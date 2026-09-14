import type { DiscoveredBusinessStatus, OpportunityScoreCategory } from "@/lib/api";

/**
 * Shared status/score presentation for discovered businesses, used by the
 * Review Queue and the business detail page so the same status always
 * looks the same everywhere. Colors follow the app's existing semantic
 * convention (see e.g. LeadStatusBadge, QaReportView, WebsiteView):
 * emerald = a good/decided outcome, red = rejected, amber = caution,
 * neutral = still in progress. Never a color introduced just for this page.
 */
export const STATUS_LABEL: Record<DiscoveredBusinessStatus, string> = {
  new: "New",
  researched: "Researched",
  audited: "Audited",
  scored: "Scored",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
  imported: "Imported",
};

const STATUS_STYLE: Record<DiscoveredBusinessStatus, string> = {
  new: "bg-surface-subtle text-fg-muted",
  researched: "bg-surface-subtle text-fg-muted",
  audited: "bg-surface-subtle text-fg-muted",
  scored: "bg-surface-subtle text-fg-muted",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  imported: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  archived: "bg-surface-hover text-fg-subtle",
};

export function ReviewStatusBadge({ status }: { status: DiscoveredBusinessStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export const SCORE_CATEGORY_STYLE: Record<OpportunityScoreCategory, string> = {
  hot: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  warm: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  cold: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  review: "bg-surface-hover text-fg-muted",
};

export function ScoreCategoryBadge({
  category,
  score,
}: {
  category: OpportunityScoreCategory;
  score?: number | null;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${SCORE_CATEGORY_STYLE[category]}`}
    >
      {category}
      {score !== undefined && score !== null ? ` · ${score}` : ""}
    </span>
  );
}
