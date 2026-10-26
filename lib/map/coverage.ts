// How much of the import graph the map actually shows, as one figure and the
// reasons behind the rest. Pure: a parse result's coverage and files in.

import type { Coverage, FileNode, ImportExample, ImportReason } from "../../parser/types.ts";

// Imports that name another file in the repository but aren't drawn. A
// package or a stylesheet was never going to be an edge between source
// files; these were, and the map is missing them.
const MISSING: Partial<Record<ImportReason, string>> = {
  "no-such-file": "point at no file",
  "directory-without-index": "point at a folder with no index file",
  "alias-without-target": "use a path alias that matched no file",
  "base-url-without-target": "use a baseUrl path that matched no file",
  "workspace-package-without-entry": "name a workspace package with no entry file",
  "computed-specifier": "are computed at runtime, so name no file",
  "excluded-directory": "land in a directory that is never read",
};

export type MissingGroup = { label: string; count: number; examples: ImportExample[] };

export type CoverageSummary = {
  // Imports aimed at the repository, and how many of them became edges.
  aimed: number;
  resolved: number;
  // Rounded down, so a graph missing anything never reads as 100%.
  percent: string;
  missing: MissingGroup[];
  skipped: { path: string; reason: string }[];
  partial: boolean;
};

export function summariseCoverage(coverage: Coverage, files: FileNode[]): CoverageSummary {
  const missing = coverage.reasons.flatMap((group) => {
    const label = MISSING[group.reason];
    return label ? [{ label, count: group.count, examples: group.examples }] : [];
  });
  const resolved = coverage.imports.resolved;
  const aimed = resolved + missing.reduce((sum, group) => sum + group.count, 0);
  const skipped = files.flatMap((file) => (file.skipReason ? [{ path: file.path, reason: file.skipReason }] : []));
  const percent = aimed === 0 ? "100" : (Math.floor((resolved / aimed) * 1000) / 10).toFixed(1).replace(/\.0$/, "");
  return { aimed, resolved, percent, missing, skipped, partial: resolved < aimed || skipped.length > 0 };
}
