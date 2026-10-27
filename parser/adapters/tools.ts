// Tools that sit beside any framework, or none: bundlers, test runners,
// config files, package scripts. Every role here is a file the tool loads
// itself, so each is an entry.

import { configs, folderOf, inside, join, readText, stem, type Role, type ToolAdapter } from "./shared.ts";

const entry = (role: string): Role => ({ role, entry: true });

// Docusaurus builds pages from src/pages and swaps in components from
// src/theme by name; neither is imported by anything.
const docusaurus: ToolAdapter = {
  name: "docusaurus",
  roles({ paths }) {
    const roles = new Map<string, Role>();
    for (const { dir, config } of configs(paths, "docusaurus")) {
      roles.set(config, entry("config"));
      for (const file of paths) {
        const relative = inside(dir, file);
        if (relative === null) continue;
        if (stem(relative) === "sidebars") roles.set(file, entry("config"));
        else if (relative.startsWith("src/pages/")) roles.set(file, entry("docs page"));
        else if (relative.startsWith("src/theme/")) roles.set(file, entry("theme component"));
      }
    }
    return roles;
  },
};

// Vite's entry is whatever module script the index.html beside its config
// names. Only a literal src that lands on a real file counts.
const vite: ToolAdapter = {
  name: "vite",
  roles({ root, paths }) {
    const roles = new Map<string, Role>();
    const known = new Set(paths);
    for (const { dir, config } of configs(paths, "vite")) {
      roles.set(config, entry("config"));
      const html = readText(root, `${dir}/index.html`);
      if (html === null) continue;
      for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) {
        const script = join(dir, match[1]);
        if (known.has(script)) roles.set(script, entry("app entry"));
      }
    }
    return roles;
  },
};

// Vitest's default include pattern, plus setup files its config lists as
// literal strings.
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const vitest: ToolAdapter = {
  name: "vitest",
  roles({ root, paths }) {
    const roles = new Map<string, Role>();
    const known = new Set(paths);
    for (const { dir, config } of configs(paths, "vitest")) {
      roles.set(config, entry("config"));
      for (const file of paths) {
        if (inside(dir, file) !== null && TEST_FILE.test(file)) roles.set(file, entry("test"));
      }
      const list = readText(root, config)?.match(/setupFiles\s*:\s*\[([^\]]*)\]/)?.[1] ?? "";
      for (const match of list.matchAll(/["']([^"']+)["']/g)) {
        const setup = join(dir, match[1]);
        if (known.has(setup)) roles.set(setup, entry("test setup"));
      }
    }
    return roles;
  },
};

// A file a package.json script runs by path, e.g. "node scripts/release.js".
const packageScripts: ToolAdapter = {
  name: "package-scripts",
  roles({ root, paths, packageJsons }) {
    const roles = new Map<string, Role>();
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
          if (known.has(script)) roles.set(script, entry("package script"));
        }
      }
    }
    return roles;
  },
};

// Declaration files are read by the compiler, never imported.
const typescript: ToolAdapter = {
  name: "typescript",
  roles({ paths }) {
    return new Map(paths.filter((p) => /\.d\.[cm]?ts$/.test(p)).map((p) => [p, entry("type declarations")]));
  },
};

// Any tool's config found by its file name: babel.config.js, .lintstagedrc.js.
const toolConfig: ToolAdapter = {
  name: "tool-config",
  roles({ paths }) {
    return new Map(
      paths.filter((p) => /\.config$/.test(stem(p)) || /^\.[\w-]+rc$/.test(stem(p))).map((p) => [p, entry("config")]),
    );
  },
};

// Earlier tools win: a tool knows more about its own config than the
// catch-all for config files does.
export const TOOLS: readonly ToolAdapter[] = [docusaurus, vite, vitest, packageScripts, typescript, toolConfig];
