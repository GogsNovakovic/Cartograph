// Express: roles from the folders a file sits in. Express itself imposes no
// layout, so these are the community's conventions, accepted in singular and
// plural because real repositories use both ("routes/" and "route/").
//
// No routes. Express assembles them at runtime from routers, variables and
// middleware chains mounted on each other; the syntax of one file rarely
// holds a full pattern, and a route that needs guessing isn't emitted.

import {
  dependents,
  folderOf,
  innermost,
  inside,
  type FrameworkAdapter,
  type RepositoryContext,
  type Role,
} from "./shared.ts";

// Folder name (singular, then plural) → role. Every role describes a file;
// none is loaded by Express itself, so none is an entry.
const FOLDERS: ReadonlyArray<[singular: string, plural: string, role: string]> = [
  ["route", "routes", "router"],
  ["router", "routers", "router"],
  ["controller", "controllers", "controller"],
  ["middleware", "middlewares", "middleware"],
  ["service", "services", "service"],
  ["model", "models", "model"],
  ["repository", "repositories", "repository"],
  ["validation", "validations", "validator"],
  ["validator", "validators", "validator"],
  ["config", "configs", "config"],
  ["util", "utils", "utility"],
  ["helper", "helpers", "utility"],
];

const ROLE_OF = new Map(FOLDERS.flatMap(([singular, plural, role]) => [[singular, role], [plural, role]] as const));

function apps(repository: RepositoryContext): string[] {
  return dependents(repository, "express");
}

export const express: FrameworkAdapter = {
  name: "express",
  detect: (repository) => apps(repository).length > 0,

  // The deepest conventional folder wins: src/models/plugins/paginate.js is
  // a model's plugin, so it sits with the models.
  roles(repository) {
    const dirs = apps(repository);
    const roles = new Map<string, Role>();
    for (const file of repository.paths) {
      const app = innermost(dirs, file);
      if (app === null) continue;
      const relative = inside(app, file);
      if (relative === null) continue;
      const folder = folderOf(relative);
      if (folder === ".") continue;
      const role = folder
        .split("/")
        .reverse()
        .map((segment) => ROLE_OF.get(segment))
        .find((found) => found !== undefined);
      if (role) roles.set(file, { role, entry: false });
    }
    return roles;
  },

  routes: () => [],
};
