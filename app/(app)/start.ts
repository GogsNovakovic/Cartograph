import "server-only";
import { after } from "next/server";
import { getCurrentOrganization } from "@/lib/organization";
import { claimAnalysis, runClaimed, startAnalysis } from "@/lib/pipeline/run";

// The row is claimed before the response, so the page it lands on already
// says "fetching". The run itself happens after the response has gone: it
// can take minutes, and the page follows it over the progress channel.
export async function begin(analysisId: string): Promise<string | null> {
  const claimed = await claimAnalysis(analysisId);
  if (!claimed.ok) return claimed.message;
  // A run records its own failure on the row, so its result is already where
  // the page will read it.
  after(() => runClaimed(claimed.claim));
  return null;
}

export type Started = { ok: true; analysisId: string } | { ok: false; message: string };

// Shared by the dashboard's form and the landing page's, which arrives as a
// GET after sign-in.
export async function analyse(url: unknown): Promise<Started> {
  // From the token, never the request: which organization owns the analysis
  // is not the browser's to say.
  const organization = await getCurrentOrganization();
  if (!organization) return { ok: false, message: "This session has no active organization." };

  if (typeof url !== "string" || url.trim() === "") return { ok: false, message: "Paste a repository URL." };

  const started = await startAnalysis(organization.id, url);
  if (!started.ok) return { ok: false, message: started.message };

  // An analysed repository goes to its existing analysis. Running it again
  // is done from there, on purpose, not by pasting the URL again.
  if (started.created) {
    const failed = await begin(started.analysisId);
    if (failed) return { ok: false, message: failed };
  }
  return { ok: true, analysisId: started.analysisId };
}
