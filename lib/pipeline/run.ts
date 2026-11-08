import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ParseResult } from "../../parser/types.ts";
import { runCache } from "../ai/cache.ts";
import { classifyFiles, type Classified } from "../ai/classify.ts";
import { flushTraces } from "../ai/client.ts";
import type { Database } from "../database.types.ts";
import { STALE_AFTER_MS, type Stage } from "../progress.ts";
import { downloadArchive, parseRepositoryUrl, resolveCommit } from "./github.ts";
import { parseInChild } from "./parse.ts";
import { clearOtherRuns, clearRun, storeResult, storeSuggestedRoles, type FileIds, type Owner, type Stored } from "./store.ts";
import { getWriter, type Writer } from "./writer.ts";

export type StartResult =
  | { ok: true; analysisId: string; created: boolean }
  | { ok: false; message: string };

// One analysis per repository per organization. A URL that has been
// analysed before returns the existing analysis rather than a second one.
// The writer bypasses policies, so the organization is named explicitly here;
// it comes from the caller's token, never from the request body.
export async function startAnalysis(
  organization: { id: string; name: string },
  url: string,
): Promise<StartResult> {
  const parsed = parseRepositoryUrl(url);
  if (!parsed.ok) return parsed;
  const { owner, name } = parsed.repository;
  const organizationId = organization.id;
  const db = getWriter();

  // Organizations live in Clerk and nothing tells this database when one is
  // made, so its row is created by its first analysis. An existing row is
  // left as it is: the name is only a label, and a terminal run has no
  // token to read the real one from.
  const created = await db
    .from("organizations")
    .upsert({ id: organizationId, name: organization.name }, { onConflict: "id", ignoreDuplicates: true });
  if (created.error) return { ok: false, message: `Recording the organization failed: ${created.error.message}` };

  const project = await db
    .from("projects")
    .upsert({ organization_id: organizationId, owner, name }, { onConflict: "organization_id,owner,name" })
    .select("id")
    .single();
  if (project.error) return { ok: false, message: `Creating the project failed: ${project.error.message}` };

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

// `mapRun` is the run whose rows are the analysis's map when the claim was
// made, or null if it has none yet.
export type Claim = { analysisId: string; organizationId: string; owner: string; name: string; mapRun: string | null };

export type ClaimResult = { ok: true; claim: Claim } | { ok: false; message: string };

// Takes the row for a run, resetting the previous run's progress. The map
// and everything it's drawn from stay: they change only when a new run swaps
// its own in.
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
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("analyses")
    .update({
      status: "parsing",
      stage: "fetching",
      stage_message: null,
      started_at: now,
      heartbeat_at: now,
      completed_at: null,
      failure_reason: null,
    })
    .eq("id", analysisId)
    .or(`status.neq.parsing,heartbeat_at.lt."${cutoff}"`)
    .select("organization_id, result_run, project:projects (owner, name)")
    .maybeSingle();
  if (error) throw new Error(`Starting the run failed: ${error.message}`);
  if (!data) throw new Error(`Analysis ${analysisId} doesn't exist, or a run on it is already in progress.`);
  return { analysisId, organizationId: data.organization_id, mapRun: data.result_run, ...data.project };
}

export async function runAnalysis(analysisId: string): Promise<RunResult> {
  const claimed = await claimAnalysis(analysisId);
  // Nothing was claimed, so there is no row of ours to mark failed.
  if (!claimed.ok) return { ok: false, stage: null, message: claimed.message };
  return runClaimed(claimed.claim);
}

