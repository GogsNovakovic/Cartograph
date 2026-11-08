import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { HOME_PATH, LANDING_PATH, SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/routes";

// Clerk owns this slot alone. Supabase's own session-refresh middleware is
// deliberately absent: the database reads Clerk's token, it keeps no session.
//
// Everything is protected except what's listed, so a path this check reads
// differently from Next's router can only end up protected, never exposed.
function isPublic(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  const under = (base: string) => path === base || path.startsWith(`${base}/`);
  return under(SIGN_IN_PATH) || under(SIGN_UP_PATH) || path === LANDING_PATH;
}

// Protecting here rather than in the page means a signed-out request is
// redirected before any rendering starts, so no page HTML is ever sent.
// A session still waiting to pick an organization counts as signed out.
export default clerkMiddleware(
  async (auth, request) => {
    // The root is the dashboard for a member and the landing page for anyone
    // else. A rewrite rather than a redirect, so the landing page is the
    // root and signing in doesn't move anyone to a different address.
    if (request.nextUrl.pathname === HOME_PATH && !(await auth()).userId) {
      return NextResponse.rewrite(new URL(LANDING_PATH, request.url));
    }
    if (!isPublic(request)) await auth.protect();
  },
  { signInUrl: SIGN_IN_PATH, signUpUrl: SIGN_UP_PATH },
);

// The agent's lookups under /api/agent never pass through here. They carry
// their own credential, not a Clerk session, and Clerk would try to verify it
// as one. The route refuses anything without a valid credential itself.
export const config = {
  matcher: [
    // Skip Next internals, the agent's lookups and static files
    "/((?!_next|api/agent(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api(?!/agent(?:/|$))|trpc)(.*)",
  ],
};
