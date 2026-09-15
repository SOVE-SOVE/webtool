import { describe, expect, it } from "vitest";
import {
  countLeadsByTab,
  isLeadTab,
  LEAD_STATUS_LABEL,
  LEAD_TABS,
  leadMatchesTab,
  leadNextAction,
  leadTone,
  sortLeads,
  statusesForTab,
} from "./leads";
import type { Lead, LeadPriority, LeadStatus } from "./api";

const ALL_STATUSES: LeadStatus[] = [
  "new", "researched", "qualified", "contacted", "replied",
  "meeting", "proposal", "won", "lost", "nurture",
];

function lead(status: LeadStatus, archived = false, clientId: string | null = null) {
  return { status, archived_at: archived ? "2026-08-01T00:00:00Z" : null, client_id: clientId };
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

  it("matches Converted on client_id, not status", () => {
    expect(leadMatchesTab(lead("won", false, "c1"), "converted")).toBe(true);
    expect(leadMatchesTab(lead("won"), "converted")).toBe(false);
  });

  it("excludes an already-converted lead from every other tab, including All and Won", () => {
    const converted = lead("won", false, "c1");
    expect(leadMatchesTab(converted, "all")).toBe(false);
    expect(leadMatchesTab(converted, "won")).toBe(false);
  });

  it("keeps a won-but-not-yet-converted lead visible under All and Won", () => {
    const won = lead("won");
    expect(leadMatchesTab(won, "all")).toBe(true);
    expect(leadMatchesTab(won, "converted")).toBe(false);
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
    expect(leadNextAction({ status: "new", client_id: null }, "2026-09-10", now)).toBe("Follow up today");
    expect(leadNextAction({ status: "new", client_id: null }, "2026-09-05", now)).toBe("Follow-up overdue");
    expect(leadNextAction({ status: "new", client_id: null }, "2026-09-20", now)).toMatch(/^Follow up /);
  });

  it("falls back to a status hint when there is no follow-up", () => {
    expect(leadNextAction({ status: "new", client_id: null }, null, now)).toBe("Needs first contact");
    expect(leadNextAction({ status: "qualified", client_id: null }, undefined, now)).toBe("Needs first contact");
    expect(leadNextAction({ status: "contacted", client_id: null }, null, now)).toBe("Waiting on a reply");
    expect(leadNextAction({ status: "replied", client_id: null }, null, now)).toBe("Move toward a proposal");
    expect(leadNextAction({ status: "meeting", client_id: null }, null, now)).toBe("Move toward a proposal");
    expect(leadNextAction({ status: "proposal", client_id: null }, null, now)).toBe("Chase the proposal");
    expect(leadNextAction({ status: "won", client_id: null }, null, now)).toBe("Convert to a client");
    expect(leadNextAction({ status: "nurture", client_id: null }, null, now)).toBe("Check back later");
    expect(leadNextAction({ status: "lost", client_id: null }, null, now)).toBe("—");
  });

  it("returns a non-empty string for every status", () => {
    for (const s of ALL_STATUSES) {
      expect(leadNextAction({ status: s, client_id: null }, null, now).length).toBeGreaterThan(0);
    }
  });

  it("shows a client-record hint once a lead has been converted, regardless of status or follow-up", () => {
    expect(leadNextAction({ status: "won", client_id: "c1" }, null, now)).toBe("Open the client record");
    expect(leadNextAction({ status: "won", client_id: "c1" }, "2026-09-05", now)).toBe("Open the client record");
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

function fullLead(overrides: Partial<Lead> & { id: string }): Lead {
  return {
    business_id: overrides.id,
    client_id: null,
    planning_id: null,
    prospect_project: null,
    business_name: overrides.id,
    industry: null,
    suburb: null,
    state: null,
    website_url: null,
    business_email: null,
    business_phone: null,
    status: "new",
    priority: "medium" as LeadPriority,
    score: null,
    source: null,
    notes: null,
    archived_at: null,
    assigned_user_id: null,
    assigned_user_name: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    google_rating: null,
    google_review_count: null,
    review_health_score: null,
    review_activity_level: null,
    review_frequency_per_month: null,
    review_sentiment_trend: null,
    positive_review_themes: [],
    negative_review_themes: [],
    review_summary: null,
    review_data_updated_at: null,
    ...overrides,
  };
}

describe("sortLeads", () => {
  it("sinks archived leads to the bottom regardless of sort", () => {
    const leads = [
      fullLead({ id: "archived", archived_at: "2026-08-01T00:00:00Z", priority: "high" }),
      fullLead({ id: "active", priority: "low" }),
    ];
    const sorted = sortLeads(leads, "priority");
    expect(sorted.map((l) => l.id)).toEqual(["active", "archived"]);
  });

  it("orders by priority high -> medium -> low, then recency as a tiebreak", () => {
    const leads = [
      fullLead({ id: "low", priority: "low", updated_at: "2026-09-03T00:00:00Z" }),
      fullLead({ id: "high-old", priority: "high", updated_at: "2026-09-01T00:00:00Z" }),
      fullLead({ id: "high-new", priority: "high", updated_at: "2026-09-02T00:00:00Z" }),
      fullLead({ id: "medium", priority: "medium", updated_at: "2026-09-04T00:00:00Z" }),
    ];
    const sorted = sortLeads(leads, "priority");
    expect(sorted.map((l) => l.id)).toEqual(["high-new", "high-old", "medium", "low"]);
  });

  it("orders by score descending, with unscored leads sinking below scored ones", () => {
    const leads = [
      fullLead({ id: "unscored", score: null }),
      fullLead({ id: "low-score", score: 20 }),
      fullLead({ id: "high-score", score: 90 }),
    ];
    const sorted = sortLeads(leads, "score");
    expect(sorted.map((l) => l.id)).toEqual(["high-score", "low-score", "unscored"]);
  });

  it("orders by nearest follow-up due date, with no-follow-up leads last", () => {
    const leads = [
      fullLead({ id: "none" }),
      fullLead({ id: "later" }),
      fullLead({ id: "soonest" }),
    ];
    const followUps = new Map([
      ["later", "2026-09-20"],
      ["soonest", "2026-09-10"],
    ]);
    const sorted = sortLeads(leads, "follow_up", followUps);
    expect(sorted.map((l) => l.id)).toEqual(["soonest", "later", "none"]);
  });

  it("defaults to most-recently-updated first", () => {
    const leads = [
      fullLead({ id: "older", updated_at: "2026-09-01T00:00:00Z" }),
      fullLead({ id: "newer", updated_at: "2026-09-05T00:00:00Z" }),
    ];
    expect(sortLeads(leads, "updated").map((l) => l.id)).toEqual(["newer", "older"]);
  });
});
