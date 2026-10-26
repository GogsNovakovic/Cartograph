import type { Status } from "@/lib/progress";

const LABELS: Record<Status, string> = {
  queued: "Queued",
  parsing: "Running",
  complete: "Complete",
  failed: "Failed",
};

// State is told by shape, not colour: colour is reserved for edge direction
// and file kind. Filled is done, half is in progress, hollow hasn't started,
// crossed stopped, dashed was left unfinished.
export function AnalysisStatus({ status, stale = false }: { status: Status; stale?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusMark mark={stale ? "stale" : status} />
      <span className={status === "queued" || stale ? "text-muted" : undefined}>
        {stale ? "Stale" : LABELS[status]}
      </span>
    </span>
  );
}

export function StatusMark({ mark }: { mark: Status | "stale" }) {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5 shrink-0" aria-hidden>
      {mark === "complete" && <circle cx="5" cy="5" r="4.5" fill="currentColor" />}
      {mark === "parsing" && (
        <>
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" />
          <path d="M5 0.5 A4.5 4.5 0 0 1 5 9.5 Z" fill="currentColor" />
        </>
      )}
      {mark === "queued" && <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" className="text-muted" />}
      {mark === "failed" && (
        <>
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" />
          <path d="M3.2 3.2 L6.8 6.8 M6.8 3.2 L3.2 6.8" stroke="currentColor" />
        </>
      )}
      {mark === "stale" && (
        <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeDasharray="1.6 1.6" className="text-muted" />
      )}
    </svg>
  );
}
