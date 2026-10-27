import { randomUUID } from "node:crypto";
import type { Database } from "../database.types.ts";
import type { ParseResult } from "../../parser/types.ts";
import type { Writer } from "./writer.ts";

type Tables = Database["public"]["Tables"];

// Comfortably under the request size limit for a row of paths, and few enough
// requests that a large repository doesn't take longer to store than to parse.
const CHUNK = 1000;

// Takes the insert call rather than a table name: the client's types only
// check an insert against a literal table name.
async function inChunks<T>(table: string, rows: T[], insert: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`Storing ${table} failed: ${error.message}`);
  }
}

// Removes whatever an earlier or interrupted run stored. Edges, roles,
// routes and explanations hang off files and go with them.
export async function clearResult(db: Writer, analysisId: string): Promise<void> {
  const { error } = await db.from("files").delete().eq("analysis_id", analysisId);
  if (error) throw new Error(`Clearing earlier rows failed: ${error.message}`);
}

export type Stored = { files: number; edges: number; roles: number; routes: number };

// Files, edges, convention roles and routes become rows. Ids are made here rather
// than returned by the inserts, so edges can name their files without a
// round trip per chunk.
export async function storeResult(
  db: Writer,
  { analysisId, organizationId }: { analysisId: string; organizationId: string },
  result: ParseResult,
): Promise<Stored> {
  const owner = { analysis_id: analysisId, organization_id: organizationId };
  const ids = new Map(result.files.map((file) => [file.path, randomUUID()]));
  const idOf = (path: string): string => {
    const id = ids.get(path);
    // The parser only makes edges and routes on files it found, so this would
    // be a broken parse result, not something to store around.
    if (!id) throw new Error(`The result names ${path}, which isn't among the parsed files.`);
    return id;
  };

  await inChunks<Tables["files"]["Insert"]>(
    "files",
    result.files.map((file) => ({
      ...owner,
      id: idOf(file.path),
      path: file.path,
      folder: file.folder,
      bytes: file.bytes,
      lines: file.lines,
      sha256: file.sha256,
      skip_reason: file.skipReason,
      fan_in: file.fanIn,
      fan_out: file.fanOut,
    })),
    (chunk) => db.from("files").insert(chunk),
  );
  await inChunks<Tables["edges"]["Insert"]>(
    "edges",
    result.edges.map((edge) => ({
      ...owner,
      source_file_id: idOf(edge.source),
      target_file_id: idOf(edge.target),
      kind: edge.kind,
      specifier: edge.specifier,
      line: edge.line,
      type_only: edge.typeOnly,
    })),
    (chunk) => db.from("edges").insert(chunk),
  );
  const roles = result.files.flatMap((file) =>
    file.role === null
      ? []
      : [{ ...owner, file_id: idOf(file.path), role: file.role, entry: file.entry, source: "convention" as const }],
  );
  await inChunks("file roles", roles, (chunk) => db.from("file_roles").insert(chunk));
  await inChunks<Tables["routes"]["Insert"]>(
    "routes",
    result.routes.map((route) => ({
      ...owner,
      file_id: idOf(route.file),
      method: route.method,
      path: route.path,
      line: route.line,
    })),
    (chunk) => db.from("routes").insert(chunk),
  );

  return { files: result.files.length, edges: result.edges.length, roles: roles.length, routes: result.routes.length };
}
