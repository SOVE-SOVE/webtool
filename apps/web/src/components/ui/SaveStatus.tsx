export type SaveStatusValue = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Shared "Saving…/Saved/error" indicator for auto-save and explicit-save
 * fields alike. Fixed height so the label changing never shifts
 * surrounding layout; each state's text cross-fades in on a `key`
 * change rather than popping.
 */
export function SaveStatus({
  status,
  dirtyText = "Unsaved changes",
  errorText = "Couldn't save — try again.",
  className = "",
}: {
  status: SaveStatusValue;
  dirtyText?: string;
  errorText?: string;
  className?: string;
}) {
  const content =
    status === "saving" ? (
      <span className="text-fg-subtle">Saving…</span>
    ) : status === "saved" ? (
      <span className="inline-flex items-center gap-1 text-fg-muted">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="m5 13 4 4 10-10" />
        </svg>
        Saved
      </span>
    ) : status === "error" ? (
      <span className="text-danger">{errorText}</span>
    ) : status === "dirty" ? (
      <span className="text-fg-subtle">{dirtyText}</span>
    ) : null;

  return (
    <p className={`h-4 text-xs ${className}`} role="status">
      <span key={status} className="animate-fade-in inline-block">
        {content}
      </span>
    </p>
  );
}
