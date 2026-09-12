"use client";

import { useEffect, useState } from "react";

const STEPS = [
  "Checking website structure",
  "Reviewing mobile layout",
  "Checking technical health",
  "Analysing visual appearance",
  "Preparing summary",
];

// Roughly how long a full run tends to take before it's worth nudging
// the step indicator forward — purely a perceived-progress pacing, not
// a measured duration.
const MS_PER_STEP = 10_000;

/**
 * "During audit" progress — the backend pipeline
 * (planning/service.py:run_analysis_job) runs as a single job with no
 * per-step status persisted anywhere the frontend can read, so this
 * estimates the current step from elapsed time since the run started
 * rather than reflecting real backend step completion. It only ever
 * moves forward and never claims to finish before the job itself does.
 */
export function AnalysingProgress({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(startedAt).getTime());

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - new Date(startedAt).getTime()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const stepIndex = Math.min(STEPS.length - 1, Math.floor(Math.max(0, elapsed) / MS_PER_STEP));

  return (
    <ul className="mt-4 space-y-2.5">
      {STEPS.map((step, i) => {
        const done = i < stepIndex;
        const current = i === stepIndex;
        return (
          <li key={step} className="flex items-center gap-2.5 text-sm">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] leading-none ${
                done
                  ? "bg-fg text-canvas"
                  : current
                    ? "animate-pulse border border-fg"
                    : "border border-border"
              }`}
            >
              {done ? "✓" : ""}
            </span>
            <span className={done ? "text-fg-muted" : current ? "font-medium text-fg" : "text-fg-subtle"}>{step}</span>
          </li>
        );
      })}
    </ul>
  );
}
