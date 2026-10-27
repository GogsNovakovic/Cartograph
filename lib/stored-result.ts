import "server-only";
import { getSupabase } from "@/lib/supabase";
import { toParseResult } from "@/parser/read";
import { SCHEMA_VERSION, type ParseResult } from "@/parser/types";

// The server caps a response at a thousand rows, so a repository's files and
// edges come back in pages. A bounded walk to the end of one analysis, not a
// poll: it stops at the first short page.
const PAGE = 1000;

async function readAll<T>(
  table: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// `stale` when the rows predate the parser reading them, so the page can
// offer the re-run that fixes it.
export type StoredResult = { ok: true; result: ParseResult } | { ok: false; stale: boolean; message: string };

// A complete analysis, rebuilt into exactly what the parser returned, and
// then put through the parser's own reader. Rows that don't add up (an edge
// to a missing file, counts that disagree) fail here with the reason,
// rather than drawing a map that's quietly wrong.
export async function readStoredResult(
  analysisId: string,
  repository: { owner: string; name: string },
): Promise<StoredResult> {
  const db = getSupabase();
  try {
    const { data: analysis, error } = await db
      .from("analyses")
      .select("schema_version, framework, adapters, coverage, excluded_directories")
      .eq("id", analysisId)
      .single();
    if (error) throw new Error(`Reading the analysis failed: ${error.message}`);
    // Stored by an earlier parser, whose rows lack what this one reads. Said
    // plainly rather than surfacing as a validation error several fields in.
    if (analysis.schema_version !== SCHEMA_VERSION) {
      return { ok: false, stale: true, message: "This map was stored by an earlier version of the parser. Run it again to read it with this one." };
    }

    const [files, edges, roles, routes] = await Promise.all([
      readAll("files", (from, to) =>
        db
          .from("files")
          .select("id, path, folder, bytes, lines, sha256, skip_reason, fan_in, fan_out")
          .eq("analysis_id", analysisId)
          .order("path")
          .range(from, to),
      ),
      readAll("edges", (from, to) =>
        db
          .from("edges")
          .select("source_file_id, target_file_id, kind, specifier, line, type_only")
          .eq("analysis_id", analysisId)
          .order("id")
          .range(from, to),
      ),
      // Convention roles only: a role a model suggested is never shown as
      // what a framework reaches the file as.
      readAll("file roles", (from, to) =>
        db
          .from("file_roles")
          .select("file_id, role, entry")
          .eq("analysis_id", analysisId)
          .eq("source", "convention")
          .order("file_id")
          .range(from, to),
      ),
      readAll("routes", (from, to) =>
        db
          .from("routes")
          .select("file_id, line, method, path")
          .eq("analysis_id", analysisId)
          .order("id")
          .range(from, to),
      ),
    ]);

    const pathOf = new Map(files.map((file) => [file.id, file.path]));
    const roleOf = new Map(roles.map((role) => [role.file_id, role]));

    return {
      ok: true,
      result: toParseResult({
        schemaVersion: analysis.schema_version,
        // The model names the map after the root's last segment.
        root: `${repository.owner}/${repository.name}`,
        framework: analysis.framework,
        adapters: analysis.adapters,
        files: files.map((file) => ({
          path: file.path,
          folder: file.folder,
          bytes: file.bytes,
          lines: file.lines,
          sha256: file.sha256,
          skipReason: file.skip_reason,
          role: roleOf.get(file.id)?.role ?? null,
          entry: roleOf.get(file.id)?.entry ?? false,
          fanOut: file.fan_out,
          fanIn: file.fan_in,
        })),
        // An id with no file reaches the reader as a missing path and fails
        // there, rather than being dropped here.
        edges: edges.map((edge) => ({
          source: pathOf.get(edge.source_file_id) ?? null,
          target: pathOf.get(edge.target_file_id) ?? null,
          kind: edge.kind,
          specifier: edge.specifier,
          line: edge.line,
          typeOnly: edge.type_only,
        })),
        // Read back in the parser's order: by path, then method.
        routes: routes
          .map((route) => ({
            file: pathOf.get(route.file_id) ?? null,
            line: route.line,
            method: route.method,
            path: route.path,
          }))
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.method < b.method ? -1 : a.method > b.method ? 1 : 0)),
        coverage: analysis.coverage,
        excludedDirectories: analysis.excluded_directories,
      }),
    };
  } catch (error) {
    return { ok: false, stale: false, message: error instanceof Error ? error.message : String(error) };
  }
}
