"use client";

import { useAnalysisProgress } from "@/components/realtime";
import { STAGE_LABELS, type Progress } from "@/lib/progress";

// The line above a map while it is being run again. The map stays the
// previous run's until this one swaps its own in; when the run ends the page
// is re-read, onto the new map or onto the failure.
export function RerunProgress({ analysisId, rendered, stale }: { analysisId: string; rendered: Progress; stale: boolean }) {
  const { progress, connection } = useAnalysisProgress(analysisId, rendered);
  // Any event since the render means the run is alive after all.
  const isStale = stale && progress === rendered;

  if (isStale) {
    return (
      <p>
        Nothing has been heard from the re-run for over five minutes; the process running it has most likely stopped.
        The map below is unchanged.
      </p>
    );
  }
  return (
    <p>
      <span className="font-medium">Running again</span>
      {progress.stage && <span> · {STAGE_LABELS[progress.stage]}</span>}
      {progress.message && <span className="text-muted"> — {progress.message}</span>}
      <span className="text-muted">. The map below is the previous run&apos;s until this one finishes.</span>
      {connection.state === "failed" && (
        <span className="text-muted"> Live updates unavailable: {connection.reason}</span>
      )}
    </p>
  );
}
