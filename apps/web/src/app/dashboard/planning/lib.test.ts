import { describe, expect, it } from "vitest";
import { computeBusinessInputRows, planningMode } from "./lib";
import type { ComparableResearchStatus, Lead, Planning, ReviewIntelligenceResult } from "../../../lib/api";

function planning(overrides: Partial<Planning> = {}): Planning {
  return {
    id: "p1",
    lead_id: "l1",
    lead_business_name: "Coastal Cafe",
    website_url: null,
    website_audit_id: null,
    status: "ready_to_analyse",
    website_summary: null,
    key_points: [],
    operator_notes: null,
    error_message: null,
    current_step: null,
    created_at: "2026-01-01T00:00:00Z",
    analysed_at: null,
    updated_at: "2026-01-01T00:00:00Z",
    has_existing_site: null,
    screenshot_desktop_base64: null,
    screenshot_mobile_base64: null,
    detected_technology: null,
    review_intelligence: null,
    review_summary: null,
    review_website_opportunities: [],
    review_faq_opportunities: [],
    review_website_gaps: [],
    review_insights_generated_at: null,
    recommended_objective: null,
    priority_pages: [],
    content_priorities: [],
    contact_priorities: [],
    visual_priorities: [],
    open_questions: [],
    website_plan_generated_at: null,
    comparable_research_status: null,
    comparable_research_error: null,
    comparable_sites: [],
    comparable_research_patterns: [],
    comparable_research_opportunities: [],
    comparable_research_generated_at: null,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewIntelligenceResult> = {}): ReviewIntelligenceResult {
  return {
    data_status: "ok",
    google_rating: null,
    google_review_count: null,
    review_health_score: null,
    review_activity_level: "unknown",
    review_volume_trend: "insufficient_data",
    ...overrides,
  } as ReviewIntelligenceResult;
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    industry: null,
    suburb: null,
    state: null,
    business_phone: null,
    business_email: null,
    ...overrides,
  } as Lead;
}

describe("planningMode", () => {
  it("is 'existing' once a real audit exists, regardless of website_url", () => {
    expect(planningMode(planning({ website_audit_id: "a1" }))).toBe("existing");
  });

  it("is 'new' with no audit yet, whether or not a website_url is on record", () => {
    expect(planningMode(planning({ website_audit_id: null, website_url: null }))).toBe("new");
    expect(planningMode(planning({ website_audit_id: null, website_url: "https://example.com" }))).toBe("new");
  });
});

describe("computeBusinessInputRows", () => {
  it("marks every row not_checked when nothing is on file", () => {
    const rows = computeBusinessInputRows(planning(), null);
    expect(rows.map((r) => r.state)).toEqual(["not_checked", "not_checked", "not_checked", "not_checked", "not_checked"]);
  });

  it("marks business details/location/contact good once present on the Lead", () => {
    const rows = computeBusinessInputRows(
      planning(),
      lead({ industry: "Cafe", suburb: "Byron Bay", business_phone: "0400000000" }),
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.state]));
    expect(byKey.business_details).toBe("good");
    expect(byKey.location).toBe("good");
    expect(byKey.contact).toBe("good");
  });

  it("reflects the same Google reviews evidence the audit-status row uses", () => {
    const rows = computeBusinessInputRows(
      planning({ review_intelligence: review({ data_status: "ok", review_health_score: 80 }) }),
      null,
    );
    expect(rows.find((r) => r.key === "google_reviews")!.state).toBe("good");
  });

  it.each([
    [null, "not_checked"],
    ["ready_for_review", "review"],
    ["analysing", "review"],
    ["completed", "good"],
    ["needs_review", "improve"],
    ["failed", "improve"],
  ] as [ComparableResearchStatus | null, string][])(
    "maps comparable_research_status %s to row state %s",
    (status, expected) => {
      const rows = computeBusinessInputRows(planning({ comparable_research_status: status }), null);
      expect(rows.find((r) => r.key === "comparable_research")!.state).toBe(expected);
    },
  );
});
