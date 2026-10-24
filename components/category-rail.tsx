import type { Category } from "@/lib/map/model";

// Kinds of file, as the framework adapter named them. Colour belongs to a
// kind; "Unlabelled" isn't one, so its swatch stays grey.
export function CategoryRail({ categories }: { categories: Category[] }) {
  return (
    <div className="px-3 py-2">
      <h2 className="mb-1 text-[11px] text-muted">Categories</h2>
      <ul>
        {categories.map((category) => (
          <li key={category.name} className="flex h-6 items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-[2px] bg-muted" />
            <span className="min-w-0 flex-1 truncate">{category.name}</span>
            <span className="font-mono text-[11px] text-muted tabular-nums">{category.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
