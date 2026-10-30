import "server-only";
import { createHash } from "node:crypto";
import { sessionCache } from "@/lib/ai/cache";
import { explainFile, explainFolder, fileInput, folderInput, type Explanation } from "@/lib/ai/explain";
import { getAnalysis } from "@/lib/analyses";
import { buildMapModel } from "@/lib/map/model";
import { getCurrentOrganization } from "@/lib/organization";
import { fetchFile, type Repository } from "@/lib/pipeline/github";
import { getWriter } from "@/lib/pipeline/writer";
import { readStoredResult } from "@/lib/stored-result";
import { getSupabase } from "@/lib/supabase";

export type ExplainTarget = { kind: "file"; path: string } | { kind: "folder"; directory: string };

export type ExplainResult = { ok: true; explanation: Explanation } | { ok: false; message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The browser names what to explain and nothing else. Everything the model
// is handed is read here, through the policy, from the stored analysis: a
// browser can't hand it a neighbour list, and another organization's
// analysis reads as absent.
export async function explainTarget(analysisId: string, target: ExplainTarget): Promise<ExplainResult> {
  const organization = await getCurrentOrganization();
  if (!organization) return { ok: false, message: "This session has no active organization." };
  const found = await getAnalysis(analysisId);
  if (!found.ok) return found;
  const analysis = found.analysis;
  if (!analysis) return { ok: false, message: "No such analysis." };
  if (analysis.status !== "complete" || analysis.commitSha === null) {
    return { ok: false, message: "This analysis has no complete map to explain." };
  }
  const stored = await readStoredResult(analysis.id, analysis.repository);
  if (!stored.ok) return { ok: false, message: stored.message };

  const repository = `${analysis.repository.owner}/${analysis.repository.name}`;
  const store = sessionCache(getSupabase(), getWriter(), organization.id);
  try {
    if (target.kind === "folder") {
      // Folded exactly as the page folds it, so the folder is the box on screen.
      const model = buildMapModel(stored.result, { roles: stored.suggested, failure: stored.classificationFailure });
      const input = folderInput(repository, model, target.directory);
      if (!input.ok) return input;
      return { ok: true, explanation: await explainFolder(input.input, store) };
    }
    const input = fileInput(repository, stored.result, stored.suggested, target.path);
    if (!input.ok) return input;
    const commit = analysis.commitSha;
    const explanation = await explainFile(input.input, {
      store,
      source: () => sourceAt(analysis.repository, commit, input.input),
    });
    return { ok: true, explanation };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

// The file exactly as the parser read it. If GitHub's copy at that commit
// hashes differently, it is not what the map was built from, and explaining
// it would describe something else.
async function sourceAt(repository: Repository, commit: string, file: { path: string; sha256: string }): Promise<string> {
  const short = commit.slice(0, 7);
  const bytes = await fetchFile(repository, commit, file.path);
  if (bytes === null) throw new Error(`GitHub has no ${file.path} at ${short}.`);
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    throw new Error(`GitHub's copy of ${file.path} at ${short} doesn't match what the parser read, so it isn't explained from it.`);
  }
  return bytes.toString("utf8");
}
