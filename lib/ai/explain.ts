import "server-only";
import { traceable } from "langsmith/traceable";
import type { Json } from "../database.types.ts";
import type { MapModel } from "../map/model.ts";
import type { CommonJsExports, EdgeKind, ParseResult } from "../../parser/types.ts";
import { cacheKey, readCache, type CacheStore, type Task } from "./cache.ts";
import { ai, MODELS, TRACE } from "./client.ts";

// What a model is handed to explain a file or a folder. Every path in it
// comes from the parse result: the model is told what is connected, it never
// works it out, and it sees nothing further away than one step.

// The three pieces of formatting the pane renders. Forbidding formatting
// outright doesn't hold (models write it anyway, and it shows as literal
// backticks), so a small subset is permitted and rendered instead.
const FORMAT = `Format: plain paragraphs. You may use exactly three kinds of formatting: \`inline code\`, **bold**, and bullet lists whose lines start with "- ". Nothing else: no headings, no numbered lists, no tables, no links, no italics.`;

const RULES = `Rules:
- Ground every statement in what you were given. If something isn't shown, don't describe it.
- Name a file only if it is in what you were given, and write its full repository path exactly as given, in backticks.
- Two files are connected only where the lists you were given say so. Never infer a connection, and never describe files beyond the ones listed.
- Explain; don't assess. No judgements of quality, no suggestions, no issues, no ratings.
- ${FORMAT}`;

const FILE_PROMPT = `You explain one file of a codebase to a developer who is reading a dependency map of it.

You are given the file's source and its neighbours: every file in the repository that it imports, and every file in the repository that imports it, as resolved by a parser. Those lists are complete and exact. Package imports aren't listed; they're visible in the source.

Say what the file does and the part it plays among those neighbours: what it takes from the files it imports, and what the files importing it come to it for.

${RULES}

Length: two or three short paragraphs, or one paragraph and a short list. Under 200 words.`;

const FOLDER_PROMPT = `You explain one folder of a codebase to a developer who is reading a dependency map of it. On the map this folder is folded into a single box.

You are given every file in the folder, and every import that crosses its boundary in either direction, as resolved by a parser. Those lists are complete and exact. You are not given any file's source.

Answer two questions about the folder as a whole: what is in here, and why do the files outside it that point at it come to it. Speak about the folder, not about any one file in it; name individual files only where they explain the folder.

${RULES}

Length: two or three short paragraphs, or one paragraph and a short list. Under 200 words.`;

type Statement = { specifier: string; line: number; kind: EdgeKind; typeOnly: boolean };

// One neighbour and every statement joining it to the file. For imports the
// lines are in the file; for importers they're in the importer.
type Neighbour = { path: string; role: string | null; suggestedRole: string | null; statements: Statement[] };

export type FileInput = {
  repository: string;
  path: string;
  // Stands in for the source in the cache key: the source sent is checked
  // against it, so the same hash is the same source.
  sha256: string;
  lines: number;
  role: string | null;
  suggestedRole: string | null;
  commonjsExports: CommonJsExports | null;
  imports: Neighbour[];
  importers: Neighbour[];
};

type FolderFile = {
  path: string;
  role: string | null;
  suggestedRole: string | null;
  lines: number | null;
  // Distinct files outside the folder importing this one / imported by it.
  importedFromOutside: number;
  importsOutside: number;
};

export type FolderInput = {
  repository: string;
  // As the map shows it: "src/lib/", or "./" for the root.
  directory: string;
  files: FolderFile[];
  // Each outside file importing into the folder, and what it imports there.
  incoming: Array<{ path: string; role: string | null; suggestedRole: string | null; imports: string[] }>;
  // Each outside file the folder imports, and which files inside import it.
  outgoing: Array<{ path: string; role: string | null; suggestedRole: string | null; importedBy: string[] }>;
};

export type Suggested = ReadonlyMap<string, string>;

const byPath = <T extends { path: string }>(a: T, b: T) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export type InputResult<T> = { ok: true; input: T } | { ok: false; message: string };

export function fileInput(
  repository: string,
  result: ParseResult,
  suggested: Suggested,
  path: string,
): InputResult<FileInput> {
  const file = result.files.find((f) => f.path === path);
  if (!file) return { ok: false, message: `${path} isn't in this analysis.` };
  if (file.skipReason !== null || file.sha256 === null || file.lines === null) {
    return { ok: false, message: `The parser didn't read ${path} (${file.skipReason ?? "no content"}), so there is nothing to explain it from.` };
  }
  const roleOf = new Map(result.files.map((f) => [f.path, f.role]));
  const gather = (side: "target" | "source") => {
    const other = side === "target" ? "source" : "target";
    const neighbours = new Map<string, Neighbour>();
    for (const edge of result.edges) {
      if (edge[side] !== path || edge[other] === path) continue;
      const at = edge[other];
      const neighbour = neighbours.get(at) ?? {
        path: at,
        role: roleOf.get(at) ?? null,
        suggestedRole: suggested.get(at) ?? null,
        statements: [],
      };
      neighbour.statements.push({ specifier: edge.specifier, line: edge.line, kind: edge.kind, typeOnly: edge.typeOnly });
      neighbours.set(at, neighbour);
    }
    return [...neighbours.values()].sort(byPath);
  };
  return {
    ok: true,
    input: {
      repository,
      path,
      sha256: file.sha256,
      lines: file.lines,
      role: file.role,
      suggestedRole: suggested.get(path) ?? null,
      commonjsExports: file.commonjsExports,
      imports: gather("source"),
      importers: gather("target"),
    },
  };
}

