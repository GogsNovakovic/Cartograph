// Framework and tooling knowledge lives behind these adapters and nowhere
// else. The parser asks them questions; it never checks which framework it's
// looking at.

import type { Route } from "../types.ts";
import { express } from "./express.ts";
import { nestjs } from "./nestjs.ts";
import { nextjs } from "./nextjs.ts";
import { react } from "./react.ts";
import { claim, type FrameworkAdapter, type RepositoryContext, type Role } from "./shared.ts";
import { TOOLS } from "./tools.ts";

export type { RepositoryContext } from "./shared.ts";

// Detection order. The first framework that matches is the repository's;
// the rest aren't asked. Next before React, because every Next app also
// depends on React. Next and Nest before Express, because either can run on
// an Express server. Express before React: a package depending on both is a
// server that renders React, and its layout is the server's.
const FRAMEWORKS: readonly FrameworkAdapter[] = [nextjs, nestjs, express, react];

export type Adapted = {
  framework: string | null;
  // The adapters that named at least one file, framework first.
  adapters: string[];
  roles: Map<string, Role>;
  routes: Route[];
};

// A framework's convention for what it loads beats a tool's, and a tool's
// beats a framework's description of what a file is: a test that renders
// JSX is a test before it's a component.
export function adapt(repository: RepositoryContext): Adapted {
  const framework = FRAMEWORKS.find((adapter) => adapter.detect(repository)) ?? null;
  const frameworkRoles = framework?.roles(repository) ?? new Map<string, Role>();
  const adapters = framework ? [framework.name] : [];
  const roles = new Map<string, Role>();

  claim(roles, new Map([...frameworkRoles].filter(([, role]) => role.entry)));
  for (const tool of TOOLS) {
    const named = tool.roles(repository);
    if (named.size > 0) adapters.push(tool.name);
    claim(roles, named);
  }
  claim(roles, frameworkRoles);

  const routes = (framework?.routes(repository) ?? []).sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.method < b.method ? -1 : a.method > b.method ? 1 : 0),
  );
  return { framework: framework?.name ?? null, adapters, roles, routes };
}
