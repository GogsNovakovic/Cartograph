import { Suspense } from "react";
import { listAnalyses, type AnalysisStatus, type AnalysisSummary } from "@/lib/analyses";
import { getCurrentOrganization } from "@/lib/organization";

export default function DashboardPage() {
  return (
    <section className="mx-auto flex w-full max-w-[960px] flex-col px-4 pt-5 pb-8">
      {/* Both reads depend on the request's token, so they stream in the same
          HTML response rather than being filled in by the browser. */}
      <Suspense>
        <Dashboard />
      </Suspense>
    </section>
  );
}

async function Dashboard() {
  const org = await getCurrentOrganization();
  if (!org) {
    return <p className="text-muted">This session has no active organization.</p>;
  }

  const result = await listAnalyses();

  return (
    <>
      <header className="mb-3 flex items-baseline gap-2">
        <h1 className="text-[15px] font-semibold tracking-tight">Analyses</h1>
        {result.ok && result.analyses.length > 0 && (
          <span className="font-mono text-[12px] text-muted tabular-nums">
            {result.analyses.length}
          </span>
        )}
      </header>
      {!result.ok ? (
        // Said plainly rather than shown as an empty list: an empty list here
        // would claim the organization has no analyses.
        <div className="rounded border border-border px-3 py-2.5">
          <p className="font-medium">Couldn&apos;t read analyses.</p>
          <p className="mt-0.5 font-mono text-[12px] text-muted">{result.message}</p>
        </div>
      ) : result.analyses.length === 0 ? (
        <div className="rounded border border-dashed border-border px-3 py-6">
          <p className="font-medium">No analyses yet</p>
          <p className="mt-0.5 text-muted">
            Every repository this organization maps is listed here, with how far its analysis got.
          </p>
        </div>
      ) : (
        <AnalysisTable analyses={result.analyses} />
      )}
    </>
  );
}

function AnalysisTable({ analyses }: { analyses: AnalysisSummary[] }) {
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-raised text-[11px] text-muted">
            <th className="h-7 px-3 font-normal">Repository</th>
            <th className="h-7 w-[1%] px-3 font-normal whitespace-nowrap">Status</th>
            <th className="h-7 w-[1%] px-3 font-normal whitespace-nowrap">Started</th>
            <th className="h-7 w-[1%] px-3 text-right font-normal whitespace-nowrap">Took</th>
          </tr>
        </thead>
        <tbody>
          {analyses.map((analysis) => (
            <tr key={analysis.id} className="border-b border-border last:border-b-0">
              <td className="px-3 py-1.5 align-top">
                <span className="font-mono text-[12.5px]">
                  <span className="text-muted">{analysis.repository.owner}/</span>
                  {analysis.repository.name}
                </span>
                {analysis.failureReason && (
                  <p className="mt-0.5 text-[12px] text-muted">{analysis.failureReason}</p>
                )}
              </td>
              <td className="px-3 py-1.5 align-top whitespace-nowrap">
                <Status status={analysis.status} />
              </td>
              <td className="px-3 py-1.5 align-top font-mono text-[12px] whitespace-nowrap text-muted tabular-nums">
                <Timestamp value={analysis.createdAt} />
              </td>
              <td className="px-3 py-1.5 text-right align-top font-mono text-[12px] whitespace-nowrap text-muted tabular-nums">
                {analysis.completedAt && (
                  <Duration from={analysis.createdAt} to={analysis.completedAt} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_LABELS: Record<AnalysisStatus, string> = {
  queued: "Queued",
  parsing: "Parsing",
  complete: "Complete",
  failed: "Failed",
};

// State is told by shape, not colour: colour is reserved for edge direction
// and file kind. Filled is done, half is in progress, hollow hasn't started,
// crossed stopped.
function Status({ status }: { status: AnalysisStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg viewBox="0 0 10 10" className="size-2.5 shrink-0" aria-hidden>
        {status === "complete" && <circle cx="5" cy="5" r="4.5" fill="currentColor" />}
        {status === "parsing" && (
          <>
            <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" />
            <path d="M5 0.5 A4.5 4.5 0 0 1 5 9.5 Z" fill="currentColor" />
          </>
        )}
        {status === "queued" && (
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" className="text-muted" />
        )}
        {status === "failed" && (
          <>
            <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" />
            <path d="M3.2 3.2 L6.8 6.8 M6.8 3.2 L3.2 6.8" stroke="currentColor" />
          </>
        )}
      </svg>
      <span className={status === "queued" ? "text-muted" : undefined}>
        {STATUS_LABELS[status]}
      </span>
    </span>
  );
}

// Rendered on the server, so it's UTC and says so rather than showing the
// server's local time as if it were the reader's.
function Timestamp({ value }: { value: string }) {
  const iso = new Date(value).toISOString();
  return <time dateTime={iso}>{`${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`}</time>;
}

function Duration({ from, to }: { from: string; to: string }) {
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const text = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return <time dateTime={`PT${seconds}S`}>{text}</time>;
}
