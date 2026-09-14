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
} from "./reviewQueue";
import type { DiscoveredBusinessReviewItem, DiscoveredBusinessStatus } from "./api";

function item(overrides: Partial<DiscoveredBusinessReviewItem> = {}): DiscoveredBusinessReviewItem {
  return {
    id: overrides.id ?? "biz-1",
    name: "Acme Plumbing",
    industry: "Plumbing",
    suburb: "Southport",
    state: "QLD",
    website_url: null,
    website_status: "none",
    status: "new",
    source_provider: "brave",
    discovered_at: "2026-09-01T00:00:00Z",
    imported_lead_id: null,
    reviewed_by_user_name: null,
    reviewed_at: null,
    researched_at: null,
    research_error: null,
    quality_summary: null,
    key_problems: [],
    opportunity_score: null,
    score_category: null,
    confidence: null,
    recommended_sales_angle: null,
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
