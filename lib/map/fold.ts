// Folding: which directories become nodes on the map. Pure, so it runs the
// same from a script as on the server.

// More nodes than this and nobody can read the map.
export const MAX_NODES = 24;
// "Fewer than a couple of files" — where the threshold starts.
const START_THRESHOLD = 2;

export const ROOT = ".";

export type Fold = {
  // The lowest threshold that landed under MAX_NODES.
  threshold: number;
  // Directory → every file path it holds after merging, including those of
  // the directories folded into it. Directories left holding nothing are absent.
  groups: Map<string, string[]>;
};

export function parentOf(directory: string): string {
  const slash = directory.lastIndexOf("/");
  return slash === -1 ? ROOT : directory.slice(0, slash);
}

function depthOf(directory: string): number {
  return directory === ROOT ? 0 : directory.split("/").length;
}

// Every directory starts as its own node. Deepest first, a directory holding
// fewer than `threshold` files merges into its parent. If that leaves too many
// nodes, the threshold rises and the whole thing runs again from scratch, so
// the repository's shape decides how deep the map goes.
export function fold(files: readonly { path: string; folder: string }[]): Fold {
  // Intermediate directories with no files of their own still exist, so a
  // deep directory merging upward has somewhere to land at every level.
  const directories = new Set<string>([ROOT]);
  for (const file of files) {
    for (let dir = file.folder; dir !== ROOT; dir = parentOf(dir)) directories.add(dir);
  }
  const byDepth = new Map<number, string[]>();
  for (const dir of directories) {
    const depth = depthOf(dir);
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), dir]);
  }
  const maxDepth = Math.max(...byDepth.keys());

  for (let threshold = START_THRESHOLD; ; threshold++) {
    const groups = new Map<string, string[]>([...directories].map((dir) => [dir, []]));
    for (const file of files) groups.get(file.folder)?.push(file.path);

    for (let depth = maxDepth; depth >= 1; depth--) {
      // Every directory at this depth is judged on the counts as they stood
      // before any of them moved. Merges only go to depth - 1, so a merge here
      // can't change what a sibling sees.
      const merging = (byDepth.get(depth) ?? []).filter(
        (dir) => (groups.get(dir)?.length ?? 0) < threshold,
      );
      for (const dir of merging) {
        groups.get(parentOf(dir))?.push(...(groups.get(dir) ?? []));
        groups.delete(dir);
      }
    }

    for (const [dir, held] of groups) if (held.length === 0) groups.delete(dir);
    // Ends: once everything has merged into the root there is one node.
    if (groups.size <= MAX_NODES) return { threshold, groups };
  }
}
