import { PathText } from "@/components/path-text";
import { INSIGHT_SENTENCES, type Insight } from "@/lib/map/graph";
import type { MapModel } from "@/lib/map/model";

// Short names for each kind's heading. The sentence under it says what the
// list is; neither is ever written by a model.
const HEADINGS: Record<Insight["kind"], string> = {
  unimported: "Nothing imports",
  cycles: "Import loops",
  "heavily-imported": "Most imported",
  long: "Over 1,000 lines",
};

// Collapsed until asked for: this explains a codebase, it doesn't open on a
// list of findings about one.
export function InsightsPanel({
  model,
  insights,
  onSelect,
}: {
  model: MapModel;
  insights: Insight[];
  onSelect: (file: number) => void;
}) {
  const row = (file: number, aside?: string | number) => (
    <li key={file}>
      <button
        type="button"
        onClick={() => onSelect(file)}
        className="-mx-1.5 flex h-5 w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-[3px] px-1.5 hover:bg-raised"
      >
        <PathText path={model.files[file].path} className="flex-1" />
        {aside !== undefined && <span className="shrink-0 text-[11px] text-muted tabular-nums">{aside}</span>}
      </button>
    </li>
  );

  return (
    <details className="border-t border-border px-3 py-2">
      <summary className="cursor-pointer text-[11px] text-muted select-none">Insights</summary>
      {insights.map((insight) => {
        const count = insight.kind === "cycles" ? insight.cycles.length : insight.files.length;
        return (
          <section key={insight.kind} className="mt-3">
            <h3 className="flex text-[12px]">
              <span className="flex-1">{HEADINGS[insight.kind]}</span>
              <span className="font-mono text-[11px] text-muted tabular-nums">{count}</span>
            </h3>
            <p className="mb-1 text-[11px] leading-4 text-muted">{INSIGHT_SENTENCES[insight.kind]}</p>
            {count === 0 && <p className="text-[11px] text-muted">None.</p>}
            {insight.kind === "unimported" && <ul>{insight.files.map((file) => row(file))}</ul>}
            {insight.kind === "heavily-imported" && (
              <ul>{insight.files.map((file) => row(file, model.files[file].fanIn))}</ul>
            )}
            {insight.kind === "long" && (
              <ul>{insight.files.map((file) => row(file, model.files[file].lines ?? ""))}</ul>
            )}
            {insight.kind === "cycles" &&
              insight.cycles.map((cycle) => (
                <div key={cycle.files.join(">")} className="mb-2">
                  <div className="text-[11px] text-muted tabular-nums">
                    {cycle.among} files reach each other · shortest loop
                  </div>
                  <ol>{cycle.files.map((file) => row(file))}</ol>
                </div>
              ))}
          </section>
        );
      })}
    </details>
  );
}
