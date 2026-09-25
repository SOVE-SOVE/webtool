"use client";

import type { ReactNode } from "react";

/**
 * Previous + next-step action, at the bottom of every step's content.
 * Navigation-only by default — `onNext`/`onPrevious` just change the
 * active step, never save, complete a checklist item, or approve
 * anything as a side effect (any real saving already happens inline,
 * on blur/click, inside each step's own editors). `nextSlot` lets the
 * last step (Review & hand off) swap in its own reused handoff action
 * instead of a plain "Continue" button — there's no step after it.
 */
export function StepFooter({
  onPrevious,
  onNext,
  nextLabel = "Continue",
  nextSlot,
}: {
  onPrevious: (() => void) | null;
  onNext?: (() => void) | null;
  nextLabel?: string;
  nextSlot?: ReactNode;
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
      <button type="button" onClick={onPrevious ?? undefined} disabled={!onPrevious} className="btn btn-secondary btn-sm">
        ← Previous
      </button>
      {nextSlot ?? (
        <button type="button" onClick={onNext ?? undefined} disabled={!onNext} className="btn btn-primary btn-sm">
          {nextLabel} →
        </button>
      )}
    </div>
  );
}
