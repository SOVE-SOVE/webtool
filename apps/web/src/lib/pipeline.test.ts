import { describe, expect, it } from "vitest";
import { countStale, daysSince, groupLeadsByStatus, isStale, orderStages, stageByKey } from "./pipeline";
import type { Lead, PipelineStage } from "./api";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
    business_id: "b1",
    business_name: "Riverside Plumbing",
    industry: null,
    suburb: null,
    state: null,
    status: "new",
    priority: "medium",
    score: null,
    source: null,
    notes: null,
    archived_at: null,
    assigned_user_id: null,
    assigned_user_name: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as Lead;
}

function stage(overrides: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id: "s1",
    key: "new",
    label: "New",
    sort_order: 0,
    is_won: false,
    is_lost: false,
    ...overrides,
  } as PipelineStage;
}

const NOW = new Date("2026-08-24T00:00:00Z").getTime();

describe("daysSince", () => {
  it("counts whole days between the timestamp and now", () => {
    expect(daysSince("2026-08-19T00:00:00Z", NOW)).toBe(5);
    expect(daysSince("2026-08-24T00:00:00Z", NOW)).toBe(0);
  });
});

describe("isStale", () => {
  it("is false with no matching stage", () => {
    expect(isStale(lead({ updated_at: "2026-08-01T00:00:00Z" }), undefined, NOW)).toBe(false);
  });

  it("is false for won/lost stages regardless of age", () => {
    const old = lead({ updated_at: "2026-01-01T00:00:00Z" });
    expect(isStale(old, stage({ is_won: true }), NOW)).toBe(false);
    expect(isStale(old, stage({ is_lost: true }), NOW)).toBe(false);
  });

  it("is false under the threshold and true at/over it", () => {
    const fresh = lead({ updated_at: "2026-08-21T00:00:00Z" }); // 3 days
    const stale = lead({ updated_at: "2026-08-19T00:00:00Z" }); // 5 days
    expect(isStale(fresh, stage(), NOW)).toBe(false);
    expect(isStale(stale, stage(), NOW)).toBe(true);
  });
});

describe("orderStages", () => {
  it("sorts by sort_order without mutating the input", () => {
    const input = [stage({ id: "b", sort_order: 2 }), stage({ id: "a", sort_order: 0 })];
    const result = orderStages(input);
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
    expect(input.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("groupLeadsByStatus", () => {
  it("buckets leads by their status", () => {
    const leads = [lead({ id: "l1", status: "new" }), lead({ id: "l2", status: "won" }), lead({ id: "l3", status: "new" })];
    const grouped = groupLeadsByStatus(leads);
    expect(grouped.get("new")?.map((l) => l.id)).toEqual(["l1", "l3"]);
    expect(grouped.get("won")?.map((l) => l.id)).toEqual(["l2"]);
    expect(grouped.get("lost")).toBeUndefined();
  });
});

describe("stageByKey", () => {
  it("indexes stages by their key", () => {
    const map = stageByKey([stage({ key: "new" }), stage({ key: "won", is_won: true })]);
    expect(map.get("new")?.is_won).toBe(false);
    expect(map.get("won")?.is_won).toBe(true);
  });
});

describe("countStale", () => {
  it("counts only non-terminal leads over the threshold", () => {
    const leads = [
      lead({ id: "l1", status: "new", updated_at: "2026-08-19T00:00:00Z" }), // stale
      lead({ id: "l2", status: "new", updated_at: "2026-08-23T00:00:00Z" }), // fresh
      lead({ id: "l3", status: "won", updated_at: "2026-01-01T00:00:00Z" }), // terminal, excluded
    ];
    const stages = [stage({ key: "new" }), stage({ key: "won", is_won: true })];
    expect(countStale(leads, stages, NOW)).toBe(1);
  });
});
