// A file path cut from the left when it doesn't fit, so the file name, the
// part that tells paths apart, is the part that stays. The full path is in
// the title.
export function PathText({ path, className = "" }: { path: string; className?: string }) {
  return (
    <span
      title={path}
      dir="rtl"
      className={"block min-w-0 truncate text-left font-mono text-[12px] " + className}
    >
      <bdi>{path}</bdi>
    </span>
  );
}
