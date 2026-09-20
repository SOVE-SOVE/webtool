import { describe, expect, it } from "vitest";
import {
  cumulativeRevenue,
  evenIndices,
  formatAxisCents,
  MIN_AXIS_CENTS,
  nearestIndex,
  niceAxis,
  parseDateKey,
  rangeQuery,
  stepPath,
} from "./revenueChart";
import type { WonDealsSeries } from "./api";

function series(overrides: Partial<WonDealsSeries> = {}): WonDealsSeries {
  return {
    start_date: "2026-03-01",
    end_date: "2026-03-04",
    group_by: "day",
    points: [
      { period_start: "2026-03-01", deals_count: 0, revenue_cents: 0, unpriced_deals_count: 0 },
      { period_start: "2026-03-02", deals_count: 2, revenue_cents: 100000, unpriced_deals_count: 1 },
      { period_start: "2026-03-03", deals_count: 0, revenue_cents: 0, unpriced_deals_count: 0 },
      { period_start: "2026-03-04", deals_count: 1, revenue_cents: 50000, unpriced_deals_count: 0 },
    ],
    total_deals_count: 3,
    total_revenue_cents: 150000,
    total_unpriced_deals_count: 1,
    prior_deals_count: 1,
    prior_revenue_cents: 70000,
    undated_deals_count: 0,
    undated_revenue_cents: 0,
    ...overrides,
  };
}

describe("rangeQuery", () => {
  const today = new Date(2026, 8, 20); // 20 Sep 2026

  it("ends today and covers exactly N days (inclusive)", () => {
    expect(rangeQuery("30d", today)).toEqual({ start: "2026-08-22", end: "2026-09-20", groupBy: "day" });
    expect(rangeQuery("90d", today)).toEqual({ start: "2026-06-23", end: "2026-09-20", groupBy: "day" });
  });

  it("groups a year by week", () => {
    const q = rangeQuery("12m", today);
    expect(q.groupBy).toBe("week");
    expect(q.end).toBe("2026-09-20");
    expect(q.start).toBe("2025-09-22");
  });

  it("handles a month boundary", () => {
    expect(rangeQuery("30d", new Date(2026, 2, 5)).start).toBe("2026-02-04");
  });
});

describe("parseDateKey", () => {
  it("parses as a local calendar day", () => {
    const d = parseDateKey("2026-03-02");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 2]);
  });
});

describe("cumulativeRevenue", () => {
  it("starts from the pre-range opening balance and accumulates", () => {
    expect(cumulativeRevenue(series()).map((p) => p.cumulativeCents)).toEqual([70000, 170000, 170000, 220000]);
  });

  it("carries deal counts and unpriced counts per period", () => {
    const pts = cumulativeRevenue(series());
    expect(pts[1]).toMatchObject({ date: "2026-03-02", dealsCount: 2, revenueCents: 100000, unpricedCount: 1 });
  });

  it("is a flat line at the opening balance when nothing was won in range", () => {
    const flat = series({
      points: [
        { period_start: "2026-03-01", deals_count: 0, revenue_cents: 0, unpriced_deals_count: 0 },
        { period_start: "2026-03-02", deals_count: 0, revenue_cents: 0, unpriced_deals_count: 0 },
      ],
    });
    expect(cumulativeRevenue(flat).map((p) => p.cumulativeCents)).toEqual([70000, 70000]);
  });

  it("is all zero for an empty workspace", () => {
    const empty = series({
      points: [{ period_start: "2026-03-01", deals_count: 0, revenue_cents: 0, unpriced_deals_count: 0 }],
      prior_revenue_cents: 0,
    });
    expect(cumulativeRevenue(empty).map((p) => p.cumulativeCents)).toEqual([0]);
  });

  it("returns [] for no points", () => {
    expect(cumulativeRevenue(series({ points: [] }))).toEqual([]);
  });
});

describe("niceAxis", () => {
  it("covers the max with clean ticks starting at 0", () => {
    const { max, ticks } = niceAxis(1_190_000); // $11,900
    expect(ticks[0]).toBe(0);
    expect(max).toBeGreaterThanOrEqual(1_190_000);
    expect(ticks[ticks.length - 1]).toBe(max);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });

  it("never collapses below the minimum scale, even for zero", () => {
    for (const value of [0, 1, 5000]) {
      const { max, ticks } = niceAxis(value);
      expect(max).toBeGreaterThanOrEqual(MIN_AXIS_CENTS);
      expect(ticks[0]).toBe(0);
      expect(ticks.length).toBeGreaterThan(1);
    }
  });

  it("uses evenly spaced ticks", () => {
    const { ticks } = niceAxis(730_000);
    const steps = ticks.slice(1).map((t, i) => t - ticks[i]);
    expect(new Set(steps).size).toBe(1);
  });

  it("scales up for large values", () => {
    expect(niceAxis(250_000_000).max).toBeGreaterThanOrEqual(250_000_000);
  });
});

describe("formatAxisCents", () => {
  it("formats compactly", () => {
    expect(formatAxisCents(0)).toBe("$0");
    expect(formatAxisCents(25_000)).toBe("$250");
    expect(formatAxisCents(150_000)).toBe("$1.5k");
    expect(formatAxisCents(1_200_000)).toBe("$12k");
    expect(formatAxisCents(120_000_000)).toBe("$1.2M");
  });
});

describe("stepPath", () => {
  it("holds flat then jumps at the next point", () => {
    expect(stepPath([0, 10, 20], [50, 50, 20])).toBe("M0 50 H10 V50 H20 V20");
  });

  it("closes down to the baseline for a fill", () => {
    expect(stepPath([0, 10], [30, 10], 100)).toBe("M0 30 H10 V10 V100 H0 Z");
  });

  it("is empty for no points and a lone move for one", () => {
    expect(stepPath([], [])).toBe("");
    expect(stepPath([5], [7])).toBe("M5 7");
  });
});

describe("nearestIndex / evenIndices", () => {
  it("snaps to the closest x", () => {
    expect(nearestIndex([0, 10, 20, 30], 14)).toBe(1);
    expect(nearestIndex([0, 10, 20, 30], 26)).toBe(3);
    expect(nearestIndex([], 5)).toBe(-1);
  });

  it("picks evenly spread label positions including both ends", () => {
    expect(evenIndices(90, 4)).toEqual([0, 30, 59, 89]);
    expect(evenIndices(3, 5)).toEqual([0, 1, 2]);
    expect(evenIndices(0, 4)).toEqual([]);
  });
});
