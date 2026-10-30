import "server-only";
import { createHash } from "node:crypto";
import { getAnalysis } from "@/lib/analyses";
import { fetchFile, resolveCommit, type Repository } from "@/lib/pipeline/github";
import { getSupabase } from "@/lib/supabase";

// Whether what the map was built from is still what the repository holds.
export type Freshness =
  | { state: "current"; commit: string }
  | { state: "moved"; analysed: string; head: string; file: "changed" | "unchanged" | "removed" }
  | { state: "unknown"; message: string };

// Clicking through several files asks the same question of the same
// repository each time, and each answer spends two of the sixty
// unauthenticated API requests an hour a run also needs. Short enough that a
// push followed by a reload is seen.
const HEAD_FOR_MS = 15_000;
const heads = new Map<string, { sha: string; at: number }>();

async function headOf(repository: Repository): Promise<string> {
  const key = `${repository.owner}/${repository.name}`;
  const known = heads.get(key);
  if (known && Date.now() - known.at < HEAD_FOR_MS) return known.sha;
  const sha = await resolveCommit(repository);
  heads.set(key, { sha, at: Date.now() });
  return sha;
}

// The file's stored content hash against the same path at the repository's
// current commit. A repository that has moved on is reported even when this
// file hasn't changed: its neighbours may have.
export async function checkFreshness(analysisId: string, path: string): Promise<Freshness> {
  try {
    const found = await getAnalysis(analysisId);
    if (!found.ok) return { state: "unknown", message: found.message };
    const analysis = found.analysis;
    if (!analysis?.commitSha) return { state: "unknown", message: "This analysis has no recorded commit." };

    const { data, error } = await getSupabase()
      .from("files")
      .select("sha256")
      .eq("analysis_id", analysis.id)
      .eq("path", path)
      .maybeSingle();
    if (error) return { state: "unknown", message: `Reading the file failed: ${error.message}` };
    if (!data?.sha256) return { state: "unknown", message: `${path} has no stored content hash.` };

    const head = await headOf(analysis.repository);
    if (head === analysis.commitSha) return { state: "current", commit: head };
    const bytes = await fetchFile(analysis.repository, head, path);
    const file =
      bytes === null ? "removed" : createHash("sha256").update(bytes).digest("hex") === data.sha256 ? "unchanged" : "changed";
    return { state: "moved", analysed: analysis.commitSha, head, file };
  } catch (error) {
    return { state: "unknown", message: error instanceof Error ? error.message : String(error) };
  }
}
