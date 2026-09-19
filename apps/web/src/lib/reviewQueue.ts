/**
 * The Review Queue page's workflow grouping, search, and sort. Pure +
 * unit-tested (same pattern as leads.ts / filters.ts), kept out of the
 * page component.
 *
 * Tabs are a plain-language grouping over the existing
 * `DiscoveredBusinessStatus` enum — they don't add or rename a status.
 */

import {
  instagramCheckDisplayState,
  type DiscoveredBusinessReviewItem,
  type DiscoveredBusinessStatus,
  type OpportunityScoreCategory,
} from "./api";

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

// --- Row-level status derivation ------------------------------------------

/**
 * Website evidence for one row, collapsed to the three states the queue
 * shows. Derived from the same fields the detail page uses
 * (`website_status`, plus the Instagram check state for handle-sourced
 * rows) — never guessed. "none" means a search found nothing, which is
 * evidence rather than proof, so the UI hedges the wording.
 */
export type ReviewWebsiteState = "listed" | "social" | "none" | "check";

// "listed", not "found": a URL on record has not been loaded or verified
// by anything here, and a social-profile URL is not an owned website.
export const REVIEW_WEBSITE_STATE_LABEL: Record<ReviewWebsiteState, string> = {
  listed: "Website listed",
  social: "Social profile",
  none: "No website found",
  check: "Needs checking",
};

export function reviewWebsiteState(
  item: Pick<
    DiscoveredBusinessReviewItem,
    | "website_status"
    | "website_kind"
    | "instagram_handle"
    | "instagram_website_status"
    | "instagram_website_checked_at"
    | "source_provider"
  >,
): ReviewWebsiteState {
  if (item.website_kind === "social_profile") return "social";
  const ig = instagramCheckDisplayState(item);
  if (ig === "check_pending" || ig === "needs_review") return "check";
  if (item.website_status === "found") return "listed";
  if (item.website_status === "none") return "none";
  return "check";
}

/**
 * Analysis (research) progress, kept separate from website state. The
 * list payload has no in-flight marker — a run is only ever "running"
 * for the operator who started it, tracked client-side by the row.
 */
export type ReviewAnalysisState = "done" | "failed" | "not_run" | "not_applicable";

export const REVIEW_ANALYSIS_STATE_LABEL: Record<ReviewAnalysisState, string> = {
  done: "Ready to review",
  failed: "Check unavailable",
  not_run: "Not checked",
  // A social profile is never audited as a website, so nothing was checked.
  not_applicable: "Not checked",
};

/** Hover text for the analysis label — what it means, not the raw error. */
export const REVIEW_ANALYSIS_STATE_TITLE: Record<ReviewAnalysisState, string> = {
  done: "The website check finished — details are on the review page",
  failed: "The check couldn't complete. That says nothing about the website — open the review page for the reason and to retry",
  not_run: "The website hasn't been checked yet",
  not_applicable: "The listed URL is a social profile, not an owned website, so there is nothing to audit",
};

export function reviewAnalysisState(
  item: Pick<DiscoveredBusinessReviewItem, "research_error" | "researched_at" | "website_kind">,
): ReviewAnalysisState {
  // A social profile is never analysed as a website, whatever an older
  // research row says.
  if (item.website_kind === "social_profile") return "not_applicable";
  if (item.research_error) return "failed";
  return item.researched_at ? "done" : "not_run";
}

/**
 * A short, plain-language reason for a failed analysis. Every case says
 * the *check* failed — none of them is a finding about the website, so
 * none may be shown as a website defect.
 */
export function describeAnalysisError(error: string | null | undefined): string {
  const e = (error ?? "").toLowerCase();
  if (!e) return "the check didn't complete";
  if (e.includes("could not resolve hostname") || e.includes("err_name_not_resolved"))
    return "the site's address couldn't be looked up";
  if (e.includes("timeout")) return "the page took too long to load";
  if (e.includes("cert")) return "the site's security certificate was rejected";
  if (e.includes("executable doesn't exist") || e.includes("browsertype.launch"))
    return "the analysis browser wasn't available";
  if (e.includes("not an allowed audit target") || e.includes("non-public")) return "the address isn't an allowed target";
  if (e.includes("connection_refused") || e.includes("err_connection")) return "the connection was refused";
  return "the page couldn't be loaded";
}

/** A missing score is "Not assessed", never zero. */
export function formatReviewScore(score: number | null | undefined): string {
  return score === null || score === undefined ? "Not assessed" : String(score);
}

// --- Filters ---------------------------------------------------------------

export type ReviewWebsiteFilter = "" | "has" | "no" | "check";
export type ReviewAnalysisFilter = "" | ReviewAnalysisState;
export type ReviewScoreFilter = "" | OpportunityScoreCategory | "unscored";

export type ReviewFilters = {
  search: string;
  website: ReviewWebsiteFilter;
  analysis: ReviewAnalysisFilter;
  score: ReviewScoreFilter;
};

export const NO_REVIEW_FILTERS: ReviewFilters = { search: "", website: "", analysis: "", score: "" };

export function isReviewWebsiteFilter(v: string | null): v is "has" | "no" | "check" {
  return v === "has" || v === "no" || v === "check";
}
export function isReviewAnalysisFilter(v: string | null): v is ReviewAnalysisState {
  return v === "done" || v === "failed" || v === "not_run";
}
export function isReviewScoreFilter(v: string | null): v is ReviewScoreFilter & string {
  return v === "hot" || v === "warm" || v === "cold" || v === "review" || v === "unscored";
}

