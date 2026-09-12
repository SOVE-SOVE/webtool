"use client";

import { PLANNING_ANALYSIS_STEPS, PLANNING_ANALYSIS_STEP_LABELS, type PlanningAnalysisStep } from "@/lib/api";

/**
 * "During audit" progress — driven entirely by `current_step`, a real
 * checkpoint the backend sets at each actual phase boundary inside
 * run_analysis_job (see PlanningAnalysisStep in apps/api). No timers, no
 * simulated percentages: a step shows as done only once the backend has
 * moved past it, and `current_step === null` (queued, not yet claimed by
 * the job runner) shows the list with nothing marked done or active yet
 * rather than guessing.
 */
export function AnalysingProgress({ currentStep }: { currentStep: PlanningAnalysisStep | null }) {
  const currentIndex = currentStep ? PLANNING_ANALYSIS_STEPS.indexOf(currentStep) : -1;

  return (
    <div>
      {currentIndex === -1 && (
        <p className="mt-1 text-sm text-fg-subtle" role="status">
          Queued — this starts automatically.
        </p>
      )}
      <ul className="mt-3 space-y-2.5" aria-label="Analysis progress">
        {PLANNING_ANALYSIS_STEPS.map((step, i) => {
          const done = currentIndex !== -1 && i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={step} className="flex items-center gap-2.5 text-sm">
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] leading-none ${
                  done
                    ? "bg-fg text-canvas"
                    : active
                      ? "border border-fg motion-safe:animate-pulse"
                      : "border border-border"
                }`}
              >
                {done ? "✓" : ""}
              </span>
              <span className={done ? "text-fg-muted" : active ? "font-medium text-fg" : "text-fg-subtle"}>
                {PLANNING_ANALYSIS_STEP_LABELS[step]}
                {active && (
                  <span className="sr-only"> — in progress</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {/* One live region for the whole list — announces the active step
          as it changes, without a burst of redundant "done" announcements
          for every step on each poll. */}
      <p className="sr-only" role="status" aria-live="polite">
        {currentIndex === -1
          ? "Analysis queued."
          : `${PLANNING_ANALYSIS_STEP_LABELS[PLANNING_ANALYSIS_STEPS[currentIndex]]}…`}
      </p>
    </div>
  );
}
