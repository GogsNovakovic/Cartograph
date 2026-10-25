"use client";

import { useState, type ReactNode } from "react";
import { KindSwatch } from "@/components/map/nodes";
import { PathText } from "@/components/path-text";
import type { Selection } from "@/components/map/canvas";
import { DEFAULT_DEPTH, walk, type Adjacency, type Direction } from "@/lib/map/graph";
import type { MapModel } from "@/lib/map/model";

type Props = {
  model: MapModel;
  graph: Adjacency;
  // "importer>imported" index pairs where every import is type-only.
  typeOnly: ReadonlySet<string>;
  selected: Selection;
  onSelect: (file: number) => void;
};

export function DetailPane({ model, graph, typeOnly, selected, onSelect }: Props) {
  if (selected === null) {
    return <p className="px-3 py-2 text-[11px] text-muted">Select a file to see what depends on it.</p>;
  }
  if (selected.kind === "folder") {
    const group = model.groups[selected.group];
    return (
      <>
        <Title label="Folder" path={group.directory === "." ? "./" : group.directory + "/"} />
        <Facts>
          <Fact term="Files">{group.files.length} files</Fact>
          <Fact term="Depends on">
            <span className="text-outgoing">{group.fanOut} files outside</span>
          </Fact>
          <Fact term="Depended on by">
            <span className="text-incoming">{group.fanIn} files outside</span>
          </Fact>
        </Facts>
      </>
    );
  }
  // Keyed by file so a new selection starts with no walk shown.
  return (
    <FileDetail
      key={selected.file}
      model={model}
      graph={graph}
      typeOnly={typeOnly}
      file={selected.file}
      onSelect={onSelect}
    />
  );
}

// The path in full, wrapping rather than truncating: it's the one place the
// whole thing is always readable.
function Title({ label, path }: { label: string; path: string }) {
  const slash = path.lastIndexOf("/", path.length - 2) + 1;
  return (
    <header className="px-3 pt-2 pb-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <h2 className="font-mono text-[13px] leading-5 break-all">
        {path.slice(0, slash)}
        <span className="font-semibold">{path.slice(slash)}</span>
      </h2>
    </header>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[108px_1fr] border-t border-border px-3 py-2 text-[12px] leading-6">
      {children}
    </dl>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{term}</dt>
      <dd className="flex min-w-0 items-center gap-2 tabular-nums">{children}</dd>
    </>
  );
}

const WALKS: { direction: Direction; label: string; empty: string }[] = [
  { direction: "dependents", label: "Blast radius", empty: "Nothing imports this file." },
  { direction: "dependencies", label: "Dependency chain", empty: "This file imports nothing in the repository." },
];

function FileDetail({
  model,
  graph,
  typeOnly,
  file,
  onSelect,
}: Omit<Props, "selected"> & { file: number }) {
  const [direction, setDirection] = useState<Direction | null>(null);
  const info = model.files[file];
  const slash = info.path.lastIndexOf("/");
  const imports = [...graph.imports[file]].sort((a, b) => a - b);
  const importers = [...graph.importers[file]].sort((a, b) => a - b);
  // Arithmetic over edges the browser already holds: computed on render,
  // no spinner, no request.
  const reached = direction === null ? [] : walk(graph, file, direction);
  const active = WALKS.find((w) => w.direction === direction);

  const row = (other: number, aside?: ReactNode) => (
    <li key={other}>
      <button
        type="button"
        onClick={() => onSelect(other)}
        className="-mx-1.5 flex h-6 w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-[3px] px-1.5 hover:bg-raised"
      >
        <PathText path={model.files[other].path} className="flex-1" />
        {aside}
      </button>
    </li>
  );
  const typeTag = (pair: string) =>
    typeOnly.has(pair) ? <span className="shrink-0 text-[11px] text-muted">type</span> : null;

  return (
    <>
      <Title label="File" path={info.path} />
      <Facts>
        <Fact term="Kind">
          <KindSwatch hue={info.hue} />
          <span className="font-mono">{info.kind}</span>
        </Fact>
        <Fact term="Folder">
          <span className="truncate font-mono" title={info.path}>
            {slash === -1 ? "./" : info.path.slice(0, slash)}
          </span>
        </Fact>
        {info.role !== null && <Fact term="Reached as">{info.role}</Fact>}
        <Fact term="Length">{info.lines === null ? "not read" : `${info.lines} lines`}</Fact>
        <Fact term="Depends on">
          <span className="text-outgoing">{info.fanOut} files</span>
        </Fact>
        <Fact term="Depended on by">
          <span className="text-incoming">{info.fanIn} files</span>
        </Fact>
      </Facts>

      <section className="border-t border-border px-3 py-2">
        <ListHeading title="Imports" count={<span className="text-outgoing">{imports.length}→</span>} />
        <ul className="mb-2">{imports.map((other) => row(other, typeTag(`${file}>${other}`)))}</ul>
        <ListHeading title="Imported by" count={<span className="text-incoming">←{importers.length}</span>} />
        <ul>{importers.map((other) => row(other, typeTag(`${other}>${file}`)))}</ul>
      </section>

      <section className="border-t border-border px-3 py-2">
        <div className="flex gap-1.5">
          {WALKS.map((w) => (
            <button
              key={w.direction}
              type="button"
              aria-pressed={w.direction === direction}
              onClick={() => setDirection((current) => (current === w.direction ? null : w.direction))}
              className={
                "h-6 cursor-pointer rounded-[3px] border px-2 text-[12px] " +
                (w.direction === direction ? "border-accent bg-accent text-accent-text" : "border-border hover:bg-raised")
              }
            >
              {w.label}
            </button>
          ))}
        </div>
        {active && (
          <div className="mt-2">
            {reached.length === 0 && <p className="text-[11px] text-muted">{active.empty}</p>}
            {Array.from({ length: DEFAULT_DEPTH }, (_, i) => i + 1).map((depth) => {
              const files = reached.filter((r) => r.depth === depth);
              if (files.length === 0) return null;
              return (
                <div key={depth} className="mb-2">
                  <ListHeading
                    title={depth === 1 ? "Directly" : `${depth} steps away`}
                    count={<span className="text-muted">{files.length}</span>}
                  />
                  <ul>{files.map((r) => row(r.file))}</ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function ListHeading({ title, count }: { title: string; count: ReactNode }) {
  return (
    <h3 className="flex h-6 items-center text-[12px]">
      <span className="flex-1">{title}</span>
      <span className="font-mono text-[11px] tabular-nums">{count}</span>
    </h3>
  );
}
