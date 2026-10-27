import { readFileSync } from "node:fs";
import {
  EDGE_KINDS,
  EXCLUDED_REASONS,
  EXTERNAL_REASONS,
  ROUTE_METHODS,
  SCHEMA_VERSION,
  UNRESOLVED_REASONS,
  type Coverage,
  type Edge,
  type EdgeKind,
  type ExcludedDirectory,
  type FileNode,
  type ImportExample,
  type ImportReason,
  type OutcomeCounts,
  type ParseResult,
  type ReasonGroup,
  type Route,
} from "./types.ts";

// Reading the output back checks every field rather than trusting a cast, so
// a file from an older schema or a hand edit fails here, loudly, with the
// path to the bad value, instead of somewhere downstream.

export class ParseResultError extends Error {}

type Fields = Record<string, unknown>;

function fail(at: string, expected: string, value: unknown): never {
  throw new ParseResultError(`${at}: expected ${expected}, got ${JSON.stringify(value)}`);
}

function object(value: unknown, at: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(at, "an object", value);
  return Object.fromEntries(Object.entries(value));
}

function array(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) fail(at, "an array", value);
  return value;
}

function string(value: unknown, at: string): string {
  if (typeof value !== "string") fail(at, "a string", value);
  return value;
}

function nullableString(value: unknown, at: string): string | null {
  return value === null ? null : string(value, at);
}

function count(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(at, "a non-negative integer", value);
  }
  return value;
}

function nullableCount(value: unknown, at: string): number | null {
  return value === null ? null : count(value, at);
}

function boolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") fail(at, "a boolean", value);
  return value;
}

function oneOf<T extends string>(options: readonly T[], value: unknown, at: string): T {
  const match = options.find((option) => option === value);
  if (match === undefined) fail(at, `one of ${options.join(", ")}`, value);
  return match;
}

function edgeKind(value: unknown, at: string): EdgeKind {
  return oneOf(EDGE_KINDS, value, at);
}

function readFile(value: unknown, at: string): FileNode {
  const f = object(value, at);
  return {
    path: string(f.path, `${at}.path`),
    folder: string(f.folder, `${at}.folder`),
    bytes: count(f.bytes, `${at}.bytes`),
    lines: nullableCount(f.lines, `${at}.lines`),
    sha256: nullableString(f.sha256, `${at}.sha256`),
    skipReason: nullableString(f.skipReason, `${at}.skipReason`),
    role: nullableString(f.role, `${at}.role`),
    entry: boolean(f.entry, `${at}.entry`),
    fanOut: count(f.fanOut, `${at}.fanOut`),
    fanIn: count(f.fanIn, `${at}.fanIn`),
  };
}

function readEdge(value: unknown, at: string): Edge {
  const e = object(value, at);
  return {
    source: string(e.source, `${at}.source`),
    target: string(e.target, `${at}.target`),
    kind: edgeKind(e.kind, `${at}.kind`),
    specifier: string(e.specifier, `${at}.specifier`),
    line: count(e.line, `${at}.line`),
    typeOnly: boolean(e.typeOnly, `${at}.typeOnly`),
  };
}

function readRoute(value: unknown, at: string): Route {
  const r = object(value, at);
  return {
    file: string(r.file, `${at}.file`),
    line: count(r.line, `${at}.line`),
    method: oneOf(ROUTE_METHODS, r.method, `${at}.method`),
    path: string(r.path, `${at}.path`),
  };
}

function readCounts(value: unknown, at: string): OutcomeCounts {
  const c = object(value, at);
  return {
    total: count(c.total, `${at}.total`),
    resolved: count(c.resolved, `${at}.resolved`),
    external: count(c.external, `${at}.external`),
    excluded: count(c.excluded, `${at}.excluded`),
    unresolved: count(c.unresolved, `${at}.unresolved`),
  };
}

function readExample(value: unknown, at: string): ImportExample {
  const x = object(value, at);
  return {
    from: string(x.from, `${at}.from`),
    line: count(x.line, `${at}.line`),
    kind: edgeKind(x.kind, `${at}.kind`),
    specifier: string(x.specifier, `${at}.specifier`),
    detail: string(x.detail, `${at}.detail`),
  };
}

