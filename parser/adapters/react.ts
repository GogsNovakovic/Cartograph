// React: which files are components, which are hooks, and which file mounts
// the app. All three are read from the file itself, not guessed from where
// it sits. React has no routes of its own, so none are produced.

import { ts } from "ts-morph";
import {
  dependents,
  inside,
  literal,
  nodes,
  stem,
  type FrameworkAdapter,
  type RepositoryContext,
  type Role,
} from "./shared.ts";

// Tests and stories render components without being them.
const NOT_A_COMPONENT = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;

// React's own rule: a hook's name starts with "use" and a capital.
const HOOK = /^use[A-Z0-9]/;

function hasJsx(source: ts.SourceFile): boolean {
  for (const node of nodes(source)) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  }
  return false;
}

// Components and hooks among the files under `dirs`. Shared with any
// framework built on React; these describe a file, they don't load it, so
// a component nothing imports is still reported as unimported.
export function componentsAndHooks(repository: RepositoryContext, dirs: readonly string[]): Map<string, Role> {
  const roles = new Map<string, Role>();
  for (const file of repository.paths) {
    if (!dirs.some((dir) => inside(dir, file) !== null) || NOT_A_COMPONENT.test(file)) continue;
    if (HOOK.test(stem(file))) {
      roles.set(file, { role: "hook", entry: false });
      continue;
    }
    // JSX can't appear in a .ts file; any other extension may hold it.
    if (/\.[cm]?ts$/.test(file)) continue;
    const source = repository.source(file)?.compilerNode;
    if (source && hasJsx(source)) roles.set(file, { role: "component", entry: false });
  }
  return roles;
}

const MOUNTS = new Set(["createRoot", "hydrateRoot", "render", "hydrate"]);
const DOM_MODULES = ["react-dom/client", "react-dom"];

// The file that hands the tree to the DOM: a call to createRoot, hydrateRoot
// or the older render/hydrate, imported from react-dom itself. A bare
// `render(` is everywhere in tests, so the import is what makes it count.
function mountsApp(source: ts.SourceFile): boolean {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = literal(statement.moduleSpecifier);
    if (from === null || !DOM_MODULES.includes(from)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) namespaces.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (MOUNTS.has((element.propertyName ?? element.name).text)) direct.add(element.name.text);
      }
    }
  }
  if (direct.size === 0 && namespaces.size === 0) return false;
  for (const node of nodes(source)) {
    if (!ts.isCallExpression(node)) continue;
    const callee = node.expression;
    if (ts.isIdentifier(callee) && direct.has(callee.text)) return true;
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      namespaces.has(callee.expression.text) &&
      MOUNTS.has(callee.name.text)
    ) {
      return true;
    }
  }
  return false;
}

export const react: FrameworkAdapter = {
  name: "react",
  detect: (repository) => dependents(repository, "react").length > 0,
  roles(repository) {
    const dirs = dependents(repository, "react");
    const roles = new Map<string, Role>();
    for (const file of repository.paths) {
      if (!dirs.some((dir) => inside(dir, file) !== null)) continue;
      const source = repository.source(file)?.compilerNode;
      if (source && mountsApp(source)) roles.set(file, { role: "app entry", entry: true });
    }
    for (const [file, role] of componentsAndHooks(repository, dirs)) if (!roles.has(file)) roles.set(file, role);
    return roles;
  },
  routes: () => [],
};
