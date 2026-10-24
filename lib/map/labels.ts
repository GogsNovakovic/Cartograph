// The shortest trailing part of each path that no other path on screen ends
// with. Two "components" folders show as "excalidraw/components" and
// "excalidraw-app/components"; a lone "scripts" stays "scripts".
export function shortestUniqueLabels(paths: readonly string[]): Map<string, string> {
  const segments = new Map(paths.map((path) => [path, path.split("/")]));
  const suffix = (path: string, k: number) => (segments.get(path) ?? []).slice(-k).join("/");

  const labels = new Map<string, string>();
  for (const path of paths) {
    const length = segments.get(path)?.length ?? 1;
    let k = 1;
    while (k < length && paths.some((other) => other !== path && suffix(other, k) === suffix(path, k))) {
      k++;
    }
    labels.set(path, suffix(path, k));
  }
  return labels;
}
