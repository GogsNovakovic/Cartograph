import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "langsmith";
import type { ExampleCreate } from "langsmith/schemas";
import { langsmith } from "../lib/ai/client.ts";
import { tracing } from "../lib/env.ts";
import { downloadArchive, parseRepositoryUrl, resolveCommit } from "../lib/pipeline/github.ts";
import { parseRepository, type ParseResult } from "../parser/index.ts";

// Experiments and datasets live in LangSmith, so an eval with tracing off
// has nowhere to put its answer. It stops and says why, rather than running
// and recording nothing.
export function requireLangSmith(): Client {
  if (!langsmith) {
    throw new Error(`LangSmith tracing is off (${tracing.on ? "no client" : tracing.reason}). Evals record their runs there.`);
  }
  return langsmith;
}

export type Checkout = {
  // owner/name, as the explain prompt names the repository.
  repository: string;
  // owner/name@abc1234: names the exact commit a dataset was built from.
  label: string;
  result: ParseResult;
  read: (file: string) => Promise<string>;
};

// The repository at its current commit, parsed by the same parser the
// pipeline runs, with its files readable until `work` returns.
export async function withCheckout<T>(url: string, work: (checkout: Checkout) => Promise<T>): Promise<T> {
  const parsed = parseRepositoryUrl(url);
  if (!parsed.ok) throw new Error(parsed.message);
  const { repository } = parsed;
  const commit = await resolveCommit(repository);
  const directory = await mkdtemp(path.join(tmpdir(), "cartograph-eval-"));
  try {
    await downloadArchive(repository, commit, directory);
    return await work({
      repository: `${repository.owner}/${repository.name}`,
      label: `${repository.owner}/${repository.name}@${commit.slice(0, 7)}`,
      result: parseRepository(directory),
      read: (file) => readFile(path.join(directory, file), "utf8"),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// A dataset is named for the commits it was built from, so the same name is
// the same examples: an existing one is reused as it stands, which is what
// lets a later experiment be compared with an earlier one.
export async function ensureDataset(
  client: Client,
  name: string,
  description: string,
  build: () => Promise<Array<Omit<ExampleCreate, "dataset_id">>>,
): Promise<{ created: boolean; examples: number }> {
  if (await client.hasDataset({ datasetName: name })) {
    const ids: string[] = [];
    for await (const example of client.listExamples({ datasetName: name })) ids.push(example.id);
    return { created: false, examples: ids.length };
  }
  const examples = await build();
  const dataset = await client.createDataset(name, { description });
  await client.createExamples(examples.map((example) => ({ ...example, dataset_id: dataset.id })));
  return { created: true, examples: examples.length };
}

// Values read back from LangSmith are checked for shape, not trusted to have one.
export function text(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  if (typeof value !== "string") throw new Error(`Expected a string at "${key}".`);
  return value;
}

export function percent(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((100 * part) / whole).toFixed(1)}%`;
}
