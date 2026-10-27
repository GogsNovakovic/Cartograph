// What every adapter is handed, and the small path and syntax helpers they
// share. Nothing framework-specific lives here.

import { readFileSync } from "node:fs";
import path from "node:path";
import { ts, type SourceFile } from "ts-morph";
import type { Route } from "../types.ts";

export type RepositoryContext = {
  root: string;
  // Relative paths of every source file the walk found.
  paths: readonly string[];
  // Relative paths of every package.json the walk found.
  packageJsons: readonly string[];
  // The parsed syntax of a file, or undefined when it was skipped: a
  // skipped file can't be described by what's written in it.
  source(file: string): SourceFile | undefined;
};

// What a file is to a framework or tool, and whether that tool loads it
// itself rather than waiting for something to import it.
export type Role = { role: string; entry: boolean };

// Knows one framework. Detection decides whether the repository uses it at
// all; only the first framework detected is asked for roles and routes.
export type FrameworkAdapter = {
  name: string;
  detect(repository: RepositoryContext): boolean;
  roles(repository: RepositoryContext): Map<string, Role>;
  routes(repository: RepositoryContext): Route[];
};

// Knows one tool that can sit beside any framework: a bundler, a test
// runner, a config file convention. Asked in every repository.
export type ToolAdapter = {
  name: string;
  roles(repository: RepositoryContext): Map<string, Role>;
};

export const posix = path.posix;

// "page.tsx" → "page", "next.config.mjs" → "next.config".
export function stem(file: string): string {
  const base = posix.basename(file);
  return base.slice(0, base.length - posix.extname(base).length);
}

export function folderOf(file: string): string {
  return posix.dirname(file);
}

// The path relative to `dir`, or null when it isn't inside it.
export function inside(dir: string, file: string): string | null {
  if (dir === ".") return file;
  return file.startsWith(dir + "/") ? file.slice(dir.length + 1) : null;
}

// A path written relative to `dir` in some config, as a repository path.
export function join(dir: string, written: string): string {
  return posix.normalize(posix.join(dir, written.replace(/^\//, "")));
}

export function readText(root: string, file: string): string | null {
  try {
    return readFileSync(path.join(root, file), "utf8");
  } catch {
    return null;
  }
}

// Directories holding a `<name>.config.*` source file, with that file.
export function configs(paths: readonly string[], name: string): Array<{ dir: string; config: string }> {
  return paths.filter((p) => stem(p) === `${name}.config`).map((config) => ({ dir: folderOf(config), config }));
}

// Directories whose package.json lists `dependency` among its dependencies
// or devDependencies. Each is the root of an app using it.
export function dependents(repository: RepositoryContext, dependency: string): string[] {
  return repository.packageJsons.flatMap((manifest) => {
    const text = readText(repository.root, manifest);
    if (text === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    if (typeof parsed !== "object" || parsed === null) return [];
    const lists = [
      "dependencies" in parsed ? parsed.dependencies : undefined,
      "devDependencies" in parsed ? parsed.devDependencies : undefined,
    ];
    const listed = lists.some((list) => typeof list === "object" && list !== null && dependency in list);
    return listed ? [folderOf(manifest)] : [];
  });
}

// The deepest of `dirs` that contains `file`, or null.
export function innermost(dirs: readonly string[], file: string): string | null {
  let best: string | null = null;
  for (const dir of dirs) {
    if (inside(dir, file) !== null && (best === null || dir.length > best.length)) best = dir;
  }
  return best;
}

// A string written literally: 'x', "x" or `x` with no substitutions. Null
// for anything that would have to be evaluated.
export function literal(node: ts.Node | undefined): string | null {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text;
  return null;
}

export function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

// Every node in the file, depth first. The raw compiler tree rather than
// ts-morph's wrappers, for the same cost reason as reading imports.
export function* nodes(root: ts.Node): Generator<ts.Node> {
  const stack: ts.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) return;
    yield node;
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

// Local names bound by `import { a, b as c } from "<module>"`, mapped to
// the name the module exports them as.
export function namedImports(source: ts.SourceFile, module: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || literal(statement.moduleSpecifier) !== module) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      names.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  return names;
}

// A `"use server"`-style directive: a string statement at the very top of a
// file or a function body.
export function hasDirective(statements: ts.NodeArray<ts.Statement>, directive: string): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === directive) return true;
  }
  return false;
}

// Adds roles without replacing one already set.
export function claim(into: Map<string, Role>, from: Map<string, Role>): void {
  for (const [file, role] of from) if (!into.has(file)) into.set(file, role);
}
