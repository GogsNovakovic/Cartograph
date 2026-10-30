"use client";

import { useMemo, useState, type ReactNode } from "react";
import { explainKey, ExplanationTab, type ExplainState } from "@/components/explanation";
import { KindSwatch } from "@/components/map/nodes";
import { PathText } from "@/components/path-text";
import type { Selection } from "@/components/map/canvas";
import type { TracingStatus } from "@/lib/env";
import type { ExplainTarget } from "@/lib/explain";
import { DEFAULT_DEPTH, walk, type Adjacency, type Direction } from "@/lib/map/graph";
import type { MapModel } from "@/lib/map/model";
import { summarize, SUMMARY_ROWS } from "@/lib/map/summary";
import { frameworkLabel } from "@/lib/map/taxonomy";
import type { CommonJsExports } from "@/parser/types";

type Tab = "structure" | "explanation";

type Props = {
  model: MapModel;
  graph: Adjacency;
  // "importer>imported" index pairs where every import is type-only.
  typeOnly: ReadonlySet<string>;
  selected: Selection;
  onSelect: (file: number) => void;
  onSelectFolder: (group: number) => void;
  // What the pointer is over, on the map or in this pane. Same shape as a
  // selection: a file, or a folded folder.
  hovered: Selection;
  onHover: (hovered: Selection) => void;
  analysisId: string;
  tracing: TracingStatus;
  // Explanations fetched this visit, by explainKey.
  explained: ReadonlyMap<string, ExplainState>;
  onExplain: (target: ExplainTarget) => void;
};

// Everything here is computed from the model already in the browser:
// selecting or hovering never waits on a request. The one request is an
// explanation, and only when asked for.
export function DetailPane(props: Props) {
  const { model, selected } = props;
  // Held above the selection, so comparing three files' explanations
  // doesn't mean reopening the tab three times.
  const [tab, setTab] = useState<Tab>("structure");

  if (selected === null) return <RepositoryOverview {...props} />;

  const path =
    selected.kind === "file"
      ? model.files[selected.file].path
      : (() => {
          const directory = model.groups[selected.group].directory;
          return directory === "." ? "./" : directory + "/";
        })();
  const target: ExplainTarget =
    selected.kind === "file"
      ? { kind: "file", path: model.files[selected.file].path }
      : { kind: "folder", directory: model.groups[selected.group].directory };

  return (
    <>
      <div className="sticky top-0 z-10 bg-surface">
        <Title label={selected.kind === "file" ? "File" : "Folder"} path={path} />
        <Tabs tab={tab} onChange={setTab} />
      </div>
      {tab === "explanation" ? (
        <ExplanationTab
          analysisId={props.analysisId}
          model={model}
          subject={selected}
          state={props.explained.get(explainKey(target))}
          onExplain={() => props.onExplain(target)}
          tracing={props.tracing}
          onSelect={props.onSelect}
          onSelectFolder={props.onSelectFolder}
          onHover={props.onHover}
        />
      ) : selected.kind === "folder" ? (
        <FolderStructure {...props} group={selected.group} />
      ) : (
        // Keyed by file so a new selection starts with no walk shown.
        <FileStructure key={selected.file} {...props} file={selected.file} />
      )}
    </>
  );
}