// A folded folder as the map draws it: its files are the map's group, which
// includes any small subfolders folded into it.
export function folderInput(repository: string, model: MapModel, directory: string): InputResult<FolderInput> {
  const group = model.groups.findIndex((g) => g.directory === directory);
  if (group === -1) return { ok: false, message: `${directory} isn't a folder on this map.` };
  const inside = (file: number) => model.files[file].group === group;
  const files = model.groups[group].files;
  const outsideImporters = new Map<number, Set<number>>();
  const outsideImports = new Map<number, Set<number>>();
  for (const [source, target] of model.links) {
    if (inside(target) && !inside(source)) {
      outsideImporters.set(target, (outsideImporters.get(target) ?? new Set()).add(source));
    } else if (inside(source) && !inside(target)) {
      outsideImports.set(source, (outsideImports.get(source) ?? new Set()).add(target));
    }
  }
  // Turned around: by the outside file, which is how "why does so much point
  // at it" reads.
  const invert = (from: Map<number, Set<number>>) => {
    const to = new Map<number, number[]>();
    for (const [mine, theirs] of from) for (const other of theirs) to.set(other, [...(to.get(other) ?? []), mine]);
    return [...to].map(([other, mine]) => ({
      path: model.files[other].path,
      role: model.files[other].role,
      suggestedRole: model.files[other].suggestedRole,
      paths: mine.map((m) => model.files[m].path).sort(),
    }));
  };
  return {
    ok: true,
    input: {
      repository,
      directory: directory === "." ? "./" : directory + "/",
      files: files
        .map((file) => ({
          path: model.files[file].path,
          role: model.files[file].role,
          suggestedRole: model.files[file].suggestedRole,
          lines: model.files[file].lines,
          importedFromOutside: outsideImporters.get(file)?.size ?? 0,
          importsOutside: outsideImports.get(file)?.size ?? 0,
        }))
        .sort(byPath),
      incoming: invert(outsideImporters)
        .map(({ path, role, suggestedRole, paths }) => ({ path, role, suggestedRole, imports: paths }))
        .sort(byPath),
      outgoing: invert(outsideImports)
        .map(({ path, role, suggestedRole, paths }) => ({ path, role, suggestedRole, importedBy: paths }))
        .sort(byPath),
    },
  };
}

function roleText(role: string | null, suggestedRole: string | null): string {
  if (role !== null) return `role by convention: ${role}`;
  if (suggestedRole !== null) return `no convention role; suggested by a model: ${suggestedRole}`;
  return "no role";
}

function statementText(s: Statement): string {
  const kind = s.kind === "import" ? "" : `${s.kind.replace("_", " ")}, `;
  return `"${s.specifier}" (${kind}line ${s.line}${s.typeOnly ? ", types only" : ""})`;
}

function neighbourLines(neighbours: Neighbour[]): string {
  if (neighbours.length === 0) return "(none)";
  return neighbours
    .map((n) => `- ${n.path} [${roleText(n.role, n.suggestedRole)}] via ${n.statements.map(statementText).join(", ")}`)
    .join("\n");
}

function exportsText(exports: CommonJsExports | null): string | null {
  if (exports === null) return null;
  if (!exports.exact) return `CommonJS exports: not read exactly (line ${exports.line}: ${exports.reason})`;
  const names = exports.names.length > 0 ? exports.names.join(", ") : "no names";
  return `CommonJS exports: ${exports.wholeValue ? "module.exports is one value; " : ""}${names}`;
}

type Clipped = { text: string; truncated: { shown: number; total: number } | null };

// Enough for nearly every source file. A longer one is sent from the top and
// the model and the pane are both told how much of it that was.
const SOURCE_LIMIT = 60_000;

function clip(source: string, lines: number): Clipped {
  if (source.length <= SOURCE_LIMIT) return { text: source, truncated: null };
  const cut = source.lastIndexOf("\n", SOURCE_LIMIT);
  const text = source.slice(0, cut === -1 ? SOURCE_LIMIT : cut);
  return { text, truncated: { shown: text.split("\n").length, total: lines } };
}

