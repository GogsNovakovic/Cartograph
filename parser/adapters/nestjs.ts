// NestJS: roles from the filename suffixes the Nest CLI generates, and routes
// assembled from the controller's decorator and the method's together.

import { ts } from "ts-morph";
import type { Route, RouteMethod } from "../types.ts";
import {
  dependents,
  innermost,
  lineOf,
  literal,
  namedImports,
  nodes,
  stem,
  type FrameworkAdapter,
  type RepositoryContext,
  type Role,
} from "./shared.ts";

// "users.controller.ts" → controller. The suffix is the convention; nothing
// about the file's contents is assumed from it.
const SUFFIXES: Record<string, string> = {
  controller: "controller",
  resolver: "resolver",
  gateway: "gateway",
  service: "service",
  repository: "repository",
  module: "module",
  entity: "entity",
  schema: "schema",
  dto: "DTO",
  guard: "guard",
  interceptor: "interceptor",
  pipe: "pipe",
  filter: "filter",
  middleware: "middleware",
  strategy: "strategy",
  decorator: "decorator",
};

const METHOD_DECORATORS: Record<string, RouteMethod> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
  Head: "HEAD",
  Options: "OPTIONS",
  Search: "SEARCH",
  All: "ALL",
};

const COMMON = "@nestjs/common";

// Options on @Controller({...}) that leave the path alone. Any other option
// (host, version) changes how the route is matched, so the controller's
// routes are left out.
const PATH_NEUTRAL_OPTIONS = new Set(["path", "scope", "durable"]);

function apps(repository: RepositoryContext): string[] {
  return dependents(repository, "@nestjs/core");
}

// A decorator argument naming paths: none means the empty path, a literal
// or a list of literals means those. Null for anything else.
function paths(argument: ts.Expression | undefined): string[] | null {
  if (argument === undefined) return [""];
  const single = literal(argument);
  if (single !== null) return [single];
  if (ts.isArrayLiteralExpression(argument)) {
    const all = argument.elements.map((element) => literal(element));
    return all.every((path): path is string => path !== null) ? all : null;
  }
  return null;
}

function controllerPaths(call: ts.CallExpression): string[] | null {
  const [argument] = call.arguments;
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) return paths(argument);
  let found: string[] = [""];
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return null;
    if (!PATH_NEUTRAL_OPTIONS.has(property.name.text)) return null;
    if (property.name.text === "path") {
      const written = paths(property.initializer);
      if (written === null) return null;
      found = written;
    }
  }
  return found;
}

// A decorator called as @Name(...), with Name imported from @nestjs/common
// under any local alias. Returns the exported name and the call.
function commonDecorator(
  decorator: ts.Decorator,
  imported: ReadonlyMap<string, string>,
): { name: string; call: ts.CallExpression } | null {
  const call = decorator.expression;
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return null;
  const name = imported.get(call.expression.text);
  return name === undefined ? null : { name, call };
}

// Nest joins the prefix, the controller path and the method path with
// single slashes and no trailing one.
function joinPath(...parts: string[]): string {
  const segments = parts.flatMap((part) => part.split("/")).filter((segment) => segment !== "");
  return "/" + segments.join("/");
}

function methodCall(node: ts.Node, method: string): ts.CallExpression | null {
  return ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === method
    ? node
    : null;
}

// What the app's bootstrap does to every path. Null when it does something
// the syntax can't settle: a computed prefix, two different prefixes, a
// prefix with exclusions, versioning, or RouterModule's module-level paths.
// The same literal set twice (a committed build beside its source) is still
// one exact prefix.
function appPrefix(sources: readonly ts.SourceFile[]): string | null {
  const prefixes: string[] = [];
  for (const source of sources) {
    for (const node of nodes(source)) {
      if (methodCall(node, "enableVersioning")) return null;
      if (ts.isIdentifier(node) && node.text === "RouterModule") return null;
      const call = methodCall(node, "setGlobalPrefix");
      if (!call) continue;
      const written = literal(call.arguments[0]);
      if (written === null || call.arguments.length > 1) return null;
      prefixes.push(written);
    }
  }
  if (new Set(prefixes).size > 1) return null;
  return prefixes[0] ?? "";
}

function controllerRoutes(file: string, source: ts.SourceFile, prefix: string): Route[] {
  const imported = namedImports(source, COMMON);
  if (imported.size === 0) return [];
  const routes: Route[] = [];
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const decorators = ts.getDecorators(statement) ?? [];
    const controller = decorators
      .map((decorator) => commonDecorator(decorator, imported))
      .find((found) => found?.name === "Controller");
    if (!controller) continue;
    const bases = controllerPaths(controller.call);
    if (bases === null) continue;

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const found = (ts.getDecorators(member) ?? []).flatMap((decorator) => {
        const match = commonDecorator(decorator, imported);
        return match ? [{ ...match, decorator }] : [];
      });
      // A per-method version changes the path it's served at.
      if (found.some(({ name }) => name === "Version")) continue;
      for (const { name, call, decorator } of found) {
        const method = METHOD_DECORATORS[name];
        if (!method) continue;
        const written = paths(call.arguments[0]);
        if (written === null) continue;
        for (const base of bases) {
          for (const path of written) {
            routes.push({ file, line: lineOf(source, decorator), method, path: joinPath(prefix, base, path) });
          }
        }
      }
    }
  }
  return routes;
}

export const nestjs: FrameworkAdapter = {
  name: "nestjs",
  detect: (repository) => apps(repository).length > 0,

  roles(repository) {
    const dirs = apps(repository);
    const roles = new Map<string, Role>();
    for (const file of repository.paths) {
      if (innermost(dirs, file) === null) continue;
      const suffix = stem(file).split(".").pop() ?? "";
      const role = stem(file).includes(".") ? SUFFIXES[suffix] : undefined;
      if (role) {
        roles.set(file, { role, entry: false });
        continue;
      }
      // The bootstrap is what Nest starts from: the file that creates the
      // app. Read from the call, not from being called main.ts.
      const source = repository.source(file)?.compilerNode;
      if (source && [...nodes(source)].some((node) => methodCall(node, "create")?.expression.getText(source) === "NestFactory.create")) {
        roles.set(file, { role: "bootstrap", entry: true });
      }
    }
    return roles;
  },

  routes(repository) {
    const dirs = apps(repository);
    const byApp = new Map<string, Array<{ file: string; source: ts.SourceFile }>>();
    for (const file of repository.paths) {
      const app = innermost(dirs, file);
      const source = repository.source(file)?.compilerNode;
      if (app === null || !source) continue;
      const files = byApp.get(app) ?? [];
      files.push({ file, source });
      byApp.set(app, files);
    }
    const routes: Route[] = [];
    for (const files of byApp.values()) {
      const prefix = appPrefix(files.map(({ source }) => source));
      if (prefix === null) continue;
      for (const { file, source } of files) routes.push(...controllerRoutes(file, source, prefix));
    }
    return routes;
  },
};
