/**
 * The Review Queue page's workflow grouping, search, and sort. Pure +
 * unit-tested (same pattern as leads.ts / filters.ts), kept out of the
 * page component.
 *
 * Tabs are a plain-language grouping over the existing
 * `DiscoveredBusinessStatus` enum — they don't add or rename a status.
 */

import type { DiscoveredBusinessReviewItem, DiscoveredBusinessStatus } from "@/lib/api";

export type ReviewTab = "all" | "needs_review" | "approved" | "imported" | "rejected" | "archived";

export type ReviewTabDef = {
  id: ReviewTab;
  label: string;
  /** null = every non-archived status (the "All" tab). */
  statuses: DiscoveredBusinessStatus[] | null;
};

// "All" deliberately still excludes archived — archived is a deliberate
// dead end an operator opts into, not part of the everyday queue.
export const REVIEW_TABS: ReviewTabDef[] = [
  { id: "all", label: "All", statuses: null },
  { id: "needs_review", label: "Needs review", statuses: ["new", "researched", "audited", "scored"] },
  { id: "approved", label: "Approved", statuses: ["approved"] },
  { id: "imported", label: "Imported", statuses: ["imported"] },
  { id: "rejected", label: "Rejected", statuses: ["rejected"] },
  { id: "archived", label: "Archived", statuses: ["archived"] },
];

const TAB_IDS = new Set(REVIEW_TABS.map((t) => t.id));

export function isReviewTab(value: string | null | undefined): value is ReviewTab {
  return value != null && TAB_IDS.has(value as ReviewTab);
}

export function statusesForReviewTab(tab: ReviewTab): DiscoveredBusinessStatus[] | null {
  return REVIEW_TABS.find((t) => t.id === tab)?.statuses ?? null;
}

export function reviewItemMatchesTab(item: Pick<DiscoveredBusinessReviewItem, "status">, tab: ReviewTab): boolean {
  if (tab === "all") return item.status !== "archived";
  const statuses = statusesForReviewTab(tab);
  return statuses === null || statuses.includes(item.status);
}

/** Count of items in each tab, for the tab-bar badges. */
export function countReviewItemsByTab(
  items: Pick<DiscoveredBusinessReviewItem, "status">[],
): Record<ReviewTab, number> {
  const counts = Object.fromEntries(REVIEW_TABS.map((t) => [t.id, 0])) as Record<ReviewTab, number>;
  for (const item of items) {
    for (const tab of REVIEW_TABS) {
      if (reviewItemMatchesTab(item, tab.id)) counts[tab.id] += 1;
    }
  }
  return counts;
}

/**
 * An item still awaiting a decision whose own signal says a human should
 * look closely rather than rubber-stamp it: either research on it failed
 * outright, or scoring itself flagged too little evidence to trust
 * (`score_category === "review"`, driven by evidence completeness — see
 * docs/05_DECISIONS.md 2026-08-22). Never based on the score value itself.
 */
export function reviewItemNeedsAttention(item: DiscoveredBusinessReviewItem): boolean {
  if (!reviewItemMatchesTab(item, "needs_review")) return false;
  return Boolean(item.research_error) || item.score_category === "review";
}

export function reviewQueueSummary(items: DiscoveredBusinessReviewItem[]) {
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let needsAttention = 0;
  for (const item of items) {
    if (reviewItemMatchesTab(item, "needs_review")) pending += 1;
    if (item.status === "approved") approved += 1;
    if (item.status === "rejected") rejected += 1;
    if (reviewItemNeedsAttention(item)) needsAttention += 1;
  }
  return { pending, approved, rejected, needsAttention };
}

export function reviewItemMatchesQuery(item: DiscoveredBusinessReviewItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.industry, item.suburb, item.state]
    .filter((v): v is string => Boolean(v))
    .some((field) => field.toLowerCase().includes(q));
}

export type ReviewSortKey = "score" | "newest" | "name";

export const REVIEW_SORT_LABEL: Record<ReviewSortKey, string> = {
  score: "Highest score",
  newest: "Most recent",
  name: "Name A–Z",
};

export function sortReviewItems(
  items: DiscoveredBusinessReviewItem[],
  sort: ReviewSortKey,
): DiscoveredBusinessReviewItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sort) {
      case "score":
        return (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1);
      case "name":
        return a.name.localeCompare(b.name);
      case "newest":
      default:
        return new Date(b.discovered_at).getTime() - new Date(a.discovered_at).getTime();
    }
  });
  return sorted;
}
