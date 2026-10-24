"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { HEADER_HEIGHT, ROW_HEIGHT } from "@/lib/map/view";

// Handles exist only so edges know where to end. Nothing is connected by
// hand, so they're invisible.
const HIDDEN_HANDLE = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

// When something is selected, everything it doesn't touch drops back.
const DIMMED = 0.25;

type Counts = { label: string; directory: string; files: number; fanIn: number; fanOut: number };

export type FolderData = Counts & { group: number; dimmed: boolean };
export type FolderNode = Node<FolderData, "folder">;

export type RowData = {
  file: number;
  name: string;
  path: string;
  fanIn: number;
  state: "selected" | "lit" | "dimmed" | "plain";
};

export type PanelData = Counts & {
  group: number;
  dimmed: boolean;
  rows: RowData[];
  hidden: number;
  moreDimmed: boolean;
};
export type PanelNode = Node<PanelData, "panel">;

function Stats({ files, fanIn, fanOut }: Pick<Counts, "files" | "fanIn" | "fanOut">) {
  return (
    <div className="truncate text-[11px] leading-4 text-muted tabular-nums">
      {files} files · in {fanIn} · out {fanOut}
    </div>
  );
}

export function FolderBox({ data }: NodeProps<FolderNode>) {
  return (
    <div
      title={data.directory}
      className="h-full w-full cursor-pointer rounded-[3px] border border-border bg-surface px-2 py-1.5 hover:border-muted"
      style={{ opacity: data.dimmed ? DIMMED : 1 }}
    >
      <Handle type="target" position={Position.Left} id="in" style={HIDDEN_HANDLE} isConnectable={false} />
      <div className="truncate font-mono text-[12px] leading-4">{data.label}</div>
      <Stats {...data} />
      <Handle type="source" position={Position.Right} id="out" style={HIDDEN_HANDLE} isConnectable={false} />
    </div>
  );
}

export function PanelBox({ data }: NodeProps<PanelNode>) {
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-[3px] border border-muted bg-surface"
      style={{ opacity: data.dimmed ? DIMMED : 1 }}
    >
      {/* Clicking the header closes the panel; the canvas reads this marker. */}
      <div
        data-panel-header
        title={`${data.directory} — click to close`}
        className="shrink-0 cursor-pointer border-b border-border bg-raised px-2 py-1.5 hover:bg-border"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="truncate font-mono text-[12px] leading-4">{data.label}</div>
        <Stats {...data} />
      </div>
      {data.rows.map((row) => (
        <div
          key={row.file}
          data-file={row.file}
          title={row.path}
          className={
            "relative flex cursor-pointer items-center gap-2 px-2 " +
            (row.state === "selected" ? "bg-accent text-accent-text" : "hover:bg-raised")
          }
          style={{ height: ROW_HEIGHT, opacity: row.state === "dimmed" ? DIMMED : 1 }}
        >
          <Handle type="target" position={Position.Left} id={`in:${row.file}`} style={HIDDEN_HANDLE} isConnectable={false} />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{row.name}</span>
          <span
            className={
              "shrink-0 text-[11px] tabular-nums " + (row.state === "selected" ? "" : "text-muted")
            }
          >
            {row.fanIn}
          </span>
          <Handle type="source" position={Position.Right} id={`out:${row.file}`} style={HIDDEN_HANDLE} isConnectable={false} />
        </div>
      ))}
      {data.hidden > 0 && (
        // Edges to files without a row end here, so nothing points at a file
        // that isn't on screen.
        <div
          className="relative flex items-center px-2 text-[11px] text-muted"
          style={{ height: ROW_HEIGHT, opacity: data.moreDimmed ? DIMMED : 1 }}
        >
          <Handle type="target" position={Position.Left} id="in:more" style={HIDDEN_HANDLE} isConnectable={false} />
          {data.hidden} more
          <Handle type="source" position={Position.Right} id="out:more" style={HIDDEN_HANDLE} isConnectable={false} />
        </div>
      )}
    </div>
  );
}

export const nodeTypes = { folder: FolderBox, panel: PanelBox };
