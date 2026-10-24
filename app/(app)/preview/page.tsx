import path from "node:path";
import { CategoryRail } from "@/components/category-rail";
import { MapCanvas } from "@/components/map/canvas";
import { Workspace } from "@/components/workspace";
import { buildMapModel } from "@/lib/map/model";
import { readParseResult } from "@/parser/read";

// Renders a checked-in parser result through the real interface, so the
// screen can be built without a database or network. Goes away once analyses
// are stored. Read and validated at build time; a bad file fails the build.
export default function PreviewPage() {
  const model = buildMapModel(readParseResult(path.join(process.cwd(), "data/excalidraw.json")));
  return <Workspace rail={<CategoryRail categories={model.categories} />} map={<MapCanvas model={model} />} />;
}
