import { tool } from "langchain";
import type { ManagedToolRuntime } from "managed-deepagents";
import { z } from "zod";

// The six lookups. Each one forwards the agent's arguments to Cartograph,
// which answers from the same map the canvas draws; nothing is worked out
// here. The agent chooses a file and a direction, never an analysis.

// Which analysis is read lives only in the credential, handed to each run as
// context by whoever opened the conversation. Context never reaches the
// model, so nothing the model reads (including a comment in the code it's
// looking at) can point a lookup at another analysis.
export const contextSchema = z.object({ credential: z.string().min(1) });

type Runtime = ManagedToolRuntime<unknown, z.infer<typeof contextSchema>>;

// Every failure comes back as text the agent passes on, so a lookup that
// didn't happen reads as one rather than as an empty answer.
async function ask(lookup: string, args: Record<string, string>, runtime: Runtime): Promise<string> {
  const credential = runtime.context?.credential;
  if (!credential) return "Lookup failed: no analysis is attached to this conversation.";
  const base = process.env.CARTOGRAPH_URL?.trim();
  if (!base) return "Lookup failed: CARTOGRAPH_URL isn't set for the agent.";
  try {
    const response = await fetch(new URL(`/api/agent/${lookup}`, base), {
      method: "POST",
      headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = await response.text();
    return response.ok ? body : `Lookup failed (${response.status}): ${body}`;
  } catch (error) {
    return `Lookup failed: Cartograph couldn't be reached (${error instanceof Error ? error.message : String(error)}).`;
  }
}

const path = z.string().describe("The file's exact path from the repository root, as an earlier lookup returned it.");

export const overview = tool((_, runtime: Runtime) => ask("overview", {}, runtime), {
  name: "overview",
  description:
    "The repository as a whole: framework, file and import counts, every role in use with how many files have it, the most-imported files, files nothing imports, how many routes there are, and how much of the import graph the parser recovered. Start here when you don't yet know what's in the repository.",
  schema: z.object({}),
});

export const searchFiles = tool(({ text }, runtime: Runtime) => ask("search", { text }, runtime), {
  name: "search_files",
  description:
    "Files whose path contains the text, ignoring case. Paths only: this does not search file contents. Try several short words (auth, session, login) rather than one long phrase.",
  schema: z.object({ text: z.string().describe("Part of a path, such as a folder or file name.") }),
});

export const filesWithRole = tool(({ role }, runtime: Runtime) => ask("role", { role }, runtime), {
  name: "files_with_role",
  description:
    "Files with a role, by its exact name as the overview lists it (page, route handler, controller, service…). Roles named by framework convention and roles a model suggested are returned separately.",
  schema: z.object({ role: z.string().describe("A role name exactly as the overview lists it.") }),
});

export const neighbours = tool(({ path }, runtime: Runtime) => ask("neighbours", { path }, runtime), {
  name: "neighbours",
  description: "One step out from a file: the files it imports and the files that import it.",
  schema: z.object({ path }),
});

export const walk = tool(({ path, direction }, runtime: Runtime) => ask("walk", { path, direction }, runtime), {
  name: "walk",
  description:
    "Everything reached from a file through imports, two levels deep. 'dependents' is what imports it, directly or not: what a change to it could break. 'dependencies' is what it imports, directly or not: what it needs.",
  schema: z.object({
    path,
    direction: z.enum(["dependents", "dependencies"]),
  }),
});

export const routes = tool((_, runtime: Runtime) => ask("routes", {}, runtime), {
  name: "routes",
  description:
    "Every route the parser read exactly: method, full path pattern, and the file and line that declare it. A route whose method or path couldn't be read exactly is not listed.",
  schema: z.object({}),
});
