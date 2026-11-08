"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { flushTraces } from "@/lib/ai/client";
import { getAnalysis } from "@/lib/analyses";
import { explainTarget, type ExplainResult, type ExplainTarget } from "@/lib/explain";
import { checkFreshness, type Freshness } from "@/lib/freshness";
import { analysisPath } from "@/lib/routes";
import { analyse, begin } from "./start";

export type ActionState = { message: string | null };

export async function analyseRepository(_previous: ActionState, form: FormData): Promise<ActionState> {
  const started = await analyse(form.get("url"));
  if (!started.ok) return { message: started.message };
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
