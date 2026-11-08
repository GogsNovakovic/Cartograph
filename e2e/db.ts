import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.ts";

// The tests' own way into the database, to put an analysis into a state the
// browser can't produce on demand (a re-run that failed). Secret key, test
// setup only; what the page then shows is read the normal way.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // A missing file is fine; a missing value fails below, by name.
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} isn't set; the signed-in tests read it from .env.local.`);
  return value;
}

export const db = createClient<Database>(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The analysis of owner/name in any organization the tests' user is in.
export async function analysisOf(owner: string, name: string) {
  const { data, error } = await db
    .from("analyses")
    .select("id, status, result_run, commit_sha, project:projects!inner (owner, name)")
    .eq("project.owner", owner)
    .eq("project.name", name)
    .limit(1)
    .single();
  if (error) throw new Error(`No analysis of ${owner}/${name} to test with: ${error.message}`);
  return data;
}
