import type { ReactNode } from "react";

// The analysis screen's three columns. Their placement is settled here and
// later phases only fill them: the rail lists file categories, the map fills
// the middle, and the detail pane is a real column, never a drawer or overlay,
// so opening it never covers the map.
export function Workspace({ rail, map }: { rail: ReactNode; map: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="Categories"
        className="w-[200px] shrink-0 overflow-y-auto border-r border-border"
      >
        {rail}
      </aside>
      <section aria-label="Map" className="relative min-w-0 flex-1">
        {map}
      </section>
      <aside
        aria-label="Details"
        className="w-[320px] shrink-0 overflow-y-auto border-l border-border"
      />
    </div>
  );
}
