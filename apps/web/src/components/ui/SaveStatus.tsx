export type SaveStatusValue = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Shared "Saving…/Saved/error" indicator for auto-save and explicit-save
 * fields alike. Fixed height so the label changing never shifts
 * surrounding layout; each state's text cross-fades in on a `key`
 * change rather than popping, and the "Saved" tick draws itself once
 * (static under reduced motion).
 *
 * Only the outcome of a save is announced to screen readers ("Saving…",
 * "Saved", the error). The "unsaved" hint is visible but sits outside the
 * live region, so typing in a field never triggers speech. Callers decide
 * the status — see lib/saveStatus.ts for the rules ("Saved" only after
 * the server confirmed it and nothing newer is waiting).
 *
 * `onRetry` adds a small "Retry" button beside the error, for callers
 * with no other way to try again. `live={false}` silences a second
 * indicator that only mirrors one already on screen.
 */
export function SaveStatus({
  status,
  dirtyText = "Unsaved changes",
  errorText = "Couldn't save — try again.",
  className = "",
  onRetry,
  live = true,
}: {
  status: SaveStatusValue;
  dirtyText?: string;
  errorText?: string;
  className?: string;
  onRetry?: () => void;
  live?: boolean;
}) {
  const outcome =
    status === "saving" ? (
      <span className="text-fg-subtle">Saving…</span>
    ) : status === "saved" ? (
      <span className="inline-flex items-center gap-1 text-fg-muted">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
          {/* Reuses the generic stroke-draw keyframe from globals.css
              (dashoffset 1 -> 0); the label beside it fades instead. */}
          <path
            d="m5 13 4 4 10-10"
            pathLength={1}
            className="[stroke-dasharray:1] motion-safe:animate-[nav-icon-draw-in_var(--duration-base)_var(--ease-out-calm)]"
          />
        </svg>
        <span className="animate-fade-in">Saved</span>
      </span>
    ) : status === "error" ? (
      <span className="text-danger">
        {errorText}
        {onRetry && live && (
          <>
            {" "}
            <button
              type="button"
              data-save-retry=""
              onClick={onRetry}
              className="rounded font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Retry
            </button>
          </>
        )}
      </span>
    ) : null;

  return (
    <p className={`h-4 text-xs ${className}`}>
      {status === "dirty" && <span className="animate-fade-in inline-block text-fg-subtle">{dirtyText}</span>}
      <span role={live ? "status" : undefined} aria-hidden={live ? undefined : true}>
        <span key={status} className={`inline-block ${status === "saved" ? "" : "animate-fade-in"}`}>
          {outcome}
        </span>
      </span>
    </p>
  );
}
