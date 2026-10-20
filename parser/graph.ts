import type { Edge } from "./types.ts";

export type Degree = { fanIn: number; fanOut: number };

// One connection per ordered pair of files, however many statements make it:
// a file that imports a module twice (a value and a type, say) still depends
// on it once. A file naming itself isn't a dependency on anything.
export function distinctConnections(edges: readonly Edge[]): Array<[string, string]> {
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const { source, target } of edges) {
    if (source === target) continue;
    const key = `${source}\0${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([source, target]);
  }
  return pairs;
}

export function degrees(paths: readonly string[], edges: readonly Edge[]): Map<string, Degree> {
  const result = new Map<string, Degree>(paths.map((p) => [p, { fanIn: 0, fanOut: 0 }]));
  for (const [source, target] of distinctConnections(edges)) {
    const from = result.get(source);
    const to = result.get(target);
    if (from) from.fanOut++;
    if (to) to.fanIn++;
  }
  return result;
}
