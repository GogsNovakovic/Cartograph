// Framework and tooling knowledge lives behind this interface and nowhere
// else. The parser asks adapters questions; it never checks which framework
// it's looking at.
//
// An adapter names the files its tool reaches by convention rather than by
// import: pages, routes, configs, tests, entry scripts. A repository can use
// several tools at once, so every adapter is asked, and the first one to
// name a file decides its role.

import { readFileSync } from "node:fs";
import path from "node:path";

export type RepositoryContext = {
  root: string;
  // Relative paths of every source file the walk found.
  paths: readonly string[];
  // Relative paths of every package.json the walk found.
  packageJsons: readonly string[];
};

export type Adapter = {
  name: string;
  // Path → role for each file this tool's conventions reach. Empty when the
  // tool isn't in the repository.
  roles(repository: RepositoryContext): Map<string, string>;
};

const posix = path.posix;

// "page.tsx" → "page", "next.config.mjs" → "next.config".
function stem(file: string): string {
  const base = posix.basename(file);
  return base.slice(0, base.length - posix.extname(base).length);
}

function folderOf(file: string): string {
  return posix.dirname(file);
}

// The path relative to `dir`, or null when it isn't inside it.
function inside(dir: string, file: string): string | null {
  if (dir === ".") return file;
  return file.startsWith(dir + "/") ? file.slice(dir.length + 1) : null;
}

