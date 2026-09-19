import type { ReactNode } from "react";

/**
 * One dense card in the discovered-business review brief. The whole card
 * is clickable (opens that section's detail panel) via the "stretched
 * button" pattern: the title is the one real `<button>`, and its ::after
 * covers the card — so there is a single tab stop and a proper accessible
 * name, and no invalid button-inside-button nesting. Anything that must
 * stay independently clickable (an action, a "View all" link) goes in
 * `actions`/`footer`, which sit above that overlay.
 *
 * `prominent` is for the decision-critical sections (audit, score):
 * larger title, more padding, stronger border. Everything else stays a
 * compact title + one summary line.
 */
export function ReviewCard({
  title,
  summary,
  badge,
  actions,
  footer,
  children,
  onOpen,
  prominent = false,
  detailLabel,
}: {
  title: string;
  summary?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  onOpen: () => void;
  prominent?: boolean;
  /** Screen-reader suffix for the title button, e.g. "open details". */
  detailLabel?: string;
}) {
  return (
    <article
      className={`group relative flex flex-col rounded-md border bg-surface transition-colors duration-[var(--duration-fast)] ease-standard hover:bg-surface-hover motion-reduce:transition-none ${
        prominent ? "border-border-strong px-4 py-3.5" : "border-border px-3.5 py-3"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className={`min-w-0 font-semibold text-fg ${prominent ? "text-base" : "text-sm"}`}>
          <button
            type="button"
            onClick={onOpen}
            aria-haspopup="dialog"
            className="cursor-pointer rounded text-left after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus-ring"
          >
            {title}
            {detailLabel && <span className="sr-only"> — {detailLabel}</span>}
          </button>
        </h3>
        <div className="relative z-10 flex shrink-0 items-center gap-2">
          {badge}
          {actions}
          <span
            aria-hidden="true"
            className="text-fg-subtle transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5 motion-reduce:transition-none"
          >
            ›
          </span>
        </div>
      </div>
      {summary && (
        <div className={`mt-1 text-fg-muted ${prominent ? "text-sm" : "line-clamp-1 text-xs"}`}>{summary}</div>
      )}
      {children}
      {footer && <div className="relative z-10 mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">{footer}</div>}
    </article>
  );
}

/** A small text-style button for a card's `footer`/`actions` slot. */
export function CardLinkButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded text-xs font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
