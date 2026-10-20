// npm run parse -- <directory> [--out result.json]
// npm run parse -- --read result.json
//
// Both print the same summary, so a written file read back should print
// exactly what the parse printed.

import { writeFileSync } from "node:fs";
import { parseRepository } from "./index.ts";
import { readParseResult } from "./read.ts";
import { EDGE_KINDS, type ParseResult } from "./types.ts";

function countBy<T>(items: readonly T[], key: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function summarise(result: ParseResult): string {
  const { files, imports, reasons } = result.coverage;
  const out: string[] = [];
  const line = (text = "") => out.push(text);

  line(`root      ${result.root}`);
  line(`adapter   ${result.adapter}`);
  line();
  line(`files     found ${files.found}   parsed ${files.parsed}   skipped ${files.skipped}`);
  for (const file of result.files) {
    if (file.skipReason) line(`  skipped ${file.path} — ${file.skipReason}`);
  }
  line(`folders   ${new Set(result.files.map((f) => f.folder)).size} distinct`);
  line(`excluded directories ${result.excludedDirectories.length}`);
  for (const [reason, n] of countBy(result.excludedDirectories, (d) => d.reason)) {
    line(`  ${n} × ${reason}`);
  }
  line();
  line(`imports   ${imports.total} seen`);
  line(`  kind            seen  resolved  external  excluded  unresolved`);
  for (const kind of EDGE_KINDS) {
    const c = imports.byKind[kind];
    line(
      `  ${kind.padEnd(14)}${String(c.total).padStart(6)}${String(c.resolved).padStart(10)}${String(c.external).padStart(10)}${String(c.excluded).padStart(10)}${String(c.unresolved).padStart(12)}`,
    );
  }
  line();
  line(`edges     ${result.edges.length}`);
  const top = [...result.files].sort((a, b) => b.fanIn - a.fanIn).slice(0, 5);
  line(`  most imported: ${top.map((f) => `${f.path} (${f.fanIn})`).join(", ")}`);
  line();
  for (const group of reasons) {
    line(`${group.outcome} · ${group.reason} · ${group.count}`);
    // External imports are expected and numerous; show what's interesting.
    const shown = group.outcome === "external" ? group.examples.slice(0, 3) : group.examples;
    for (const x of shown) line(`  ${x.from}:${x.line}  ${x.kind} "${x.specifier}" — ${x.detail}`);
    if (group.count > shown.length) line(`  … ${group.count - shown.length} more`);
  }
  return out.join("\n");
}

function main(args: string[]): number {
  const readIndex = args.indexOf("--read");
  if (readIndex !== -1) {
    const file = args[readIndex + 1];
    if (!file) return usage();
    console.log(summarise(readParseResult(file)));
    console.log(`\nread back ${file}: every field matches the ParseResult type`);
    return 0;
  }

  const outIndex = args.indexOf("--out");
  const outFile = outIndex === -1 ? null : args[outIndex + 1];
  if (outIndex !== -1 && !outFile) return usage();
  const directory = args.find((arg, i) => !arg.startsWith("--") && (outIndex === -1 || i !== outIndex + 1));
  if (!directory) return usage();

  const started = performance.now();
  const result = parseRepository(directory);
  console.log(summarise(result));
  console.log(`\nparsed in ${Math.round(performance.now() - started)} ms`);
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
    console.log(`wrote ${outFile}`);
  }
  return 0;
}

function usage(): number {
  console.error("usage: npm run parse -- <directory> [--out result.json]\n       npm run parse -- --read result.json");
  return 2;
}

process.exitCode = main(process.argv.slice(2));