// A path written relative to `dir` in some config, as a repository path.
function join(dir: string, written: string): string {
  return posix.normalize(posix.join(dir, written.replace(/^\//, "")));
}

function readText(root: string, file: string): string | null {
  try {
    return readFileSync(path.join(root, file), "utf8");
  } catch {
    return null;
  }
}

// Directories holding a `<name>.config.*` source file, with that file.
function configs(paths: readonly string[], name: string): Array<{ dir: string; config: string }> {
  return paths.filter((p) => stem(p) === `${name}.config`).map((config) => ({ dir: folderOf(config), config }));
}

// App Router files, by name, from the file conventions in Next's own docs.
const NEXT_SEGMENT_FILES: Record<string, string> = {
  page: "page",
  layout: "layout",
  template: "layout",
  route: "route handler",
  loading: "loading UI",
  error: "error UI",
  "global-error": "error UI",
  "not-found": "error UI",
  forbidden: "error UI",
  unauthorized: "error UI",
  default: "parallel route default",
  icon: "metadata",
  "apple-icon": "metadata",
  "opengraph-image": "metadata",
  "twitter-image": "metadata",
  sitemap: "metadata",
  robots: "metadata",
  manifest: "metadata",
};

// Files Next looks for beside app/ or pages/.
const NEXT_ROOT_FILES: Record<string, string> = {
  proxy: "proxy",
  middleware: "middleware",
  instrumentation: "instrumentation",
  "instrumentation-client": "instrumentation",
  "mdx-components": "MDX components",
};

// A Next app is wherever a next.config sits, so an example app inside a
// monorepo counts as one.
const nextjs: Adapter = {
  name: "nextjs",
  roles({ paths }) {
    const roles = new Map<string, string>();
    for (const { dir, config } of configs(paths, "next")) {
      roles.set(config, "config");
      for (const file of paths) {
        const relative = inside(dir, file);
        if (relative === null) continue;
        const within = relative.startsWith("src/") ? relative.slice(4) : relative;
        const name = stem(file);
        if (within.startsWith("app/")) {
          const role = NEXT_SEGMENT_FILES[name];
          if (role) roles.set(file, role);
        } else if (within.startsWith("pages/")) {
          roles.set(file, within.startsWith("pages/api/") ? "API route" : "page");
        } else if (!within.includes("/") && NEXT_ROOT_FILES[name]) {
          roles.set(file, NEXT_ROOT_FILES[name]);
        }
      }
    }
    return roles;
  },
};

// Docusaurus builds pages from src/pages and swaps in components from
// src/theme by name; neither is imported by anything.
const docusaurus: Adapter = {
  name: "docusaurus",
  roles({ paths }) {
    const roles = new Map<string, string>();
    for (const { dir, config } of configs(paths, "docusaurus")) {
      roles.set(config, "config");
      for (const file of paths) {
        const relative = inside(dir, file);
        if (relative === null) continue;
        if (stem(relative) === "sidebars") roles.set(file, "config");
        else if (relative.startsWith("src/pages/")) roles.set(file, "page");
        else if (relative.startsWith("src/theme/")) roles.set(file, "theme component");
      }
    }
    return roles;
  },
};

// Vite's entry is whatever module script the index.html beside its config
// names. Only a literal src that lands on a real file counts.
const vite: Adapter = {
  name: "vite",
  roles({ root, paths }) {
    const roles = new Map<string, string>();
    const known = new Set(paths);
    for (const { dir, config } of configs(paths, "vite")) {
      roles.set(config, "config");
      const html = readText(root, posix.join(dir, "index.html"));
      if (html === null) continue;
      for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) {
        const entry = join(dir, match[1]);
        if (known.has(entry)) roles.set(entry, "entry");
      }
    }
    return roles;
  },
};

// Vitest's default include pattern, plus setup files its config lists as
// literal strings.
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const vitest: Adapter = {
  name: "vitest",
  roles({ root, paths }) {
    const roles = new Map<string, string>();
    const known = new Set(paths);
    for (const { dir, config } of configs(paths, "vitest")) {
      roles.set(config, "config");
      for (const file of paths) {
        if (inside(dir, file) !== null && TEST_FILE.test(file)) roles.set(file, "test");
      }
      const list = readText(root, config)?.match(/setupFiles\s*:\s*\[([^\]]*)\]/)?.[1] ?? "";
      for (const match of list.matchAll(/["']([^"']+)["']/g)) {
        const setup = join(dir, match[1]);
        if (known.has(setup)) roles.set(setup, "test setup");
      }
    }
    return roles;
  },
};

// A file a package.json script runs by path, e.g. "node scripts/release.js".
const packageScripts: Adapter = {
  name: "package-scripts",
  roles({ root, paths, packageJsons }) {
    const roles = new Map<string, string>();
    const known = new Set(paths);
    for (const manifest of packageJsons) {
      const text = readText(root, manifest);
      if (text === null) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || !("scripts" in parsed)) continue;
      const scripts = parsed.scripts;
      if (typeof scripts !== "object" || scripts === null) continue;
      for (const command of Object.values(scripts)) {
        if (typeof command !== "string") continue;
        for (const word of command.split(/\s+/)) {
          const script = join(folderOf(manifest), word.replace(/^["']|["']$/g, ""));
          if (known.has(script)) roles.set(script, "package script");
        }
      }
    }
    return roles;
  },
};

// Declaration files are read by the compiler, never imported.
const typescript: Adapter = {
  name: "typescript",
  roles({ paths }) {
    return new Map(paths.filter((p) => /\.d\.[cm]?ts$/.test(p)).map((p) => [p, "type declarations"]));
  },
};

// Any tool's config found by its file name: babel.config.js, .lintstagedrc.js.
const toolConfig: Adapter = {
  name: "tool-config",
  roles({ paths }) {
    return new Map(
      paths
        .filter((p) => /\.config$/.test(stem(p)) || /^\.[\w-]+rc$/.test(stem(p)))
        .map((p) => [p, "config"]),
    );
  },
};

// Earlier adapters win: a framework knows more about its own config than
// the catch-all for config files does.
const ADAPTERS: readonly Adapter[] = [nextjs, docusaurus, vite, vitest, packageScripts, typescript, toolConfig];

export type Roles = {
  // The adapters that named at least one file. Empty means no framework or
  // tooling was recognised, and every role is null.
  adapters: string[];
  roles: Map<string, string>;
};

export function readRoles(repository: RepositoryContext): Roles {
  const adapters: string[] = [];
  const roles = new Map<string, string>();
  for (const adapter of ADAPTERS) {
    const named = adapter.roles(repository);
    if (named.size === 0) continue;
    adapters.push(adapter.name);
    for (const [file, role] of named) if (!roles.has(file)) roles.set(file, role);
  }
  return { adapters, roles };
}
