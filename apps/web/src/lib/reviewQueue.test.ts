import { describe, expect, it } from "vitest";
import {
  countReviewItemsByTab,
  isReviewTab,
  REVIEW_TABS,
  reviewItemMatchesQuery,
  reviewItemMatchesTab,
  reviewItemNeedsAttention,
  reviewQueueSummary,
  sortReviewItems,
  statusesForReviewTab,
  applyPinnedOrder,
  describeAnalysisError,
  REVIEW_WEBSITE_STATE_LABEL,
  countMoreFilters,
  quickFilterFor,
  REVIEW_QUICK_FILTERS,
  formatReviewScore,
  REVIEW_ANALYSIS_STATE_LABEL,
  hasActiveReviewFilters,
  NO_REVIEW_FILTERS,
  reviewAnalysisState,
  pageRange,
  parsePage,
  parseReviewQuery,
  type ReviewOrderContext,
  reviewNeighbours,
  reviewWebsiteState,
} from "./reviewQueue";
import type { DiscoveredBusinessReviewItem, DiscoveredBusinessStatus } from "./api";

function item(overrides: Partial<DiscoveredBusinessReviewItem> = {}): DiscoveredBusinessReviewItem {
  return {
    id: overrides.id ?? "biz-1",
    name: "Acme Plumbing",
    industry: "Plumbing",
    suburb: "Southport",
    state: "QLD",
    business_category: null,
    website_url: null,
    website_status: "none",
    website_kind: null,
    website_platform: null,
    status: "new",
    source_provider: "brave",
    discovered_at: "2026-09-01T00:00:00Z",
    imported_lead_id: null,
    reviewed_by_user_name: null,
    reviewed_at: null,
    review_queued_at: null,
    instagram_handle: null,
    instagram_website_status: null,
    instagram_website_checked_at: null,
    raw_snippet: null,
    researched_at: null,
    research_error: null,
    quality_summary: null,
    key_problems: [],
    opportunity_score: null,
    score_category: null,
    confidence: null,
    recommended_sales_angle: null,
    google_rating: null,
    google_review_count: null,
    review_health_score: null,
    review_activity_level: null,
    ...overrides,
  };
}

describe("REVIEW_TABS", () => {
  it("covers every non-archived-only status at least once", () => {
    const covered = new Set(REVIEW_TABS.flatMap((t) => t.statuses ?? []));
    const all: DiscoveredBusinessStatus[] = [
      "new", "researched", "audited", "scored", "approved", "rejected", "archived", "imported",
    ];
    for (const s of all) expect(covered.has(s)).toBe(true);
  });

  it("assigns each status to exactly one non-All tab", () => {
    const seen = new Map<string, number>();
    for (const t of REVIEW_TABS) {
      if (t.id === "all") continue;
      for (const s of t.statuses ?? []) seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    for (const [, n] of seen) expect(n).toBe(1);
  });
});

describe("isReviewTab", () => {
  it("accepts known ids and rejects everything else", () => {
    expect(isReviewTab("needs_review")).toBe(true);
    expect(isReviewTab("bogus")).toBe(false);
    expect(isReviewTab(null)).toBe(false);
  });
});

describe("reviewItemMatchesTab", () => {
  it("All matches everything except archived", () => {
    expect(reviewItemMatchesTab(item({ status: "new" }), "all")).toBe(true);
    expect(reviewItemMatchesTab(item({ status: "archived" }), "all")).toBe(false);
  });
  it("groups new/researched/audited/scored under Needs review", () => {
    expect(reviewItemMatchesTab(item({ status: "scored" }), "needs_review")).toBe(true);
    expect(reviewItemMatchesTab(item({ status: "approved" }), "needs_review")).toBe(false);
  });
  it("Archived only matches archived", () => {
    expect(reviewItemMatchesTab(item({ status: "archived" }), "archived")).toBe(true);
    expect(reviewItemMatchesTab(item({ status: "rejected" }), "archived")).toBe(false);
  });
});

describe("statusesForReviewTab", () => {
  it("returns null for All and a list otherwise", () => {
    expect(statusesForReviewTab("all")).toBeNull();
    expect(statusesForReviewTab("approved")).toEqual(["approved"]);
  });
});

describe("countReviewItemsByTab", () => {
  it("counts per tab", () => {
    const items = [
      item({ status: "new" }),
      item({ status: "scored" }),
      item({ status: "approved" }),
      item({ status: "archived" }),
    ];
    const c = countReviewItemsByTab(items);
    expect(c.all).toBe(3);
    expect(c.needs_review).toBe(2);
    expect(c.approved).toBe(1);
    expect(c.archived).toBe(1);
  });
});

describe("reviewItemNeedsAttention", () => {
  it("flags a pending item with a research error", () => {
    expect(reviewItemNeedsAttention(item({ status: "researched", research_error: "timeout" }))).toBe(true);
  });
  it("flags a pending item scored 'review' for thin evidence", () => {
    expect(reviewItemNeedsAttention(item({ status: "scored", score_category: "review" }))).toBe(true);
  });
  it("does not flag a clean pending item", () => {
    expect(reviewItemNeedsAttention(item({ status: "scored", score_category: "hot" }))).toBe(false);
  });
  it("does not flag an already-decided item even with a stale research error", () => {
    expect(reviewItemNeedsAttention(item({ status: "approved", research_error: "timeout" }))).toBe(false);
  });
});

describe("reviewQueueSummary", () => {
  it("tallies pending/approved/rejected/needs-attention", () => {
    const items = [
      item({ status: "new" }),
      item({ status: "scored", score_category: "review" }),
      item({ status: "approved" }),
      item({ status: "rejected" }),
    ];
    const s = reviewQueueSummary(items);
    expect(s.pending).toBe(2);
    expect(s.approved).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.needsAttention).toBe(1);
  });
});

