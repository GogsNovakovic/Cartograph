"use client";

import { useActionState } from "react";
import { analyseRepository, rerunAnalysis, type ActionState } from "@/app/(app)/actions";

const IDLE: ActionState = { message: null };

const BUTTON =
  "h-7 shrink-0 rounded border border-border bg-raised px-2.5 text-[12.5px] font-medium hover:border-muted disabled:text-muted";

export function AnalyseForm() {
  const [state, action, pending] = useActionState(analyseRepository, IDLE);
  return (
    <form action={action} className="mb-4">
      <div className="flex gap-2">
        <input
          name="url"
          type="text"
          required
          spellCheck={false}
          autoComplete="off"
          placeholder="https://github.com/owner/name"
          aria-label="Public GitHub repository URL"
          className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-2 font-mono text-[12.5px] outline-none placeholder:text-muted focus:border-accent"
        />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Starting…" : "Analyse"}
        </button>
      </div>
      {state.message && <p className="mt-1 text-[12px]">{state.message}</p>}
    </form>
  );
}

export function RerunButton({ analysisId, label = "Run again" }: { analysisId: string; label?: string }) {
  const [state, action, pending] = useActionState(rerunAnalysis.bind(null, analysisId), IDLE);
  return (
    <form action={action} className="flex items-center gap-2">
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Starting…" : label}
      </button>
      {state.message && <span className="text-[12px]">{state.message}</span>}
    </form>
  );
}
