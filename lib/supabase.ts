import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// The only way server code gets a database client. Every request carries the
// signed-in Clerk token, so policies can read the organization claim off it.
// Without the token the client would run as anon and every policy would
// quietly return nothing.
export function getSupabase() {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken: async () => (await auth()).getToken(),
  });
}
