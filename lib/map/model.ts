// What the map is drawn from, derived from a parse result. The parse result
// is the contract and isn't changed; this is a view over it, built once on
// the server so the browser gets indexes instead of 4,000 path pairs.

import type { ParseResult } from "../../parser/types.ts";
import { fold, ROOT } from "./fold.ts";
import { shortestUniqueLabels } from "./labels.ts";

export type MapFile = {
  path: string;
  // Path relative to its group's directory: what its row shows.
  name: string;
  group: number;
  fanIn: number;
  fanOut: number;
  lines: number | null;
  // What a framework or tool reaches the file as, from the parse result.
  role: string | null;
  // The category it belongs to in the rail.
  kind: string;
  // Which kind colour the file carries, or null for a kind left grey.
  hue: number | null;
};

export type MapGroup = {
  directory: string;
  label: string;
  // File indexes, most depended-on first, so a panel that can't show every
  // row shows the ones the most other files lean on.
  files: number[];
  // Distinct files outside the group importing into it / imported from it.
  fanIn: number;
  fanOut: number;
};

// A kind of file, by extension. `hue` indexes the kind colours; null is grey.
export type Category = { name: string; count: number; hue: number | null };

export type MapModel = {
  files: MapFile[];
  groups: MapGroup[];
  // Distinct [importer, imported] file index pairs. Duplicate imports of the
  // same file, of any kind, are one link, as they are for fan-in.
  links: [number, number][];
  threshold: number;
  categories: Category[];
};

// Colour separates a handful of kinds and no more: the most common get a
// hue, the long tail stays grey. Must match the --kind-N tokens.
export const KIND_HUES = 4;

// Kind is the extension, read straight off the path, so it's a fact about the
// file rather than a judgement. "Makefile" or ".eslintrc" has none.
export function kindOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "no extension" : base.slice(dot);
}

export function buildMapModel(result: ParseResult): MapModel {
  const { threshold, groups: folded } = fold(result.files);

  const directories = [...folded.keys()].sort();
  const labels = shortestUniqueLabels(directories);
  const groupOf = new Map<string, number>();
  directories.forEach((dir, g) => {
    for (const path of folded.get(dir) ?? []) groupOf.set(path, g);
  });

  const byKind = new Map<string, number>();
  for (const file of result.files) byKind.set(kindOf(file.path), (byKind.get(kindOf(file.path)) ?? 0) + 1);
  const categories: Category[] = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([name, count], i) => ({ name, count, hue: i < KIND_HUES ? i : null }));
  const hueOf = new Map(categories.map((category) => [category.name, category.hue]));

  const files: MapFile[] = [...result.files]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((file) => {
      const group = groupOf.get(file.path);
      if (group === undefined) throw new Error(`${file.path} was not folded into any group`);
      const dir = directories[group];
      return {
        path: file.path,
        name: dir === ROOT ? file.path : file.path.slice(dir.length + 1),
        group,
        fanIn: file.fanIn,
        fanOut: file.fanOut,
        lines: file.lines,
        role: file.role,
        kind: kindOf(file.path),
        hue: hueOf.get(kindOf(file.path)) ?? null,
      };
    });
  const indexOf = new Map(files.map((file, i) => [file.path, i]));

  const seen = new Set<string>();
  const links: [number, number][] = [];
  for (const edge of result.edges) {
    const source = indexOf.get(edge.source);
    const target = indexOf.get(edge.target);
    // The parser only writes edges between files it lists, so a miss here is
    // a broken data file, not something to quietly drop.
    if (source === undefined || target === undefined) {
      throw new Error(`edge ${edge.source} -> ${edge.target} names a file that isn't in the result`);
    }
    const key = `${source}>${target}`;
    if (source === target || seen.has(key)) continue;
    seen.add(key);
    links.push([source, target]);
  }

  const importers = directories.map(() => new Set<number>());
  const imported = directories.map(() => new Set<number>());
  for (const [source, target] of links) {
    const from = files[source].group;
    const to = files[target].group;
    if (from === to) continue;
    importers[to].add(source);
    imported[from].add(target);
  }

  const groups: MapGroup[] = directories.map((directory, g) => ({
    directory,
    label: directory === ROOT ? "./" : (labels.get(directory) ?? directory),
    files: files
      .map((_, i) => i)
      .filter((i) => files[i].group === g)
      .sort((a, b) => files[b].fanIn - files[a].fanIn || (files[a].path < files[b].path ? -1 : 1)),
    fanIn: importers[g].size,
    fanOut: imported[g].size,
  }));

  return { files, groups, links, threshold, categories };
}
