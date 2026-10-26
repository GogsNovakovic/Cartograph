"use client";

import { AnalysisStatus, StatusMark } from "@/components/analysis-status";
import { useAnalysisProgress } from "@/components/realtime";
import { STAGE_LABELS, STAGES, type Progress, type Stage } from "@/lib/progress";

type StageState = "done" | "current" | "failed" | "pending";

function stateOf(stage: Stage, progress: Progress): StageState {
  if (progress.status === "complete") return "done";
  if (progress.status === "queued" || progress.stage === null) return "pending";
  const at = STAGES.indexOf(progress.stage);
  const index = STAGES.indexOf(stage);
  if (index < at) return "done";
  if (index > at) return "pending";
  return progress.status === "failed" ? "failed" : "current";
}

const MARKS: Record<StageState, "complete" | "parsing" | "failed" | "queued"> = {
  done: "complete",
  current: "parsing",
  failed: "failed",
  pending: "queued",
};

// The stages by name as the run passes through them, and what the current
// one is doing. Nothing animates: a stage changes when the database says it
// has.
export function AnalysisProgress({ analysisId, rendered, stale }: { analysisId: string; rendered: Progress; stale: boolean }) {
  const { progress, connection } = useAnalysisProgress(analysisId, rendered);
  const isStale = stale && progress === rendered;

  return (
    <div className="rounded border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-raised px-3 py-1.5">
        <AnalysisStatus status={progress.status} stale={isStale} />
        <span className="flex-1" />
        <span className="text-[11px] text-muted">
          {connection.state === "live"
            ? "Live"
            : connection.state === "connecting"
              ? "Connecting…"
              : `Live updates unavailable: ${connection.reason}`}
        </span>
      </div>
      <ol className="px-3 py-2">
        {STAGES.map((stage) => {
          const state = stateOf(stage, progress);
          return (
            <li key={stage} className="flex items-baseline gap-2 py-0.5">
              <span className="relative top-px">
                <StatusMark mark={MARKS[state]} />
              </span>
              <span className={state === "pending" ? "text-muted" : undefined}>{STAGE_LABELS[stage]}</span>
              {(state === "current" || state === "failed") && progress.message && (
                <span className={state === "failed" ? "min-w-0" : "min-w-0 text-muted"}>— {progress.message}</span>
              )}
            </li>
          );
        })}
      </ol>
      {isStale && (
        <p className="border-t border-border px-3 py-1.5 text-[12px] text-muted">
          Nothing has been heard from this run for over five minutes. The process running it has most likely stopped.
        </p>
      )}
    </div>
  );
}
