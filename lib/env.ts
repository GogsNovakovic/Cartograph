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
};

// Report every missing name at once rather than one per restart.
if (missing.length > 0) {
  throw new Error(
    `Missing environment variables: ${missing.join(", ")}. Set them in .env.local.`,
  );
}

export const env = values;
