"use client";

import { useMemo, type ReactNode } from "react";
import { RerunButton } from "@/components/analyse-form";
import type { Selection } from "@/components/map/canvas";
import type { Explanation } from "@/lib/ai/explain";
import type { TracingStatus } from "@/lib/env";
import type { ExplainTarget } from "@/lib/explain";
import type { Freshness } from "@/lib/freshness";
import type { MapModel } from "@/lib/map/model";
import { linkPaths, parseMarkup, type Inline } from "@/lib/markup";

// What the pane holds for one file or folder. Kept above the selection, so
// an explanation already fetched is still there when the selection comes back.
export type ExplainState =
  | { status: "pending" }
  | { status: "failed"; message: string }
  // `freshness` is null while the repository is being checked, and for folders.
  | { status: "done"; explanation: Explanation; freshness: Freshness | null; checking: boolean };

export function explainKey(target: ExplainTarget): string {
  return target.kind === "file" ? `file:${target.path}` : `folder:${target.directory}`;
}

type Props = {
  analysisId: string;
  model: MapModel;
  subject: { kind: "file"; file: number } | { kind: "folder"; group: number };
  state: ExplainState | undefined;
  onExplain: () => void;
  tracing: TracingStatus;
  onSelect: (file: number) => void;
  onSelectFolder: (group: number) => void;
  onHover: (hovered: Selection) => void;
};

const BUTTON =
  "h-6 cursor-pointer rounded-[3px] border border-border px-2 text-[12px] hover:bg-raised disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent";

export function ExplanationTab(props: Props) {
  const { model, subject, state, onExplain } = props;
  const noun = subject.kind === "file" ? "file" : "folder";
  const skipped = subject.kind === "file" && model.files[subject.file].lines === null;

  return (
    <div className="px-3 py-2">
      {state?.status === "done" ? (
        <Done {...props} state={state} />
      ) : skipped ? (
        <p className="text-[12px]">The parser didn&apos;t read this file, so there is nothing to explain it from.</p>
      ) : (
        <>
          <p className="text-[12px]">
            {state?.status === "failed" ? `Couldn't explain this ${noun}.` : `No explanation for this ${noun} yet.`}
          </p>
          {state?.status === "failed" ? (
            <p className="mt-0.5 font-mono text-[11px] leading-4 break-words text-muted">{state.message}</p>
          ) : (
            <p className="mt-0.5 text-[11px] leading-4 text-muted">
              {subject.kind === "file"
                ? "Written by a model from this file's source and every file it imports or is imported by, as the parser resolved them. It is told nothing else."
                : "Written by a model from every file in this folder and every import crossing its edge, as the parser resolved them. It sees no source."}
            </p>
          )}
          <button type="button" onClick={onExplain} disabled={state?.status === "pending"} className={BUTTON + " mt-2"}>
            {state?.status === "pending" ? "Explaining…" : state?.status === "failed" ? "Try again" : `Explain this ${noun}`}
          </button>
        </>
      )}
      <TracingLine tracing={props.tracing} />
    </div>
  );
}

function Done({ state, analysisId, model, subject, ...links }: Props & { state: Extract<ExplainState, { status: "done" }> }) {
  const { explanation } = state;
  return (
    <>
      {subject.kind === "file" && (
        <FreshnessNotice
          analysisId={analysisId}
          path={model.files[subject.file].path}
          freshness={state.freshness}
          checking={state.checking}
        />
      )}
      <Body body={explanation.body} model={model} {...links} />
      <p className="mt-2 font-mono text-[11px] text-muted">
        {explanation.model} · {explanation.cached ? "from cache" : "written now"}
      </p>
      {explanation.truncated && (
        <p className="text-[11px] leading-4 text-muted">
          Explained from the first {explanation.truncated.shown} of {explanation.truncated.total} lines; the rest
          wasn&apos;t sent.
        </p>
      )}
    </>
  );
}

const short = (sha: string) => sha.slice(0, 7);

