"use client";

import { AnalysisStatus } from "@/components/analysis-status";
import { useAnalysisProgress } from "@/components/realtime";
import { STAGE_LABELS, type Progress } from "@/lib/progress";

// A dashboard row's status while its run is unfinished, kept current by the
// run's own channel, so a second tab follows a run started in the first.
export function LiveStatus({ analysisId, rendered, stale }: { analysisId: string; rendered: Progress; stale: boolean }) {
  const { progress, connection } = useAnalysisProgress(analysisId, rendered);
  // Any event since the render means the run is alive after all.
  const isStale = stale && progress === rendered;

  return (
    <div>
      <AnalysisStatus status={progress.status} stale={isStale} />
      {progress.stage && !isStale && (
        <span className="ml-1.5 text-muted">· {STAGE_LABELS[progress.stage]}</span>
      )}
      {connection.state === "failed" && (
        <p className="mt-0.5 text-[11px] text-muted">Live updates unavailable: {connection.reason}</p>
      )}
    </div>
  );
}
