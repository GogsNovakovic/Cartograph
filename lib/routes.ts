// Passed to both the Clerk provider and the proxy so the two can't disagree
// about where sign-in lives.
export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

// Every sign-in method, and accepting an invitation, ends here.
export const HOME_PATH = "/";

export function analysisPath(analysisId: string): string {
  return `/analyses/${analysisId}`;
}
