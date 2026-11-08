// npm run eval:roles -- <github-url> [<github-url> ...]
//
// Role accuracy. Convention names some files' roles with certainty, and
// those files never reach the classifier in normal operation, so they are a
// held-out set with real answers. Each is shown to the classifier with its
// role hidden, exactly as an unnamed file would be, and the answer compared.
//
// Only files whose convention role is one the classifier may answer with
// are asked: scoring it on roles it is forbidden to give measures nothing.
// The model is asked directly, with no cache: an experiment that served
// stored answers would measure the cache, not the model.

import { evaluate } from "langsmith/evaluation";
import { askRoles, SUGGESTED_ROLES } from "../lib/ai/classify.ts";
import { flushTraces, MODELS } from "../lib/ai/client.ts";
import { ensureDataset, percent, requireLangSmith, text, withCheckout } from "./shared.ts";

// Below this a percentage moves by several points per file.
const MINIMUM = 30;

type Example = { inputs: { path: string; source: string }; reference_outputs: { role: string }; metadata: { repository: string } };

const allowed = new Set<string>(SUGGESTED_ROLES);

async function main(urls: string[]): Promise<number> {
  if (urls.length === 0) {
    console.error("usage: npm run eval:roles -- <github-url> [<github-url> ...]");
    return 2;
  }
  const client = requireLangSmith();

  const labels: string[] = [];
  const examples: Example[] = [];
  for (const url of urls) {
    await withCheckout(url, async (checkout) => {
      labels.push(checkout.label);
      const held = checkout.result.files.filter((f) => f.skipReason === null && f.role !== null && allowed.has(f.role));
      for (const file of held) {
        examples.push({
          inputs: { path: file.path, source: await checkout.read(file.path) },
          reference_outputs: { role: file.role ?? "" },
          metadata: { repository: checkout.repository },
        });
      }
      console.log(`${checkout.label}  ${held.length} files with a convention role the classifier may give`);
    });
  }
  if (examples.length < MINIMUM) {
    console.error(`Only ${examples.length} files qualify; role accuracy needs at least ${MINIMUM}. Add another repository.`);
    return 1;
  }

  const name = `cartograph roles · ${labels.sort().join(", ")}`;
  const dataset = await ensureDataset(
    client,
    name,
    "Files whose role convention names with certainty, limited to roles the classifier may answer with. The role is the reference answer.",
    async () => examples,
  );
  console.log(`dataset   ${name} (${dataset.examples} files, ${dataset.created ? "created" : "reused"})`);

  // One file per call, where the pipeline sends twenty: an experiment row is
  // one example, and each answer is then scored on its own.
  const results = await evaluate(
    async (inputs: Record<string, unknown>) => {
      const path = text(inputs, "path");
      const answers = await askRoles([{ path, source: text(inputs, "source") }]);
      if (!answers.has(path)) throw new Error(`The model didn't answer for ${path}.`);
      return { role: answers.get(path) ?? null };
    },
    {
      data: name,
      client,
      experimentPrefix: "roles",
      metadata: { model: MODELS.classify },
      maxConcurrency: 4,
      evaluators: [
        ({ outputs, referenceOutputs }: { outputs: Record<string, unknown>; referenceOutputs?: Record<string, unknown> }) => ({
          key: "role correct",
          score: outputs.role === referenceOutputs?.role ? 1 : 0,
        }),
      ],
    },
  );
  await flushTraces();

  // Tallied from the rows themselves: expected role → answers given.
  const byRole = new Map<string, { right: number; total: number; wrong: Map<string, number> }>();
  let right = 0;
  let failed = 0;
  for (const row of results.results) {
    const expected = text(row.example.outputs, "role");
    const tally = byRole.get(expected) ?? { right: 0, total: 0, wrong: new Map<string, number>() };
    byRole.set(expected, tally);
    tally.total++;
    if (row.run.error) {
      failed++;
      continue;
    }
    const answer: unknown = row.run.outputs?.role;
    if (answer === expected) {
      tally.right++;
      right++;
    } else {
      const said = typeof answer === "string" ? answer : "null";
      tally.wrong.set(said, (tally.wrong.get(said) ?? 0) + 1);
    }
  }
  const total = results.results.length;
  console.log(`model     ${MODELS.classify}`);
  console.log(`accuracy  ${right} of ${total} (${percent(right, total)})${failed > 0 ? `, ${failed} calls failed and count as wrong` : ""}`);
  for (const [role, tally] of [...byRole].sort((a, b) => b[1].total - a[1].total)) {
    const wrong = [...tally.wrong].map(([said, n]) => `${n} × ${said}`).join(", ");
    console.log(`  ${role.padEnd(10)} ${tally.right}/${tally.total}${wrong ? `   answered instead: ${wrong}` : ""}`);
  }
  console.log(`experiment ${results.experimentName}`);
  console.log(`           ${await client.getDatasetUrl({ datasetName: name })}`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
