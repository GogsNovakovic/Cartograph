"use client";

import { useActionState } from "react";
import { analyseRepository, rerunAnalysis, type ActionState } from "@/app/(app)/actions";
import { BUTTON, URL_INPUT } from "@/components/controls";

const IDLE: ActionState = { message: null };

export function AnalyseForm({ defaultUrl, message = null }: { defaultUrl?: string; message?: string | null }) {
  const [state, action, pending] = useActionState(analyseRepository, { message });
  return (
    <form action={action} className="mb-4">
      <div className="flex gap-2">
        <input
          name="url"
          type="text"
          required
          defaultValue={defaultUrl}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://github.com/owner/name"
          aria-label="Public GitHub repository URL"
          className={URL_INPUT}
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
