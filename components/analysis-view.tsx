"use client";

import { useMemo, useState } from "react";
import { explain, freshness } from "@/app/(app)/actions";
import { CategoryRail } from "@/components/category-rail";
import { DetailPane } from "@/components/detail-pane";
import { explainKey, type ExplainState } from "@/components/explanation";
import { InsightsPanel } from "@/components/insights-panel";
import { MapCanvas, type OpenState, type Selection } from "@/components/map/canvas";
import { Workspace } from "@/components/workspace";
import type { TracingStatus } from "@/lib/env";
import type { ExplainTarget } from "@/lib/explain";
import { adjacency, type Insight } from "@/lib/map/graph";
import type { MapModel } from "@/lib/map/model";

// One analysis on screen. The rail, the map and the detail pane all select
// files, so what's open, what's selected and which category is active live
// here, and every answer is computed from the model already in the browser.
export function AnalysisView({
  analysisId,
  model,
  insights,
  tracing,
}: {
  analysisId: string;
  model: MapModel;
  insights: Insight[];
  tracing: TracingStatus;
}) {
  const [open, setOpen] = useState<OpenState>({ groups: new Set(), opened: null });
  const [selected, setSelected] = useState<Selection>(null);
  const [category, setCategory] = useState<string | null>(null);
  // What the pointer is over, on the map or in the pane; each lights it in
  // the other. Kept apart from the selection so hovering never moves it.
  const [hovered, setHovered] = useState<Selection>(null);
  const graph = useMemo(() => adjacency(model.files.length, model.links), [model]);
  // Every explanation fetched this visit, by what it explains. Here rather
  // than in the pane, so moving the selection away and back finds it again
  // without another request.
  const [explained, setExplained] = useState<ReadonlyMap<string, ExplainState>>(new Map());
  const typeOnly = useMemo(
    () => new Set(model.links.filter((_, i) => model.typeOnly[i]).map(([source, target]) => `${source}>${target}`)),
    [model],
  );

  // Selecting a file from a list opens its folder, so the selection is
  // something on the map, and refits if that panel is off screen.
  const selectFile = (file: number) => {
    const group = model.files[file].group;
    setOpen((current) => ({ groups: new Set(current.groups).add(group), opened: group }));
    setSelected({ kind: "file", file });
    // The row under the pointer is about to be replaced, and won't report
    // that the pointer left it.
    setHovered(null);
  };

  // Clicking a folder's path does what clicking its box on the map does:
  // opens it and selects the folder.
  const selectFolder = (group: number) => {
    setOpen((current) => ({ groups: new Set(current.groups).add(group), opened: group }));
    setSelected({ kind: "folder", group });
    setHovered(null);
  };

  // The explanation first; then, for a file, whether the repository has
  // moved on since. Actions run one at a time, so the check waits for the
  // explanation rather than holding it up.
  const requestExplanation = async (target: ExplainTarget) => {
    const key = explainKey(target);
    const put = (update: (current: ExplainState | undefined) => ExplainState | undefined) =>
      setExplained((all) => {
        const next = update(all.get(key));
        return next === undefined ? all : new Map(all).set(key, next);
      });
    put(() => ({ status: "pending" }));
    const result = await explain(analysisId, target);
    if (!result.ok) {
      put(() => ({ status: "failed", message: result.message }));
      return;
    }
    const checking = target.kind === "file";
    put(() => ({ status: "done", explanation: result.explanation, freshness: null, checking }));
    if (target.kind !== "file") return;
    const fresh = await freshness(analysisId, target.path);
    put((current) => (current?.status === "done" ? { ...current, freshness: fresh, checking: false } : current));
  };

  // The map reports every pointer move; only a change re-renders.
  const hover = (next: Selection) => setHovered((current) => (sameTarget(current, next) ? current : next));

  return (
    <Workspace
      rail={
        <>
          <CategoryRail
            categories={model.categories}
            active={category}
            onToggle={(name) => setCategory((current) => (current === name ? null : name))}
          />
          <InsightsPanel model={model} insights={insights} onSelect={selectFile} />
        </>
      }
      map={
        <MapCanvas
          model={model}
          open={open}
          setOpen={setOpen}
          selected={selected}
          setSelected={setSelected}
          category={category}
          hovered={hovered}
          onHover={hover}
        />
      }
      detail={
        <DetailPane
          model={model}
          graph={graph}
          typeOnly={typeOnly}
          selected={selected}
          onSelect={selectFile}
          onSelectFolder={selectFolder}
          hovered={hovered}
          onHover={hover}
          analysisId={analysisId}
          tracing={tracing}
          explained={explained}
          onExplain={requestExplanation}
        />
      }
    />
  );
}

function sameTarget(a: Selection, b: Selection): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "file") return b.kind === "file" && a.file === b.file;
  return b.kind === "folder" && a.group === b.group;
}
