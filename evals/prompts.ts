// npm run eval:prompts -- <github-url>
//
// The current file prompt and the retired one, run over the same dataset as
// two experiments and scored the same two ways:
//
// - grounded paths: the invented-path check. Deterministic; an exact answer.
// - specificity: a model's 1–5 judgement of whether the explanation is
//   specific enough to be useful. There is no exact answer to that, so a
//   model judges it, unavoidably. It is an opinion with a number on it, and
//   is reported as one, never as a measurement.
//
// Both prompts are given the identical message for each file, and the model
// is asked directly, with no cache: a cached answer would be scored as if
// the prompt had just produced it.

import { evaluate } from "langsmith/evaluation";
import type { ExperimentResultRow } from "langsmith/evaluation";
import { ai, flushTraces, MODELS } from "../lib/ai/client.ts";
import { clip, FILE_PROMPT, fileInput, fileMessage, writeExplanation } from "../lib/ai/explain.ts";
import { checkPaths, GROUNDED_PATHS, pathScore } from "../lib/ai/invented-paths.ts";
import { RETIRED_FILE_PROMPT } from "./retired-prompt.ts";
import { ensureDataset, percent, requireLangSmith, text, withCheckout } from "./shared.ts";

// Enough files to see a difference, few enough to read every answer.
const FILES = 20;

// Pinned exactly, like every model the app calls, and never the model under
// test grading its own answers.
const JUDGE_MODEL = "gpt-5.4-2026-03-05";
const SPECIFICITY = "specificity (model judge)";

const JUDGE_PROMPT = `You judge explanations of single source files, written for a developer reading a dependency map of a codebase.

You are given exactly what the explainer was given (the file's source and its neighbours in the repository) and the explanation it wrote.

Score how specific the explanation is to this file, from 1 to 5:
1: generic. It could describe almost any file of this kind; nothing in it needed this source.
2: mostly generic, with one or two details taken from the file.
3: specific about what the file does, but says little about why its neighbours use it or what it takes from them.
4: specific about what the file does and the part it plays among its neighbours.
5: as 4, and a developer could act on it: they would know which neighbour to open next and why.

Judge specificity only. Do not reward length, and do not judge the code itself.`;

const VERDICT = {
  type: "object",
  properties: { score: { type: "integer", enum: [1, 2, 3, 4, 5] }, reason: { type: "string" } },
  required: ["score", "reason"],
  additionalProperties: false,
};

async function judge(message: string, explanation: string): Promise<{ score: number; reason: string }> {
  const completion = await ai.chat.completions.create(
    {
      model: JUDGE_MODEL,
      reasoning_effort: "low",
      max_completion_tokens: 4000,
      messages: [
        { role: "system", content: JUDGE_PROMPT },
        { role: "user", content: `<given>\n${message}\n</given>\n\n<explanation>\n${explanation}\n</explanation>` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT } },
    },
    { langsmithExtra: { name: "judge specificity: model" } },
  );
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("The judge returned no verdict.");
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || !("score" in parsed) || !("reason" in parsed)) {
    throw new Error("The judge's verdict wasn't a score and a reason.");
  }
  const { score, reason } = parsed;
  if (typeof score !== "number" || score < 1 || score > 5 || typeof reason !== "string") {
    throw new Error("The judge's verdict wasn't a score from 1 to 5 with a reason.");
  }
  return { score, reason };
}

const VERSIONS = [
  { name: "current", prompt: FILE_PROMPT },
  { name: "retired", prompt: RETIRED_FILE_PROMPT },
] as const;

type Args = { outputs: Record<string, unknown>; inputs: Record<string, unknown> };

function scores(rows: ExperimentResultRow[], key: string): number[] {
  return rows.flatMap((row) =>
    row.evaluationResults.results.filter((r) => r.key === key && typeof r.score === "number").map((r) => Number(r.score)),
  );
}

