import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverview } from "./api";

const overview = vi.hoisted(() => ({ calls: 0 }));

vi.mock("./api", () => ({
  api: {
    dashboardOverview: vi.fn(async (): Promise<DashboardOverview> => {
      overview.calls += 1;
      return {
        total_leads: overview.calls, // changes per call so we can tell cache hits from misses
        qualified_leads: 0,
        contacted_leads: 0,
        upcoming_meetings: 0,
        won_projects: 0,
        active_projects: 0,
        websites: { building: 0, in_review: 0, ready_to_launch: 0, deployed: 0, maintenance: 0 },
        revenue_cents: 0,
        tasks_needing_attention: 0,
        follow_ups_due: 0,
        needs_attention: [],
      };
    }),
  },
}));

// Imported after the mock is registered.
const { loadOverview, peekOverview, invalidateOverview } = await import("./overview");

afterEach(() => {
  overview.calls = 0;
  invalidateOverview();
});

describe("loadOverview", () => {
  it("serves a second call from cache within the freshness window", async () => {
    const a = await loadOverview();
    const b = await loadOverview();
    expect(a.total_leads).toBe(1);
    expect(b.total_leads).toBe(1);
    expect(overview.calls).toBe(1);
  });

  it("dedupes concurrent callers onto one in-flight request", async () => {
    const [a, b] = await Promise.all([loadOverview(), loadOverview()]);
    expect(a).toBe(b);
    expect(overview.calls).toBe(1);
  });

  it("refetches when forced", async () => {
    await loadOverview();
    const forced = await loadOverview({ force: true });
    expect(forced.total_leads).toBe(2);
    expect(overview.calls).toBe(2);
  });

  it("refetches after invalidateOverview()", async () => {
    await loadOverview();
    invalidateOverview();
    await loadOverview();
    expect(overview.calls).toBe(2);
  });
});

describe("peekOverview", () => {
  it("is null before any load and the cached value after", async () => {
    expect(peekOverview()).toBeNull();
    await loadOverview();
    expect(peekOverview()?.total_leads).toBe(1);
  });
});
