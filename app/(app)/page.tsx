import { Suspense } from "react";
import { listAnalyses, type AnalysisSummary } from "@/lib/analyses";
import { getCurrentOrganization } from "@/lib/organization";

export default function DashboardPage() {
  return (
    <section className="flex flex-col">
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
    return <p className="p-3 text-muted">This session has no active organization.</p>;
  }

  const result = await listAnalyses();

  return (
    <>
      <header className="flex h-8 items-center gap-2 border-b border-border px-3">
        <h1 className="font-medium">Analyses</h1>
        {result.ok && result.analyses.length > 0 && (
          <span className="text-muted tabular-nums">{result.analyses.length}</span>
        )}
      </header>
      {!result.ok ? (
        // Said plainly rather than shown as an empty list: an empty list here
        // would claim the organization has no analyses.
        <p className="p-3">
          Couldn&apos;t read analyses: <span className="font-mono">{result.message}</span>
        </p>
      ) : result.analyses.length === 0 ? (
        <p className="p-3 text-muted">This organization hasn&apos;t analysed a repository yet.</p>
      ) : (
        <AnalysisTable analyses={result.analyses} />
      )}
    </>
  );
}

function AnalysisTable({ analyses }: { analyses: AnalysisSummary[] }) {
  return (
    <table className="w-full border-collapse text-left">
      <thead className="text-muted">
        <tr className="border-b border-border">
          <th className="h-7 px-3 font-normal">Repository</th>
          <th className="h-7 px-3 font-normal">Status</th>
          <th className="h-7 px-3 font-normal">Started</th>
          <th className="h-7 px-3 font-normal">Finished</th>
        </tr>
      </thead>
      <tbody>
        {analyses.map((analysis) => (
          <tr key={analysis.id} className="border-b border-border align-baseline">
            <td className="h-7 px-3 font-mono">
              {analysis.repository.owner}/{analysis.repository.name}
            </td>
            <td className="h-7 px-3">
              {analysis.status}
              {analysis.failureReason && (
                <span className="ml-2 text-muted">{analysis.failureReason}</span>
              )}
            </td>
            <td className="h-7 px-3 font-mono text-muted tabular-nums">
              <Timestamp value={analysis.createdAt} />
            </td>
            <td className="h-7 px-3 font-mono text-muted tabular-nums">
              {analysis.completedAt && <Timestamp value={analysis.completedAt} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Rendered on the server, so it's UTC and says so rather than showing the
// server's local time as if it were the reader's.
function Timestamp({ value }: { value: string }) {
  const iso = new Date(value).toISOString();
  return <time dateTime={iso}>{`${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`}</time>;
}
