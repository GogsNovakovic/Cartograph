import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { ts } from "ts-morph";
import type { ExcludedReason, ExternalReason, UnresolvedReason } from "./types.ts";
import { isSourceFile, toRelative } from "./walk.ts";

export type Resolution =
  | { outcome: "resolved"; target: string }
  | { outcome: "external"; reason: ExternalReason; detail: string }
  | { outcome: "excluded"; reason: ExcludedReason; detail: string }
  | { outcome: "unresolved"; reason: UnresolvedReason; detail: string };

type Config = { options: ts.CompilerOptions; file: string | null };

// Used when a file has no tsconfig or jsconfig above it. Bundler resolution is
// the most permissive real algorithm: extensionless and index imports work,
// which is what untyped JavaScript projects rely on.
const DEFAULT_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

// Applied on top of every config. allowJs so a .js file counts as a target
// even in a project that doesn't type-check JavaScript; resolveJsonModule so a
// JSON import resolves to its file and is reported as non-source, not missing.
const FORCED_OPTIONS: ts.CompilerOptions = { allowJs: true, resolveJsonModule: true };

const BUILTINS = new Set(builtinModules);

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isRelative(specifier: string): boolean {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}

function matchesPathPattern(pattern: string, specifier: string): boolean {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier;
  return (
    specifier.length >= pattern.length - 1 &&
    specifier.startsWith(pattern.slice(0, star)) &&
    specifier.endsWith(pattern.slice(star + 1))
  );
}

export class Resolver {
  private readonly root: string;
  private readonly nodes: Set<string>;
  private readonly workspaces: Map<string, string>;
  private readonly configByDir = new Map<string, string | null>();
  private readonly parsedConfigs = new Map<string, ts.ParsedCommandLine>();
  private readonly cache: ts.ModuleResolutionCache;

  constructor(root: string, nodePaths: Iterable<string>, packageJsonPaths: string[]) {
    this.root = root;
    this.nodes = new Set(nodePaths);
    this.workspaces = new Map();
    for (const file of packageJsonPaths) {
      const name = readPackageName(file);
      if (name) this.workspaces.set(name, path.dirname(file));
    }
    this.cache = ts.createModuleResolutionCache(root, (name) => name);
  }

  resolve(specifier: string, fromAbsolute: string): Resolution {
    const config = this.configFor(fromAbsolute);
    const options = { ...config.options, ...FORCED_OPTIONS };
    const result = ts.resolveModuleName(specifier, fromAbsolute, options, ts.sys, this.cache);
    const resolved = result.resolvedModule?.resolvedFileName;

    if (resolved) return this.classifyFile(path.resolve(resolved), specifier);

    if (specifier.startsWith("node:") || BUILTINS.has(specifier)) {
      return { outcome: "external", reason: "node-builtin", detail: specifier };
    }

    if (isRelative(specifier) || path.isAbsolute(specifier)) {
      return this.explainMissingPath(path.resolve(path.dirname(fromAbsolute), specifier), specifier);
    }

    const workspace = this.workspaces.get(packageNameOf(specifier));
    if (workspace) return this.resolveWorkspace(specifier, workspace, options);

    const alias = Object.keys(options.paths ?? {}).find((pattern) =>
      matchesPathPattern(pattern, specifier),
    );
    if (alias) return this.explainMissingAlias(specifier, alias, options, config);

    // A bare specifier that baseUrl would have reached if the file existed:
    // its first segment names something under baseUrl.
    if (options.baseUrl && existsSync(path.join(options.baseUrl, specifier.split("/")[0]))) {
      return {
        outcome: "unresolved",
        reason: "base-url-without-target",
        detail: `no file for it under baseUrl ${toRelative(this.root, options.baseUrl) || "."}`,
      };
    }

    return { outcome: "external", reason: "package", detail: packageNameOf(specifier) };
  }

