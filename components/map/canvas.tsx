"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
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
type OpenState = { groups: ReadonlySet<number>; opened: number | null };

export function MapCanvas({ model }: { model: MapModel }) {
  return (
    <ReactFlowProvider>
      <Canvas model={model} />
    </ReactFlowProvider>
  );
}

function Canvas({ model }: { model: MapModel }) {
  const [open, setOpen] = useState<OpenState>({ groups: new Set(), opened: null });
  const [selected, setSelected] = useState<number | null>(null);
  const view = useMemo(() => buildView(model, open.groups), [model, open.groups]);
  const highlight = useMemo(() => highlightOf(model, view, selected), [model, view, selected]);
  const nodes = useMemo(() => toNodes(model, view, selected, highlight), [model, view, selected, highlight]);
  const edges = useMemo(() => toEdges(view, highlight), [view, highlight]);

  const { fitView, getViewport } = useReactFlow();
  const store = useStoreApi();

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
      return;
    }
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest("[data-file]");
    if (row) {
      const file = Number(row.getAttribute("data-file"));
      setSelected((current) => (current === file ? null : file));
      return;
    }
    if (event.target.closest("[data-panel-header]")) {
      setOpen((current) => {
        const groups = new Set(current.groups);
        groups.delete(group);
        return { groups, opened: null };
      });
      // A selected row in a closed panel no longer exists on screen.
      if (selected !== null && model.files[selected].group === group) setSelected(null);
    }
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
        // selected through React Flow; selection is ours, per file.
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.06, maxZoom: 1.25 }}
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

function highlightOf(model: MapModel, view: View, selected: number | null): Highlight {
  if (selected === null) return null;
  const own = slotKey({ node: model.groups[model.files[selected].group].directory, slot: selected });
  const lit = new Set<string>();
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const edge of view.edges) {
    if (slotKey(edge.source) === own) {
      outgoing.add(edge.id);
      lit.add(slotKey(edge.target));
    } else if (slotKey(edge.target) === own) {
      incoming.add(edge.id);
      lit.add(slotKey(edge.source));
    }
  }
  return { lit, incoming, outgoing };
}

function toNodes(model: MapModel, view: View, selected: number | null, highlight: Highlight): MapNode[] {
  return view.boxes.map((box): MapNode => {
    const group = model.groups[box.group];
    const counts = {
      label: group.label,
      directory: group.directory,
      files: group.files.length,
      fanIn: group.fanIn,
      fanOut: group.fanOut,
      group: box.group,
    };
    const placed = { id: box.id, position: { x: box.x, y: box.y }, width: box.width, height: box.height };
    const isLit = (slot: Slot["slot"]) => highlight?.lit.has(slotKey({ node: box.id, slot })) ?? false;

    if (box.kind === "folder") {
      return { ...placed, type: "folder", data: { ...counts, dimmed: highlight !== null && !isLit("node") } };
    }
    const rows: RowData[] = box.rows.map((file) => ({
      file,
      name: model.files[file].name,
      path: model.files[file].path,
      fanIn: model.files[file].fanIn,
      state:
        file === selected ? "selected" : highlight === null ? "plain" : isLit(file) ? "lit" : "dimmed",
    }));
    const moreLit = isLit("more");
    const touched = rows.some((row) => row.state === "selected" || row.state === "lit") || moreLit;
    return {
      ...placed,
      type: "panel",
      data: {
        ...counts,
        dimmed: highlight !== null && !touched,
        rows,
        hidden: box.hidden,
        moreDimmed: highlight !== null && !moreLit,
      },
    };
  });
}

function handleOf(direction: "in" | "out", slot: Slot["slot"]): string {
  return slot === "node" ? direction : `${direction}:${slot}`;
}

function toEdges(view: View, highlight: Highlight): Edge[] {
  return view.edges.map((edge) => {
    const into = highlight?.incoming.has(edge.id) ?? false;
    const out = highlight?.outgoing.has(edge.id) ?? false;
    const colour = into ? "var(--incoming)" : out ? "var(--outgoing)" : "var(--muted)";
    const opacity = highlight === null ? 0.45 : into || out ? 1 : 0.08;
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
