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
  const graph = useMemo(() => adjacency(model.files.length, model.links), [model]);

  // Selecting a file from a list opens its folder, so the selection is
  // something on the map, and refits if that panel is off screen.
  const selectFile = (file: number) => {
    const group = model.files[file].group;
    setOpen((current) => ({ groups: new Set(current.groups).add(group), opened: group }));
    setSelected({ kind: "file", file });
  };

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
        />
      }
      detail={<DetailPane model={model} graph={graph} selected={selected} onSelect={selectFile} />}
    />
  );
}
