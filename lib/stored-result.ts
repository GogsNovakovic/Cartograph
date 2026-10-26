import "server-only";
import { getSupabase } from "@/lib/supabase";
import { toParseResult } from "@/parser/read";
import type { ParseResult } from "@/parser/types";

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

export type StoredResult = { ok: true; result: ParseResult } | { ok: false; message: string };

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
      .select("schema_version, adapters, coverage, excluded_directories")
      .eq("id", analysisId)
      .single();
    if (error) throw new Error(`Reading the analysis failed: ${error.message}`);

    const [files, edges, roles] = await Promise.all([
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
          .select("file_id, role")
          .eq("analysis_id", analysisId)
          .eq("source", "convention")
          .order("file_id")
          .range(from, to),
      ),
    ]);

    const pathOf = new Map(files.map((file) => [file.id, file.path]));
    const roleOf = new Map(roles.map((role) => [role.file_id, role.role]));

    return {
      ok: true,
      result: toParseResult({
        schemaVersion: analysis.schema_version,
        // The model names the map after the root's last segment.
        root: `${repository.owner}/${repository.name}`,
        adapters: analysis.adapters,
        files: files.map((file) => ({
          path: file.path,
          folder: file.folder,
          bytes: file.bytes,
          lines: file.lines,
          sha256: file.sha256,
          skipReason: file.skip_reason,
          role: roleOf.get(file.id) ?? null,
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
        coverage: analysis.coverage,
        excludedDirectories: analysis.excluded_directories,
      }),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
