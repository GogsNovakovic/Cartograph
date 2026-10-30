import "server-only";
import { Client } from "langsmith";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";
import { env, tracing } from "../env.ts";

// The only place a model client is constructed. Anything that made its own
// would silently skip tracing, so everything else imports from here: `ai`,
// the model client, and `TRACE`, the settings every traced step is given.

// Exact snapshots, never a moving alias: an alias changes what answers
// without anything here changing, and the cache would go on serving the old
// model's output as if it were the new one's. Each is part of its own task's
// cache key, so re-pinning one invalidates only that task's rows.
export const MODELS = {
  explain: "gpt-5.5-2026-04-23",
  classify: "gpt-5.4-mini-2026-03-17",
} as const;

// Unconfigured tracing still runs every call; it just records nothing. Not
// constructed then, so a missing key never becomes a failed upload.
const langsmith = tracing.on ? new Client() : undefined;

export const ai = wrapOpenAI(new OpenAI({ apiKey: env.openaiApiKey }), {
  client: langsmith,
  tracingEnabled: tracing.on,
});

// Spread into every traceable() so a step reports to the same client, and
// is off by the same rule, as the model calls inside it. Every model task is
// a traced step with its cache read as a traced step inside it, so a cache
// hit shows up as a run with no model call.
export const TRACE = { client: langsmith, tracingEnabled: tracing.on };

// Traces are sent in the background. A terminal run exits, and a request's
// work can end, before the last batch is delivered, so callers wait for it.
export async function flushTraces(): Promise<void> {
  await langsmith?.awaitPendingTraceBatches();
}
