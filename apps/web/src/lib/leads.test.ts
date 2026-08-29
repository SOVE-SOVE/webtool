import { describe, expect, it } from "vitest";
import { countLeadsByTab, isLeadTab, LEAD_TABS, leadMatchesTab, statusesForTab } from "./leads";
import type { LeadStatus } from "./api";

function lead(status: LeadStatus, archived = false) {
  return { status, archived_at: archived ? "2026-08-01T00:00:00Z" : null };
}

describe("LEAD_TABS", () => {
  it("covers every LeadStatus at least once across the non-All tabs", () => {
    const covered = new Set(LEAD_TABS.flatMap((t) => t.statuses ?? []));
    const all: LeadStatus[] = [
      "new", "researched", "qualified", "contacted", "replied",
      "meeting", "proposal", "won", "lost", "nurture",
    ];
    for (const s of all) expect(covered.has(s)).toBe(true);
  });

  it("assigns each status to exactly one non-All tab (no overlap)", () => {
    const seen = new Map<string, number>();
    for (const t of LEAD_TABS) {
      for (const s of t.statuses ?? []) seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    for (const [, n] of seen) expect(n).toBe(1);
  });
});

describe("isLeadTab", () => {
  it("accepts known ids and rejects everything else", () => {
    expect(isLeadTab("won")).toBe(true);
    expect(isLeadTab("all")).toBe(true);
    expect(isLeadTab("bogus")).toBe(false);
    expect(isLeadTab(null)).toBe(false);
  });
});

describe("leadMatchesTab", () => {
  it("All matches any status", () => {
    expect(leadMatchesTab(lead("lost"), "all")).toBe(true);
  });
  it("groups replied + meeting under Interested", () => {
    expect(leadMatchesTab(lead("replied"), "interested")).toBe(true);
    expect(leadMatchesTab(lead("meeting"), "interested")).toBe(true);
    expect(leadMatchesTab(lead("contacted"), "interested")).toBe(false);
  });
  it("groups new + researched + qualified under New", () => {
    expect(leadMatchesTab(lead("qualified"), "new")).toBe(true);
    expect(leadMatchesTab(lead("contacted"), "new")).toBe(false);
  });
});

describe("statusesForTab", () => {
  it("returns null for All and a list otherwise", () => {
    expect(statusesForTab("all")).toBeNull();
    expect(statusesForTab("proposal")).toEqual(["proposal"]);
  });
});

describe("countLeadsByTab", () => {
  it("counts per tab and ignores archived", () => {
    const leads = [
      lead("new"), lead("qualified"), lead("contacted"),
      lead("replied"), lead("won"), lead("won", true), // archived won — excluded
    ];
    const c = countLeadsByTab(leads);
    expect(c.all).toBe(5);
    expect(c.new).toBe(2);
    expect(c.contacted).toBe(1);
    expect(c.interested).toBe(1);
    expect(c.won).toBe(1);
    expect(c.lost).toBe(0);
  });
});