// The resting state, and the first thing anyone sees: what this repository
// is, what it leans on, and where reading starts.
function RepositoryOverview({ model, graph, onSelect, hovered, onHover }: Props) {
  const summary = useMemo(() => summarize(model.files, graph), [model, graph]);
  const top = summary.leanedOn.slice(0, SUMMARY_ROWS);
  const most = top.length > 0 ? graph.importers[top[0]].length : 0;
  const row = rowOf(model, onSelect, hovered, onHover);
  const suggested = model.files.filter((file) => file.suggestedRole !== null).length;

  return (
    <>
      <header className="px-3 pt-2 pb-2.5">
        <div className="text-[11px] text-muted">Repository</div>
        <h2 className="font-mono text-[14px] leading-5 font-semibold break-all">{model.repository.name}</h2>
        <p className="mt-0.5 text-[11px] leading-4 text-muted">
          {model.repository.framework === null ? (
            "No framework recognised."
          ) : (
            <>
              Framework: <span className="text-text">{frameworkLabel(model.repository.framework)}</span>
            </>
          )}
          {model.repository.adapters.length > 0 && (
            <>
              {" · "}Conventions read:{" "}
              <span className="font-mono text-text">{model.repository.adapters.join(", ")}</span>
            </>
          )}
        </p>
      </header>

      <dl className="grid grid-cols-3 border-y border-border">
        <Stat term="Files" value={summary.files} />
        <Stat term="Imports" value={summary.links} title="Distinct file-to-file imports the parser resolved" />
        <Stat term="Routes" value={model.routes.length} title="Routes whose method and full path were both read from the code" />
      </dl>
      <p className="border-b border-border px-3 py-1.5 text-[11px] leading-4 text-muted">
        <span className="font-mono text-text tabular-nums">{summary.unidentified}</span> of {summary.files} files
        aren&apos;t named by any convention.
        {summary.unidentified > 0 && (
          <>
            {" "}
            {model.repository.classificationFailure !== null ? (
              <>No roles were suggested for them: {model.repository.classificationFailure}</>
            ) : (
              <>
                <span className="font-mono text-text tabular-nums">{suggested}</span> of them have a role suggested by a
                model.
              </>
            )}
          </>
        )}
      </p>

      <section className="border-b border-border px-3 py-2">
        <ListHeading title="Most depended on" count={<span className="text-incoming">←{summary.leanedOn.length}</span>} />
        <Caption>Ordered by how many files import each one.</Caption>
        {top.length === 0 ? (
          <Caption>Nothing in the repository imports anything else in it.</Caption>
        ) : (
          <ul>
            {top.map((file) => {
              const count = graph.importers[file].length;
              return row(
                file,
                <span className="flex w-[64px] shrink-0 items-center justify-end gap-1.5">
                  {/* Share of the most-imported file, so the drop-off reads at a glance. */}
                  <span className="h-1 rounded-full bg-incoming/70" style={{ width: Math.max(2, (count / most) * 36) }} />
                  <span className="w-[22px] text-right font-mono text-[11px] text-incoming tabular-nums">{count}</span>
                </span>,
              );
            })}
          </ul>
        )}
      </section>

      <UnimportedList model={model} graph={graph} files={summary.unimported} row={row} />
      <RouteTable model={model} onSelect={onSelect} hovered={hovered} onHover={onHover} />
    </>
  );
}

// Why a table is empty, by what the parser could and couldn't read. An empty
// table is a statement, so it says which one.
function noRoutes(framework: string | null): string {
  if (framework === null) return "No framework recognised, so no routes were read.";
  if (framework === "react") return "React declares no routes of its own.";
  if (framework === "express") {
    return "Express assembles routes at runtime from routers and middleware mounted on each other, so none are read from the code.";
  }
  return "No route whose method and full path could both be read exactly from the code.";
}

