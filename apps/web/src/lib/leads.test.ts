import { describe, expect, it } from "vitest";
import {
  countLeadsByTab,
  isLeadTab,
  LEAD_STATUS_LABEL,
  LEAD_TABS,
  leadMatchesTab,
  leadNextAction,
  leadTone,
  statusesForTab,
} from "./leads";
import type { LeadStatus } from "./api";

const ALL_STATUSES: LeadStatus[] = [
  "new", "researched", "qualified", "contacted", "replied",
  "meeting", "proposal", "won", "lost", "nurture",
];

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

describe("LEAD_STATUS_LABEL", () => {
  it("has a human label for every status", () => {
    for (const s of ALL_STATUSES) {
      expect(LEAD_STATUS_LABEL[s]).toBeTruthy();
    }
  });
});

describe("leadTone", () => {
  it("groups statuses into five tones", () => {
    expect(leadTone("new")).toBe("new");
    expect(leadTone("researched")).toBe("new");
    expect(leadTone("qualified")).toBe("new");
    expect(leadTone("contacted")).toBe("active");
    expect(leadTone("replied")).toBe("active");
    expect(leadTone("proposal")).toBe("active");
    expect(leadTone("won")).toBe("won");
    expect(leadTone("lost")).toBe("lost");
    expect(leadTone("nurture")).toBe("nurture");
  });
});

describe("leadNextAction", () => {
  const now = new Date("2026-09-10T12:00:00Z").getTime();

  it("prioritises a scheduled follow-up over status", () => {
    expect(leadNextAction({ status: "new" }, "2026-09-10", now)).toBe("Follow up today");
    expect(leadNextAction({ status: "new" }, "2026-09-05", now)).toBe("Follow-up overdue");
    expect(leadNextAction({ status: "new" }, "2026-09-20", now)).toMatch(/^Follow up /);
  });

  it("falls back to a status hint when there is no follow-up", () => {
    expect(leadNextAction({ status: "new" }, null, now)).toBe("Needs first contact");
    expect(leadNextAction({ status: "qualified" }, undefined, now)).toBe("Needs first contact");
    expect(leadNextAction({ status: "contacted" }, null, now)).toBe("Waiting on a reply");
    expect(leadNextAction({ status: "replied" }, null, now)).toBe("Move toward a proposal");
    expect(leadNextAction({ status: "meeting" }, null, now)).toBe("Move toward a proposal");
    expect(leadNextAction({ status: "proposal" }, null, now)).toBe("Chase the proposal");
    expect(leadNextAction({ status: "won" }, null, now)).toBe("Convert to a client");
    expect(leadNextAction({ status: "nurture" }, null, now)).toBe("Check back later");
    expect(leadNextAction({ status: "lost" }, null, now)).toBe("—");
  });

  it("returns a non-empty string for every status", () => {
    for (const s of ALL_STATUSES) {
      expect(leadNextAction({ status: s }, null, now).length).toBeGreaterThan(0);
    }
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
