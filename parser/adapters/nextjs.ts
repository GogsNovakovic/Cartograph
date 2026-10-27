// Next.js: roles from the file conventions in Next's own docs, server
// actions from the "use server" directive, and routes from route handlers.
// Every bit of Next knowledge in the parser is in this file.

import { ts } from "ts-morph";
import { ROUTE_METHODS, type Route, type RouteMethod } from "../types.ts";
import { componentsAndHooks } from "./react.ts";
import {
  configs,
  dependents,
  folderOf,
  hasDirective,
  inside,
  lineOf,
  literal,
  nodes,
  stem,
  type FrameworkAdapter,
  type RepositoryContext,
  type Role,
} from "./shared.ts";

// App Router files, by name.
const SEGMENT_FILES: Record<string, string> = {
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
const ROOT_FILES: Record<string, string> = {
  proxy: "proxy",
  middleware: "middleware",
  instrumentation: "instrumentation",
  "instrumentation-client": "instrumentation",
  "mdx-components": "MDX components",
};

// A Next app is wherever a next.config sits or a package.json depends on
// next (the config is optional), so an app inside a monorepo counts.
function apps(repository: RepositoryContext): string[] {
  const dirs = new Set([...configs(repository.paths, "next").map(({ dir }) => dir), ...dependents(repository, "next")]);
  return [...dirs];
}

// Where the App Router lives in an app: app/, or src/app/ when there's no
// app/ at the root, which is the order Next itself checks.
function appRouterOf(repository: RepositoryContext, dir: string): string {
  const atRoot = repository.paths.some((file) => inside(dir, file)?.startsWith("app/"));
  return atRoot ? "app/" : "src/app/";
}

function pagesRouterOf(repository: RepositoryContext, dir: string): string {
  const atRoot = repository.paths.some((file) => inside(dir, file)?.startsWith("pages/"));
  return atRoot ? "pages/" : "src/pages/";
}

// Folders starting with an underscore are private: nothing in them routes.
function isPrivate(segments: readonly string[]): boolean {
  return segments.some((segment) => segment.startsWith("_"));
}

function hasServerActions(source: ts.SourceFile): boolean {
  if (hasDirective(source.statements, "use server")) return true;
  for (const node of nodes(source)) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      hasDirective(node.body.statements, "use server")
    ) {
      return true;
    }
  }
  return false;
}

// The URL prefix every route in the app gets, read from next.config: "" with
// no basePath, the literal when it's written as one. Null when any option
// that reshapes URLs is present and can't be applied exactly — then no
// route is emitted rather than one that might be wrong.
function urlPrefix(repository: RepositoryContext, dir: string): string | null {
  const config = configs(repository.paths, "next").find((found) => found.dir === dir);
  if (!config) return "";
  const source = repository.source(config.config)?.compilerNode;
  // A config that couldn't be read could say anything.
  if (!source) return null;

  let basePath = "";
  let basePaths = 0;
  for (const node of nodes(source)) {
    // A spread could carry any option in from elsewhere. Spreads inside a
    // function are skipped: those are hooks like webpack(config) building
    // their own objects, not the config itself.
    if (ts.isSpreadAssignment(node) && !insideFunction(node)) return null;
    if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) continue;
    const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
    if (name === null) continue;
    const value = ts.isPropertyAssignment(node) ? node.initializer : undefined;
    if (name === "basePath") {
      const written = literal(value);
      if (written === null) return null;
      basePath = written;
      basePaths++;
    }
    // Locales prefix every path; other page extensions change what a route
    // file is; a trailing slash changes every pattern.
    if (name === "i18n" || name === "pageExtensions") return null;
    if (name === "trailingSlash" && value?.kind !== ts.SyntaxKind.FalseKeyword) return null;
  }
  return basePaths > 1 ? null : basePath.replace(/\/+$/, "");
}

function insideFunction(node: ts.Node): boolean {
  for (let at = node.parent; at; at = at.parent) if (ts.isFunctionLike(at)) return true;
  return false;
}

