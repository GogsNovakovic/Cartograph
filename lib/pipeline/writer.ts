import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.ts";
import { env } from "../env.ts";

// The pipeline's writer. The secret key bypasses row-level security, so it is
// only ever used to write what a run produced, never to read on someone's
// behalf: reads go through the signed-in client and its policies. A run can
// outlast a sixty-second session token, and from a terminal there is none.
export function getWriter() {
  return createClient<Database>(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Writer = ReturnType<typeof getWriter>;
