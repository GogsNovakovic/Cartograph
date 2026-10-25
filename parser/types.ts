// The shape the parser writes. Everything downstream reads this, so a change
// here is a change to a contract: bump SCHEMA_VERSION when it changes.

export const SCHEMA_VERSION = 2;

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
  // Distinct files this one imports / distinct files importing this one.
  fanOut: number;
  fanIn: number;
};

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
  // The adapters that named at least one file; empty when none applied.
  adapters: string[];
  files: FileNode[];
  edges: Edge[];
  coverage: Coverage;
  // Directories never walked into. Not files, so not in the found count,
  // but listed so nothing disappears without a reason.
  excludedDirectories: ExcludedDirectory[];
};
