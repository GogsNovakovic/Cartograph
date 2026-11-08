// npm run eval:paths [-- --limit 50]
// npm run eval:paths -- --splice <made-up-path>
//
// The invented-path check over recent real explanations: the model runs the
// app traced, each read back with exactly what the model was sent. The same
// check runs live on every new explanation; this is the same code run over
// the record, so a flagged run can be opened and confirmed by hand.
//
// --splice takes the most recent explanation, adds a sentence naming a path
// that was never shown, and checks that instead: the check must catch it.

import type { Run } from "langsmith/schemas";
import { tracing } from "../lib/env.ts";
import { checkPaths } from "../lib/ai/invented-paths.ts";
import { percent, requireLangSmith } from "./shared.ts";

const NAMES = ["explain file: model", "explain folder: model"];

type Explained = { run: Run; shown: string[]; body: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// What the wrapped client records: the request as its one argument, and the
// completion as the output. Anything else isn't a run this check can read,
// and is reported as such rather than scored.
function read(run: Run): Explained | string {
  const args: unknown = run.inputs.args;
  const request: unknown = Array.isArray(args) ? args[0] : undefined;
  const messages = isRecord(request) ? request.messages : undefined;
  if (!Array.isArray(messages)) return "no messages in its inputs";
  const shown: string[] = [];
  for (const message of messages) {
    if (!isRecord(message) || typeof message.content !== "string") return "a message that isn't text";
    shown.push(message.content);
  }
  const choices: unknown = run.outputs?.choices;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first.message : undefined;
  const body = isRecord(message) ? message.content : undefined;
  if (typeof body !== "string" || body.trim() === "") return "no answer in its outputs";
  return { run, shown, body };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function main(args: string[]): Promise<number> {
  const client = requireLangSmith();
  const splice = flag(args, "--splice");
  const limit = Number(flag(args, "--limit") ?? 50);
  if (!Number.isInteger(limit) || limit < 1) {
    console.error("usage: npm run eval:paths [-- --limit <n>]\n       npm run eval:paths -- --splice <made-up-path>");
    return 2;
  }
  const project = tracing.on ? tracing.project : "";
  const runUrl = (run: Run) => (run.app_path ? `${client.getHostUrl()}${run.app_path}` : run.id);

  const explained: Explained[] = [];
  const unreadable: Array<{ run: Run; reason: string }> = [];
  for await (const run of client.listRuns({
    projectName: project,
    filter: `and(in(name, [${NAMES.map((n) => JSON.stringify(n)).join(", ")}]), eq(status, "success"))`,
    limit: splice ? 1 : limit,
  })) {
    const found = read(run);
    if (typeof found === "string") unreadable.push({ run, reason: found });
    else explained.push(found);
  }

  // Nothing to check is not a perfect score.
  if (explained.length === 0) {
    console.error(`No explanations in LangSmith project ${project} to check. Explain a few files in the app first.`);
    for (const { run, reason } of unreadable) console.error(`  unreadable ${runUrl(run)}: ${reason}`);
    return 1;
  }

  if (splice) {
    const [latest] = explained;
    const body = `${latest.body}\n\nIt also hands its result to \`${splice}\`.`;
    const check = checkPaths(latest.shown, body);
    console.log(`spliced   \`${splice}\` into ${runUrl(latest.run)}`);
    console.log(`named     ${check.mentioned.join(", ")}`);
    console.log(`invented  ${check.invented.length > 0 ? check.invented.join(", ") : "none"}`);
    const caught = check.invented.includes(splice.replace(/^(?:\.\/)+/, "").replace(/\/+$/, ""));
    console.log(caught ? "caught    yes" : "caught    NO — the check missed a path that was never shown");
    return caught ? 0 : 1;
  }

  const checks = explained.map((e) => ({ ...e, ...checkPaths(e.shown, e.body) }));
  const grounded = checks.filter((c) => c.invented.length === 0).length;
  const mentions = checks.reduce((sum, c) => sum + c.mentioned.length, 0);
  console.log(`checked   ${checks.length} most recent explanations in LangSmith project ${project}`);
  console.log(`paths     ${mentions} named in them`);
  console.log(`score     ${grounded} of ${checks.length} name only paths they were shown (${percent(grounded, checks.length)})`);
  for (const c of checks.filter((c) => c.invented.length > 0)) {
    console.log(`\n  ${c.run.name}  ${runUrl(c.run)}`);
    for (const path of c.invented) console.log(`    not shown: ${path}`);
  }
  for (const { run, reason } of unreadable) console.log(`\n  unreadable ${runUrl(run)}: ${reason}`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
