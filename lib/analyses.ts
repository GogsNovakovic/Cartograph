import "server-only";
import { isStale, type Stage, type Status } from "@/lib/progress";
import { getSupabase } from "@/lib/supabase";

export type AnalysisSummary = {
  id: string;
  status: Status;
  stage: Stage | null;
  stageMessage: string | null;
  failureReason: string | null;
  createdAt: string;
  // When the latest run began; null until one has.
  startedAt: string | null;
  completedAt: string | null;
  // The run whose rows are the map, and the commit it was built from. Both
  // null until a run has stored one; a re-run or a failed re-run keeps them.
  mapRun: string | null;
  commitSha: string | null;
  // Unfinished, and silent for longer than a live run would be, as of this read.
  stale: boolean;
  repository: { owner: string; name: string };
};

export type AnalysesResult =
  | { ok: true; analyses: AnalysisSummary[] }
  | { ok: false; message: string };

export type AnalysisResult =
  | { ok: true; analysis: AnalysisSummary | null }
  | { ok: false; message: string };

// Enough for a dashboard; paging comes when a team can actually have more.
const LIMIT = 100;

const COLUMNS =
  "id, status, stage, stage_message, failure_reason, created_at, started_at, heartbeat_at, completed_at, result_run, commit_sha, project:projects (owner, name)";

type Row = {
  id: string;
  status: Status;
  stage: Stage | null;
  stage_message: string | null;
  failure_reason: string | null;
  created_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  result_run: string | null;
  commit_sha: string | null;
  project: { owner: string; name: string };
};

function toSummary(row: Row): AnalysisSummary {
  return {
    stale: isStale(row.status, row.heartbeat_at ?? row.created_at, Date.now()),
    id: row.id,
    status: row.status,
    stage: row.stage,
    stageMessage: row.stage_message,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    mapRun: row.result_run,
    commitSha: row.commit_sha,
    repository: row.project,
  };
}

// No organization filter, on purpose. The policy scopes every row to the
// organization on the token, so switching organization changes what this
// same query returns. If another organization's row ever shows up here, the
// fix belongs in the policy, not in a where clause.
export async function listAnalyses(): Promise<AnalysesResult> {
  const { data, error } = await getSupabase()
    .from("analyses")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) return { ok: false, message: error.message };
  return { ok: true, analyses: data.map(toSummary) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Null when the policy hides it, which is the same answer as not existing:
// another organization's analysis is absent, not forbidden.
export async function getAnalysis(id: string): Promise<AnalysisResult> {
  // Anything else would come back as a Postgres cast error rather than "no
  // such analysis".
  if (!UUID.test(id)) return { ok: true, analysis: null };

  const { data, error } = await getSupabase().from("analyses").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) return { ok: false, message: error.message };
  return { ok: true, analysis: data && toSummary(data) };
}
