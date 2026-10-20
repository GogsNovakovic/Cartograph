import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ExcludedDirectory } from "./types.ts";

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

// Bigger than this is almost always bundled or generated output, and parsing
// it would cost more than every hand-written file together.
export const MAX_PARSE_BYTES = 1024 * 1024;

export type WalkedFile = {
  path: string;
  absolutePath: string;
  folder: string;
  bytes: number;
  lines: number | null;
  sha256: string | null;
  // Null when there is text to parse.
  text: string | null;
  skipReason: string | null;
};

export type WalkResult = {
  files: WalkedFile[];
  excludedDirectories: ExcludedDirectory[];
  // Every package.json outside excluded directories, for workspace packages.
  packageJsonPaths: string[];
};

export function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.includes(path.extname(name));
}

export function toRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function folderOf(relativePath: string): string {
  const dir = path.posix.dirname(relativePath);
  return dir === "" ? "." : dir;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  // A trailing newline ends the last line rather than starting a new one.
  return text.endsWith("\n") ? lines - 1 : lines;
}

function isDirectoryLink(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

// Why a directory is never entered, or null to walk it. Structural only:
// installed dependencies and dot-directories (VCS, caches, editor state).
function directoryExclusion(name: string): string | null {
  if (name === "node_modules") return "installed dependencies";
  if (name.startsWith(".")) return "dot-directory";
  return null;
}

// Keeps whole directories rather than seeding from entry points: with no
// framework knowledge there is no reliable entry point, and keeping every
// source file means every resolved import has a node to land on.
export function walkRepository(root: string): WalkResult {
  const files: WalkedFile[] = [];
  const excludedDirectories: ExcludedDirectory[] = [];
  const packageJsonPaths: string[] = [];

  const visit = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = toRelative(root, absolutePath);

      if (entry.isDirectory()) {
        const reason = directoryExclusion(entry.name);
        if (reason) excludedDirectories.push({ path: relativePath, reason });
        else visit(absolutePath);
        continue;
      }

      if (entry.isSymbolicLink() && isDirectoryLink(absolutePath)) {
        excludedDirectories.push({ path: relativePath, reason: "symbolic link to a directory" });
        continue;
      }

      if (entry.name === "package.json" && entry.isFile()) packageJsonPaths.push(absolutePath);
      if (!isSourceFile(entry.name)) continue;

      const base = { path: relativePath, absolutePath, folder: folderOf(relativePath) };

      if (entry.isSymbolicLink()) {
        files.push({
          ...base,
          bytes: lstatSync(absolutePath).size,
          lines: null,
          sha256: null,
          text: null,
          skipReason: "symbolic link; the file it points to is parsed where it lives",
        });
        continue;
      }
      if (!entry.isFile()) continue;

      let buffer: Buffer;
      try {
        buffer = readFileSync(absolutePath);
      } catch (error) {
        files.push({
          ...base,
          bytes: 0,
          lines: null,
          sha256: null,
          text: null,
          skipReason: `unreadable: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }

      const text = buffer.toString("utf8");
      const tooLarge = buffer.length > MAX_PARSE_BYTES;
      files.push({
        ...base,
        bytes: buffer.length,
        lines: countLines(text),
        sha256: createHash("sha256").update(buffer).digest("hex"),
        text: tooLarge ? null : text,
        skipReason: tooLarge
          ? `larger than ${MAX_PARSE_BYTES / 1024} KiB (${Math.round(buffer.length / 1024)} KiB), likely generated`
          : null,
      });
    }
  };

  visit(root);
  return { files, excludedDirectories, packageJsonPaths };
}