  private classifyFile(absolute: string, specifier: string): Resolution {
    const relative = toRelative(this.root, absolute);
    if (this.nodes.has(relative)) return { outcome: "resolved", target: relative };
    if (relative.startsWith("../") || path.isAbsolute(relative)) {
      if (absolute.split(path.sep).includes("node_modules")) {
        return { outcome: "external", reason: "package", detail: packageNameOf(specifier) };
      }
      return { outcome: "external", reason: "outside-repository", detail: absolute };
    }
    if (relative.split("/").includes("node_modules")) {
      return { outcome: "external", reason: "package", detail: packageNameOf(specifier) };
    }
    if (!isSourceFile(relative)) {
      return { outcome: "excluded", reason: "non-source-file", detail: relative };
    }
    return {
      outcome: "excluded",
      reason: "excluded-directory",
      detail: `${relative} is inside a directory the walk does not enter`,
    };
  }

  private explainMissingPath(absolute: string, specifier: string): Resolution {
    const relative = toRelative(this.root, absolute);
    if (relative.startsWith("../")) {
      return { outcome: "external", reason: "outside-repository", detail: absolute };
    }
    if (existsSync(absolute)) {
      if (statSync(absolute).isDirectory()) {
        return {
          outcome: "unresolved",
          reason: "directory-without-index",
          detail: `${relative}/ exists but has no index file or package.json entry`,
        };
      }
      // The file is there; it just isn't code (stylesheet, image, ...).
      return { outcome: "excluded", reason: "non-source-file", detail: relative };
    }
    return {
      outcome: "unresolved",
      reason: "no-such-file",
      detail: `nothing at ${relative} with any source extension or as a directory index (${specifier})`,
    };
  }

  // TypeScript only resolves aliases to code. Substituting the alias by hand
  // tells a stylesheet that exists apart from a file that doesn't.
  private explainMissingAlias(
    specifier: string,
    pattern: string,
    options: ts.CompilerOptions,
    config: Config,
  ): Resolution {
    const star = pattern.indexOf("*");
    const captured = star === -1 ? "" : specifier.slice(star, specifier.length - (pattern.length - star - 1));
    const base = options.baseUrl ?? (config.file ? path.dirname(config.file) : this.root);
    const candidates = (options.paths?.[pattern] ?? []).map((target) =>
      path.resolve(base, target.replace("*", captured)),
    );
    const existing = candidates.find((candidate) => existsSync(candidate));
    if (existing) return this.explainMissingPath(existing, specifier);
    return {
      outcome: "unresolved",
      reason: "alias-without-target",
      detail: `matches "${pattern}" in ${this.configName(config)}, but nothing exists at ${candidates.map((c) => toRelative(this.root, c)).join(" or ")}`,
    };
  }

  // A workspace package is resolvable only through node_modules links, which
  // a fresh clone doesn't have. Resolve its subpath as a relative path inside
  // the package directory instead; that honours the package's own main/types.
  private resolveWorkspace(
    specifier: string,
    packageDir: string,
    options: ts.CompilerOptions,
  ): Resolution {
    const name = packageNameOf(specifier);
    const subpath = specifier.slice(name.length);
    // Resolved as if from a file at the package root, so "." means the
    // package directory itself and its package.json picks the entry.
    const fromPackageRoot = path.join(packageDir, "index.ts");
    const relativeSpecifier = subpath ? "." + subpath : ".";
    const result = ts.resolveModuleName(relativeSpecifier, fromPackageRoot, options, ts.sys, this.cache);
    const resolved = result.resolvedModule?.resolvedFileName;
    if (resolved) return this.classifyFile(path.resolve(resolved), specifier);

    // Usually the entry is build output the clone doesn't contain. Mapping it
    // back to source would be a guess, so say what it points at instead.
    const declared = declaredEntries(path.join(packageDir, "package.json"), subpath);
    // Directory resolution ignores the exports map. Each declared entry is
    // resolved as the relative path it is, so `./src/a.js` finds `src/a.ts`
    // exactly as it would written as a relative import.
    for (const entry of declared) {
      const relative = entry.startsWith("./") || entry.startsWith("../") ? entry : "./" + entry;
      const viaEntry = ts.resolveModuleName(relative, fromPackageRoot, options, ts.sys, this.cache);
      const file = viaEntry.resolvedModule?.resolvedFileName;
      if (file) return this.classifyFile(path.resolve(file), specifier);
    }
    const where = toRelative(this.root, packageDir) || ".";
    return {
      outcome: "unresolved",
      reason: "workspace-package-without-entry",
      detail:
        declared.length > 0
          ? `${name} is the package at ${where}; its package.json points "${"." + subpath}" at ${declared.join(", ")}, none of which exists (build output not in the repository?)`
          : `${name} is the package at ${where}, and its package.json declares no entry for "${"." + subpath}"`,
    };
  }