function RouteTable({
  model,
  onSelect,
  hovered,
  onHover,
}: Pick<Props, "model" | "onSelect" | "hovered" | "onHover">) {
  const [all, setAll] = useState(false);
  const routes = model.routes;
  const shown = all ? routes : routes.slice(0, SUMMARY_ROWS);
  return (
    <section className="border-t border-border px-3 py-2">
      <ListHeading title="Routes" count={<span className="text-muted">{routes.length}</span>} />
      <Caption>
        {routes.length === 0
          ? noRoutes(model.repository.framework)
          : "Method and full path as declared. Routes that would need guessing aren't listed."}
      </Caption>
      {routes.length > 0 && (
        <ul>
          {shown.map((route) => {
            const file = model.files[route.file];
            const lit = hovered?.kind === "file" ? hovered.file === route.file : hovered?.group === file.group;
            return (
              <li key={`${route.method} ${route.path} ${route.file}:${route.line}`}>
                <button
                  type="button"
                  onClick={() => onSelect(route.file)}
                  onMouseEnter={() => onHover({ kind: "file", file: route.file })}
                  onMouseLeave={() => onHover(null)}
                  className={
                    "-mx-1.5 block w-[calc(100%+12px)] cursor-pointer rounded-[3px] px-1.5 py-0.5 text-left " +
                    (lit ? "bg-raised shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-raised")
                  }
                >
                  <span className="flex items-baseline gap-2 font-mono text-[12px]">
                    <span className="w-[52px] shrink-0 text-[11px] text-muted">{route.method}</span>
                    <span className="min-w-0 break-all">{route.path}</span>
                  </span>
                  <span className="block truncate pl-[60px] font-mono text-[11px] text-muted">
                    {file.path}:{route.line}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {routes.length > SUMMARY_ROWS && (
        <button
          type="button"
          onClick={() => setAll((current) => !current)}
          className="mt-1 h-6 cursor-pointer text-[11px] text-muted hover:text-text"
        >
          {all ? `Show the first ${SUMMARY_ROWS}` : `Show all ${routes.length}`}
        </button>
      )}
    </section>
  );
}

function UnimportedList({
  model,
  graph,
  files,
  row,
}: {
  model: MapModel;
  graph: Adjacency;
  files: number[];
  row: Row;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, SUMMARY_ROWS);
  return (
    <section className="px-3 py-2">
      <ListHeading title="Nothing imports" count={<span className="text-muted">{files.length}</span>} />
      <Caption>Where reading starts. The ones importing the most come first.</Caption>
      {files.length === 0 ? (
        <Caption>Every file is imported by another.</Caption>
      ) : (
        <ul>
          {shown.map((file) =>
            row(
              file,
              <>
                {model.files[file].role !== null && (
                  <span className="shrink-0 text-[11px] text-muted">{model.files[file].role}</span>
                )}
                <span className="w-[30px] shrink-0 text-right font-mono text-[11px] text-outgoing tabular-nums">
                  {graph.imports[file].length}→
                </span>
              </>,
            ),
          )}
        </ul>
      )}
      {files.length > SUMMARY_ROWS && (
        <button
          type="button"
          onClick={() => setAll((current) => !current)}
          className="mt-1 h-6 cursor-pointer text-[11px] text-muted hover:text-text"
        >
          {all ? `Show the first ${SUMMARY_ROWS}` : `Show all ${files.length}`}
        </button>
      )}
    </section>
  );
}

function Stat({ term, value, title }: { term: string; value: number; title?: string }) {
  return (
    <div title={title} className="border-r border-border px-3 py-1.5 last:border-r-0">
      <dt className="text-[11px] text-muted">{term}</dt>
      <dd className="font-mono text-[15px] leading-5 tabular-nums">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

// The path in full, wrapping rather than truncating: it's the one place the
// whole thing is always readable.
function Title({ label, path }: { label: string; path: string }) {
  const slash = path.lastIndexOf("/", path.length - 2) + 1;
  return (
    <header className="px-3 pt-2 pb-2">
      <div className="text-[11px] text-muted">{label}</div>
      <h2 className="font-mono text-[13px] leading-5 break-all">
        {path.slice(0, slash)}
        <span className="font-semibold">{path.slice(slash)}</span>
      </h2>
    </header>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "structure", label: "Structure" },
  { id: "explanation", label: "Explanation" },
];

function Tabs({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div role="tablist" className="flex gap-3 border-b border-border px-3">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === tab}
          onClick={() => onChange(t.id)}
          className={
            "-mb-px h-7 cursor-pointer border-b-2 text-[12px] " +
            (t.id === tab ? "border-accent text-text" : "border-transparent text-muted hover:text-text")
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[108px_1fr] px-3 py-2 text-[12px] leading-6">{children}</dl>;
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{term}</dt>
      <dd className="flex min-w-0 items-center gap-2 tabular-nums">{children}</dd>
    </>
  );
}

function FolderStructure({ model, group: index }: Props & { group: number }) {
  const group = model.groups[index];
  // Kinds in the rail's order, so a kind sits where it does there.
  const kinds = model.categories
    .map((category) => ({
      ...category,
      inside: group.files.filter((file) => model.files[file].kind === category.name).length,
    }))
    .filter((category) => category.inside > 0);
  return (
    <>
      <Facts>
        <Fact term="Files">{group.files.length} files</Fact>
        <Fact term="Depends on">
          <span className="text-outgoing">{group.fanOut} files outside</span>
        </Fact>
        <Fact term="Depended on by">
          <span className="text-incoming">{group.fanIn} files outside</span>
        </Fact>
      </Facts>
      <section className="border-t border-border px-3 py-2">
        <ListHeading title="Categories inside" count={<span className="text-muted">{kinds.length}</span>} />
        <ul>
          {kinds.map((kind) => (
            <li key={kind.name} className="flex h-6 items-center gap-2">
              <KindSwatch hue={kind.hue} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{kind.name}</span>
              <span className="font-mono text-[11px] text-muted tabular-nums">{kind.inside}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const WALKS: { direction: Direction; label: string; empty: string }[] = [
  { direction: "dependents", label: "Blast radius", empty: "Nothing imports this file." },
  { direction: "dependencies", label: "Dependency chain", empty: "This file imports nothing in the repository." },
];

function FileStructure({ model, graph, typeOnly, file, onSelect, hovered, onHover }: Props & { file: number }) {
  const [direction, setDirection] = useState<Direction | null>(null);
  const info = model.files[file];
  const slash = info.path.lastIndexOf("/");
  // The counts above are these lists' lengths, so a count always matches
  // the rows under it.
  const imports = [...graph.imports[file]].sort((a, b) => a - b);
  const importers = [...graph.importers[file]].sort((a, b) => a - b);
  // Arithmetic over edges the browser already holds: computed on render,
  // no spinner, no request.
  const reached = direction === null ? [] : walk(graph, file, direction);
  const active = WALKS.find((w) => w.direction === direction);
  const row = rowOf(model, onSelect, hovered, onHover);
  const typeTag = (pair: string) =>
    typeOnly.has(pair) ? <span className="shrink-0 text-[11px] text-muted">type</span> : null;

  return (
    <>
      <Facts>
        <Fact term="Category">
          <KindSwatch hue={info.hue} />
          <span className="font-mono">{info.kind}</span>
        </Fact>
        <Fact term="Reached as">
          {info.role === null ? <span className="text-muted">no convention</span> : info.role}
        </Fact>
        {info.suggestedRole !== null && (
          <Fact term="Suggested role">
            {info.suggestedRole}
            <span className="text-[11px] text-muted">by a model, not convention</span>
          </Fact>
        )}
        <Fact term="Folder">
          <span className="truncate font-mono" title={info.path}>
            {slash === -1 ? "./" : info.path.slice(0, slash)}
          </span>
        </Fact>
        <Fact term="Length">{info.lines === null ? <span className="text-muted">not read</span> : `${info.lines} lines`}</Fact>
        <Fact term="Depends on">
          <span className="text-outgoing">{imports.length} files</span>
        </Fact>
        <Fact term="Depended on by">
          <span className="text-incoming">{importers.length} files</span>
        </Fact>
      </Facts>

      {info.commonjsExports !== null && <CommonJsExportList exports={info.commonjsExports} />}

      <section className="border-t border-border px-3 py-2">
        <ListHeading title="Imports" count={<span className="text-outgoing">{imports.length}→</span>} />
        {imports.length === 0 && <Caption>Imports nothing in the repository.</Caption>}
        <ul className="mb-2">{imports.map((other) => row(other, typeTag(`${file}>${other}`)))}</ul>
        <ListHeading title="Imported by" count={<span className="text-incoming">←{importers.length}</span>} />
        {importers.length === 0 && <Caption>Nothing in the repository imports this.</Caption>}
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
            {reached.length === 0 && <Caption>{active.empty}</Caption>}
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

// Names only when every write was read; otherwise where reading stopped,
// with no partial list beside it.
function CommonJsExportList({ exports }: { exports: CommonJsExports }) {
  if (!exports.exact) {
    return (
      <section className="border-t border-border px-3 py-2">
        <ListHeading title="CommonJS exports" count={<span className="text-muted">not read</span>} />
        <Caption>
          <span className="font-mono text-text">line {exports.line}</span> · {exports.reason}.
        </Caption>
      </section>
    );
  }
  const { names, wholeValue } = exports;
  return (
    <section className="border-t border-border px-3 py-2">
      <ListHeading title="CommonJS exports" count={<span className="text-muted">{names.length}</span>} />
      <Caption>
        {wholeValue
          ? names.length > 0
            ? "module.exports is one value, with these properties added to it."
            : "module.exports is one value: a function, class or instance, not named properties."
          : names.length > 0
            ? "Named in the order they're written."
            : "No names are written to module.exports or exports."}
      </Caption>
      {names.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[12px]">
          {names.map((name) => (
            <li key={name} className="break-all">
              {name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Row = (file: number, aside?: ReactNode) => ReactNode;

// One clickable path. Clicking moves the map's selection to it; hovering
// lights it on the map, and a hover on the map lights it here.
function rowOf(
  model: MapModel,
  onSelect: (file: number) => void,
  hovered: Selection,
  onHover: (hovered: Selection) => void,
): Row {
  return function row(file, aside) {
    const lit =
      hovered !== null &&
      (hovered.kind === "file" ? hovered.file === file : hovered.group === model.files[file].group);
    return (
      <li key={file}>
        <button
          type="button"
          onClick={() => onSelect(file)}
          onMouseEnter={() => onHover({ kind: "file", file })}
          onMouseLeave={() => onHover(null)}
          className={
            "-mx-1.5 flex h-6 w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-[3px] px-1.5 text-left " +
            (lit ? "bg-raised shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-raised")
          }
        >
          <PathText path={model.files[file].path} className="flex-1" />
          {aside}
        </button>
      </li>
    );
  };
}

function ListHeading({ title, count }: { title: string; count: ReactNode }) {
  return (
    <h3 className="flex h-6 items-center text-[12px]">
      <span className="flex-1">{title}</span>
      <span className="font-mono text-[11px] tabular-nums">{count}</span>
    </h3>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[11px] leading-4 text-muted">{children}</p>;
}
