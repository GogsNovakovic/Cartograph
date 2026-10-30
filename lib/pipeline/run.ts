import "server-only";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSelection, selectFiles } from "../../parser/index.ts";
import type { ParseResult } from "../../parser/types.ts";
import { runCache } from "../ai/cache.ts";
import { classifyFiles, type Classified } from "../ai/classify.ts";
import { flushTraces } from "../ai/client.ts";
import type { Database } from "../database.types.ts";
import { STALE_AFTER_MS, type Stage } from "../progress.ts";
import { downloadArchive, parseRepositoryUrl, resolveCommit } from "./github.ts";
import { clearResult, storeResult, storeSuggestedRoles, type FileIds, type Stored } from "./store.ts";
import { getWriter, type Writer } from "./writer.ts";

export type StartResult =
  | { ok: true; analysisId: string; created: boolean }
  | { ok: false; message: string };

// One analysis per repository per organization. A URL that has been
// analysed before returns the existing analysis rather than a second one.
// The writer bypasses policies, so the organization is named explicitly here;
// it comes from the caller's token, never from the request body.
export async function startAnalysis(organizationId: string, url: string): Promise<StartResult> {
  const parsed = parseRepositoryUrl(url);
  if (!parsed.ok) return parsed;
  const { owner, name } = parsed.repository;
  const db = getWriter();

  const project = await db
    .from("projects")
    .upsert({ organization_id: organizationId, owner, name }, { onConflict: "organization_id,owner,name" })
    .select("id")
    .single();
  if (project.error) {
    // 23503: no organizations row for this id to hang the project on.
    if (project.error.code === "23503") return { ok: false, message: `Organization ${organizationId} has no row.` };
    return { ok: false, message: `Creating the project failed: ${project.error.message}` };
  }

  const inserted = await db
    .from("analyses")
    .upsert(
      { organization_id: organizationId, project_id: project.data.id },
      { onConflict: "project_id", ignoreDuplicates: true },
    )
    .select("id");
  if (inserted.error) return { ok: false, message: `Creating the analysis failed: ${inserted.error.message}` };
  if (inserted.data.length > 0) return { ok: true, analysisId: inserted.data[0].id, created: true };

  const existing = await db.from("analyses").select("id").eq("project_id", project.data.id).single();
  if (existing.error) return { ok: false, message: `Finding the existing analysis failed: ${existing.error.message}` };
  return { ok: true, analysisId: existing.data.id, created: false };
}