// The URL a route handler serves, from the folders above it. Route groups
// "(name)" don't appear in the URL; dynamic segments are kept as Next writes
// them. A parallel slot "@name", an intercepting "(.)" segment or an escaped
// name changes how the URL is matched in ways the path alone doesn't fix,
// so those produce nothing.
function pattern(segments: readonly string[]): string | null {
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith("@") || segment.startsWith("(.") || segment.includes("%")) return null;
    if (segment.startsWith("(") && segment.endsWith(")")) continue;
    kept.push(segment);
  }
  return "/" + kept.join("/");
}

function isMethod(name: string): name is Exclude<RouteMethod, "SEARCH" | "ALL"> {
  return name !== "SEARCH" && name !== "ALL" && ROUTE_METHODS.some((method) => method === name);
}

// The HTTP methods a route handler exports, by the names it exports them
// under: `export function GET`, `export const POST =`, `export { x as PUT }`.
function exportedMethods(source: ts.SourceFile): Array<{ method: RouteMethod; line: number }> {
  const found: Array<{ method: RouteMethod; line: number }> = [];
  const exported = (node: ts.Node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && exported(statement) && statement.name && isMethod(statement.name.text)) {
      found.push({ method: statement.name.text, line: lineOf(source, statement) });
    } else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isMethod(declaration.name.text)) {
          found.push({ method: declaration.name.text, line: lineOf(source, declaration) });
        }
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (isMethod(element.name.text)) found.push({ method: element.name.text, line: lineOf(source, element) });
      }
    }
  }
  return found;
}

export const nextjs: FrameworkAdapter = {
  name: "nextjs",
  detect: (repository) => apps(repository).length > 0,

  roles(repository) {
    const roles = new Map<string, Role>();
    const dirs = apps(repository);
    for (const { config } of configs(repository.paths, "next")) roles.set(config, { role: "config", entry: true });
    for (const dir of dirs) {
      const appRouter = appRouterOf(repository, dir);
      const pagesRouter = pagesRouterOf(repository, dir);
      for (const file of repository.paths) {
        const relative = inside(dir, file);
        if (relative === null || roles.has(file)) continue;
        const name = stem(file);
        if (relative.startsWith(appRouter)) {
          const role = SEGMENT_FILES[name];
          const segments = folderOf(relative.slice(appRouter.length)).split("/");
          if (role && !isPrivate(segments)) roles.set(file, { role, entry: true });
        } else if (relative.startsWith(pagesRouter)) {
          // Underscore files here are _app and _document: Next loads them too.
          const within = relative.slice(pagesRouter.length);
          roles.set(file, { role: within.startsWith("api/") ? "API route" : "page", entry: true });
        } else if (!relative.replace(/^src\//, "").includes("/") && ROOT_FILES[name]) {
          roles.set(file, { role: ROOT_FILES[name], entry: true });
        }
      }
    }
    // A file of server actions is imported by the forms that call it, so
    // this describes it without making it an entry.
    for (const file of repository.paths) {
      if (roles.has(file) || !dirs.some((dir) => inside(dir, file) !== null)) continue;
      const source = repository.source(file)?.compilerNode;
      if (source && hasServerActions(source)) roles.set(file, { role: "server actions", entry: false });
    }
    for (const [file, role] of componentsAndHooks(repository, dirs)) if (!roles.has(file)) roles.set(file, role);
    return roles;
  },

  // Route handlers only. A page answers GET by Next's rules, but nothing in
  // the page says so; a pages/api handler picks its method at runtime. Both
  // are counted as files in the rail, never listed as routes.
  routes(repository) {
    const routes: Route[] = [];
    for (const dir of apps(repository)) {
      const prefix = urlPrefix(repository, dir);
      if (prefix === null) continue;
      const appRouter = appRouterOf(repository, dir);
      for (const file of repository.paths) {
        const relative = inside(dir, file);
        if (relative === null || !relative.startsWith(appRouter) || stem(file) !== "route") continue;
        const folder = folderOf(relative.slice(appRouter.length));
        const segments = folder === "." ? [] : folder.split("/");
        if (isPrivate(segments)) continue;
        const path = pattern(segments);
        const source = repository.source(file)?.compilerNode;
        if (path === null || !source) continue;
        for (const { method, line } of exportedMethods(source)) {
          routes.push({ file, line, method, path: (prefix + path).replace(/\/+$/, "") || "/" });
        }
      }
    }
    return routes;
  },
};
