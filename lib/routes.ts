// Passed to both the Clerk provider and the proxy so the two can't disagree
// about where sign-in lives.
export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

// Every sign-in method, and accepting an invitation, ends here.
export const HOME_PATH = "/";

// What a signed-out visitor sees at HOME_PATH. The proxy serves it there
// without changing the URL; it also answers at its own path.
export const LANDING_PATH = "/about";

// Takes ?url= and starts that analysis. A plain GET, so a signed-out visitor
// can be sent through sign-in and land back here with the URL intact.
export const ANALYSE_PATH = "/analyse";

export function analysisPath(analysisId: string): string {
  return `/analyses/${analysisId}`;
}
