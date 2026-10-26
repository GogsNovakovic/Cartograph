import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { Project, ts } from "ts-morph";
import { readRoles } from "./adapters.ts";
import { degrees } from "./graph.ts";
import { readImports } from "./imports.ts";
import { Resolver } from "./resolve.ts";
import {
  SCHEMA_VERSION,
  type Edge,
  type EdgeKind,
  type ImportExample,
  type ImportOutcome,
  type ImportReason,
  type OutcomeCounts,
  type ParseResult,
  type ReasonGroup,
} from "./types.ts";
import { toRelative, walkRepository, type WalkResult } from "./walk.ts";

export * from "./types.ts";

export const EXAMPLES_PER_REASON = 10;

function emptyCounts(): OutcomeCounts {
  return { total: 0, resolved: 0, external: 0, excluded: 0, unresolved: 0 };
}

// Choosing and reading the files is separate from parsing them, so a caller
// can report the two as stages. Both are synchronous; split here, a caller can
// do its own async work between them.
export type Selection = { root: string; walk: WalkResult };

export function selectFiles(directory: string): Selection {
  // Real path, so it compares equal to the real paths TypeScript resolves to.
  const root = realpathSync(path.resolve(directory));
  if (!statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
  return { root, walk: walkRepository(root) };
}

export function parseRepository(directory: string): ParseResult {
  return parseSelection(selectFiles(directory));
}

export function parseSelection({ root, walk }: Selection): ParseResult {
  const paths = walk.files.map((file) => file.path);
  const { adapters, roles } = readRoles({
    root,
    paths,
    packageJsons: walk.packageJsonPaths.map((p) => toRelative(root, p)),
  });
  const resolver = new Resolver(root, paths, walk.packageJsonPaths);

  // Parsing only: no lib files, no following imports into files we didn't
  // choose. Resolution is done separately so every failure gets a reason.
  const project = new Project({
    compilerOptions: { allowJs: true, noResolve: true, noLib: true, types: [] },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });
  const sourceFiles = new Map(
    walk.files.flatMap((file) =>
      file.text === null
        ? []
        : [[file.path, project.createSourceFile(file.absolutePath, file.text, { overwrite: true })] as const],
    ),
  );
  const program = project.getProgram().compilerObject;

  const edges: Edge[] = [];
  const totals = emptyCounts();
  const byKind: Record<EdgeKind, OutcomeCounts> = {
    import: emptyCounts(),
    re_export: emptyCounts(),
    dynamic_import: emptyCounts(),
    require: emptyCounts(),
  };
  const groups = new Map<string, ReasonGroup>();

  const count = (kind: EdgeKind, outcome: ImportOutcome) => {
    totals.total++;
    totals[outcome]++;
    byKind[kind].total++;
    byKind[kind][outcome]++;
  };
  const report = (outcome: Exclude<ImportOutcome, "resolved">, reason: ImportReason, example: ImportExample) => {
    count(example.kind, outcome);
    const key = `${outcome}:${reason}`;
    const group = groups.get(key) ?? { outcome, reason, count: 0, examples: [] };
    group.count++;
    if (group.examples.length < EXAMPLES_PER_REASON) group.examples.push(example);
    groups.set(key, group);
  };

  for (const file of walk.files) {
    const sourceFile = sourceFiles.get(file.path);
    if (!sourceFile) continue;

    const [syntaxError] = program.getSyntacticDiagnostics(sourceFile.compilerNode);
    if (syntaxError) {
      const line =
        syntaxError.start === undefined
          ? "?"
          : sourceFile.compilerNode.getLineAndCharacterOfPosition(syntaxError.start).line + 1;
      file.skipReason = `syntax error at line ${line}: ${ts.flattenDiagnosticMessageText(syntaxError.messageText, " ")}`;
      continue;
    }

    for (const site of readImports(sourceFile)) {
      const at = { from: file.path, line: site.line, kind: site.kind };
      if (site.specifier === null) {
        report("excluded", "computed-specifier", {
          ...at,
          specifier: site.text,
          detail: "the specifier is computed at runtime, so there is no file to name",
        });
        continue;
      }
      const resolution = resolver.resolve(site.specifier, file.absolutePath);
      if (resolution.outcome === "resolved") {
        count(site.kind, "resolved");
        edges.push({
          source: file.path,
          target: resolution.target,
          kind: site.kind,
          specifier: site.specifier,
          line: site.line,
          typeOnly: site.typeOnly,
        });
      } else {
        report(resolution.outcome, resolution.reason, {
          ...at,
          specifier: site.specifier,
          detail: resolution.detail,
        });
      }
    }
  }

  const degree = degrees(paths, edges);
  const files = walk.files.map((file) => ({
    path: file.path,
    folder: file.folder,
    bytes: file.bytes,
    lines: file.lines,
    sha256: file.sha256,
    skipReason: file.skipReason,
    role: roles.get(file.path) ?? null,
    fanOut: degree.get(file.path)?.fanOut ?? 0,
    fanIn: degree.get(file.path)?.fanIn ?? 0,
  }));
  const skipped = files.filter((file) => file.skipReason !== null).length;

  return {
    schemaVersion: SCHEMA_VERSION,
    root,
    adapters,
    files,
    edges,
    coverage: {
      files: { found: files.length, parsed: files.length - skipped, skipped },
      imports: { ...totals, byKind },
      reasons: [...groups.values()].sort((a, b) => b.count - a.count),
    },
    excludedDirectories: walk.excludedDirectories,
  };
}
