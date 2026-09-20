import { describe, expect, it } from "vitest";
import { buildFunnel, leadsHrefForStage } from "./pipelineFunnel";
import type { LeadStatus } from "./api";

const STAGES = [
  { key: "new", label: "New", sort_order: 0, is_won: false, is_lost: false },
  { key: "contacted", label: "Contacted", sort_order: 3, is_won: false, is_lost: false },
  { key: "proposal", label: "Proposal", sort_order: 6, is_won: false, is_lost: false },
  { key: "won", label: "Won", sort_order: 7, is_won: true, is_lost: false },
  { key: "lost", label: "Lost", sort_order: 8, is_won: false, is_lost: true },
  { key: "nurture", label: "Nurture", sort_order: 9, is_won: false, is_lost: false },
] as const;

const lead = (status: LeadStatus, archived = false) => ({
  status,
  archived_at: archived ? "2026-08-01T00:00:00Z" : null,
});

describe("buildFunnel", () => {
  it("returns one segment per stage, in stage order, with counts and shares", () => {
    const funnel = buildFunnel(STAGES, [lead("new"), lead("new"), lead("new"), lead("contacted"), lead("won")]);
    expect(funnel.segments.map((s) => s.key)).toEqual(["new", "contacted", "proposal", "won", "lost", "nurture"]);
    expect(funnel.segments.map((s) => s.count)).toEqual([3, 1, 0, 1, 0, 0]);
    expect(funnel.total).toBe(5);
    expect(funnel.segments[0].share).toBeCloseTo(0.6);
    expect(funnel.segments[2].share).toBe(0);
  });

  it("orders by sort_order, not by the order the stages arrive in", () => {
    const shuffled = [STAGES[3], STAGES[0], STAGES[2]];
    expect(buildFunnel(shuffled, []).segments.map((s) => s.key)).toEqual(["new", "proposal", "won"]);
  });

  it("uses the workspace's own stage labels", () => {
    const renamed = [{ ...STAGES[1], label: "Reached out" }];
    expect(buildFunnel(renamed, [lead("contacted")]).segments[0].label).toBe("Reached out");
  });

  it("ignores archived leads", () => {
    const funnel = buildFunnel(STAGES, [lead("new"), lead("new", true), lead("won", true)]);
    expect(funnel.total).toBe(1);
    expect(funnel.segments.find((s) => s.key === "won")?.count).toBe(0);
  });

  it("is a clean empty funnel with no leads: every count and share is 0", () => {
    const funnel = buildFunnel(STAGES, []);
    expect(funnel.total).toBe(0);
    expect(funnel.segments).toHaveLength(6);
    expect(funnel.segments.every((s) => s.count === 0 && s.share === 0)).toBe(true);
  });

  it("does not count leads at a status that has no stage", () => {
    const funnel = buildFunnel([STAGES[0]], [lead("new"), lead("qualified")]);
    expect(funnel.total).toBe(1);
  });

  it("marks won, lost and nurture stages and ramps only the active ones", () => {
    const segs = buildFunnel(STAGES, []).segments;
    expect(segs.map((s) => s.tone)).toEqual(["active", "active", "active", "won", "lost", "parked"]);
    expect(segs.map((s) => s.depth)).toEqual([0, 0.5, 1, 0, 0, 0]);
  });

  it("falls back to every status in order when the stages are missing", () => {
    for (const stages of [null, []]) {
      const funnel = buildFunnel(stages, [lead("replied")]);
      expect(funnel.segments).toHaveLength(10);
      expect(funnel.segments[0].key).toBe("new");
      expect(funnel.segments.find((s) => s.key === "replied")?.count).toBe(1);
      expect(funnel.segments.find((s) => s.key === "won")?.tone).toBe("won");
    }
  });
});

describe("leadsHrefForStage", () => {
  it("links to the Leads list filtered to that exact status", () => {
    expect(leadsHrefForStage("contacted")).toBe("/dashboard/sales/leads?status=contacted");
  });
});
