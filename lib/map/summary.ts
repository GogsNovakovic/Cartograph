// The repository as a whole, for the detail pane's resting state. Pure
// arithmetic over the file list and the adjacency, like the insights.

import type { Adjacency } from "./graph.ts";

// Roles an adapter gives a file that a URL is served from. A count of these
// files, not of routes: method and full path aren't recovered, so no route
// is ever listed.
const ROUTE_ROLES: ReadonlySet<string> = new Set(["page", "route handler", "API route"]);

// Ten rows is a list someone reads; the whole tail is one click away.
export const SUMMARY_ROWS = 10;

export type RepositorySummary = {
  files: number;
  // Distinct importer → imported pairs: the edges on the map.
  links: number;
  routeFiles: number;
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
    routeFiles: files.filter((file) => file.role !== null && ROUTE_ROLES.has(file.role)).length,
    unidentified: files.filter((file) => file.role === null).length,
    leanedOn: indexes.filter((i) => fanIn(i) > 0).sort((a, b) => fanIn(b) - fanIn(a) || a - b),
    unimported: indexes.filter((i) => fanIn(i) === 0).sort((a, b) => fanOut(b) - fanOut(a) || a - b),
  };
}
