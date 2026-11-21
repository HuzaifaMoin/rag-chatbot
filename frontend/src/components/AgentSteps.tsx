"use client";

import { useState } from "react";
import type { AgentStep } from "@/lib/api";

// The agent's work as a live checklist. While it runs, every step shows; once the answer
// is done it folds into one line ("✓ 6 steps · 3.2s") that you can click to open again.
export default function AgentSteps({
  steps,
  finished,
  seconds,
}: {
  steps: AgentStep[];
  finished: boolean;
  seconds?: number;
}) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  const list = (
    <ol className="flex flex-col gap-1.5 text-xs">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-2">
          {step.status === "done" ? (
            <span className="mt-px text-success" aria-hidden="true">
              ✓
            </span>
          ) : (
            <span
              className="mt-0.5 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent"
              aria-hidden="true"
            />
          )}
          <span>
            <span className={step.status === "done" ? "text-muted-foreground" : "font-medium"}>
              {step.label}
              {step.status === "running" && "…"}
            </span>
            {step.detail && <span className="text-muted-foreground"> · {step.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );

  if (!finished) {
    return (
      <div aria-live="polite" aria-label="Agent steps" className="rounded-xl border bg-card px-3 py-2.5">
        {list}
      </div>
    );
  }

  return (
    <div className="text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        ✓ {steps.length} steps{seconds !== undefined && ` · ${seconds.toFixed(1)}s`} {open ? "▴" : "▾"}
      </button>
      {open && <div className="mt-1.5 rounded-xl border bg-card px-3 py-2.5">{list}</div>}
    </div>
  );
}
