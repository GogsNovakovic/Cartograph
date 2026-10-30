"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { flushTraces } from "@/lib/ai/client";
import { getAnalysis } from "@/lib/analyses";
import { explainTarget, type ExplainResult, type ExplainTarget } from "@/lib/explain";
import { checkFreshness, type Freshness } from "@/lib/freshness";
import { getCurrentOrganization } from "@/lib/organization";
import { claimAnalysis, runClaimed, startAnalysis } from "@/lib/pipeline/run";
import { analysisPath } from "@/lib/routes";

export type ActionState = { message: string | null };

// The row is claimed before the response, so the page it lands on already
// says "fetching". The run itself happens after the response has gone: it
// can take minutes, and the page follows it over the progress channel.
async function begin(analysisId: string): Promise<string | null> {
  const claimed = await claimAnalysis(analysisId);
  if (!claimed.ok) return claimed.message;
  // A run records its own failure on the row, so its result is already where
  // the page will read it.
  after(() => runClaimed(claimed.claim));
  return null;
}

export async function analyseRepository(_previous: ActionState, form: FormData): Promise<ActionState> {
  // From the token, never the form: which organization owns the analysis is
  // not the browser's to say.
  const organization = await getCurrentOrganization();
  if (!organization) return { message: "This session has no active organization." };

  const url = form.get("url");
  if (typeof url !== "string" || url.trim() === "") return { message: "Paste a repository URL." };

  const started = await startAnalysis(organization.id, url);
  if (!started.ok) return { message: started.message };

  // An analysed repository goes to its existing analysis. Running it again
  // is done from there, on purpose, not by pasting the URL again.
  if (started.created) {
    const failed = await begin(started.analysisId);
    if (failed) return { message: failed };
  }
  redirect(analysisPath(started.analysisId));
}

export async function rerunAnalysis(analysisId: string): Promise<ActionState> {
  // Read through the policy first: the writer would run anything it's given,
  // so this is what stops one organization re-running another's analysis.
  const visible = await getAnalysis(analysisId);
  if (!visible.ok) return { message: visible.message };
  if (!visible.analysis) return { message: "No such analysis." };

  const failed = await begin(analysisId);
  if (failed) return { message: failed };
  refresh();
  return { message: null };
}

// Arguments to an action arrive from the browser unchecked, whatever their
// declared type.
function isTarget(value: unknown): value is ExplainTarget {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (value.kind === "file") return "path" in value && typeof value.path === "string";
  return value.kind === "folder" && "directory" in value && typeof value.directory === "string";
}

export async function explain(analysisId: string, target: ExplainTarget): Promise<ExplainResult> {
  if (typeof analysisId !== "string" || !isTarget(target)) return { ok: false, message: "Nothing to explain." };
  const result = await explainTarget(analysisId, target);
  // The trace is delivered after the answer, not in front of it.
  after(flushTraces);
  return result;
}

export async function freshness(analysisId: string, path: string): Promise<Freshness> {
  if (typeof analysisId !== "string" || typeof path !== "string") return { state: "unknown", message: "No file named." };
  return checkFreshness(analysisId, path);
}