/**
 * The three quick filters, each a real analysis state (the same `analysis`
 * URL param and server filter the More-filters select uses — one source of
 * truth). "All" is every actionable queued business, including unchecked
 * ones; "Ready" has a completed check; "Needs attention" has a failed
 * check, the only incomplete state that needs the operator to act.
 */
export type ReviewQuickFilterId = "all" | "ready" | "attention";

export const REVIEW_QUICK_FILTERS: { id: ReviewQuickFilterId; label: string; analysis: ReviewAnalysisFilter }[] = [
  { id: "all", label: "All", analysis: "" },
  { id: "ready", label: "Ready", analysis: "done" },
  { id: "attention", label: "Needs attention", analysis: "failed" },
];

/** The quick filter an `analysis` value corresponds to; null for "not_run", which only More filters offers. */
export function quickFilterFor(analysis: ReviewAnalysisFilter): ReviewQuickFilterId | null {
  return REVIEW_QUICK_FILTERS.find((q) => q.analysis === analysis)?.id ?? null;
}

/** Filters that live under "More filters": website, score band, and the not-yet-checked analysis state. */
export function countMoreFilters(f: ReviewFilters): number {
  return (f.website ? 1 : 0) + (f.score ? 1 : 0) + (f.analysis === "not_run" ? 1 : 0);
}

export function hasActiveReviewFilters(f: ReviewFilters): boolean {
  return f.search.trim() !== "" || f.website !== "" || f.analysis !== "" || f.score !== "";
}

// --- Pagination + URL query -------------------------------------------------

export const REVIEW_PAGE_SIZE = 10;

/** 1-based page from a URL param; anything invalid means page 1. */
export function parsePage(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** "Showing 11–20 of 64" bounds for the rows actually on screen; null when the page is empty. */
export function pageRange(page: number, pageSize: number, count: number): { from: number; to: number } | null {
  if (count <= 0) return null;
  const from = (page - 1) * pageSize + 1;
  return { from, to: from + count - 1 };
}

export type ReviewQueueQuery = {
  tab: ReviewTab;
  search: string;
  website: ReviewWebsiteFilter;
  analysis: ReviewAnalysisFilter;
  score: ReviewScoreFilter;
  sort: ReviewSortKey;
  page: number;
};

const SORT_KEYS: ReviewSortKey[] = ["score", "newest", "name"];

/** The list's whole query state, read from the URL — one source of truth for the list and the review page. */
export function parseReviewQuery(sp: URLSearchParams): ReviewQueueQuery {
  const tab = sp.get("tab");
  const website = sp.get("website");
  const analysis = sp.get("analysis");
  const score = sp.get("score");
  const sort = sp.get("sort");
  return {
    tab: isReviewTab(tab) ? tab : "needs_review",
    search: sp.get("search") ?? "",
    website: isReviewWebsiteFilter(website) ? website : "",
    analysis: isReviewAnalysisFilter(analysis) ? analysis : "",
    score: isReviewScoreFilter(score) ? score : "",
    sort: sort && (SORT_KEYS as string[]).includes(sort) ? (sort as ReviewSortKey) : "score",
    page: parsePage(sp.get("page")),
  };
}

// --- Queue position shared with the full review page -------------------------

const ORDER_KEY = "wdos-review-order";

/** Where the operator is in the queue, so the review page can offer Previous/Next without the whole list. */
export type ReviewOrderContext = {
  ids: string[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** The list's URL query string, so an adjacent page can be fetched with the same criteria. */
  query: string;
};

export function saveReviewOrder(ctx: ReviewOrderContext): void {
  try {
    sessionStorage.setItem(ORDER_KEY, JSON.stringify(ctx));
  } catch {
    /* storage unavailable — Previous/Next simply won't appear */
  }
}

export function loadReviewOrder(): ReviewOrderContext | null {
  try {
    const raw = sessionStorage.getItem(ORDER_KEY);
    const c: unknown = raw ? JSON.parse(raw) : null;
    if (!c || typeof c !== "object") return null;
    const o = c as ReviewOrderContext;
    return Array.isArray(o.ids) && typeof o.page === "number" && typeof o.query === "string" ? o : null;
  } catch {
    return null;
  }
}

export type ReviewNeighbours = {
  previous: string | null;
  next: string | null;
  /** True at the first/last row of a page that has another page beyond it. */
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  /** 1-based position within the whole filtered queue. */
  position: number;
  total: number;
};

export function reviewNeighbours(ctx: ReviewOrderContext | null, id: string): ReviewNeighbours | null {
  if (!ctx) return null;
  const i = ctx.ids.indexOf(id);
  if (i === -1) return null;
  return {
    previous: i > 0 ? ctx.ids[i - 1] : null,
    next: i < ctx.ids.length - 1 ? ctx.ids[i + 1] : null,
    hasPreviousPage: i === 0 && ctx.page > 1,
    hasNextPage: i === ctx.ids.length - 1 && ctx.page < ctx.totalPages,
    position: (ctx.page - 1) * ctx.pageSize + i + 1,
    total: ctx.total,
  };
}

/** Re-applies a previously shown order so a background refresh never reshuffles rows. */
export function applyPinnedOrder<T extends { id: string }>(items: T[], pinned: string[] | null): T[] {
  if (!pinned) return items;
  const rank = new Map(pinned.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
