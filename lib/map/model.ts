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

export type Category = { name: string; count: number };

export type MapModel = {
  files: MapFile[];
  groups: MapGroup[];
  // Distinct [importer, imported] file index pairs. Duplicate imports of the
  // same file, of any kind, are one link, as they are for fan-in.
  links: [number, number][];
  threshold: number;
  categories: Category[];
};

export const UNLABELLED = "Unlabelled";

export function buildMapModel(result: ParseResult): MapModel {
  const { threshold, groups: folded } = fold(result.files);

  const directories = [...folded.keys()].sort();
  const labels = shortestUniqueLabels(directories);
  const groupOf = new Map<string, number>();
  directories.forEach((dir, g) => {
    for (const path of folded.get(dir) ?? []) groupOf.set(path, g);
  });

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

  // Categories are what the framework adapter says a file is. A file it says
  // nothing about is counted as unlabelled rather than guessed at.
  const byRole = new Map<string, number>();
  for (const file of result.files) {
    const name = file.role ?? UNLABELLED;
    byRole.set(name, (byRole.get(name) ?? 0) + 1);
  }
  const categories = [...byRole.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));

  return { files, groups, links, threshold, categories };
}