  private configName(config: Config): string {
    return config.file ? toRelative(this.root, config.file) : "default options";
  }

  private configFor(fileAbsolute: string): Config {
    const configFile = this.nearestConfig(path.dirname(fileAbsolute));
    if (!configFile) return { options: DEFAULT_OPTIONS, file: null };
    const parsed = this.parseConfig(configFile);

    // Solution-style configs (`files: []` plus references, as Vite templates
    // ship) keep the real options in whichever referenced config owns the file.
    for (const reference of parsed.projectReferences ?? []) {
      const referencePath = ts.resolveProjectReferencePath(reference);
      if (!existsSync(referencePath)) continue;
      const referenced = this.parseConfig(referencePath);
      if (referenced.fileNames.some((name) => path.resolve(name) === fileAbsolute)) {
        return { options: referenced.options, file: referencePath };
      }
    }
    return { options: parsed.options, file: configFile };
  }

  private nearestConfig(dir: string): string | null {
    const cached = this.configByDir.get(dir);
    if (cached !== undefined) return cached;
    let found: string | null = null;
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) {
        found = candidate;
        break;
      }
    }
    if (!found && dir !== this.root && dir.startsWith(this.root)) {
      found = this.nearestConfig(path.dirname(dir));
    }
    this.configByDir.set(dir, found);
    return found;
  }

  private parseConfig(configFile: string): ts.ParsedCommandLine {
    const cached = this.parsedConfigs.get(configFile);
    if (cached) return cached;
    // Errors (an `extends` naming an uninstalled package, say) still leave
    // usable options behind, and resolution failures that follow from them
    // are reported per import.
    const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config ?? {}, ts.sys, path.dirname(configFile));
    this.parsedConfigs.set(configFile, parsed);
    return parsed;
  }
}

function readPackageJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed));
    }
  } catch {
    // An unparseable package.json names no package and no entry.
  }
  return null;
}

function readPackageName(file: string): string | null {
  const name = readPackageJson(file)?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringLeaves);
  return [];
}

// The files a package.json names for a subpath ("" for the package root),
// exactly as written: the exports entry if there is one, else main/types.
function declaredEntries(file: string, subpath: string): string[] {
  const json = readPackageJson(file);
  if (!json) return [];
  const key = "." + subpath;
  const exports = json.exports;
  if (typeof exports === "object" && exports !== null && !Array.isArray(exports)) {
    const entries = Object.fromEntries(Object.entries(exports));
    const conditionKeys = Object.keys(entries).every((k) => !k.startsWith("."));
    if (conditionKeys) return key === "." ? [...new Set(stringLeaves(exports))] : [];
    if (key in entries) return [...new Set(stringLeaves(entries[key]))];
    // Subpath patterns: "./*" or "./utils/*.js", one star, substituted as-is.
    for (const [pattern, target] of Object.entries(entries)) {
      const star = pattern.indexOf("*");
      if (star === -1 || !matchesPathPattern(pattern, key)) continue;
      const captured = key.slice(star, key.length - (pattern.length - star - 1));
      return [...new Set(stringLeaves(target).map((leaf) => leaf.replace("*", captured)))];
    }
    return [];
  }
  if (typeof exports === "string") return key === "." ? [exports] : [];
  if (key !== ".") return [];
  return [...new Set([json.main, json.types, json.typings, json.module].flatMap(stringLeaves))];
}
