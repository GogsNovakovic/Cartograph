// The shape the parser writes. Everything downstream reads this, so a change
// here is a change to a contract: bump SCHEMA_VERSION when it changes.

export const SCHEMA_VERSION = 4;

export const EDGE_KINDS = ["import", "re_export", "dynamic_import", "require"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export type FileNode = {
  // Relative to the repository root, forward slashes. This is the file's id.
  path: string;
  // The directory the file sits in, relative to the root; "." at the root.
  // Everything that groups files groups by this.
  folder: string;
  bytes: number;
  // Null only when the file couldn't be read at all, and then skipReason says why.
  lines: number | null;
  sha256: string | null;
  // Null means parsed. A skipped file is still a node; it just has no
  // outgoing edges because nothing was read from it.
  skipReason: string | null;
  // What a framework or tool reaches this file as by convention (a page, a
  // test, a config), or null when no adapter names it.
  role: string | null;
  // The framework or a tool loads this file itself (a page, a config, a
  // test), so nothing importing it says nothing about whether it's used.
  // False for a role that only describes the file, like a component.
  entry: boolean;
  // Distinct files this one imports / distinct files importing this one.
  fanOut: number;
  fanIn: number;
  // What the file exports through module.exports / exports, or null when it
  // never refers to either (an ES module, or a script that exports nothing).
  commonjsExports: CommonJsExports | null;
};

// Exact or not given: names only when every write to the exports was read
// from top-level statements; otherwise where and why they couldn't be.
export type CommonJsExports =
  | {
      exact: true;
      // In the order they're first written.
      names: string[];
      // module.exports was replaced by one value (a function, a class, an
      // instance) rather than an object of named properties.
      wholeValue: boolean;
    }
  | { exact: false; line: number; reason: string };

export type Edge = {
  source: string;
  target: string;
  kind: EdgeKind;
  // The import as written, so an edge can always be traced back to its line.
  specifier: string;
  line: number;
  // `import type`, `export type ... from`, or `typeof import(...)`.
  typeOnly: boolean;
};

// Every method a route can be declared with. ALL is a real registration
// (one handler for every method), not a stand-in for an unknown one.
export const ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "SEARCH", "ALL"] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];

// A route exists only when its method and its full pattern were both read
// from the syntax. Anything that would need guessing produces no route.
export type Route = {
  file: string;
  // Where the method is declared.
  line: number;
  method: RouteMethod;
  // The full pattern as the framework writes it, prefixes included.
  path: string;
};

export type ImportOutcome = "resolved" | "external" | "excluded" | "unresolved";

export const EXTERNAL_REASONS = ["package", "node-builtin", "outside-repository"] as const;
export const EXCLUDED_REASONS = [
  "non-source-file",
  "excluded-directory",
  "computed-specifier",
] as const;
export const UNRESOLVED_REASONS = [
  "no-such-file",
  "directory-without-index",
  "alias-without-target",
  "base-url-without-target",
  "workspace-package-without-entry",
] as const;

export type ExternalReason = (typeof EXTERNAL_REASONS)[number];
export type ExcludedReason = (typeof EXCLUDED_REASONS)[number];
export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];
export type ImportReason = ExternalReason | ExcludedReason | UnresolvedReason;

export type ImportExample = {
  from: string;
  line: number;
  kind: EdgeKind;
  specifier: string;
  // The specific circumstance, e.g. which path was looked for.
  detail: string;
};

export type ReasonGroup = {
  outcome: Exclude<ImportOutcome, "resolved">;
  reason: ImportReason;
  count: number;
  // Up to EXAMPLES_PER_REASON; count is the true total.
  examples: ImportExample[];
};

export type OutcomeCounts = Record<ImportOutcome, number> & { total: number };

export type Coverage = {
  files: { found: number; parsed: number; skipped: number };
  imports: OutcomeCounts & { byKind: Record<EdgeKind, OutcomeCounts> };
  reasons: ReasonGroup[];
};

export type ExcludedDirectory = { path: string; reason: string };

export type ParseResult = {
  schemaVersion: typeof SCHEMA_VERSION;
  root: string;
  // The framework adapter that matched, or null when none did. Detection
  // runs in a fixed order and the first match wins.
  framework: string | null;
  // The adapters that named at least one file; empty when none applied.
  adapters: string[];
  files: FileNode[];
  edges: Edge[];
  // Empty when the framework declares none, or none could be read exactly.
  routes: Route[];
  coverage: Coverage;
  // Directories never walked into. Not files, so not in the found count,
  // but listed so nothing disappears without a reason.
  excludedDirectories: ExcludedDirectory[];
};
