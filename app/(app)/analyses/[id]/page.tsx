import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { RerunButton } from "@/components/analyse-form";
import { AnalysisProgress } from "@/components/analysis-progress";
import { AnalysisView } from "@/components/analysis-view";
import { CoverageBanner } from "@/components/coverage-banner";
import { getAnalysis, type AnalysisSummary } from "@/lib/analyses";
import { summariseCoverage } from "@/lib/map/coverage";
import { findInsights } from "@/lib/map/graph";
import { buildMapModel } from "@/lib/map/model";
import { HOME_PATH } from "@/lib/routes";
import { readStoredResult } from "@/lib/stored-result";

// One address per analysis. While it runs, or if it failed, this is its
// progress; once complete it is its map. The progress view re-reads the page
// when the run ends, so finishing lands here on the map without a redirect.
export default function AnalysisPage({ params }: PageProps<"/analyses/[id]">) {
  return (
    // Reading a map is several queries; without a fallback a click shows
    // nothing until they finish and looks like it didn't register.
    <Suspense
      fallback={
        <Page>
          <p className="text-muted">Loading analysis…</p>
        </Page>
      }
    >
      <Analysis params={params} />
    </Suspense>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <section className="mx-auto flex w-full max-w-[960px] flex-col px-4 pt-5 pb-8">{children}</section>;
}

async function AnalysisMap({ analysis }: { analysis: AnalysisSummary }) {
  const stored = await readStoredResult(analysis.id, analysis.repository);
  if (!stored.ok) {
    return (
      <Page>
        <div className="rounded border border-border px-3 py-2.5">
          <p className="font-medium">Couldn&apos;t rebuild this map from its stored rows.</p>
          <p className="mt-0.5 font-mono text-[12px] text-muted">{stored.message}</p>
          {stored.stale && (
            <div className="mt-2">
              <RerunButton analysisId={analysis.id} />
            </div>
          )}
        </div>
      </Page>
    );
  }
  const model = buildMapModel(stored.result);
  return (
    <>
      <CoverageBanner
        analysisId={analysis.id}
        repository={analysis.repository}
        commitSha={analysis.commitSha}
        coverage={summariseCoverage(stored.result.coverage, stored.result.files)}
      />
      <AnalysisView model={model} insights={findInsights(model.files, model.links)} />
    </>
  );
}

async function Analysis({ params }: { params: PageProps<"/analyses/[id]">["params"] }) {
  const { id } = await params;
  const result = await getAnalysis(id);
  if (!result.ok) {
    return (
      <Page>
        <div className="rounded border border-border px-3 py-2.5">
          <p className="font-medium">Couldn&apos;t read this analysis.</p>
          <p className="mt-0.5 font-mono text-[12px] text-muted">{result.message}</p>
        </div>
      </Page>
    );
  }
  // Another organization's analysis lands here too: the policy returns no
  // row, so to this session it doesn't exist.
  if (!result.analysis) notFound();

  const analysis = result.analysis;
  if (analysis.status === "complete") return <AnalysisMap analysis={analysis} />;

  return (
    <Page>
      <nav className="mb-2 text-[12px] text-muted">
        <Link href={HOME_PATH} className="hover:text-text">
          Analyses
        </Link>
      </nav>
      <header className="mb-3 flex items-baseline gap-3">
        <h1 className="font-mono text-[14px] font-semibold">
          <span className="font-normal text-muted">{analysis.repository.owner}/</span>
          {analysis.repository.name}
        </h1>
        {analysis.commitSha && (
          <span className="font-mono text-[12px] text-muted" title={analysis.commitSha}>
            {analysis.commitSha.slice(0, 7)}
          </span>
        )}
        <span className="flex-1" />
        {/* Running again is deliberate and from the analysis, never a side
            effect of pasting the URL again. Not offered while a run is live;
            a finished map offers it in its banner. */}
        {(analysis.status === "failed" || analysis.stale) && <RerunButton analysisId={analysis.id} />}
      </header>
      <AnalysisProgress
        analysisId={analysis.id}
        rendered={{
          status: analysis.status,
          stage: analysis.stage,
          message: analysis.failureReason ?? analysis.stageMessage,
        }}
        stale={analysis.stale}
      />
    </Page>
  );
}
