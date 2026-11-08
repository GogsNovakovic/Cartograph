// The agent's six lookups. Each one is a question put to the map the canvas
// draws, answered by the same model, the same walk and the same summary, so
// the agent can only ever say what the canvas would show. Pure: a parse
// result and its suggested roles in, plain data out.
//
// The agent picks a file and a direction and nothing else. No lookup here
// relates two files the edge list doesn't already relate; one that did would
// let the model infer structure instead of querying it.

import type { ParseResult } from "../../parser/types.ts";
import { summariseCoverage } from "./coverage.ts";
import { adjacency, DEFAULT_DEPTH, walk, type Adjacency, type Direction } from "./graph.ts";
import { buildMapModel, type MapModel, type Suggestions } from "./model.ts";
import { summarize, SUMMARY_ROWS } from "./summary.ts";

export type Lookup = {
  result: ParseResult;
  model: MapModel;
  graph: Adjacency;
  // Why the parser couldn't read a file, by path.
  skipped: ReadonlyMap<string, string>;
};

export function lookup(result: ParseResult, suggestions: Suggestions): Lookup {
  const model = buildMapModel(result, suggestions);
  return {
    result,
    model,
    graph: adjacency(model.files.length, model.links),
    skipped: new Map(result.files.flatMap((file) => (file.skipReason ? [[file.path, file.skipReason] as const] : []))),
  };
}

// A list long enough to answer from, short enough to fit in a model's
// context. Every list says its true total, so a cut list never reads as the
// whole of it.
export const LIST_LIMIT = 100;

type Listed<T> = { total: number; shown: T[]; truncated: boolean };

function listed<T>(items: readonly T[], limit = LIST_LIMIT): Listed<T> {
  return { total: items.length, shown: items.slice(0, limit), truncated: items.length > limit };
}

// What every answer says about a file. A suggested role is labelled as one:
// it's a model's guess at a file no convention named, never what a framework
// reaches the file as.
export type FileFacts = {
  path: string;
  role: string | null;
  suggestedRole: string | null;
  lines: number | null;
  importedBy: number;
  imports: number;
  // Why the parser couldn't read it. A skipped file has no imports recorded
  // because none were read, not because it has none.
  skipped: string | null;
};

function facts(lookup: Lookup, file: number): FileFacts {
  const f = lookup.model.files[file];
  return {
    path: f.path,
    role: f.role,
    suggestedRole: f.suggestedRole,
    lines: f.lines,
    importedBy: f.fanIn,
    imports: f.fanOut,
    skipped: lookup.skipped.get(f.path) ?? null,
  };
}

// A path is looked up exactly. A near miss is reported, never corrected: the
// closest path to the one asked for is a guess about which file was meant.
export type NotFound = { found: false; path: string; message: string };

function find(lookup: Lookup, path: string): number | NotFound {
  const wanted = path.trim().replace(/^(?:\.\/)+/, "");
  const index = lookup.model.files.findIndex((file) => file.path === wanted);
  if (index !== -1) return index;
  return {
    found: false,
    path: wanted,
    message: "No file has exactly this path in this analysis. Search by part of the path to find the exact one.",
  };
}

