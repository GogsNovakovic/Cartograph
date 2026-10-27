// The repository as a whole, for the detail pane's resting state. Pure
// arithmetic over the file list and the adjacency, like the insights.

import type { Adjacency } from "./graph.ts";

// Ten rows is a list someone reads; the whole tail is one click away.
export const SUMMARY_ROWS = 10;

export type RepositorySummary = {
  files: number;
  // Distinct importer → imported pairs: the edges on the map.
  links: number;
  // Files no adapter named; they're reached only through imports, if at all.
  unidentified: number;
  // Every file something imports, most importers first.
  leanedOn: number[];
  // Every file nothing imports, the ones importing the most first: those
  // pull the rest of the repository in.
  unimported: number[];
};

export function summarize(files: readonly { role: string | null }[], graph: Adjacency): RepositorySummary {
  const indexes = files.map((_, i) => i);
  const fanIn = (i: number) => graph.importers[i].length;
  const fanOut = (i: number) => graph.imports[i].length;
  return {
    files: files.length,
    links: graph.imports.reduce((sum, targets) => sum + targets.length, 0),
    unidentified: files.filter((file) => file.role === null).length,
    leanedOn: indexes.filter((i) => fanIn(i) > 0).sort((a, b) => fanIn(b) - fanIn(a) || a - b),
    unimported: indexes.filter((i) => fanIn(i) === 0).sort((a, b) => fanOut(b) - fanOut(a) || a - b),
  };
}
