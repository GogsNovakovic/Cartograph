"use client";

import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import {
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useStoreApi,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { MapModel } from "@/lib/map/model";
import { buildView, slotKey, type Slot, type View } from "@/lib/map/view";
import { nodeTypes, type FolderNode, type PanelNode, type RowData } from "./nodes";

type MapNode = FolderNode | PanelNode;

// `opened` is the panel the last click opened, kept in the same update as
// the open set, so the refit always reads the state after the change.
export type OpenState = { groups: ReadonlySet<number>; opened: number | null };

// What's selected: one file, or a whole folder. Clicking a folded node opens
// it and selects the folder in the same click; a row inside narrows it to
// that file.
export type Selection = { kind: "file"; file: number } | { kind: "folder"; group: number } | null;

// The canvas holds no state of its own: the rail and the detail pane select
// files too, so open folders, selection and the active category live above.
type CanvasProps = {
  model: MapModel;
  open: OpenState;
  setOpen: Dispatch<SetStateAction<OpenState>>;
  selected: Selection;
  setSelected: Dispatch<SetStateAction<Selection>>;
  // A rail category: files of any other kind dim. Null shows everything.
  category: string | null;
};

export function MapCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ model, open, setOpen, selected, setSelected, category }: CanvasProps) {
  const pinned = selected?.kind === "file" ? selected.file : null;
  const view = useMemo(() => buildView(model, open.groups, pinned), [model, open.groups, pinned]);
  const highlight = useMemo(() => highlightOf(model, view, selected), [model, view, selected]);
  const filter = useMemo(() => filterOf(model, view, category), [model, view, category]);
  const nodes = useMemo(
    () => toNodes(model, view, selected, highlight, filter),
    [model, view, selected, highlight, filter],
  );
  const edges = useMemo(() => toEdges(view, highlight, filter), [view, highlight, filter]);

  const { fitView, getViewport } = useReactFlow();
  const store = useStoreApi();

  // The first fit waits for the canvas to have a size. Fitting on mount can
  // run while the container still measures 0 x 0, which places the whole map
  // off screen, and nothing would fit it again afterwards.
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || width === 0 || height === 0) return;
    fitted.current = true;
    void fitView({ padding: 0.06, maxZoom: 1.25 });
  }, [width, height, fitView]);

  // Refit only zooms out. Fitting to the panel alone would zoom into it and
  // lose the rest of the map, so the current zoom is the ceiling, and if the
  // panel is already fully on screen nothing moves at all.
  useEffect(() => {
    if (open.opened === null) return;
    const panel = view.boxes.find((box) => box.group === open.opened);
    if (!panel) return;
    const { x, y, zoom } = getViewport();
    const { width, height } = store.getState();
    const left = panel.x * zoom + x;
    const top = panel.y * zoom + y;
    const visible =
      left >= 0 && top >= 0 && left + panel.width * zoom <= width && top + panel.height * zoom <= height;
    if (visible) return;
    void fitView({ nodes: [{ id: panel.id }], maxZoom: zoom, padding: 0.08 });
  }, [open, view, fitView, getViewport, store]);

  const onNodeClick: NodeMouseHandler<MapNode> = (event, node) => {
    const group = node.data.group;
    if (node.type === "folder") {
      setOpen((current) => ({ groups: new Set(current.groups).add(group), opened: group }));
      setSelected({ kind: "folder", group });
      return;
    }
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-panel-header]")) {
      setOpen((current) => {
        const groups = new Set(current.groups);
        groups.delete(group);
        return { groups, opened: null };
      });
      // A selection inside a closed panel no longer exists on screen.
      if (selected && groupOf(model, selected) === group) setSelected(null);
      return;
    }
    const row = event.target.closest("[data-file]");
    if (row) {
      const file = Number(row.getAttribute("data-file"));
      setSelected((current) => (current?.kind === "file" && current.file === file ? null : { kind: "file", file }));
      return;
    }
    // Anywhere else on a panel — its "more" row, its edges — is the folder.
    setSelected({ kind: "folder", group });
  };

  // Absolutely placed so the canvas has a definite size whatever the flex
  // chain above it resolves to.
  return (
    <div className="absolute inset-0">
      <ReactFlow<MapNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelected(null)}
        // The picture is the layout's, so nothing is dragged, connected or
        // selected through React Flow; selection is ours.
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.15}
        maxZoom={2.5}
      />
    </div>
  );
}

type Highlight = {
  // Slot keys at the far end of an edge from the selection.
  lit: ReadonlySet<string>;
  incoming: ReadonlySet<string>;
  outgoing: ReadonlySet<string>;
} | null;

function groupOf(model: MapModel, selection: NonNullable<Selection>): number {
  return selection.kind === "folder" ? selection.group : model.files[selection.file].group;
}

