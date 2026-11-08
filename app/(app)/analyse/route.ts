import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { analysisPath, HOME_PATH } from "@/lib/routes";
import { analyse } from "../start";

// The landing page's form. A GET with side effects, accepted because the
// only thing that sends one is someone pressing the button: the proxy keeps
// signed-out requests out and Clerk returns them here after sign-in, which a
// server action can't survive.
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const started = await analyse(url);
  if (started.ok) redirect(analysisPath(started.analysisId));

  // Back to the dashboard's own form with the URL still in it and the reason
  // beside it, rather than a page of its own.
  const back = new URLSearchParams({ message: started.message });
  if (url) back.set("url", url);
  redirect(`${HOME_PATH}?${back}`);
}
