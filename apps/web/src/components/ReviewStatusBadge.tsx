import type { DiscoveredBusinessStatus, OpportunityScoreCategory } from "@/lib/api";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

/**
 * Shared status/score presentation for discovered businesses, used by the
 * Review Queue and the business detail page so the same status always
 * looks the same everywhere. Tones follow the app's existing semantic
 * convention (see e.g. LeadStatusBadge, QaReportView, WebsiteView):
 * success = a good/decided outcome, danger = rejected, warning = caution,
 * muted = still in progress. Never a tone introduced just for this page.
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

const STATUS_TONE: Record<DiscoveredBusinessStatus, BadgeTone> = {
  new: "muted",
  researched: "muted",
  audited: "muted",
  scored: "muted",
  approved: "success",
  imported: "success",
  rejected: "danger",
  archived: "muted",
};

export function ReviewStatusBadge({ status }: { status: DiscoveredBusinessStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const SCORE_CATEGORY_TONE: Record<OpportunityScoreCategory, BadgeTone> = {
  hot: "danger",
  warm: "warning",
  cold: "info",
  review: "muted",
};

export function ScoreCategoryBadge({
  category,
  score,
}: {
  category: OpportunityScoreCategory;
  score?: number | null;
}) {
  return (
    <Badge tone={SCORE_CATEGORY_TONE[category]} className="uppercase">
      {category}
      {score !== undefined && score !== null ? ` · ${score}` : ""}
    </Badge>
  );
}