// Fetch, select, parse, store. Every stage is written to the row before it
// starts, so the row always says where the run is. The run stores its rows
// beside the current map and swaps them in with its last write. Everything
// lands in the catch, which removes this run's rows and records the failure
// and the stage it happened in, leaving any earlier map as it was.
export async function runClaimed(claimed: Claim): Promise<RunResult> {
  const { analysisId } = claimed;
  const db = getWriter();
  const owner: Owner = { analysisId, organizationId: claimed.organizationId, run: randomUUID() };
  let stage: Stage = "fetching";
  // Every write to the row is also a heartbeat, so a run that is still
  // writing is never read as abandoned.
  const update = async (values: Database["public"]["Tables"]["analyses"]["Update"]) => {
    const { error } = await db
      .from("analyses")
      .update({ ...values, heartbeat_at: new Date().toISOString() })
      .eq("id", analysisId);
    if (error) throw new Error(`Updating the analysis failed: ${error.message}`);
  };
  const enter = async (next: Stage, message: string) => {
    stage = next;
    await update({ stage, stage_message: message });
  };

  let work: string | null = null;
  try {
    // The repository is unpacked into its own folder, so the parse result
    // written beside it is never mistaken for one of its files.
    work = await mkdtemp(path.join(tmpdir(), "cartograph-"));
    const directory = path.join(work, "repository");
    await mkdir(directory);
    const repository = { owner: claimed.owner, name: claimed.name };
    // Whatever a crashed run left behind; never the map on screen.
    await clearOtherRuns(db, analysisId, claimed.mapRun);

    await enter("fetching", `Resolving the default branch of github.com/${repository.owner}/${repository.name}`);
    const commitSha = await resolveCommit(repository);
    // Recorded with the map at the swap, not now: until then the commit on
    // the row is the one the current map was built from.
    await update({ stage_message: `Downloading commit ${commitSha.slice(0, 7)}` });
    await downloadArchive(repository, commitSha, directory);

    // Selecting and parsing happen in another process, which can't write to
    // the row, so this one reports in for it while it waits.
    await enter("selecting", "Choosing and reading source files");
    const result = await whileWaiting(
      () => update({}),
      parseInChild(directory, path.join(work, "result.json"), (files) =>
        enter("parsing", `Parsing ${files} source files`),
      ),
    );

    await enter("storing", `Storing ${result.files.length} files and ${result.edges.length} imports`);
    const { stored, ids } = await storeResult(db, owner, result);

    const unnamed = result.files.filter((file) => file.role === null && file.skipReason === null);
    await enter("classifying", `Suggesting roles for ${unnamed.length} files no convention names`);
    const classification = await classify(db, claimed, owner, ids, directory, unnamed, () => update({}));

    // The swap: the map and everything it's drawn from, in one write.
    await update({
      status: "complete",
      stage: null,
      stage_message: null,
      completed_at: new Date().toISOString(),
      result_run: owner.run,
      commit_sha: commitSha,
      schema_version: result.schemaVersion,
      framework: result.framework,
      adapters: result.adapters,
      coverage: result.coverage,
      excluded_directories: result.excludedDirectories,
      classification_failure: classification.ok ? null : classification.message,
    });
    // The map it replaced. Reads only ever see the run the analysis names, so
    // rows that outlive a failure here are invisible, and the next run clears
    // them; the run itself has succeeded and isn't marked otherwise.
    await clearOtherRuns(db, analysisId, owner.run).catch((error: unknown) => {
      console.error(`analysis ${analysisId}: ${messageOf(error)} The next run removes them.`);
    });
    return { ok: true, commitSha, stored, classification };
  } catch (error) {
    const message = messageOf(error);
    try {
      // Never a partial map: this run's rows go, and any earlier map stays.
      await clearRun(db, analysisId, owner.run);
      await update({ status: "failed", failure_reason: message, completed_at: new Date().toISOString() });
    } catch (recording) {
      // The row can't be marked, so say both things rather than lose either.
      return { ok: false, stage, message: `${message} Recording the failure also failed: ${messageOf(recording)}` };
    }
    return { ok: false, stage, message };
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
    await flushTraces();
  }
}

// Well inside the five minutes after which a silent run reads as abandoned.
const HEARTBEAT_MS = 60 * 1000;

// Reports in every minute until `work` settles. A heartbeat that can't be
// written fails the run once the work is done, rather than leaving it to be
// taken for abandoned while it is still going.
async function whileWaiting<T>(beat: () => Promise<void>, work: Promise<T>): Promise<T> {
  let failed: string | null = null;
  const timer = setInterval(() => {
    beat().catch((error: unknown) => {
      failed ??= messageOf(error);
    });
  }, HEARTBEAT_MS);
  try {
    const value = await work;
    if (failed !== null) throw new Error(`Reporting in during the parse failed: ${failed}`);
    return value;
  } finally {
    clearInterval(timer);
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
  owner: Owner,
  ids: FileIds,
  directory: string,
  files: ParseResult["files"],
  heartbeat: () => Promise<void>,
): Promise<Classification> {
  let classified: Classified;
  try {
    // A parsed file always has a hash; one without is left out rather than keyed on nothing.
    const hashed = files.flatMap((file) => (file.sha256 === null ? [] : [{ path: file.path, sha256: file.sha256 }]));
    const sources = await Promise.all(
      hashed.map(async (file) => ({ ...file, source: await readFile(path.join(directory, file.path), "utf8") })),
    );
    classified = await classifyFiles(sources, runCache(db, claimed.organizationId), heartbeat);
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  await storeSuggestedRoles(db, owner, ids, classified.suggested);
  return { ok: true, ...classified };
}
