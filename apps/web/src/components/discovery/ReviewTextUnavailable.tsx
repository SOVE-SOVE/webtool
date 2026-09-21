import { REVIEW_TEXT_REFRESH_NOTE, REVIEW_TEXT_UNAVAILABLE_MESSAGE } from "@/lib/reviewText";

/**
 * The one "Review text unavailable" state shared by Planning's Google
 * Review Insights and the discovery review display. Replaces the empty
 * theme/trend/recommendation sections rather than sitting beside them.
 * `showRefreshNote` is for places that also offer a Refresh action.
 */
export function ReviewTextUnavailable({ showRefreshNote = false }: { showRefreshNote?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface-subtle px-3 py-2.5" role="status">
      <p className="text-sm font-medium text-fg">Review text unavailable</p>
      <p className="mt-0.5 text-sm text-fg-muted">{REVIEW_TEXT_UNAVAILABLE_MESSAGE}</p>
      {showRefreshNote && <p className="mt-1 text-xs text-fg-subtle">{REVIEW_TEXT_REFRESH_NOTE}</p>}
    </div>
  );
}