export type RunResult =
  | { ok: true; commitSha: string; stored: Stored; classification: Classification }
  | { ok: false; stage: Stage | null; message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type Claim = { analysisId: string; organizationId: string; owner: string; name: string };

export type ClaimResult = { ok: true; claim: Claim } | { ok: false; message: string };

// Takes the row for a run, resetting anything a previous run left on it.
// Refused while another run is live, so two runs never write one analysis.
// Separate from the run itself so a caller can claim before answering and
// run afterwards: the row already says "fetching" when anyone looks.
export async function claimAnalysis(analysisId: string): Promise<ClaimResult> {
  try {
    return { ok: true, claim: await claim(getWriter(), analysisId) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

async function claim(db: Writer, analysisId: string): Promise<Claim> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data, error } = await db
    .from("analyses")
    .update({
      status: "parsing",
      stage: "fetching",
      stage_message: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      failure_reason: null,
      commit_sha: null,
      schema_version: null,
      adapters: null,
      coverage: null,
      excluded_directories: null,
      classification_failure: null,
    })
    .eq("id", analysisId)
    .or(`status.neq.parsing,started_at.lt."${cutoff}"`)
    .select("organization_id, project:projects (owner, name)")
    .maybeSingle();
  if (error) throw new Error(`Starting the run failed: ${error.message}`);
  if (!data) throw new Error(`Analysis ${analysisId} doesn't exist, or a run on it is already in progress.`);
  return { analysisId, organizationId: data.organization_id, ...data.project };
}

export async function runAnalysis(analysisId: string): Promise<RunResult> {
  const claimed = await claimAnalysis(analysisId);
  // Nothing was claimed, so there is no row of ours to mark failed.
  if (!claimed.ok) return { ok: false, stage: null, message: claimed.message };
  return runClaimed(claimed.claim);
}

// Fetch, select, parse, store. Every stage is written to the row before it
// starts, so the row always says where the run is. Everything lands in the
// catch, which records the failure and the stage it happened in rather than
// leaving the row mid-run.
export async function runClaimed(claimed: Claim): Promise<RunResult> {
  const { analysisId } = claimed;
  const db = getWriter();
  let stage: Stage = "fetching";
  const update = async (values: Database["public"]["Tables"]["analyses"]["Update"]) => {
    const { error } = await db.from("analyses").update(values).eq("id", analysisId);
    if (error) throw new Error(`Updating the analysis failed: ${error.message}`);
  };
  const enter = async (next: Stage, message: string) => {
    stage = next;
    await update({ stage, stage_message: message });
  };

  let directory: string | null = null;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "cartograph-"));
    const repository = { owner: claimed.owner, name: claimed.name };
    await clearResult(db, analysisId);

    await enter("fetching", `Resolving the default branch of github.com/${repository.owner}/${repository.name}`);
    const commitSha = await resolveCommit(repository);
    await update({ commit_sha: commitSha, stage_message: `Downloading commit ${commitSha.slice(0, 7)}` });
    await downloadArchive(repository, commitSha, directory);

    await enter("selecting", "Choosing and reading source files");
    const selection = selectFiles(directory);

    // The parse is synchronous, so this write has to finish before it starts
    // or nothing would see the stage until it was over.
    await enter("parsing", `Parsing ${selection.walk.files.length} source files`);
    const result = parseSelection(selection);

    await enter("storing", `Storing ${result.files.length} files and ${result.edges.length} imports`);
    const { stored, ids } = await storeResult(db, { analysisId, organizationId: claimed.organizationId }, result);

    const unnamed = result.files.filter((file) => file.role === null && file.skipReason === null);
    await enter("classifying", `Suggesting roles for ${unnamed.length} files no convention names`);
    const classification = await classify(db, claimed, ids, directory, unnamed);

    await update({
      status: "complete",
      stage: null,
      stage_message: null,
      completed_at: new Date().toISOString(),
      schema_version: result.schemaVersion,
      framework: result.framework,
      adapters: result.adapters,
      coverage: result.coverage,
      excluded_directories: result.excludedDirectories,
      classification_failure: classification.ok ? null : classification.message,
    });
    return { ok: true, commitSha, stored, classification };
  } catch (error) {
    const message = messageOf(error);
    try {
      // A failed analysis never shows a partial map.
      await clearResult(db, analysisId);
      await update({ status: "failed", failure_reason: message, completed_at: new Date().toISOString() });
    } catch (recording) {
      // The row can't be marked, so say both things rather than lose either.
      return { ok: false, stage, message: `${message} Recording the failure also failed: ${messageOf(recording)}` };
    }
    return { ok: false, stage, message };
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    await flushTraces();
  }
}

export type Classification =
  | ({ ok: true } & Classified)
  | { ok: false; message: string };

// Roles a model suggests for files no adapter named, stored beside the
// convention roles and marked as the model's. The map is complete without
// them, so a failed call doesn't fail the run: it is recorded on the
// analysis, and the pane says no roles were suggested and why. A failure to
// store them is a storage failure like any other, and does fail it.
async function classify(
  db: Writer,
  claimed: Claim,
  ids: FileIds,
  directory: string,
  files: ParseResult["files"],
): Promise<Classification> {
  let classified: Classified;
  try {
    // A parsed file always has a hash; one without is left out rather than keyed on nothing.
    const hashed = files.flatMap((file) => (file.sha256 === null ? [] : [{ path: file.path, sha256: file.sha256 }]));
    const sources = await Promise.all(
      hashed.map(async (file) => ({ ...file, source: await readFile(path.join(directory, file.path), "utf8") })),
    );
    classified = await classifyFiles(sources, runCache(db, claimed.organizationId));
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  await storeSuggestedRoles(db, claimed, ids, classified.suggested);
  return { ok: true, ...classified };
}
