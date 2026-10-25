import { KindSwatch } from "@/components/map/nodes";
import type { Category } from "@/lib/map/model";

// Kinds of file, by extension, with the colour their rows carry on the map.
// Clicking one dims every other kind on the map; clicking it again clears it.
export function CategoryRail({
  categories,
  active,
  onToggle,
}: {
  categories: Category[];
  active: string | null;
  onToggle: (name: string) => void;
}) {
  const total = categories.reduce((sum, category) => sum + category.count, 0);
  return (
    <div className="px-3 py-2">
      <h2 className="mb-1 text-[11px] text-muted tabular-nums">Categories · {total} files</h2>
      <ul>
        {categories.map((category) => (
          <li key={category.name}>
            <button
              type="button"
              aria-pressed={category.name === active}
              onClick={() => onToggle(category.name)}
              className={
                "-mx-1.5 flex h-6 w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-[3px] px-1.5 text-left " +
                (category.name === active ? "bg-raised outline outline-accent" : "hover:bg-raised")
              }
            >
              <KindSwatch hue={category.hue} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{category.name}</span>
              <span className="font-mono text-[11px] text-muted tabular-nums">{category.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
