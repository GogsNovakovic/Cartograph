"use client";

import { useMemo, useState } from "react";
import { CategoryRail } from "@/components/category-rail";
import { DetailPane } from "@/components/detail-pane";
import { InsightsPanel } from "@/components/insights-panel";
import { MapCanvas, type OpenState, type Selection } from "@/components/map/canvas";
import { Workspace } from "@/components/workspace";
import { adjacency, type Insight } from "@/lib/map/graph";
import type { MapModel } from "@/lib/map/model";

// One analysis on screen. The rail, the map and the detail pane all select
// files, so what's open, what's selected and which category is active live
// here, and every answer is computed from the model already in the browser.
export function AnalysisView({ model, insights }: { model: MapModel; insights: Insight[] }) {
  const [open, setOpen] = useState<OpenState>({ groups: new Set(), opened: null });
  const [selected, setSelected] = useState<Selection>(null);
  const [category, setCategory] = useState<string | null>(null);
  // What the pointer is over, on the map or in the pane; each lights it in
  // the other. Kept apart from the selection so hovering never moves it.
  const [hovered, setHovered] = useState<Selection>(null);
  const graph = useMemo(() => adjacency(model.files.length, model.links), [model]);
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
          hovered={hovered}
          onHover={hover}
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
