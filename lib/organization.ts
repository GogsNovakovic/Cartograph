import "server-only";
import { auth } from "@clerk/nextjs/server";

export type CurrentOrganization = {
  id: string;
  slug: string | null;
  // Null when the session token isn't configured to carry `org_name`.
  name: string | null;
};

// Read entirely from the verified session token. No call to Clerk's API, so
// this costs nothing at render time and reads the same claim a database
// policy will.
export async function getCurrentOrganization(): Promise<CurrentOrganization | null> {
  const { orgId, orgSlug, sessionClaims } = await auth();
  if (!orgId) return null;
  return {
    id: orgId,
    slug: orgSlug ?? null,
    name: sessionClaims?.org_name ?? null,
  };
}
