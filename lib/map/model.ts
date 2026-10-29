// What the map is drawn from, derived from a parse result. The parse result
// is the contract and isn't changed; this is a view over it, built once on
// the server so the browser gets indexes instead of 4,000 path pairs.

import type { CommonJsExports, ParseResult } from "../../parser/types.ts";
import { fold, ROOT } from "./fold.ts";
import { shortestUniqueLabels } from "./labels.ts";
import { categoriesFor, categoryOf, NO_CONVENTION, UNLISTED } from "./taxonomy.ts";

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
  // Loaded by the framework or a tool itself, so not importing it is normal.
  entry: boolean;
  // The category it belongs to in the rail.
  kind: string;
  // Which kind colour the file carries, or null for a kind left grey.
  hue: number | null;
  commonjsExports: CommonJsExports | null;
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

// A rail category: a kind of file by the role a framework or tool gives it.
// `hue` indexes the kind colours; null is grey.
export type Category = { name: string; count: number; hue: number | null };

// A route the parser read exactly, pointing at the file that declares it.
export type MapRoute = { file: number; line: number; method: string; path: string };

export type MapModel = {
  // What the repository is called, and the adapters whose conventions named
  // at least one of its files.
  repository: { name: string; framework: string | null; adapters: string[] };
  files: MapFile[];
  groups: MapGroup[];
  // Distinct [importer, imported] file index pairs. Duplicate imports of the
  // same file, of any kind, are one link, as they are for fan-in.
  links: [number, number][];
  // typeOnly[i]: every statement making links[i] is a type import, so the
  // connection disappears at runtime.
  typeOnly: boolean[];
  threshold: number;
  categories: Category[];
  // In the parser's order: by path, then method.
  routes: MapRoute[];
};

// Colour separates a handful of kinds and no more: the first categories in
// reading order that have files get a hue, the rest stay grey. Must match
// the --kind-N tokens.
export const KIND_HUES = 4;

export function buildMapModel(result: ParseResult): MapModel {
  const { threshold, groups: folded } = fold(result.files);

  const directories = [...folded.keys()].sort();
  const labels = shortestUniqueLabels(directories);
  const groupOf = new Map<string, number>();
  directories.forEach((dir, g) => {
    for (const path of folded.get(dir) ?? []) groupOf.set(path, g);
  });

  // The framework's categories in their fixed order, so the same repository
  // always lays its rail out the same way. Empty ones are left out unless
  // the framework always shows them.
  const definitions = categoriesFor(result.framework);
  const kindOf = (role: string | null) => categoryOf(definitions, role);
  const counts = new Map<string, number>();
  for (const file of result.files) counts.set(kindOf(file.role), (counts.get(kindOf(file.role)) ?? 0) + 1);
  let hues = 0;
  const categories: Category[] = definitions
    .map((definition) => ({ definition, count: counts.get(definition.name) ?? 0 }))
    .filter(({ definition, count }) => count > 0 || definition.always)
    .map(({ definition, count }) => ({
      name: definition.name,
      count,
      // Files nothing named have no kind to colour.
      hue: count > 0 && hues < KIND_HUES && definition.name !== NO_CONVENTION && definition.name !== UNLISTED ? hues++ : null,
    }));
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
        entry: file.entry,
        kind: kindOf(file.role),
        hue: hueOf.get(kindOf(file.role)) ?? null,
        commonjsExports: file.commonjsExports,
      };
    });
  const indexOf = new Map(files.map((file, i) => [file.path, i]));

  const seen = new Map<string, number>();
  const links: [number, number][] = [];
  const typeOnly: boolean[] = [];
  for (const edge of result.edges) {
    const source = indexOf.get(edge.source);
    const target = indexOf.get(edge.target);
    // The parser only writes edges between files it lists, so a miss here is
    // a broken data file, not something to quietly drop.
    if (source === undefined || target === undefined) {
      throw new Error(`edge ${edge.source} -> ${edge.target} names a file that isn't in the result`);
    }
    const key = `${source}>${target}`;
    if (source === target) continue;
    const at = seen.get(key);
    if (at !== undefined) {
      typeOnly[at] = typeOnly[at] && edge.typeOnly;
      continue;
    }
    seen.set(key, links.length);
    links.push([source, target]);
    typeOnly.push(edge.typeOnly);
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

  // The checked-in result only knows the directory it was parsed from; its
  // last segment is the repository's name.
  const name = result.root.replace(/\/+$/, "").split("/").pop() || result.root;
  const routes = result.routes.map((route) => {
    const file = indexOf.get(route.file);
    if (file === undefined) throw new Error(`route ${route.method} ${route.path} names ${route.file}, which isn't in the result`);
    return { file, line: route.line, method: route.method, path: route.path };
  });
  return {
    repository: { name, framework: result.framework, adapters: result.adapters },
    files,
    groups,
    links,
    typeOnly,
    threshold,
    categories,
    routes,
  };
}