// 1. The repository as a whole: what the detail pane shows at rest, plus the
// roles there are to list and how much of the import graph was recovered.
export function overview(lookup: Lookup) {
  const { model, result, graph } = lookup;
  const summary = summarize(model.files, graph);
  const coverage = summariseCoverage(result.coverage, result.files);
  const roles = new Map<string, { role: string; source: "convention" | "suggested"; files: number }>();
  for (const file of model.files) {
    const [role, source] = file.role !== null ? [file.role, "convention" as const] : [file.suggestedRole, "suggested" as const];
    if (role === null) continue;
    const key = `${source}:${role}`;
    const entry = roles.get(key) ?? { role, source, files: 0 };
    entry.files++;
    roles.set(key, entry);
  }
  return {
    repository: model.repository.name,
    framework: model.repository.framework,
    adapters: model.repository.adapters,
    files: summary.files,
    links: summary.links,
    filesWithNoConventionRole: summary.unidentified,
    // Why no roles were suggested, when the run couldn't ask.
    suggestionFailure: model.repository.classificationFailure,
    roles: [...roles.values()].sort((a, b) => b.files - a.files || (a.role < b.role ? -1 : 1)),
    categories: model.categories.map(({ name, count }) => ({ name, files: count })),
    mostImported: summary.leanedOn.slice(0, SUMMARY_ROWS).map((i) => facts(lookup, i)),
    importedByNothing: listed(summary.unimported.map((i) => model.files[i].path), SUMMARY_ROWS),
    routes: model.routes.length,
    coverage: {
      importsAimedAtRepository: coverage.aimed,
      resolved: coverage.resolved,
      percent: coverage.percent,
      notDrawn: coverage.missing.map(({ label, count }) => ({ count, imports: label })),
      skippedFiles: listed(coverage.skipped, SUMMARY_ROWS),
    },
  };
}

// 2. Files whose path contains the text, ignoring case.
export function searchFiles(lookup: Lookup, text: string) {
  const needle = text.trim().toLowerCase();
  if (needle === "") return { query: text, message: "Give part of a path to search for." };
  const matches = lookup.model.files.flatMap((file, i) => (file.path.toLowerCase().includes(needle) ? [i] : []));
  return { query: text, matches: listed(matches.map((i) => facts(lookup, i))) };
}

// 3. Files with a role, by its exact name. Convention and suggestion are
// listed apart, because only one of them is a fact about the code.
export function filesWithRole(lookup: Lookup, role: string) {
  const wanted = role.trim();
  const files = lookup.model.files.map((_, i) => i);
  const byConvention = files.filter((i) => lookup.model.files[i].role === wanted);
  const bySuggestion = files.filter((i) => lookup.model.files[i].suggestedRole === wanted);
  if (byConvention.length === 0 && bySuggestion.length === 0) {
    return { role: wanted, message: "No file has this role. The overview lists every role there is." };
  }
  return {
    role: wanted,
    byConvention: listed(byConvention.map((i) => facts(lookup, i))),
    suggestedByModel: listed(bySuggestion.map((i) => facts(lookup, i))),
  };
}

// 4. One step out: what the file imports and what imports it, each import
// marked when it's for types only and so disappears at runtime.
export function neighbours(lookup: Lookup, path: string) {
  const file = find(lookup, path);
  if (typeof file !== "number") return file;
  const { model, graph } = lookup;
  const typeOnly = new Map(model.links.map(([source, target], i) => [`${source}>${target}`, model.typeOnly[i]]));
  const side = (others: number[], key: (other: number) => string) =>
    listed(
      [...others]
        .sort((a, b) => a - b)
        .map((other) => ({ ...facts(lookup, other), typeOnly: typeOnly.get(key(other)) ?? false })),
    );
  return {
    file: facts(lookup, file),
    imports: side(graph.imports[file], (other) => `${file}>${other}`),
    importedBy: side(graph.importers[file], (other) => `${other}>${file}`),
  };
}

// 5. The blast radius ("dependents") or the dependency chain
// ("dependencies"), walked exactly as the pane walks it, to the same depth.
export function walkFrom(lookup: Lookup, path: string, direction: Direction) {
  const file = find(lookup, path);
  if (typeof file !== "number") return file;
  const reached = walk(lookup.graph, file, direction);
  return {
    from: facts(lookup, file),
    direction,
    depth: DEFAULT_DEPTH,
    reached: listed(reached.map(({ file: other, depth }) => ({ depth, ...facts(lookup, other) }))),
  };
}

// 6. Every route the parser read exactly. A framework with routes it
// couldn't read exactly has fewer here, never approximate ones.
export function routeTable(lookup: Lookup) {
  const { model } = lookup;
  return {
    framework: model.repository.framework,
    routes: listed(
      model.routes.map((route) => ({ method: route.method, path: route.path, file: model.files[route.file].path, line: route.line })),
    ),
  };
}
