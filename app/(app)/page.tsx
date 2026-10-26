import Link from "next/link";
import { Suspense } from "react";
import { AnalyseForm } from "@/components/analyse-form";
import { AnalysisStatus } from "@/components/analysis-status";
import { LiveStatus } from "@/components/live-status";
import { listAnalyses, type AnalysisSummary } from "@/lib/analyses";
import { getCurrentOrganization } from "@/lib/organization";
import { analysisPath } from "@/lib/routes";

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
      <AnalyseForm />
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
          {analyses.map((analysis) => {
            const started = analysis.startedAt ?? analysis.createdAt;
            const unfinished = analysis.status === "queued" || analysis.status === "parsing";
            return (
              <tr key={analysis.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-1.5 align-top">
                  <Link href={analysisPath(analysis.id)} className="font-mono text-[12.5px] hover:underline">
                    <span className="text-muted">{analysis.repository.owner}/</span>
                    {analysis.repository.name}
                  </Link>
                  {analysis.failureReason && (
                    <p className="mt-0.5 text-[12px] text-muted">{analysis.failureReason}</p>
                  )}
                </td>
                <td className="px-3 py-1.5 align-top whitespace-nowrap">
                  {/* Only an unfinished run can still change, so only those
                      rows subscribe. */}
                  {unfinished ? (
                    <LiveStatus
                      analysisId={analysis.id}
                      rendered={{ status: analysis.status, stage: analysis.stage, message: analysis.stageMessage }}
                      stale={analysis.stale}
                    />
                  ) : (
                    <AnalysisStatus status={analysis.status} />
                  )}
                </td>
                <td className="px-3 py-1.5 align-top font-mono text-[12px] whitespace-nowrap text-muted tabular-nums">
                  <Timestamp value={started} />
                </td>
                <td className="px-3 py-1.5 text-right align-top font-mono text-[12px] whitespace-nowrap text-muted tabular-nums">
                  {analysis.completedAt && <Duration from={started} to={analysis.completedAt} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
