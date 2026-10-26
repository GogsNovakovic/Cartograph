"use client";

import { useAuth } from "@clerk/nextjs";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Database } from "@/lib/database.types";
import { analysisTopic, readProgress, type Progress } from "@/lib/progress";

type GetClient = () => SupabaseClient<Database>;

const RealtimeContext = createContext<GetClient | null>(null);

// One browser client for the signed-in shell, so every subscription on a
// page shares one socket. It carries the Clerk session token, the same one
// the server sends: the channel policy reads the organization off it, and
// without it the socket would open as anon and every private channel would
// be refused.
export function RealtimeProvider({
  url,
  publishableKey,
  children,
}: {
  url: string;
  publishableKey: string;
  children: ReactNode;
}) {
  // getToken asks Clerk for the current session's token each time, so a
  // refreshed token doesn't mean a new client and a new socket.
  const { getToken } = useAuth();
  // Made on first use rather than on render. This component also renders on
  // the server, where the client would ask Clerk for a token at once and
  // Clerk refuses outside the browser. Only effects ask, and effects only run
  // in the browser.
  const [getClient] = useState(() => {
    let client: SupabaseClient<Database> | null = null;
    return () =>
      (client ??= createClient<Database>(url, publishableKey, {
        accessToken: async () => (await getToken()) ?? null,
      }));
  });

  return <RealtimeContext value={getClient}>{children}</RealtimeContext>;
}

export type Connection = { state: "connecting" } | { state: "live" } | { state: "failed"; reason: string };

// The server's render of a run, kept current by the analysis's progress
// channel. When the run ends, the page is re-read once so everything the
// event doesn't carry (commit, timings) catches up; a fresh render replaces
// whatever arrived live before it.
export function useAnalysisProgress(analysisId: string, rendered: Progress): { progress: Progress; connection: Connection } {
  const getClient = useContext(RealtimeContext);
  // A wiring mistake, not a runtime state: fail loudly rather than render a
  // progress view that silently never updates.
  if (!getClient) throw new Error("useAnalysisProgress needs RealtimeProvider above it.");
  const router = useRouter();
  const [live, setLive] = useState<Progress | null>(null);
  const [renderedSeen, setRenderedSeen] = useState(rendered);
  const [connection, setConnection] = useState<Connection>({ state: "connecting" });

  if (renderedSeen !== rendered) {
    setRenderedSeen(rendered);
    setLive(null);
  }

  useEffect(() => {
    const client = getClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    // Private channels authorize with the token, so it has to be on the
    // socket before the subscription is made.
    client.realtime
      .setAuth()
      .then(() => {
        if (cancelled) return;
        channel = client
          .channel(analysisTopic(analysisId), { config: { private: true } })
          .on("broadcast", { event: "progress" }, ({ payload }) => {
            const progress = readProgress(payload);
            if (!progress) return;
            setLive(progress);
            if (progress.status === "complete" || progress.status === "failed") router.refresh();
          })
          .subscribe((status, error) => {
            if (status === "SUBSCRIBED") setConnection({ state: "live" });
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              setConnection({ state: "failed", reason: error?.message ?? status.toLowerCase().replace("_", " ") });
            }
          });
      })
      .catch((error: unknown) => {
        if (!cancelled) setConnection({ state: "failed", reason: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [getClient, analysisId, router]);

  return { progress: live ?? rendered, connection };
}
