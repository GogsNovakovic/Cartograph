// Imported by next.config.ts, so a missing value stops `next dev` and
// `next build` before anything serves. Keep this free of Next and React
// imports so the config can load it.

const missing: string[] = [];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    missing.push(name);
    return "";
  }
  return value;
}

const values = {
  clerkPublishableKey: required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
  clerkSecretKey: required("CLERK_SECRET_KEY"),
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  openaiApiKey: required("OPENAI_API_KEY"),
};

// Report every missing name at once rather than one per restart.
if (missing.length > 0) {
  throw new Error(
    `Missing environment variables: ${missing.join(", ")}. Set them in .env.local.`,
  );
}

export const env = values;

// Tracing is optional: without it every model call still runs, it just isn't
// recorded. That state looks exactly like a working setup with no traffic,
// so it's reported in words wherever model output is shown, never inferred.
export type TracingStatus = { on: true; project: string } | { on: false; reason: string };

function tracingStatus(): TracingStatus {
  const key = process.env.LANGSMITH_API_KEY?.trim();
  const flag = process.env.LANGSMITH_TRACING?.trim();
  if (!key) return { on: false, reason: "LANGSMITH_API_KEY isn't set" };
  if (flag !== "true") return { on: false, reason: "LANGSMITH_TRACING isn't true" };
  return { on: true, project: process.env.LANGSMITH_PROJECT?.trim() || "default" };
}

export const tracing = tracingStatus();
