// What's on the canvas for a given set of open folders: every box, its size
// and place, and every edge with the exact row or node it ends on. Pure, and
// free of React Flow, so the same picture can be counted from a script.

import dagre from "@dagrejs/dagre";
import type { MapModel } from "./model.ts";

// Geist Mono advances 0.6em, so at 12px every character is 7.2px wide. Sizes
// are computed rather than measured so the layout is known before render,
// and so the same data always gives the same picture.
const CHAR = 7.2;
export const FOLDER_MIN_WIDTH = 156;
export const FOLDER_BASE_HEIGHT = 44;
export const HEADER_HEIGHT = 42;
export const ROW_HEIGHT = 20;
export const MAX_ROWS = 14;
const PANEL_MIN_WIDTH = 240;
const PANEL_MAX_WIDTH = 440;

export type FolderBox = {
  kind: "folder";
  id: string;
  group: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PanelBox = {
  kind: "panel";
  id: string;
  group: number;
  x: number;
  y: number;
  width: number;
  height: number;
  // File indexes shown as rows; the rest are counted, not listed.
  rows: number[];
  hidden: number;
};

export type Box = FolderBox | PanelBox;

// An end of an edge: a whole folded node, one row, or a panel's "N more" row.
export type Slot = { node: string; slot: "node" | "more" | number };

export type ViewEdge = {
  id: string;
  source: Slot;
  target: Slot;
  // Distinct file-to-file imports this edge stands for.
  count: number;
};

export type View = { boxes: Box[]; edges: ViewEdge[] };

// Height carries fan-in: how many files outside depend on this folder. Log
// scale, or the one folder everything imports would dwarf the rest.
export function folderHeight(fanIn: number): number {
  return FOLDER_BASE_HEIGHT + Math.round(14 * Math.log2(1 + fanIn));
}

// Width comes from the label alone, so a long name doesn't read as important.
function folderWidth(label: string): number {
  return Math.max(FOLDER_MIN_WIDTH, Math.ceil(label.length * CHAR) + 24);
}

export function slotKey(slot: Slot): string {
  return `${slot.node}|${slot.slot}`;
}

// `pinned` is a selected file: if its panel is open but too long to list it,
// it takes the last row, so a selection is always something on screen.
export function buildView(model: MapModel, open: ReadonlySet<number>, pinned: number | null = null): View {
  const sized = model.groups.map((group, g) => {
    const id = group.directory;
    if (!open.has(g)) {
      return { kind: "folder" as const, id, group: g, width: folderWidth(group.label), height: folderHeight(group.fanIn) };
    }
    // Showing 14 rows and "1 more" would spend a row saying less than the row.
    const rows = group.files.length <= MAX_ROWS + 1 ? group.files : group.files.slice(0, MAX_ROWS);
    if (pinned !== null && model.files[pinned].group === g && !rows.includes(pinned)) {
      rows[rows.length - 1] = pinned;
    }
    const hidden = group.files.length - rows.length;
    const longest = Math.max(...rows.map((f) => model.files[f].name.length));
    const width = Math.min(
      PANEL_MAX_WIDTH,
      Math.max(PANEL_MIN_WIDTH, folderWidth(group.label), Math.ceil(longest * CHAR) + 80),
    );
    const height = HEADER_HEIGHT + (rows.length + (hidden > 0 ? 1 : 0)) * ROW_HEIGHT + 4;
    return { kind: "panel" as const, id, group: g, width, height, rows, hidden };
  });

  const shown = sized.map((box) => (box.kind === "panel" ? new Set(box.rows) : null));
  const slotOf = (file: number): Slot => {
    const g = model.files[file].group;
    const node = model.groups[g].directory;
    const rows = shown[g];
    if (!rows) return { node, slot: "node" };
    return { node, slot: rows.has(file) ? file : "more" };
  };

  const edges = new Map<string, ViewEdge>();
  for (const [from, to] of model.links) {
    const source = slotOf(from);
    const target = slotOf(to);
    // Imports inside one box don't leave it, so they draw nothing.
    if (source.node === target.node) continue;
    const id = `${slotKey(source)}>${slotKey(target)}`;
    const edge = edges.get(id);
    if (edge) edge.count++;
    else edges.set(id, { id, source, target, count: 1 });
  }

  const positions = layout(sized, [...edges.values()]);
  const boxes: Box[] = sized.map((box) => {
    const position = positions.get(box.id);
    if (!position) throw new Error(`layout placed no ${box.id}`);
    return { ...box, ...position };
  });
  return { boxes, edges: [...edges.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) };
}

// Left to right: importers on the left, what they import on the right. The
// map column is wider than it is tall, and rows take edges on their sides.
// Input order is fixed (groups are sorted, edges sorted by id), which is what
// makes dagre give the same picture every time.
function layout(
  boxes: readonly { id: string; width: number; height: number }[],
  edges: readonly ViewEdge[],
): Map<string, { x: number; y: number }> {
  const pairs = new Map<string, [string, string]>();
  for (const edge of edges) {
    pairs.set(`${edge.source.node}>${edge.target.node}`, [edge.source.node, edge.target.node]);
  }
  const component = stronglyConnected(boxes.map((box) => box.id), [...pairs.values()]);

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 14, edgesep: 6, ranksep: 64, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const box of boxes) graph.setNode(box.id, { width: box.width, height: box.height });
  // Folders that import each other in a cycle have no left-to-right order.
  // Given those edges, dagre breaks each cycle by stringing its members into
  // a chain, which on a real repository runs to fifteen columns for twenty
  // nodes. Ranking only on edges between cycles keeps the map compact. This
  // decides placement only: every edge is still drawn.
  for (const [source, target] of pairs.values()) {
    if (component.get(source) !== component.get(target)) graph.setEdge(source, target);
  }
  dagre.layout(graph);

  // Dagre decides each box's rank and its order within the rank. Where it
  // puts them is redone here: one cycle can hold most of a repository, and
  // as a single column it's too tall to read once fitted to the screen.
  const ranks = new Map<number, { id: string; width: number; height: number; y: number }[]>();
  for (const box of boxes) {
    const { x, y } = graph.node(box.id);
    if (x === undefined || y === undefined) throw new Error(`dagre placed no ${box.id}`);
    const rank = Math.round(x);
    ranks.set(rank, [...(ranks.get(rank) ?? []), { ...box, y }]);
  }
  const columns = [...ranks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, members]) => members.sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1)));
  return wrap(columns);
}