// Said above the explanation, because it changes how the explanation reads.
function FreshnessNotice({
  analysisId,
  path,
  freshness,
  checking,
}: {
  analysisId: string;
  path: string;
  freshness: Freshness | null;
  checking: boolean;
}) {
  if (checking) return <p className="mb-2 text-[11px] text-muted">Checking the repository for changes…</p>;
  if (freshness === null) return null;
  if (freshness.state === "current") {
    return (
      <p className="mb-2 text-[11px] text-muted">
        Current: the repository is still at <span className="font-mono">{short(freshness.commit)}</span>.
      </p>
    );
  }
  if (freshness.state === "unknown") {
    return <p className="mb-2 text-[11px] leading-4 text-muted">Couldn&apos;t check whether this is current: {freshness.message}</p>;
  }
  const analysed = <span className="font-mono">{short(freshness.analysed)}</span>;
  const head = <span className="font-mono">{short(freshness.head)}</span>;
  const name = <span className="font-mono break-all">{path}</span>;
  const message: ReactNode =
    freshness.file === "changed" ? (
      <>
        <span className="font-semibold">Stale.</span> {name} has changed since {analysed}, the commit this map was built
        from; the repository is now at {head}. This explains the analysed version.
      </>
    ) : freshness.file === "removed" ? (
      <>
        <span className="font-semibold">Stale.</span> {name} no longer exists at {head}; this map was built from{" "}
        {analysed}.
      </>
    ) : (
      <>
        The repository has moved from {analysed} to {head}. This file is unchanged, but the files around it may not
        be.
      </>
    );
  return (
    <div className="mb-2 rounded-[3px] border border-border px-2 py-1.5">
      <p className="text-[11px] leading-4">{message}</p>
      <div className="mt-1.5">
        <RerunButton analysisId={analysisId} label="Re-analyse" />
      </div>
    </div>
  );
}

type Target = { kind: "file"; file: number } | { kind: "folder"; group: number };

type LinkProps = Pick<Props, "onSelect" | "onSelectFolder" | "onHover">;

function Body({ body, model, ...links }: { body: string; model: MapModel } & LinkProps) {
  const blocks = useMemo(() => parseMarkup(body), [body]);
  // Every path the map knows, as a file or a folder on it. Anything else
  // the prose names stays plain text.
  const resolve = useMemo(() => {
    const files = new Map(model.files.map((file, i) => [file.path, i]));
    const folders = new Map(model.groups.map((group, g) => [group.directory, g]));
    return (candidate: string): Target | null => {
      const path = candidate.replace(/^\.?\//, "");
      const file = files.get(path);
      if (file !== undefined) return { kind: "file", file };
      const group = folders.get(path.replace(/\/$/, ""));
      return group !== undefined && path !== "" ? { kind: "folder", group } : null;
    };
  }, [model]);

  return (
    <div className="space-y-2 text-[12px] leading-[18px]">
      {blocks.map((block, b) =>
        block.kind === "paragraph" ? (
          <p key={b}>
            <Inlines inlines={block.inlines} resolve={resolve} {...links} />
          </p>
        ) : (
          <ul key={b} className="list-disc space-y-0.5 pl-4 marker:text-muted">
            {block.items.map((item, i) => (
              <li key={i}>
                <Inlines inlines={item} resolve={resolve} {...links} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Inlines({
  inlines,
  resolve,
  ...links
}: { inlines: Inline[]; resolve: (candidate: string) => Target | null } & LinkProps) {
  return inlines.map((inline, i) => {
    const weight = inline.bold ? " font-semibold" : "";
    if (inline.kind === "code") {
      const target = resolve(inline.text);
      return target ? (
        <PathLink key={i} text={inline.text} target={target} className={weight} {...links} />
      ) : (
        <code key={i} className={"rounded-[2px] bg-raised px-1 font-mono text-[11px] break-all" + weight}>
          {inline.text}
        </code>
      );
    }
    return (
      <span key={i} className={weight || undefined}>
        {linkPaths(inline.text, resolve).map((part, p) =>
          typeof part === "string" ? part : <PathLink key={p} text={part.text} target={part.target} {...links} />,
        )}
      </span>
    );
  });
}

// A path in the prose moves the map to it, the way a row in a list does.
function PathLink({
  text,
  target,
  className = "",
  onSelect,
  onSelectFolder,
  onHover,
}: { text: string; target: Target; className?: string } & LinkProps) {
  return (
    <button
      type="button"
      onClick={() => (target.kind === "file" ? onSelect(target.file) : onSelectFolder(target.group))}
      onMouseEnter={() => onHover(target)}
      onMouseLeave={() => onHover(null)}
      className={"cursor-pointer font-mono text-[11px] break-all text-accent hover:underline " + className}
    >
      {text}
    </button>
  );
}

// An absent key looks exactly like a working setup with no traffic, so
// which one this is gets said wherever a model call can be made.
function TracingLine({ tracing }: { tracing: TracingStatus }) {
  return (
    <p className="mt-3 border-t border-border pt-1.5 text-[11px] leading-4 text-muted">
      {tracing.on ? (
        <>
          Model calls are traced to LangSmith, project <span className="font-mono">{tracing.project}</span>.
        </>
      ) : (
        <>
          <span className="text-text">Not traced:</span> {tracing.reason}. Calls still run; nothing records them.
        </>
      )}
    </p>
  );
}
