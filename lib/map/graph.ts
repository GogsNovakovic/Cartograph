// Arithmetic over the edge list: walks and insights. Pure functions over a
// file count and [importer, imported] index pairs, with no React and no
// data fetching, so every answer can be checked from a script.

export type Link = readonly [number, number];

export type Adjacency = {
  // imports[f]: files f imports. importers[f]: files importing f.
  imports: number[][];
  importers: number[][];
};

export function adjacency(count: number, links: readonly Link[]): Adjacency {
  const imports: number[][] = Array.from({ length: count }, () => []);
  const importers: number[][] = Array.from({ length: count }, () => []);
  for (const [source, target] of links) {
    imports[source].push(target);
    importers[target].push(source);
  }
  return { imports, importers };
}

// "dependents" is the blast radius: everything that breaks if this file
// changes. "dependencies" is the dependency chain: everything it needs.
export type Direction = "dependents" | "dependencies";

// Two levels. Deeper returns most of a real repository and stops being an
// answer.
export const DEFAULT_DEPTH = 2;

export type Reached = { file: number; depth: number };

// Breadth-first, so each file is listed at the shortest distance it's
// reached at. Ordered by depth, then by index (which is path order).
export function walk(
  graph: Adjacency,
  start: number,
  direction: Direction,
  depth: number = DEFAULT_DEPTH,
): Reached[] {
  const next = direction === "dependents" ? graph.importers : graph.imports;
  const seen = new Set<number>([start]);
  const reached: Reached[] = [];
  let frontier = [start];
  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    const found: number[] = [];
    for (const file of frontier) {
      for (const other of next[file]) {
        if (seen.has(other)) continue;
        seen.add(other);
        found.push(other);
      }
    }
    found.sort((a, b) => a - b);
    for (const file of found) reached.push({ file, depth: level });
    frontier = found;
  }
  return reached;
}

// What insights need to know about a file beyond its edges.
export type InsightFile = {
  // Set when a framework or tool reaches the file by convention.
  role: string | null;
  lines: number | null;
};

// A cycle is listed in walking order: each file imports the next, and the
// last imports the first. `among` is how many files share the loop it sits
// in, every one of which can reach every other.
export type Insight =
  | { kind: "unimported"; files: number[] }
  | { kind: "cycles"; cycles: { files: number[]; among: number }[] }
  | { kind: "heavily-imported"; files: number[] }
  | { kind: "long"; files: number[] };

// The only words an insight ever carries. No model writes them.
export const INSIGHT_SENTENCES: Record<Insight["kind"], string> = {
  unimported: "Nothing the parser read imports these files, and no framework convention reaches them.",
  cycles: "Each file in a loop imports the next, and the last imports the first.",
  "heavily-imported": "More files import each of these than import 99% of the repository's files.",
  long: "These files are over 1,000 lines long.",
};

export const LONG_LINES = 1000;
const HEAVY_PERCENTILE = 0.99;

// Unimported leads: it explains the repository. Cycles and long files read
// closer to a verdict, so they come after.
export function findInsights(files: readonly InsightFile[], links: readonly Link[]): Insight[] {
  const graph = adjacency(files.length, links);
  const indexes = files.map((_, i) => i);

  // A page or a config isn't imported because the framework reaches it;
  // listing it would describe the limit of the import graph, not the code.
  const unimported = indexes.filter((i) => graph.importers[i].length === 0 && files[i].role === null);

  const fanIns = indexes.map((i) => graph.importers[i].length).sort((a, b) => a - b);
  const cutoff = fanIns[Math.min(fanIns.length - 1, Math.floor(fanIns.length * HEAVY_PERCENTILE))] ?? 0;
  const heavy = indexes
    .filter((i) => cutoff > 0 && graph.importers[i].length >= cutoff)
    .sort((a, b) => graph.importers[b].length - graph.importers[a].length || a - b);

  const long = indexes
    .filter((i) => (files[i].lines ?? 0) > LONG_LINES)
    .sort((a, b) => (files[b].lines ?? 0) - (files[a].lines ?? 0) || a - b);

  const cycles = components(graph)
    .filter((members) => members.length > 1)
    .map((members) => ({ files: shortestCycle(graph, members), among: members.length }))
    .sort((a, b) => b.among - a.among || a.files[0] - b.files[0]);

  return [
    { kind: "unimported", files: unimported },
    { kind: "cycles", cycles },
    { kind: "heavily-imported", files: heavy },
    { kind: "long", files: long },
  ];
}

// Tarjan's strongly connected components, with an explicit stack instead of
// recursion: a real repository's import chains run deep enough to overflow
// the call stack.
function components(graph: Adjacency): number[][] {
  const count = graph.imports.length;
  const index = new Array<number>(count).fill(-1);
  const low = new Array<number>(count).fill(0);
  const onStack = new Array<boolean>(count).fill(false);
  const stack: number[] = [];
  const result: number[][] = [];
  let counter = 0;

  for (let root = 0; root < count; root++) {
    if (index[root] !== -1) continue;
    // Each frame is a file and how far through its imports the walk has got.
    const frames: { file: number; next: number }[] = [{ file: root, next: 0 }];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const targets = graph.imports[frame.file];
      if (frame.next < targets.length) {
        const target = targets[frame.next++];
        if (index[target] === -1) {
          index[target] = low[target] = counter++;
          stack.push(target);
          onStack[target] = true;
          frames.push({ file: target, next: 0 });
        } else if (onStack[target]) {
          low[frame.file] = Math.min(low[frame.file], index[target]);
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) low[parent.file] = Math.min(low[parent.file], low[frame.file]);
      if (low[frame.file] === index[frame.file]) {
        const members: number[] = [];
        for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
          onStack[member] = false;
          members.push(member);
          if (member === frame.file) break;
        }
        result.push(members.sort((a, b) => a - b));
      }
    }
  }
  return result;
}

// The shortest loop inside one component, so it can be walked by hand: a
// breadth-first search from each member back to itself, staying inside the
// component. Ties go to the lowest starting index, so it's deterministic.
function shortestCycle(graph: Adjacency, members: readonly number[]): number[] {
  const inside = new Set(members);
  let best: number[] = [];
  for (const start of members) {
    const parent = new Map<number, number>();
    let frontier = [start];
    let closing: number | null = null;
    while (frontier.length > 0 && closing === null) {
      // A loop no shorter than the best one found can't improve on it.
      if (best.length > 0 && pathLength(parent, frontier[0], start) >= best.length) break;
      const found: number[] = [];
      for (const file of frontier) {
        for (const target of graph.imports[file]) {
          if (target === start) {
            closing = file;
            break;
          }
          if (!inside.has(target) || parent.has(target)) continue;
          parent.set(target, file);
          found.push(target);
        }
        if (closing !== null) break;
      }
      frontier = found;
    }
    if (closing === null) continue;
    const loop = [closing];
    while (loop[0] !== start) loop.unshift(parent.get(loop[0]) ?? start);
    if (best.length === 0 || loop.length < best.length) best = loop;
    if (best.length === 2) break;
  }
  return best;
}

function pathLength(parent: ReadonlyMap<number, number>, file: number, start: number): number {
  let length = 1;
  for (let at = file; at !== start; at = parent.get(at) ?? start) length++;
  return length;
}
