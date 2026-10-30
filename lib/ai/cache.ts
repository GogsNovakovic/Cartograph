import "server-only";
import { traceable } from "langsmith/traceable";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types.ts";
import { TRACE } from "./client.ts";

export type Task = "explain-file" | "explain-folder" | "classify";

export type CacheRow = { key: string; task: Task; model: string; output: Json };

export type CacheStore = {
  read(keys: readonly string[]): Promise<Map<string, Json>>;
  write(rows: readonly CacheRow[]): Promise<void>;
};

// Everything the model is handed, hashed: the task, the pinned model, the
// prompt and the input. Any of them changing is a different question, so it
// is a different key. A file's source is in the input as its content hash,
// which the source sent is checked against.
export function cacheKey(task: Task, model: string, prompt: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify([task, model, prompt, input])).digest("hex");
}

// Traced so it appears inside every task's run: a hit is this step and
// nothing after it. Only the keys are recorded, not the store.
export const readCache = traceable(
  async (store: CacheStore, keys: readonly string[]): Promise<{ hits: number; found: Map<string, Json> }> => {
    const found = await store.read(keys);
    return { hits: found.size, found };
  },
  {
    ...TRACE,
    name: "cache read",
    run_type: "retriever",
    processInputs: ({ args }) => ({ keys: args[1] }),
    processOutputs: (outputs) => ({ hits: outputs.hits, keys: [...outputs.found.keys()] }),
  },
);

type Db = SupabaseClient<Database>;

// Requests stay well under the URL length limit with this many keys in a filter.
const KEYS_PER_READ = 100;

async function readWith(db: Db, keys: readonly string[], organizationId: string | null): Promise<Map<string, Json>> {
  const found = new Map<string, Json>();
  for (let i = 0; i < keys.length; i += KEYS_PER_READ) {
    let query = db
      .from("model_cache")
      .select("key, output")
      .in("key", keys.slice(i, i + KEYS_PER_READ));
    if (organizationId !== null) query = query.eq("organization_id", organizationId);
    const { data, error } = await query.limit(KEYS_PER_READ);
    if (error) throw new Error(`Reading the model cache failed: ${error.message}`);
    for (const row of data) found.set(row.key, row.output);
  }
  return found;
}

async function writeWith(writer: Db, organizationId: string, rows: readonly CacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  // Two requests can miss on the same key at once; the first answer stays.
  const { error } = await writer
    .from("model_cache")
    .upsert(
      rows.map((row) => ({ ...row, organization_id: organizationId })),
      { onConflict: "organization_id,key", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Writing the model cache failed: ${error.message}`);
}

// A signed-in request: reads go through the policy, which is what scopes
// them to the session's organization. Writes use the secret key, like every
// other write, with the organization taken from the session's token.
export function sessionCache(session: Db, writer: Db, organizationId: string): CacheStore {
  return {
    read: (keys) => readWith(session, keys, null),
    write: (rows) => writeWith(writer, organizationId, rows),
  };
}

// A run, which has no session: the secret key bypasses policies, so the
// claimed organization is named in the read as it is in every write the
// pipeline makes.
export function runCache(writer: Db, organizationId: string): CacheStore {
  return {
    read: (keys) => readWith(writer, keys, organizationId),
    write: (rows) => writeWith(writer, organizationId, rows),
  };
}
