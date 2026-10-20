import "server-only";
import type { Database } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase";

export type AnalysisStatus = Database["public"]["Enums"]["analysis_status"];

export type AnalysisSummary = {
  id: string;
  status: AnalysisStatus;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  repository: { owner: string; name: string };
};

export type AnalysesResult =
  | { ok: true; analyses: AnalysisSummary[] }
  | { ok: false; message: string };

// Enough for a dashboard; paging comes when a team can actually have more.
const LIMIT = 100;

// No organization filter, on purpose. The policy scopes every row to the
// organization on the token, so switching organization changes what this
// same query returns. If another organization's row ever shows up here, the
// fix belongs in the policy, not in a where clause.
export async function listAnalyses(): Promise<AnalysesResult> {
  const { data, error } = await getSupabase()
    .from("analyses")
    .select("id, status, failure_reason, created_at, completed_at, project:projects (owner, name)")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) return { ok: false, message: error.message };

  return {
    ok: true,
    analyses: data.map((row) => ({
      id: row.id,
      status: row.status,
      failureReason: row.failure_reason,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      repository: row.project,
    })),
  };
}