async function main(args: string[]): Promise<number> {
  const [url] = args;
  if (!url) {
    console.error("usage: npm run eval:prompts -- <github-url>");
    return 2;
  }
  const client = requireLangSmith();

  // The most connected files, which are the ones with neighbours to explain.
  const { label, examples } = await withCheckout(url, async (checkout) => {
    const picked = checkout.result.files
      .filter((f) => f.skipReason === null && f.lines !== null && f.fanIn + f.fanOut > 0)
      .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut) || (a.path < b.path ? -1 : 1))
      .slice(0, FILES);
    const built = [];
    for (const file of picked) {
      // No suggested roles: those come from a separate model run, and the
      // dataset is built from the parse alone.
      const input = fileInput(checkout.repository, checkout.result, new Map(), file.path);
      if (!input.ok) throw new Error(input.message);
      const message = fileMessage(input.input, clip(await checkout.read(file.path), input.input.lines));
      built.push({ inputs: { path: file.path, message }, metadata: { repository: checkout.repository } });
    }
    return { label: checkout.label, examples: built };
  });

  const name = `cartograph explain-file · ${label}`;
  const dataset = await ensureDataset(
    client,
    name,
    "The message the explainer is sent for each of a repository's most connected files, exactly as the app builds it.",
    async () => examples,
  );
  console.log(`dataset   ${name} (${dataset.examples} files, ${dataset.created ? "created" : "reused"})`);

  const results = [];
  for (const version of VERSIONS) {
    const experiment = await evaluate(
      async (inputs: Record<string, unknown>) => ({
        body: await writeExplanation(`explain file (${version.name} prompt): model`, version.prompt, text(inputs, "message")),
      }),
      {
        data: name,
        client,
        experimentPrefix: `explain-file ${version.name}`,
        description: `File explanations with the ${version.name} prompt.`,
        metadata: { prompt: version.name, model: MODELS.explain, judge: JUDGE_MODEL },
        maxConcurrency: 4,
        evaluators: [
          ({ outputs, inputs }: Args) => pathScore(checkPaths([version.prompt, text(inputs, "message")], text(outputs, "body"))),
          async ({ outputs, inputs }: Args) => {
            const verdict = await judge(text(inputs, "message"), text(outputs, "body"));
            return { key: SPECIFICITY, score: verdict.score, comment: verdict.reason };
          },
        ],
      },
    );
    results.push({ version: version.name, experiment });
  }
  await flushTraces();

  const column = (s: string) => s.padEnd(14);
  console.log(`\nmodel     ${MODELS.explain}, judged by ${JUDGE_MODEL}`);
  console.log(`${column("")}${results.map((r) => column(r.version)).join("")}`);
  const grounded = results.map((r) => scores(r.experiment.results, GROUNDED_PATHS));
  console.log(
    `${column(GROUNDED_PATHS)}${grounded.map((s) => column(`${s.filter((x) => x === 1).length}/${s.length} ${percent(s.filter((x) => x === 1).length, s.length)}`)).join("")}`,
  );
  const specific = results.map((r) => scores(r.experiment.results, SPECIFICITY));
  console.log(
    `${column("specificity")}${specific.map((s) => column(s.length ? `${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)} / 5` : "n/a")).join("")}`,
  );
  const failed = results.map((r) => r.experiment.results.filter((row) => row.run.error).length);
  if (failed.some((n) => n > 0)) console.log(`${column("failed calls")}${failed.map((n) => column(String(n))).join("")}`);
  console.log(`\ngrounded paths is exact. specificity is ${JUDGE_MODEL}'s opinion on a 1–5 rubric: a difference of a`);
  console.log(`few tenths over ${dataset.examples} files is within what a second run of the judge could move.`);
  console.log(`\nexperiments ${results.map((r) => r.experiment.experimentName).join(", ")}`);
  console.log(`compare     ${await client.getDatasetUrl({ datasetName: name })} → select both experiments → Compare`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
