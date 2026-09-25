import { describe, expect, it } from "vitest";
import {
  computeBuildBriefFacts,
  computeBusinessInputRows,
  computeContentDraftReadiness,
  computeInformationToConfirm,
  planningCardAction,
  planningListItemMode,
  planningMode,
} from "./lib";
import type {
  ComparableResearchStatus,
  Lead,
  Planning,
  PlanningListItem,
  PlanningSocialProfile,
  Recommendation,
  ReviewIntelligenceResult,
  SitemapPageProposal,
} from "../../../lib/api";

function listItem(overrides: Partial<PlanningListItem> = {}): PlanningListItem {
  return {
    id: "p1",
    lead_id: "l1",
    project_id: null,
    lead_business_name: "Coastal Cafe",
    website_url: null,
    status: "ready_to_analyse",
    comparable_research_status: null,
    content_draft_status: null,
    content_draft_progress_label: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    analysed_at: null,
    website_audit_id: null,
    has_screenshot: false,
    lead_industry: null,
    lead_suburb: null,
    lead_state: null,
    website_plan_generated_at: null,
    ...overrides,
  };
}

function planning(overrides: Partial<Planning> = {}): Planning {
  return {
    id: "p1",
    lead_id: "l1",
    project_id: null,
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
    social_profile: socialProfile(),
    recommendations_objective: null,
    recommendations_generated_at: null,
    recommendations: [],
    sitemap_proposal_generated_at: null,
    sitemap_pages: [],
    blueprint_template: null,
    blueprint_selected_at: null,
    blueprint_requirements: [],
    visual_direction_options: [],
    selected_visual_direction: null,
    visual_directions_generated_at: null,
    assets_checklist_generated_at: null,
    assets: [],
    content_draft_status: null,
    content_draft_progress_label: null,
    content_draft_generated_at: null,
    content_draft_error: null,
    content_pages: [],
    ...overrides,
  };
}

