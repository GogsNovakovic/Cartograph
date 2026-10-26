"use client";

import Link from "next/link";
import { useState } from "react";
import { RerunButton } from "@/components/analyse-form";
import type { CoverageSummary } from "@/lib/map/coverage";
import { HOME_PATH } from "@/lib/routes";

// The strip above a finished map: which repository and commit it is, how
// much of the import graph it shows, and running it again. When the graph is
// partial the reasons open underneath; folded, the line still names the
// figure, so a partial map can never pass for a complete one.
export function CoverageBanner({
  analysisId,
  repository,
  commitSha,
  coverage,
}: {
  analysisId: string;
  repository: { owner: string; name: string };
  commitSha: string | null;
  coverage: CoverageSummary;
}) {
  const [open, setOpen] = useState(coverage.partial);
  const unresolved = coverage.aimed - coverage.resolved;

  return (
    <div className="shrink-0 border-b border-border text-[12.5px]">
      <div className="flex h-8 items-center gap-3 px-3">
        <Link href={HOME_PATH} className="text-muted hover:text-text">
          Analyses
        </Link>
        <span className="font-mono">
          <span className="text-muted">{repository.owner}/</span>
          {repository.name}
        </span>
        {commitSha && (
          <span className="font-mono text-[12px] text-muted" title={commitSha}>
            {commitSha.slice(0, 7)}
          </span>
        )}
        <span aria-hidden className="h-4 w-px bg-border" />
        <span className="min-w-0 truncate">
          {coverage.partial ? (
            <>
              <span className="font-semibold">Partial graph: {coverage.percent}%</span>
              <span className="text-muted">
                {" "}
                of {coverage.aimed} imports into the repository resolved
                {unresolved > 0 && ` · ${unresolved} not drawn`}
                {coverage.skipped.length > 0 && ` · ${coverage.skipped.length} files skipped`}
              </span>
            </>
          ) : (
            <span className="text-muted">All {coverage.aimed} imports into the repository resolved</span>
          )}
        </span>
        {coverage.partial && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="shrink-0 text-muted hover:text-text"
          >
            {open ? "Hide why" : "Why"}
          </button>
        )}
        <span className="flex-1" />
        <RerunButton analysisId={analysisId} />
      </div>
      {open && coverage.partial && (
        <div className="max-h-[220px] overflow-y-auto border-t border-border bg-raised px-3 py-2">
          {coverage.missing.map((group) => (
            <div key={group.label} className="mb-1.5">
              <p>
                <span className="font-mono tabular-nums">{group.count}</span> imports {group.label}
              </p>
              <ul className="mt-0.5 pl-3 font-mono text-[11.5px] text-muted">
                {group.examples.slice(0, 3).map((x) => (
                  <li key={`${x.from}:${x.line}:${x.specifier}`} className="truncate">
                    {x.from}:{x.line} &quot;{x.specifier}&quot; — {x.detail}
                  </li>
                ))}
                {group.count > 3 && <li>… {group.count - 3} more</li>}
              </ul>
            </div>
          ))}
          {coverage.skipped.length > 0 && (
            <div>
              <p>
                <span className="font-mono tabular-nums">{coverage.skipped.length}</span> files skipped, so nothing
                they import is drawn
              </p>
              <ul className="mt-0.5 pl-3 font-mono text-[11.5px] text-muted">
                {coverage.skipped.map((file) => (
                  <li key={file.path} className="truncate">
                    {file.path} — {file.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
