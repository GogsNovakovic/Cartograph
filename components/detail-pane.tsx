"use client";

import { useState } from "react";
import { PathText } from "@/components/path-text";
import type { Selection } from "@/components/map/canvas";
import { DEFAULT_DEPTH, walk, type Adjacency, type Direction } from "@/lib/map/graph";
import type { MapModel } from "@/lib/map/model";

export function DetailPane({
  model,
  graph,
  selected,
  onSelect,
}: {
  model: MapModel;
  graph: Adjacency;
  selected: Selection;
  onSelect: (file: number) => void;
}) {
  if (selected === null) {
    return <p className="px-3 py-2 text-[11px] text-muted">Select a file to see what depends on it.</p>;
  }
  if (selected.kind === "folder") {
    const group = model.groups[selected.group];
    return (
      <div className="px-3 py-2">
        <PathText path={group.directory === "." ? "./" : group.directory + "/"} />
        <Facts
          facts={[
            ["files", group.files.length],
            ["imported by", `${group.fanIn} files outside`],
            ["imports", `${group.fanOut} files outside`],
          ]}
        />
      </div>
    );
  }
  // Keyed by file so a new selection starts with no walk shown.
  return <FileDetail key={selected.file} model={model} graph={graph} file={selected.file} onSelect={onSelect} />;
}

const BUTTONS: { direction: Direction; label: string; empty: string }[] = [
  { direction: "dependents", label: "Blast radius", empty: "Nothing imports this file." },
  { direction: "dependencies", label: "Dependency chain", empty: "This file imports nothing in the repository." },
];

function FileDetail({
  model,
  graph,
  file,
  onSelect,
}: {
  model: MapModel;
  graph: Adjacency;
  file: number;
  onSelect: (file: number) => void;
}) {
  const [direction, setDirection] = useState<Direction | null>(null);
  const info = model.files[file];
  // Arithmetic over edges the browser already holds: computed on render,
  // no spinner, no request.
  const reached = direction === null ? [] : walk(graph, file, direction);
  const button = BUTTONS.find((b) => b.direction === direction);

  return (
    <div className="px-3 py-2">
      <PathText path={info.path} />
      <Facts
        facts={[
          ...(info.role === null ? [] : [["reached as", info.role] as const]),
          ["lines", info.lines ?? "not read"],
          ["imported by", `${info.fanIn} files`],
          ["imports", `${info.fanOut} files`],
        ]}
      />
      <div className="mt-2 flex gap-1.5">
        {BUTTONS.map((b) => (
          <button
            key={b.direction}
            type="button"
            aria-pressed={b.direction === direction}
            onClick={() => setDirection((current) => (current === b.direction ? null : b.direction))}
            className={
              "h-6 cursor-pointer rounded-[3px] border px-2 text-[12px] " +
              (b.direction === direction ? "border-accent bg-accent text-accent-text" : "border-border hover:bg-raised")
            }
          >
            {b.label}
          </button>
        ))}
      </div>
      {button && (
        <div className="mt-3">
          {reached.length === 0 && <p className="text-[11px] text-muted">{button.empty}</p>}
          {Array.from({ length: DEFAULT_DEPTH }, (_, i) => i + 1).map((depth) => {
            const files = reached.filter((r) => r.depth === depth);
            if (files.length === 0) return null;
            return (
              <section key={depth} className="mb-2">
                <h3 className="flex text-[11px] text-muted">
                  <span className="flex-1">{depth === 1 ? "Directly" : `${depth} steps away`}</span>
                  <span className="font-mono tabular-nums">{files.length}</span>
                </h3>
                <ul>
                  {files.map(({ file: other }) => (
                    <li key={other}>
                      <button
                        type="button"
                        onClick={() => onSelect(other)}
                        className="-mx-1.5 flex h-5 w-[calc(100%+12px)] cursor-pointer items-center rounded-[3px] px-1.5 hover:bg-raised"
                      >
                        <PathText path={model.files[other].path} className="flex-1" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Facts({ facts }: { facts: readonly (readonly [string, string | number])[] }) {
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 text-[11px] leading-5">
      {facts.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted">{term}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