// The map column's shape, width over height, roughly.
const ASPECT = 1.2;
const GAP_X = 64;
const GAP_Y = 14;

// Splits each rank, in order, into sub-columns no taller than some height H,
// and picks the H whose overall box best fills a frame of ASPECT. Ranks still
// read left to right; a tall rank just becomes several narrow ones.
function wrap(
  ranks: readonly (readonly { id: string; width: number; height: number }[])[],
): Map<string, { x: number; y: number }> {
  type Item = { id: string; width: number; height: number };
  const split = (limit: number) =>
    ranks.flatMap((rank) => {
      const columns: Item[][] = [[]];
      let used = 0;
      for (const item of rank) {
        const current = columns[columns.length - 1];
        if (current.length > 0 && used + GAP_Y + item.height > limit) {
          columns.push([item]);
          used = item.height;
        } else {
          current.push(item);
          used += (current.length > 1 ? GAP_Y : 0) + item.height;
        }
      }
      return columns;
    });
  const heightOf = (column: readonly Item[]) =>
    column.reduce((sum, item) => sum + item.height, 0) + GAP_Y * (column.length - 1);
  const widthOf = (columns: readonly Item[][]) =>
    columns.reduce((sum, column) => sum + Math.max(...column.map((item) => item.width)), 0) +
    GAP_X * (columns.length - 1);

  const tallest = Math.max(...ranks.flatMap((rank) => rank.map((item) => item.height)));
  const highest = Math.max(...ranks.map(heightOf));
  let best = split(highest);
  let bestScale = Infinity;
  for (let limit = tallest; limit <= highest; limit += 20) {
    const columns = split(limit);
    const height = Math.max(...columns.map(heightOf));
    // The size of frame this needs at ASPECT; smaller fits the screen larger.
    const scale = Math.max(widthOf(columns) / ASPECT, height);
    if (scale < bestScale) {
      bestScale = scale;
      best = columns;
    }
  }

  const height = Math.max(...best.map(heightOf));
  const positions = new Map<string, { x: number; y: number }>();
  let x = 0;
  for (const column of best) {
    const width = Math.max(...column.map((item) => item.width));
    let y = (height - heightOf(column)) / 2;
    for (const item of column) {
      positions.set(item.id, { x, y });
      y += item.height + GAP_Y;
    }
    x += width + GAP_X;
  }
  return positions;
}

// Tarjan's algorithm: node → index of the strongly connected component it's in.
function stronglyConnected(
  nodes: readonly string[],
  edges: readonly [string, string][],
): Map<string, number> {
  const next = new Map<string, string[]>(nodes.map((node) => [node, []]));
  for (const [source, target] of edges) next.get(source)?.push(target);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const component = new Map<string, number>();
  let counter = 0;
  let components = 0;

  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const target of next.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(target) ?? 0));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(target) ?? 0));
      }
    }
    if (low.get(node) === index.get(node)) {
      const id = components++;
      for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
        onStack.delete(member);
        component.set(member, id);
        if (member === node) break;
      }
    }
  };
  for (const node of nodes) if (!index.has(node)) visit(node);
  return component;
}