function readGroup(value: unknown, at: string): ReasonGroup {
  const g = object(value, at);
  const outcome = oneOf(["external", "excluded", "unresolved"] as const, g.outcome, `${at}.outcome`);
  // A reason only belongs to the outcome that produces it.
  const reasons: Record<ReasonGroup["outcome"], readonly ImportReason[]> = {
    external: EXTERNAL_REASONS,
    excluded: EXCLUDED_REASONS,
    unresolved: UNRESOLVED_REASONS,
  };
  return {
    outcome,
    reason: oneOf(reasons[outcome], g.reason, `${at}.reason`),
    count: count(g.count, `${at}.count`),
    examples: array(g.examples, `${at}.examples`).map((x, i) => readExample(x, `${at}.examples[${i}]`)),
  };
}

function readCoverage(value: unknown, at: string): Coverage {
  const c = object(value, at);
  const files = object(c.files, `${at}.files`);
  const imports = object(c.imports, `${at}.imports`);
  const byKind = object(imports.byKind, `${at}.imports.byKind`);
  return {
    files: {
      found: count(files.found, `${at}.files.found`),
      parsed: count(files.parsed, `${at}.files.parsed`),
      skipped: count(files.skipped, `${at}.files.skipped`),
    },
    imports: {
      ...readCounts(imports, `${at}.imports`),
      byKind: {
        import: readCounts(byKind.import, `${at}.imports.byKind.import`),
        re_export: readCounts(byKind.re_export, `${at}.imports.byKind.re_export`),
        dynamic_import: readCounts(byKind.dynamic_import, `${at}.imports.byKind.dynamic_import`),
        require: readCounts(byKind.require, `${at}.imports.byKind.require`),
      },
    },
    reasons: array(c.reasons, `${at}.reasons`).map((g, i) => readGroup(g, `${at}.reasons[${i}]`)),
  };
}

function readExcludedDirectory(value: unknown, at: string): ExcludedDirectory {
  const d = object(value, at);
  return { path: string(d.path, `${at}.path`), reason: string(d.reason, `${at}.reason`) };
}

export function toParseResult(value: unknown): ParseResult {
  const r = object(value, "result");
  if (r.schemaVersion !== SCHEMA_VERSION) fail("result.schemaVersion", String(SCHEMA_VERSION), r.schemaVersion);
  const result: ParseResult = {
    schemaVersion: SCHEMA_VERSION,
    root: string(r.root, "result.root"),
    framework: nullableString(r.framework, "result.framework"),
    adapters: array(r.adapters, "result.adapters").map((a, i) => string(a, `result.adapters[${i}]`)),
    files: array(r.files, "result.files").map((f, i) => readFile(f, `result.files[${i}]`)),
    edges: array(r.edges, "result.edges").map((e, i) => readEdge(e, `result.edges[${i}]`)),
    routes: array(r.routes, "result.routes").map((x, i) => readRoute(x, `result.routes[${i}]`)),
    coverage: readCoverage(r.coverage, "result.coverage"),
    excludedDirectories: array(r.excludedDirectories, "result.excludedDirectories").map((d, i) =>
      readExcludedDirectory(d, `result.excludedDirectories[${i}]`),
    ),
  };

  // Shape alone isn't the contract: every edge must land on a file in the
  // list, and the counts must agree with what they count.
  const paths = new Set(result.files.map((f) => f.path));
  result.edges.forEach((edge, i) => {
    if (!paths.has(edge.source)) fail(`result.edges[${i}].source`, "a path in files", edge.source);
    if (!paths.has(edge.target)) fail(`result.edges[${i}].target`, "a path in files", edge.target);
  });
  result.routes.forEach((route, i) => {
    if (!paths.has(route.file)) fail(`result.routes[${i}].file`, "a path in files", route.file);
    if (!route.path.startsWith("/")) fail(`result.routes[${i}].path`, "a path starting with /", route.path);
  });
  const { found, parsed, skipped } = result.coverage.files;
  if (found !== result.files.length) fail("result.coverage.files.found", String(result.files.length), found);
  if (parsed + skipped !== found) fail("result.coverage.files", "parsed + skipped = found", { parsed, skipped, found });
  const imports = result.coverage.imports;
  if (imports.resolved !== result.edges.length) {
    fail("result.coverage.imports.resolved", String(result.edges.length), imports.resolved);
  }
  if (imports.resolved + imports.external + imports.excluded + imports.unresolved !== imports.total) {
    fail("result.coverage.imports", "outcomes summing to total", imports);
  }
  return result;
}

export function readParseResult(file: string): ParseResult {
  return toParseResult(JSON.parse(readFileSync(file, "utf8")));
}
