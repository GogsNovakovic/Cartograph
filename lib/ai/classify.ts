import "server-only";
import { traceable } from "langsmith/traceable";
import type { Json } from "../database.types.ts";
import { cacheKey, readCache, type CacheRow, type CacheStore } from "./cache.ts";
import { ai, MODELS, TRACE } from "./client.ts";

// Roles for files no adapter named. Only roles that describe a file: page,
// route and controller decide the route table and which files count as
// entry points, and those belong to convention. The answer's schema allows
// nothing else, and the answer is checked against this list again on arrival.
export const SUGGESTED_ROLES = ["service", "repository", "model", "util", "config", "component", "hook"] as const;
export type SuggestedRole = (typeof SUGGESTED_ROLES)[number];

const PROMPT = `You label source files of a codebase by the part each one plays. Each file is shown with its repository path and the start of its source.

For each file answer with exactly one of these roles, or null:
- service: business logic, or an integration with an outside system, that other code calls
- repository: reads and writes stored data on behalf of other code
- model: the shape of data, such as a schema, an entity or the types describing records
- util: small general helpers with no domain of their own
- config: settings or constants that other code reads
- component: a user interface component
- hook: a React hook, a use… function that components call

Null is a correct answer: for a script, a fixture, an entry point, or anything where a role would be a guess. Never pick the nearest role to avoid null.

Answer every file listed exactly once, with its path exactly as given.`;

// Enough of the top of a file to see its imports and its first exports.
const SOURCE_CHARS = 3000;
const PER_CALL = 20;
const AT_ONCE = 4;

export type Unclassified = { path: string; sha256: string; source: string };

export type Classified = {
  suggested: Array<{ path: string; role: SuggestedRole }>;
  // Answered, with no role that fits.
  none: string[];
  // Left out of the answer. Not cached, so a re-run asks again.
  unanswered: string[];
};

const keyOf = (file: Unclassified) => cacheKey("classify", MODELS.classify, PROMPT, { path: file.path, sha256: file.sha256 });

function isRole(value: unknown): value is SuggestedRole {
  return SUGGESTED_ROLES.some((role) => role === value);
}

// A cached answer: a role, null for "none fits", or undefined when the row
// doesn't have the shape an answer has.
function readStored(json: Json | undefined): SuggestedRole | null | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined;
  const { role } = json;
  if (role === null) return null;
  return isRole(role) ? role : undefined;
}

const SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          role: { anyOf: [{ type: "string", enum: [...SUGGESTED_ROLES] }, { type: "null" }] },
        },
        required: ["path", "role"],
        additionalProperties: false,
      },
    },
  },
  required: ["files"],
  additionalProperties: false,
};

// One call's answers by path. Anything not matching a file that was sent,
// or not one of the allowed roles, is dropped and so stays unanswered.
async function ask(files: readonly Unclassified[]): Promise<Map<string, SuggestedRole | null>> {
  const message = files
    .map((file) => `<file path="${file.path}">\n${file.source.slice(0, SOURCE_CHARS)}\n</file>`)
    .join("\n\n");
  const completion = await ai.chat.completions.create(
    {
      model: MODELS.classify,
      reasoning_effort: "low",
      max_completion_tokens: 8000,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: message },
      ],
      response_format: { type: "json_schema", json_schema: { name: "roles", strict: true, schema: SCHEMA } },
    },
    { langsmithExtra: { name: "classify files: model" } },
  );
  const choice = completion.choices[0];
  if (choice?.finish_reason === "length") throw new Error("The model ran out of room before answering every file.");
  const content = choice?.message.content;
  if (!content) throw new Error(choice?.message.refusal ?? "The model returned an empty answer.");

  const sent = new Set(files.map((file) => file.path));
  const answers = new Map<string, SuggestedRole | null>();
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || !("files" in parsed) || !Array.isArray(parsed.files)) {
    throw new Error("The model's answer wasn't a list of files.");
  }
  for (const entry of parsed.files) {
    if (typeof entry !== "object" || entry === null || !("path" in entry) || !("role" in entry)) continue;
    const { path, role } = entry;
    if (typeof path !== "string" || !sent.has(path) || answers.has(path)) continue;
    if (role === null || isRole(role)) answers.set(path, role);
  }
  return answers;
}

// Every file in one traced run: the cache read for all of them first, then
// model calls only for the misses. A re-run of an unchanged repository is a
// recorded run with no model call in it.
export const classifyFiles = traceable(
  async (files: readonly Unclassified[], store: CacheStore): Promise<Classified> => {
    const { found } = await readCache(store, files.map(keyOf));
    const answers = new Map<string, SuggestedRole | null>();
    const misses: Unclassified[] = [];
    for (const file of files) {
      const stored = readStored(found.get(keyOf(file)));
      if (stored === undefined) misses.push(file);
      else answers.set(file.path, stored);
    }

    const batches: Unclassified[][] = [];
    for (let i = 0; i < misses.length; i += PER_CALL) batches.push(misses.slice(i, i + PER_CALL));
    // A few calls in flight at once; one failing fails the whole set, so no
    // run stores roles for some files and silently none for the rest.
    for (let i = 0; i < batches.length; i += AT_ONCE) {
      const asked = await Promise.all(batches.slice(i, i + AT_ONCE).map(ask));
      const rows: CacheRow[] = [];
      for (const [b, answered] of asked.entries()) {
        for (const file of batches[i + b]) {
          const role = answered.get(file.path);
          if (role === undefined) continue;
          answers.set(file.path, role);
          rows.push({ key: keyOf(file), task: "classify", model: MODELS.classify, output: { role } });
        }
      }
      await store.write(rows);
    }

    const result: Classified = { suggested: [], none: [], unanswered: [] };
    for (const file of files) {
      const role = answers.get(file.path);
      if (role === undefined) result.unanswered.push(file.path);
      else if (role === null) result.none.push(file.path);
      else result.suggested.push({ path: file.path, role });
    }
    return result;
  },
  {
    ...TRACE,
    name: "classify files",
    run_type: "chain",
    processInputs: ({ args }) => ({ files: args[0].map((file) => file.path) }),
  },
);
