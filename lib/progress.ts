// What a run reports while it happens, shared by the server that renders it
// and the browser that keeps it current. No server-only imports.

import { Constants, type Database } from "./database.types.ts";

export type Status = Database["public"]["Enums"]["analysis_status"];
export type Stage = Database["public"]["Enums"]["analysis_stage"];

// In the order a run passes through them.
export const STAGES = Constants.public.Enums.analysis_stage;

export const STAGE_LABELS: Record<Stage, string> = {
  fetching: "Fetching",
  selecting: "Selecting",
  parsing: "Parsing",
  storing: "Storing",
};

// Exactly what the database publishes when a run moves: the stage and its
// message, plus the status so the end of a run is an event too.
export type Progress = { status: Status; stage: Stage | null; message: string | null };

// Must match private.analysis_topic() in the migration.
export function analysisTopic(analysisId: string): string {
  return `analysis:${analysisId}`;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((v) => v === value);
}

// A broadcast payload is untyped on arrival. Anything not in the published
// shape is dropped rather than shown.
export function readProgress(payload: Record<string, unknown>): Progress | null {
  const { status, stage, message } = payload;
  if (!isOneOf(Constants.public.Enums.analysis_status, status)) return null;
  if (stage !== null && !isOneOf(STAGES, stage)) return null;
  if (message !== null && typeof message !== "string") return null;
  return { status, stage, message };
}

// Nothing here has a queue or a timeout, so a process that dies mid-run
// leaves its row unfinished forever. Past this age an unfinished run is taken
// to be abandoned: shown as stale, and allowed to be run again.
export const STALE_AFTER_MS = 5 * 60 * 1000;

export function isStale(status: Status, startedAt: string, now: number): boolean {
  return (status === "queued" || status === "parsing") && now - Date.parse(startedAt) > STALE_AFTER_MS;
}
