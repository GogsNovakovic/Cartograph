import type { NextRequest } from "next/server";
import { verifyCredential } from "@/lib/agent/credential";
import {
  filesWithRole,
  lookup,
  neighbours,
  overview,
  routeTable,
  searchFiles,
  walkFrom,
  type Lookup,
} from "@/lib/map/questions";
import { readStoredResult } from "@/lib/stored-result";
import { getSupabaseAsAgent } from "@/lib/supabase";

// The agent's six lookups, read-only. No signed-in user: each request carries
// a credential naming one analysis, and every read is made with it, so the
// policies (not this code) decide what it can see. The request body holds the
// agent's arguments and nothing else; which analysis is read is never one of
// them.

type Args = Record<string, unknown>;

type Answer = { ok: true; value: unknown } | { ok: false; message: string };

function text(args: Args, name: string): string | null {
  const value = args[name];
  return typeof value === "string" ? value : null;
}

const LOOKUPS: Record<string, (map: Lookup, args: Args) => Answer> = {
  overview: (map) => ({ ok: true, value: overview(map) }),
  search: (map, args) => {
    const query = text(args, "text");
    return query === null ? { ok: false, message: "search needs `text`." } : { ok: true, value: searchFiles(map, query) };
  },
  role: (map, args) => {
    const role = text(args, "role");
    return role === null ? { ok: false, message: "role needs `role`." } : { ok: true, value: filesWithRole(map, role) };
  },
  neighbours: (map, args) => {
    const path = text(args, "path");
    return path === null ? { ok: false, message: "neighbours needs `path`." } : { ok: true, value: neighbours(map, path) };
  },
  walk: (map, args) => {
    const path = text(args, "path");
    const direction = text(args, "direction");
    if (path === null) return { ok: false, message: "walk needs `path`." };
    if (direction !== "dependents" && direction !== "dependencies") {
      return { ok: false, message: "walk needs `direction`: dependents or dependencies." };
    }
    return { ok: true, value: walkFrom(map, path, direction) };
  },
  routes: (map) => ({ ok: true, value: routeTable(map) }),
};

const refuse = (status: number, message: string) => Response.json({ error: message }, { status });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/agent/[lookup]">) {
  const { lookup: name } = await ctx.params;
  const answer = Object.hasOwn(LOOKUPS, name) ? LOOKUPS[name] : undefined;
  if (!answer) return refuse(404, `There is no lookup called ${name}.`);

  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return refuse(401, "No credential.");
  const verified = verifyCredential(token);
  if (!verified.ok) return refuse(401, verified.message);

  let args: unknown;
  try {
    args = await request.json();
  } catch {
    return refuse(400, "The arguments aren't JSON.");
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return refuse(400, "The arguments aren't an object.");

  const db = getSupabaseAsAgent(token);
  const { data: analysis, error } = await db
    .from("analyses")
    .select("id, project:projects (owner, name)")
    .eq("id", verified.scope.analysisId)
    .maybeSingle();
  if (error) return refuse(500, `Reading the analysis failed: ${error.message}`);
  // Hidden by the policies reads the same as absent.
  if (!analysis) return refuse(404, "The analysis this credential names isn't there.");

  const stored = await readStoredResult(db, analysis.id, analysis.project);
  if (!stored.ok) return refuse(409, stored.message);

  const result = answer(lookup(stored.result, { roles: stored.suggested, failure: stored.classificationFailure }), Object.fromEntries(Object.entries(args)));
  return result.ok ? Response.json(result.value) : refuse(400, result.message);
}
