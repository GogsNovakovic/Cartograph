// A file path that, when it doesn't fit, gives up its folder before its
// file name: the name is what tells paths apart. The full path is in the
// title.
export function PathText({ path, className = "" }: { path: string; className?: string }) {
  const slash = path.lastIndexOf("/") + 1;
  return (
    <span title={path} className={"flex min-w-0 font-mono text-[12px] " + className}>
      <span className="min-w-0 truncate text-muted">{path.slice(0, slash)}</span>
      <span className="shrink-0">{path.slice(slash)}</span>
    </span>
  );
}
