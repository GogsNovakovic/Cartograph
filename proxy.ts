import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/routes";

// Clerk owns this slot alone. Supabase's own session-refresh middleware is
// deliberately absent: the database reads Clerk's token, it keeps no session.
const isPublic = createRouteMatcher([
  `${SIGN_IN_PATH}(.*)`,
  `${SIGN_UP_PATH}(.*)`,
]);

// Protecting here rather than in the page means a signed-out request is
// redirected before any rendering starts, so no page HTML is ever sent.
// A session still waiting to pick an organization counts as signed out.
export default clerkMiddleware(
  async (auth, request) => {
    if (!isPublic(request)) await auth.protect();
  },
  { signInUrl: SIGN_IN_PATH, signUpUrl: SIGN_UP_PATH },
);

export const config = {
  matcher: [
    // Skip Next internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