function socialProfile(overrides: Partial<PlanningSocialProfile> = {}): PlanningSocialProfile {
  return {
    instagram_handle: null,
    instagram_profile_url: null,
    instagram_bio: null,
    instagram_bio_link_url: null,
    instagram_profile_image_url: null,
    instagram_follower_count: null,
    instagram_source: null,
    instagram_verified_at: null,
    facebook_page_url: null,
    facebook_page_name: null,
    facebook_bio: null,
    facebook_source: null,
    facebook_verified_at: null,
    has_any: false,
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
    expect(rows.map((r) => r.state)).toEqual([
      "not_checked",
      "not_checked",
      "not_checked",
      "not_checked",
      "not_checked",
      "not_checked",
    ]);
  });

  it("marks social presence good once Instagram or Facebook is on file", () => {
    const rows = computeBusinessInputRows(
      planning({ social_profile: socialProfile({ facebook_page_url: "https://facebook.com/x", has_any: true }) }),
      null,
    );
    expect(rows.find((r) => r.key === "social_presence")!.state).toBe("good");
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

describe("computeInformationToConfirm", () => {
  it("prompts to confirm Instagram, Facebook, and contact when nothing is on file", () => {
    const items = computeInformationToConfirm(planning(), lead(), socialProfile());
    expect(items).toContain("Confirm whether this business has an Instagram profile.");
    expect(items).toContain("Confirm whether this business has a Facebook Page.");
    expect(items).toContain("No phone or email on file — confirm a primary contact method.");
  });

  it("makes no contact-method claim when the Lead hasn't loaded yet", () => {
    const items = computeInformationToConfirm(planning(), null, socialProfile());
    expect(items).not.toContain("No phone or email on file — confirm a primary contact method.");
  });

  it("drops the Instagram/Facebook prompts once either is on file", () => {
    const items = computeInformationToConfirm(
      planning(),
      lead({ business_phone: "0400000000" }),
      socialProfile({ instagram_handle: "coastalcafe", facebook_page_url: "https://facebook.com/coastalcafe" }),
    );
    expect(items).not.toContain("Confirm whether this business has an Instagram profile.");
    expect(items).not.toContain("Confirm whether this business has a Facebook Page.");
    expect(items).not.toContain("No phone or email on file — confirm a primary contact method.");
  });

  it("appends the agent's own open_questions, deduped against the deterministic checklist", () => {
    const items = computeInformationToConfirm(
      planning({ open_questions: ["No services list on file — confirm exact services offered."] }),
      null,
      socialProfile(),
    );
    expect(items).toContain("No services list on file — confirm exact services offered.");
    // Deterministic items still come first.
    expect(items[0]).toBe("Confirm whether this business has an Instagram profile.");
  });
});

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "r1",
    category: "add",
    title: "Services page",
    explanation: "x",
    source_type: "operator",
    source_evidence: null,
    status: "accepted",
    order_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function sitemapPage(overrides: Partial<SitemapPageProposal> = {}): SitemapPageProposal {
  return {
    id: "sp1",
    order_index: 0,
    title: "Services",
    page_type: "services",
    purpose: "List services.",
    reason: "Core offering.",
    key_sections: [],
    needs_confirmation: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeBuildBriefFacts", () => {
  it("lists confirmed facts with their source", () => {
    const summary = computeBuildBriefFacts(
      planning({ social_profile: socialProfile({ instagram_handle: "coastalcafe" }) }),
      lead({ industry: "Cafe", suburb: "Byron Bay", business_phone: "0400000000" }),
    );
    expect(summary.confirmedFacts).toContainEqual({ fact: "Category: Cafe", source: "Business record" });
    expect(summary.confirmedFacts).toContainEqual({ fact: "Instagram: @coastalcafe", source: "Social Presence" });
  });

  it("summarises proposed decisions from accepted recommendations, sitemap pages, and a selected direction", () => {
    const summary = computeBuildBriefFacts(
      planning({
        recommendations_objective: "Generate bookings.",
        recommendations: [recommendation({ status: "accepted" }), recommendation({ id: "r2", status: "proposed" })],
        sitemap_pages: [sitemapPage()],
        selected_visual_direction: {
          character: "Warm and handcrafted",
          typography: "Rounded sans-serif",
          colour_palette: "Terracotta",
          imagery: "Real photos",
          layout: "Generous whitespace",
        },
      }),
      null,
    );
    expect(summary.proposedDecisions).toContain("Objective: Generate bookings.");
    expect(summary.proposedDecisions).toContain("1 accepted Keep/Improve/Add recommendation");
    expect(summary.proposedDecisions).toContain("1 proposed page");
    expect(summary.proposedDecisions).toContain("Visual direction selected: Warm and handcrafted");
  });

  it("merges sitemap needs_confirmation and missing assets into open questions", () => {
    const summary = computeBuildBriefFacts(
      planning({
        sitemap_pages: [sitemapPage({ needs_confirmation: true, title: "Services" })],
        assets: [
          {
            id: "a1",
            category: "logo",
            label: "Logo",
            status: "missing",
            note: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
      lead(),
    );
    expect(summary.openQuestions).toContain("Confirm content for the proposed 'Services' page.");
    expect(summary.openQuestions).toContain("Missing asset: Logo.");
  });
});

describe("computeContentDraftReadiness", () => {
  it("blocks on zero sitemap pages and reports every input as unavailable", () => {
    const readiness = computeContentDraftReadiness(planning());
    expect(readiness.blocker).toMatch(/sitemap/i);
    expect(readiness.items.every((i) => !i.available)).toBe(true);
  });

  it("clears the blocker once at least one sitemap page exists", () => {
    const readiness = computeContentDraftReadiness(planning({ sitemap_pages: [sitemapPage()] }));
    expect(readiness.blocker).toBeNull();
    const sitemapItem = readiness.items.find((i) => i.label.includes("Proposed sitemap"));
    expect(sitemapItem?.available).toBe(true);
  });

  it("reflects accepted recommendations and a selected visual direction", () => {
    const readiness = computeContentDraftReadiness(
      planning({
        recommendations: [recommendation({ status: "accepted" })],
        selected_visual_direction: {
          character: "Warm",
          typography: "Rounded",
          colour_palette: "Terracotta",
          imagery: "Real photos",
          layout: "Generous whitespace",
        },
      }),
    );
    expect(readiness.items.find((i) => i.label.includes("Accepted Keep/Improve/Add"))?.available).toBe(true);
    expect(readiness.items.find((i) => i.label === "Selected visual direction")?.available).toBe(true);
  });
});

describe("planningListItemMode", () => {
  it("is 'existing' whenever an audit is attached", () => {
    expect(planningListItemMode(listItem({ website_audit_id: "a1" }))).toBe("existing");
  });

  it("is 'new' with no audit attached", () => {
    expect(planningListItemMode(listItem({ website_audit_id: null }))).toBe("new");
  });
});

describe("planningCardAction — the Planning grid's one primary action per state", () => {
  it("shows View Progress whenever a run is in progress, regardless of mode", () => {
    expect(planningCardAction(listItem({ status: "analysing", website_audit_id: null })).kind).toBe("progress");
    expect(planningCardAction(listItem({ status: "analysing", website_audit_id: "a1" })).kind).toBe("progress");
  });

  it("shows Analyse Website for a website_url on record that hasn't been analysed yet", () => {
    const action = planningCardAction(
      listItem({ status: "ready_to_analyse", website_audit_id: null, website_url: "https://example.com" }),
    );
    expect(action).toEqual({ kind: "analyse", label: "Analyse Website" });
  });

  it("shows Generate Website Plan for a lead with no website at all", () => {
    const action = planningCardAction(
      listItem({ status: "ready_to_analyse", website_audit_id: null, website_url: null }),
    );
    expect(action).toEqual({ kind: "generate", label: "Generate Website Plan" });
  });

  it("shows Open Planning once a New Website Plan has been generated", () => {
    const action = planningCardAction(
      listItem({
        status: "ready_to_analyse",
        website_audit_id: null,
        website_url: null,
        website_plan_generated_at: "2026-01-02T00:00:00Z",
      }),
    );
    expect(action).toEqual({ kind: "open", label: "Open Planning" });
  });

  it("shows Open Planning once an audit is attached and nothing is running", () => {
    const action = planningCardAction(listItem({ status: "completed", website_audit_id: "a1" }));
    expect(action).toEqual({ kind: "open", label: "Open Planning" });
  });

  it("shows Open Planning for a failed run — never re-offers Analyse/Generate from the card", () => {
    expect(planningCardAction(listItem({ status: "failed", website_audit_id: "a1" })).kind).toBe("open");
  });
});