describe("reviewItemMatchesQuery", () => {
  it("matches name, industry, suburb, state case-insensitively", () => {
    const biz = item({ name: "Acme Plumbing", industry: "Plumbing", suburb: "Southport", state: "QLD" });
    expect(reviewItemMatchesQuery(biz, "acme")).toBe(true);
    expect(reviewItemMatchesQuery(biz, "PLUMB")).toBe(true);
    expect(reviewItemMatchesQuery(biz, "southport")).toBe(true);
    expect(reviewItemMatchesQuery(biz, "qld")).toBe(true);
    expect(reviewItemMatchesQuery(biz, "electrician")).toBe(false);
  });
  it("an empty query matches everything", () => {
    expect(reviewItemMatchesQuery(item(), "   ")).toBe(true);
  });
});

describe("sortReviewItems", () => {
  it("sorts by score descending, nulls last", () => {
    const items = [item({ id: "a", opportunity_score: 40 }), item({ id: "b", opportunity_score: null }), item({ id: "c", opportunity_score: 90 })];
    expect(sortReviewItems(items, "score").map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
  it("sorts by name A-Z", () => {
    const items = [item({ id: "a", name: "Zed" }), item({ id: "b", name: "Acme" })];
    expect(sortReviewItems(items, "name").map((i) => i.id)).toEqual(["b", "a"]);
  });
  it("sorts by newest first", () => {
    const items = [
      item({ id: "a", discovered_at: "2026-09-01T00:00:00Z" }),
      item({ id: "b", discovered_at: "2026-09-05T00:00:00Z" }),
    ];
    expect(sortReviewItems(items, "newest").map((i) => i.id)).toEqual(["b", "a"]);
  });
  it("does not mutate the input array", () => {
    const items = [item({ id: "a", name: "Zed" }), item({ id: "b", name: "Acme" })];
    sortReviewItems(items, "name");
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("row status derivation", () => {
  it("derives website state from evidence, never guessing", () => {
    // A URL on record is only "listed" — nothing has verified it.
    expect(reviewWebsiteState(item({ website_status: "found" }))).toBe("listed");
    expect(reviewWebsiteState(item({ website_status: "none" }))).toBe("none");
    expect(reviewWebsiteState(item({ website_status: "unknown" }))).toBe("check");
  });

  it("treats an unchecked Instagram candidate as needing a check even if website_status says none", () => {
    expect(
      reviewWebsiteState(
        item({ website_status: "none", instagram_handle: "acme", source_provider: "instagram_search" }),
      ),
    ).toBe("check");
  });

  it("keeps analysis state separate: failed beats done, no timestamp is not_run", () => {
    expect(reviewAnalysisState(item({ research_error: "timeout", researched_at: "2026-09-01T00:00:00Z" }))).toBe("failed");
    expect(reviewAnalysisState(item({ researched_at: "2026-09-01T00:00:00Z" }))).toBe("done");
    expect(reviewAnalysisState(item())).toBe("not_run");
  });

  it("distinguishes an unavailable score from zero", () => {
    expect(formatReviewScore(null)).toBe("Not assessed");
    expect(formatReviewScore(0)).toBe("0");
    expect(formatReviewScore(72)).toBe("72");
  });
});

describe("misleading-state regressions", () => {
  it("never presents a Facebook/Instagram URL as an owned website", () => {
    const fb = item({ website_status: "found", website_url: "https://www.facebook.com/x", website_kind: "social_profile", website_platform: "Facebook" });
    expect(reviewWebsiteState(fb)).toBe("social");
    expect(REVIEW_WEBSITE_STATE_LABEL[reviewWebsiteState(fb)]).not.toMatch(/found|website listed/i);
  });

  it("labels a plain listed URL 'Website listed', not 'Website found'", () => {
    expect(REVIEW_WEBSITE_STATE_LABEL.listed).toBe("Website listed");
    expect(Object.values(REVIEW_WEBSITE_STATE_LABEL)).not.toContain("Website found");
  });

  it("a social profile has no site to analyse, even if an old research row failed", () => {
    expect(
      reviewAnalysisState(item({ website_kind: "social_profile", research_error: "Could not resolve hostname 'www.facebook.com'" })),
    ).toBe("not_applicable");
  });

  it("describes analysis errors as check failures, never as site defects", () => {
    for (const e of [
      "Could not resolve hostname 'x.com.au': [Errno 8] nodename nor servname",
      "Page.goto: Timeout 15000ms exceeded.",
      "Page.goto: net::ERR_CERT_DATE_INVALID at https://x",
      "BrowserType.launch: Executable doesn't exist at /x",
      "something else entirely",
    ]) {
      const text = describeAnalysisError(e);
      expect(text).not.toMatch(/broken|down|defect|poor/i);
      expect(text.length).toBeGreaterThan(10);
    }
    expect(describeAnalysisError("Could not resolve hostname 'x'")).toMatch(/address/);
    expect(describeAnalysisError(null)).toBeTruthy();
  });
});

describe("filter helpers", () => {
  const f = (o: Partial<typeof NO_REVIEW_FILTERS>) => ({ ...NO_REVIEW_FILTERS, ...o });
  it("reports active filters and counts only the More-filters ones", () => {
    expect(hasActiveReviewFilters(NO_REVIEW_FILTERS)).toBe(false);
    expect(hasActiveReviewFilters(f({ score: "hot" }))).toBe(true);
    // A quick-filter analysis value isn't a "More" filter; website and score are, and so is not_run.
    expect(countMoreFilters(f({ score: "hot", analysis: "failed", website: "has" }))).toBe(2);
    expect(countMoreFilters(f({ analysis: "not_run" }))).toBe(1);
    expect(hasActiveReviewFilters(f({ analysis: "done" }))).toBe(true);
  });
  it("maps quick filters to real analysis states", () => {
    expect(REVIEW_QUICK_FILTERS.map((q) => [q.id, q.analysis])).toEqual([
      ["all", ""],
      ["ready", "done"],
      ["attention", "failed"],
    ]);
    expect(quickFilterFor("")).toBe("all");
    expect(quickFilterFor("done")).toBe("ready");
    expect(quickFilterFor("failed")).toBe("attention");
    expect(quickFilterFor("not_run")).toBeNull();
  });
});

describe("pagination helpers", () => {
  it("parses pages defensively", () => {
    expect(parsePage(null)).toBe(1);
    expect(parsePage("3")).toBe(3);
    for (const bad of ["0", "-2", "abc", "1.5", ""]) expect(parsePage(bad)).toBe(1);
  });

  it("computes the shown range, including a partial last page and an empty page", () => {
    expect(pageRange(1, 10, 10)).toEqual({ from: 1, to: 10 });
    expect(pageRange(7, 10, 4)).toEqual({ from: 61, to: 64 });
    expect(pageRange(1, 10, 0)).toBeNull();
  });

  it("round-trips the whole query through the URL, defaulting invalid values", () => {
    const q = parseReviewQuery(new URLSearchParams("tab=approved&search=cafe&website=check&analysis=failed&score=hot&sort=name&page=4"));
    expect(q).toEqual({ tab: "approved", search: "cafe", website: "check", analysis: "failed", score: "hot", sort: "name", page: 4 });
    expect(parseReviewQuery(new URLSearchParams("tab=bogus&sort=zzz&page=-1&website=x"))).toEqual({
      tab: "needs_review", search: "", website: "", analysis: "", score: "", sort: "score", page: 1,
    });
  });
});

describe("review order helpers", () => {
  const ctx = (o: Partial<ReviewOrderContext> = {}): ReviewOrderContext => ({
    ids: ["a", "b", "c"], page: 2, pageSize: 10, total: 25, totalPages: 3, query: "page=2", ...o,
  });

  it("positions within the whole queue and flags adjacent pages only at page edges", () => {
    expect(reviewNeighbours(ctx(), "a")).toEqual({
      previous: null, next: "b", hasPreviousPage: true, hasNextPage: false, position: 11, total: 25,
    });
    expect(reviewNeighbours(ctx(), "b")).toMatchObject({ previous: "a", next: "c", hasPreviousPage: false, hasNextPage: false });
    expect(reviewNeighbours(ctx(), "c")).toMatchObject({ next: null, hasNextPage: true, position: 13 });
  });

  it("has no adjacent page beyond the first/last page, and null for an unknown id or no context", () => {
    expect(reviewNeighbours(ctx({ page: 1 }), "a")?.hasPreviousPage).toBe(false);
    expect(reviewNeighbours(ctx({ page: 3 }), "c")?.hasNextPage).toBe(false);
    expect(reviewNeighbours(ctx(), "zzz")).toBeNull();
    expect(reviewNeighbours(null, "a")).toBeNull();
  });

  it("re-applies a pinned order, sending unknown ids last", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(applyPinnedOrder(rows, ["c", "a", "b"]).map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
    expect(applyPinnedOrder(rows, null)).toBe(rows);
  });
});

describe("analysis state labels", () => {
  it("uses the four plain-language states", () => {
    expect(REVIEW_ANALYSIS_STATE_LABEL).toEqual({
      done: "Ready to review",
      failed: "Check unavailable",
      not_run: "Not checked",
      not_applicable: "Not checked",
    });
  });
});
