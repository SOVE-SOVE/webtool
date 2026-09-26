"use client";

import { STEP_LABEL, STEP_ORDER, STEP_STATUS_LABEL, type StepId, type StepStatus } from "./processSteps";

// Short display labels for the horizontal stepper only — the full
// STEP_LABEL wording still appears in the narrow `<select>` and in each
// step's hover/focus tooltip (and screen-reader `aria-label`), so nothing
// about what a step is actually called changes, this is purely a
// same-width-budget abbreviation for the compact row.
const STEP_SHORT_LABEL: Record<StepId, string> = {
  research: "Analyse business",
  plan: "Choose website",
  review: "Confirm & create",
};

const CIRCLE_TONE: Record<StepStatus, string> = {
  not_started: "bg-surface-subtle text-fg-muted",
  in_progress: "bg-pill-info-bg text-pill-info-fg",
  needs_review: "bg-pill-warning-bg text-pill-warning-fg",
  complete: "bg-pill-success-bg text-pill-success-fg",
  skipped: "bg-surface-subtle text-fg-muted",
};

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.8a1 1 0 0 1 1.4 0Z" />
    </svg>
  );
}

/**
 * One step's circle + short label, plus a hover/focus tooltip carrying the
 * full label and whatever status/summary text exists — the single visible
 * signal per step is the circle's number/check and colour (never a second
 * always-on line), with the fuller detail available without it competing
 * for space in the compact row. `title` alone would only reach mouse
 * users, so the tooltip is a real element toggled by
 * `group-hover`/`group-focus-visible`, reaching keyboard users too.
 */
function StepButton({
  id,
  index,
  isActive,
  status,
  summary,
  onChange,
}: {
  id: StepId;
  index: number;
  isActive: boolean;
  status: StepStatus;
  summary: string | null | undefined;
  onChange: (id: StepId) => void;
}) {
  const isComplete = status === "complete";
  const circleTone = isActive ? "bg-accent text-accent-fg" : CIRCLE_TONE[status];
  const detail = summary || STEP_STATUS_LABEL[status];
  const accessibleLabel = `${index + 1}. ${STEP_LABEL[id]}${detail ? ` — ${detail}` : ""}${isActive ? " (current step)" : ""}`;

  return (
    <button
      type="button"
      onClick={() => onChange(id)}
      aria-current={isActive ? "step" : undefined}
      aria-label={accessibleLabel}
      className="group relative flex w-32 flex-col items-center gap-1.5 rounded-md px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-fast ease-standard motion-reduce:transition-none ${circleTone}`}
      >
        {isComplete ? <CheckGlyph /> : index + 1}
      </span>
      <span
        aria-hidden="true"
        className={`max-w-full truncate text-xs transition-colors duration-fast ease-standard motion-reduce:transition-none ${
          isActive ? "font-semibold text-fg" : "text-fg-muted group-hover:text-fg"
        }`}
      >
        {STEP_SHORT_LABEL[id]}
      </span>

      {/* Full label + status/summary — hidden until hover or keyboard
          focus, so it never crowds the always-visible row above. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-10 mt-1.5 hidden -translate-x-1/2 -translate-y-1 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg opacity-0 shadow-sm transition-[opacity,transform] duration-fast ease-standard group-hover:block group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:block group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none"
      >
        {STEP_LABEL[id]}
        {detail ? ` — ${detail}` : ""}
      </span>
    </button>
  );
}

/**
 * The Planning workspace's step navigation — a single centered horizontal
 * stepper above the active step's content on wide screens, a `<select>`
 * on narrow ones. One shared status source for both (`statuses`, from
 * `computeStepStatus` in processSteps.ts) — this component only renders
 * it, it never derives a status itself.
 *
 * The persistent "Notes" control lives in the same row as the stepper
 * (`onOpenNotes`) — reachable from every step without being a fourth,
 * equal-weight step — and stays paired with the compact `<select>` below
 * `lg`, exactly as before.
 */
export function ProcessNav({
  active,
  statuses,
  summaries,
  onChange,
  hasNotes,
  onOpenNotes,
}: {
  active: StepId;
  /** Always a real status per step (`computeStepStatus` never returns
   * null); the `| null` is kept only so page.tsx's existing cast still
   * type-checks — a null falls back to "Not started". */
  statuses: Record<StepId, StepStatus | null>;
  /** Short, real-data second line for each step (see `computeStepSummary`)
   * — surfaced only in the narrow `<select>` and each wide step's
   * hover/focus tooltip, never as a second always-visible line. */
  summaries?: Record<StepId, string | null>;
  onChange: (id: StepId) => void;
  hasNotes: boolean;
  onOpenNotes: () => void;
}) {
  return (
    <div>
      {/* Compact selector — narrow widths only. */}
      <div className="flex items-center gap-2 lg:hidden">
        <label htmlFor="planning-step-select" className="sr-only">
          Planning step
        </label>
        <select
          id="planning-step-select"
          className="input flex-1"
          value={active}
          onChange={(e) => onChange(e.target.value as StepId)}
        >
          {STEP_ORDER.map((id, i) => {
            const status = statuses[id] ?? "not_started";
            const summary = summaries?.[id];
            return (
              <option key={id} value={id}>
                {`${i + 1}. ${STEP_LABEL[id]} — ${summary || STEP_STATUS_LABEL[status]}`}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          onClick={onOpenNotes}
          className="btn btn-secondary btn-sm shrink-0"
          aria-label={hasNotes ? "Open notes (notes on file)" : "Open notes"}
        >
          Notes{hasNotes && <span aria-hidden="true" className="ml-1 h-1.5 w-1.5 rounded-full bg-accent" />}
        </button>
      </div>

      {/* Horizontal stepper — lg and up. The stepper centres within the
          space left over from the Notes control (an intrinsically-sized
          `<ol>` wrapped in `mx-auto` inside a `flex-1` nav), rather than
          a fixed counter-balancing spacer. Each step is the same fixed
          width (w-32, sized to fit the longest short label), so the
          three circles sit evenly spaced whatever their labels, and each connector is top-aligned to the circles'
          centre line (py-1.5 + half of h-7 = 20px) rather than the
          circle+label block's middle. */}
      <div className="hidden items-center gap-3 lg:flex">
        <nav aria-label="Planning steps" className="min-w-0 flex-1">
          <ol className="mx-auto flex w-fit max-w-full items-center">
            {STEP_ORDER.map((id, i) => (
              <li key={id} className="flex items-start">
                <StepButton
                  id={id}
                  index={i}
                  isActive={id === active}
                  status={statuses[id] ?? "not_started"}
                  summary={summaries?.[id]}
                  onChange={onChange}
                />
                {i < STEP_ORDER.length - 1 && (
                  <span aria-hidden="true" className="mt-5 h-px w-10 shrink-0 bg-border xl:w-16" />
                )}
              </li>
            ))}
          </ol>
        </nav>
        <button
          type="button"
          onClick={onOpenNotes}
          className="btn btn-secondary btn-sm shrink-0"
          aria-label={hasNotes ? "Open notes (notes on file)" : "Open notes"}
        >
          Notes{hasNotes && <span aria-hidden="true" className="ml-1 h-1.5 w-1.5 rounded-full bg-accent" />}
        </button>
      </div>
    </div>
  );
}