function fileMessage(input: FileInput, source: Clipped): string {
  const head = [
    `Repository: ${input.repository}`,
    `File: ${input.path} (${input.lines} lines; ${roleText(input.role, input.suggestedRole)})`,
    exportsText(input.commonjsExports),
  ].filter((line) => line !== null);
  const shown = source.truncated
    ? `Source (only the first ${source.truncated.shown} of ${source.truncated.total} lines; the rest wasn't sent):`
    : "Source:";
  return [
    head.join("\n"),
    `Files in the repository that ${input.path} imports (${input.imports.length}):\n${neighbourLines(input.imports)}`,
    `Files in the repository that import ${input.path} (${input.importers.length}):\n${neighbourLines(input.importers)}`,
    `${shown}\n<source>\n${source.text}\n</source>`,
  ].join("\n\n");
}

function folderMessage(input: FolderInput): string {
  const files = input.files
    .map(
      (f) =>
        `- ${f.path} [${roleText(f.role, f.suggestedRole)}; ${f.lines === null ? "not read" : `${f.lines} lines`}; imported by ${f.importedFromOutside} files outside; imports ${f.importsOutside} files outside]`,
    )
    .join("\n");
  const incoming = input.incoming.length
    ? input.incoming.map((i) => `- ${i.path} [${roleText(i.role, i.suggestedRole)}] imports ${i.imports.join(", ")}`).join("\n")
    : "(none)";
  const outgoing = input.outgoing.length
    ? input.outgoing.map((o) => `- ${o.path} [${roleText(o.role, o.suggestedRole)}] is imported by ${o.importedBy.join(", ")}`).join("\n")
    : "(none)";
  return [
    `Repository: ${input.repository}`,
    `Folder: ${input.directory} (${input.files.length} files, including any small subfolders the map folds into it)`,
    `Files in the folder:\n${files}`,
    `Files outside the folder that import into it (${input.incoming.length}):\n${incoming}`,
    `Files outside the folder that it imports (${input.outgoing.length}):\n${outgoing}`,
  ].join("\n\n");
}

export type Explanation = {
  body: string;
  model: string;
  cached: boolean;
  // Set when only the top of a long file was sent.
  truncated: { shown: number; total: number } | null;
};

type Stored = Pick<Explanation, "body" | "truncated">;

// A cached row is read back by its shape, not trusted to have one.
function readStored(json: Json | undefined): Stored | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const { body, truncated } = json;
  if (typeof body !== "string" || body.trim() === "") return null;
  if (truncated === null || truncated === undefined) return { body, truncated: null };
  if (typeof truncated !== "object" || Array.isArray(truncated)) return null;
  const { shown, total } = truncated;
  if (typeof shown !== "number" || typeof total !== "number") return null;
  return { body, truncated: { shown, total } };
}

async function write(name: string, prompt: string, message: string): Promise<string> {
  const completion = await ai.chat.completions.create(
    {
      model: MODELS.explain,
      reasoning_effort: "low",
      // Room for the reasoning as well as the answer.
      max_completion_tokens: 8000,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: message },
      ],
    },
    { langsmithExtra: { name } },
  );
  const choice = completion.choices[0];
  // Half an explanation reads as a whole one, so a cut-off answer isn't shown.
  if (choice?.finish_reason === "length") throw new Error("The model ran out of room before finishing, so nothing is shown.");
  const body = choice?.message.content?.trim();
  if (!body) throw new Error(choice?.message.refusal ?? "The model returned an empty answer.");
  return body;
}

async function cached(
  task: Task,
  prompt: string,
  input: unknown,
  store: CacheStore,
  miss: () => Promise<Stored>,
): Promise<Explanation> {
  const key = cacheKey(task, MODELS.explain, prompt, input);
  const { found } = await readCache(store, [key]);
  const hit = readStored(found.get(key));
  if (hit) return { ...hit, model: MODELS.explain, cached: true };
  const fresh = await miss();
  await store.write([{ key, task, model: MODELS.explain, output: fresh }]);
  return { ...fresh, model: MODELS.explain, cached: false };
}

export type FileContext = {
  store: CacheStore;
  // The file as of the analysed commit, already checked against its hash.
  // Only asked for on a miss: a hit never touches the repository.
  source: () => Promise<string>;
};

export const explainFile = traceable(
  (input: FileInput, context: FileContext) =>
    cached("explain-file", FILE_PROMPT, input, context.store, async () => {
      const source = clip(await context.source(), input.lines);
      const body = await write("explain file: model", FILE_PROMPT, fileMessage(input, source));
      return { body, truncated: source.truncated };
    }),
  { ...TRACE, name: "explain file", run_type: "chain", processInputs: ({ args }) => ({ input: args[0] }) },
);

export const explainFolder = traceable(
  (input: FolderInput, store: CacheStore) =>
    cached("explain-folder", FOLDER_PROMPT, input, store, async () => ({
      body: await write("explain folder: model", FOLDER_PROMPT, folderMessage(input)),
      truncated: null,
    })),
  { ...TRACE, name: "explain folder", run_type: "chain", processInputs: ({ args }) => ({ input: args[0] }) },
);