function highlightOf(model: MapModel, view: View, selected: Selection): Highlight {
  if (selected === null) return null;
  const directory = model.groups[groupOf(model, selected)].directory;
  // A file owns the one slot its row is; a folder owns every slot on its box.
  const owns =
    selected.kind === "folder"
      ? (slot: Slot) => slot.node === directory
      : (slot: Slot) => slot.node === directory && slot.slot === selected.file;
  const lit = new Set<string>();
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const edge of view.edges) {
    if (owns(edge.source)) {
      outgoing.add(edge.id);
      lit.add(slotKey(edge.target));
    } else if (owns(edge.target)) {
      incoming.add(edge.id);
      lit.add(slotKey(edge.source));
    }
  }
  return { lit, incoming, outgoing };
}

// The active category: which files match, how many per folder, and which
// edge ends on screen hold at least one match. Null when none is active.
type Filter = {
  matches: (file: number) => boolean;
  counts: readonly number[];
  slots: ReadonlySet<string>;
} | null;

function filterOf(model: MapModel, view: View, category: string | null): Filter {
  if (category === null) return null;
  const matches = (file: number) => model.files[file].kind === category;
  const counts = model.groups.map((group) => group.files.filter(matches).length);
  const slots = new Set<string>();
  for (const box of view.boxes) {
    if (box.kind === "folder") {
      if (counts[box.group] > 0) slots.add(slotKey({ node: box.id, slot: "node" }));
      continue;
    }
    for (const file of box.rows) if (matches(file)) slots.add(slotKey({ node: box.id, slot: file }));
    const shown = new Set(box.rows);
    if (model.groups[box.group].files.some((file) => !shown.has(file) && matches(file))) {
      slots.add(slotKey({ node: box.id, slot: "more" }));
    }
  }
  return { matches, counts, slots };
}

function toNodes(
  model: MapModel,
  view: View,
  selected: Selection,
  highlight: Highlight,
  filter: Filter,
): MapNode[] {
  const selectedFile = selected?.kind === "file" ? selected.file : null;
  const selectedFolder = selected?.kind === "folder" ? selected.group : null;
  return view.boxes.map((box): MapNode => {
    const group = model.groups[box.group];
    const counts = {
      label: group.label,
      directory: group.directory,
      files: group.files.length,
      fanIn: group.fanIn,
      fanOut: group.fanOut,
      matched: filter === null ? null : filter.counts[box.group],
      group: box.group,
    };
    // A category dims a folder only when none of its files are that kind.
    const unmatched = filter !== null && filter.counts[box.group] === 0;
    const placed = { id: box.id, position: { x: box.x, y: box.y }, width: box.width, height: box.height };
    const isLit = (slot: Slot["slot"]) => highlight?.lit.has(slotKey({ node: box.id, slot })) ?? false;

    if (box.kind === "folder") {
      return { ...placed, type: "folder", data: { ...counts, dimmed: unmatched || (highlight !== null && !isLit("node")) } };
    }
    // A selected folder keeps all of its own rows bright.
    const isSelected = box.group === selectedFolder;
    const rows: RowData[] = box.rows.map((file) => ({
      file,
      name: model.files[file].name,
      path: model.files[file].path,
      fanIn: model.files[file].fanIn,
      hue: model.files[file].hue,
      matched: filter === null || filter.matches(file),
      state:
        file === selectedFile
          ? "selected"
          : highlight === null || isSelected
            ? "plain"
            : isLit(file)
              ? "lit"
              : "dimmed",
    }));
    const moreLit = isSelected || isLit("more");
    const touched = isSelected || moreLit || rows.some((row) => row.state === "selected" || row.state === "lit");
    return {
      ...placed,
      type: "panel",
      data: {
        ...counts,
        selected: isSelected,
        dimmed: unmatched || (highlight !== null && !touched),
        rows,
        hidden: box.hidden,
        moreDimmed:
          (highlight !== null && !moreLit) ||
          (filter !== null && !filter.slots.has(slotKey({ node: box.id, slot: "more" }))),
      },
    };
  });
}

function handleOf(direction: "in" | "out", slot: Slot["slot"]): string {
  return slot === "node" ? direction : `${direction}:${slot}`;
}

function toEdges(view: View, highlight: Highlight, filter: Filter): Edge[] {
  return view.edges.map((edge) => {
    const into = highlight?.incoming.has(edge.id) ?? false;
    const out = highlight?.outgoing.has(edge.id) ?? false;
    const colour = into ? "var(--incoming)" : out ? "var(--outgoing)" : "var(--muted)";
    // Under a category, an edge stays only if both of its ends hold a match.
    const kept = filter === null || (filter.slots.has(slotKey(edge.source)) && filter.slots.has(slotKey(edge.target)));
    const opacity = into || out ? 1 : highlight === null && kept ? 0.45 : 0.08;
    return {
      id: edge.id,
      source: edge.source.node,
      sourceHandle: handleOf("out", edge.source.slot),
      target: edge.target.node,
      targetHandle: handleOf("in", edge.target.slot),
      // Thicker when the edge stands for more file-to-file imports.
      style: { stroke: colour, strokeWidth: Math.min(3, 1 + Math.log10(edge.count)), opacity },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: colour },
      zIndex: into || out ? 1 : 0,
    };
  });
}
