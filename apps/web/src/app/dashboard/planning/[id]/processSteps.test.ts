import { describe, expect, it } from "vitest";
import {
  PLANNING_CHECKLIST_TITLES,
  assetsStepStatus,
  auditOrPlanStepStatus,
  checklistItemStepStatus,
  combineStepStatuses,
  computeStepStatus,
  computeStepSummary,
  handoffStepStatus,
  improvementsStepStatus,
  lastStepStorageKey,
  legacyTabToStep,
  parseStoredStep,
  reviewInsightsStepStatus,
  structureStepStatus,
} from "./processSteps";
import type { Planning, PlanningSocialProfile, StageChecklist, StageChecklistItem, StageChecklistItemStatus } from "@/lib/api";

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
    review_synthesis_status: null,
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

function checklistItem(title: string, status: StageChecklistItemStatus, overrides: Partial<StageChecklistItem> = {}): StageChecklistItem {
  return {
    id: title,
    title,
    order_index: 0,
    is_default: true,
    is_required: true,
    completion_mode: "manual",
    status,
    completed_at: null,
    completed_by: null,
    link: null,
    assigned_user_id: null,
    assigned_user_name: null,
    blocked_reason: null,
    needs_review_reason: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function checklist(items: StageChecklistItem[]): StageChecklist {
  const requiredItems = items.filter((i) => i.is_required);
  const completed = requiredItems.filter((i) => i.status === "complete").length;
  return {
    items,
    progress: {
      required: { completed, total: requiredItems.length, pct: requiredItems.length === 0 ? null : completed / requiredItems.length },
      optional: { completed: 0, total: 0, pct: null },
    },
    next_item: null,
    next_action: { kind: "done" },
  };
}

describe("combineStepStatuses", () => {
  it("defaults to not_started for an empty list", () => {
    expect(combineStepStatuses([])).toBe("not_started");
  });

  it("in_progress wins over everything else", () => {
    expect(combineStepStatuses(["complete", "in_progress", "needs_review"])).toBe("in_progress");
  });

  it("needs_review wins over not_started and complete", () => {
    expect(combineStepStatuses(["complete", "needs_review", "not_started"])).toBe("needs_review");
  });

  it("not_started wins over a mix of complete/skipped", () => {
    expect(combineStepStatuses(["complete", "not_started", "skipped"])).toBe("not_started");
  });

  it("is skipped only when every part is skipped", () => {
    expect(combineStepStatuses(["skipped", "skipped"])).toBe("skipped");
    expect(combineStepStatuses(["skipped", "complete"])).toBe("complete");
  });
});

describe("checklistItemStepStatus", () => {
  it("returns null for a missing item", () => {
    expect(checklistItemStepStatus(undefined)).toBeNull();
  });

  it("maps pending to null (no evidence either way)", () => {
    expect(checklistItemStepStatus(checklistItem("x", "pending"))).toBeNull();
  });

  it("maps complete/not_required/needs_review/blocked", () => {
    expect(checklistItemStepStatus(checklistItem("x", "complete"))).toBe("complete");
    expect(checklistItemStepStatus(checklistItem("x", "not_required"))).toBe("skipped");
    expect(checklistItemStepStatus(checklistItem("x", "needs_review"))).toBe("needs_review");
    expect(checklistItemStepStatus(checklistItem("x", "blocked"))).toBe("needs_review");
  });
});

describe("auditOrPlanStepStatus", () => {
  it("is not_started for New Website Plan mode before anything is generated", () => {
    expect(auditOrPlanStepStatus(planning(), null)).toBe("not_started");
  });

  it("is in_progress while analysing, even with no prior audit", () => {
    expect(auditOrPlanStepStatus(planning({ website_audit_id: "a1", status: "analysing" }), null)).toBe("in_progress");
  });

  it("is needs_review after a failed re-analysis, with no matching checklist item", () => {
    expect(auditOrPlanStepStatus(planning({ website_audit_id: "a1", status: "failed" }), null)).toBe("needs_review");
  });

  it("is in_progress once an audit exists but hasn't been reviewed (checklist item still pending)", () => {
    const cl = checklist([checklistItem(PLANNING_CHECKLIST_TITLES.audit, "pending")]);
    expect(auditOrPlanStepStatus(planning({ website_audit_id: "a1", status: "completed" }), cl)).toBe("in_progress");
  });

  it("defers to the checklist item once it's been explicitly reviewed", () => {
    const cl = checklist([checklistItem(PLANNING_CHECKLIST_TITLES.audit, "complete")]);
    expect(auditOrPlanStepStatus(planning({ website_audit_id: "a1", status: "completed" }), cl)).toBe("complete");
  });

  it("New Website Plan mode: not_started before generation, in_progress after", () => {
    expect(auditOrPlanStepStatus(planning({ website_plan_generated_at: null }), null)).toBe("not_started");
    expect(auditOrPlanStepStatus(planning({ website_plan_generated_at: "2026-01-02T00:00:00Z" }), null)).toBe(
      "in_progress",
    );
  });

  it("is in_progress while analysing a website that has never had an audit before (mode still reads 'new')", () => {
    // website_audit_id null -> planningMode() is "new", but a run is
    // genuinely in progress -- must not read as "not_started".
    expect(auditOrPlanStepStatus(planning({ website_audit_id: null, status: "analysing" }), null)).toBe(
      "in_progress",
    );
  });

  it("is needs_review after a failed *first* analysis attempt, not not_started (the Analyse Website empty state's own retry state)", () => {
    // website_url on record, audit attempt failed, no plan generated --
    // planningMode() still reads "new" here (see its own docstring),
    // but the content shown is AnalyseWebsiteAction's retry state, not
    // GenerateWebsitePlanAction's fresh one.
    expect(
      auditOrPlanStepStatus(
        planning({ website_audit_id: null, website_url: "https://example.com", status: "failed" }),
        null,
      ),
    ).toBe("needs_review");
  });
});

describe("reviewInsightsStepStatus", () => {
  it("is skipped only on an explicit recorded skip, never inferred from missing data", () => {
    expect(reviewInsightsStepStatus(planning(), null)).toBe("not_started");
    expect(reviewInsightsStepStatus(planning({ review_synthesis_status: "skipped" }), null)).toBe("skipped");
  });

  it("is needs_review after a failed synthesis attempt", () => {
    expect(reviewInsightsStepStatus(planning({ review_synthesis_status: "failed" }), null)).toBe("needs_review");
  });

  it("is in_progress once insights have been generated, pending explicit review", () => {
    expect(
      reviewInsightsStepStatus(planning({ review_insights_generated_at: "2026-01-02T00:00:00Z" }), null),
    ).toBe("in_progress");
  });
});

describe("improvementsStepStatus", () => {
  it("is not_started with nothing generated", () => {
    expect(improvementsStepStatus(planning(), null)).toBe("not_started");
  });

  it("is in_progress once recommendations exist, pending explicit review", () => {
    expect(improvementsStepStatus(planning({ recommendations_generated_at: "2026-01-02T00:00:00Z" }), null)).toBe(
      "in_progress",
    );
  });
});

describe("structureStepStatus / assetsStepStatus", () => {
  it("structure reflects sitemap/visual-direction generation", () => {
    expect(structureStepStatus(planning(), null)).toBe("not_started");
    expect(structureStepStatus(planning({ sitemap_proposal_generated_at: "2026-01-02T00:00:00Z" }), null)).toBe(
      "in_progress",
    );
  });

  it("assets is needs_review while content draft generation has failed", () => {
    expect(assetsStepStatus(planning({ content_draft_status: "failed" }), null)).toBe("needs_review");
  });

  it("assets is in_progress while content draft is actively generating, overriding a stale complete checklist item", () => {
    const cl = checklist([checklistItem(PLANNING_CHECKLIST_TITLES.assets, "complete")]);
    expect(assetsStepStatus(planning({ content_draft_status: "generating" }), cl)).toBe("in_progress");
  });
});

describe("handoffStepStatus", () => {
  it("is not_started with no matching checklist item", () => {
    expect(handoffStepStatus(planning(), null)).toBe("not_started");
  });

  it("reads straight from the AUTOMATIC checklist item once the brief is approved", () => {
    const cl = checklist([checklistItem(PLANNING_CHECKLIST_TITLES.buildBriefApproved, "complete", { completion_mode: "automatic" })]);
    expect(handoffStepStatus(planning(), cl)).toBe("complete");
  });
});

describe("computeStepStatus", () => {
  it("never assigns a status to 'understand' -- no evidence exists for it", () => {
    expect(computeStepStatus("understand", planning(), null)).toBeNull();
  });

  it("combines both halves of 'presence'", () => {
    const p = planning({ website_audit_id: "a1", status: "completed", review_synthesis_status: "skipped" });
    // audit half: in_progress (no checklist item, audit exists) ; review half: skipped
    expect(computeStepStatus("presence", p, null)).toBe("in_progress");
  });
});

describe("legacyTabToStep", () => {
  it("maps every old tab id to a step, and leaves 'notes' unmapped", () => {
    expect(legacyTabToStep("overview")).toBe("understand");
    expect(legacyTabToStep("audit")).toBe("presence");
    expect(legacyTabToStep("reviews")).toBe("presence");
    expect(legacyTabToStep("build-brief")).toBe("prepare");
    expect(legacyTabToStep("content-draft")).toBe("prepare");
    expect(legacyTabToStep("notes")).toBeNull();
  });
});

describe("resume-step persistence (pure half)", () => {
  it("keys the stored value per plan", () => {
    expect(lastStepStorageKey("p1")).toBe("wdos-planning-step:p1");
    expect(lastStepStorageKey("p2")).toBe("wdos-planning-step:p2");
    expect(lastStepStorageKey("p1")).not.toBe(lastStepStorageKey("p2"));
  });

  it("accepts any real step id", () => {
    for (const id of ["understand", "presence", "improvements", "prepare", "handoff"] as const) {
      expect(parseStoredStep(id)).toBe(id);
    }
  });

  it("falls back to null for nothing stored, garbage, or a stale/removed step id", () => {
    expect(parseStoredStep(null)).toBeNull();
    expect(parseStoredStep(undefined)).toBeNull();
    expect(parseStoredStep("")).toBeNull();
    expect(parseStoredStep("notes")).toBeNull(); // never a step, even historically
    expect(parseStoredStep("some-future-step-this-version-does-not-know")).toBeNull();
  });
});

function contentPage(overrides: Partial<import("@/lib/api").ContentPage> = {}): import("@/lib/api").ContentPage {
  return {
    id: "cp1",
    sitemap_page_id: "sp1",
    seo_title: null,
    seo_meta_description: null,
    status: "draft",
    approved_at: null,
    approved_by_user_id: null,
    sections: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    stale: false,
    ...overrides,
  };
}

function contentSection(overrides: Partial<import("@/lib/api").ContentSection> = {}): import("@/lib/api").ContentSection {
  return {
    id: "cs1",
    order_index: 0,
    section_type: "hero",
    content: {},
    needs_confirmation_notes: [],
    source: "generated",
    heading: null,
    purpose: null,
    draft_text: null,
    notes: null,
    source_recommendation_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function recommendation(
  overrides: Partial<import("@/lib/api").Recommendation> = {},
): import("@/lib/api").Recommendation {
  return {
    id: "r1",
    category: "add",
    title: "Add a contact form",
    explanation: "Makes it easier to get in touch.",
    source_type: "audit_finding",
    source_evidence: null,
    status: "proposed",
    order_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeStepSummary", () => {
  it("never summarizes 'understand' -- no evidence exists for it either", () => {
    expect(computeStepSummary("understand", planning(), null)).toBeNull();
  });

  describe("presence", () => {
    it("is null before anything is on record (New Website Plan mode, no url)", () => {
      expect(computeStepSummary("presence", planning(), null)).toBe("No website on record");
    });

    it("says a website exists but hasn't been analysed yet", () => {
      expect(computeStepSummary("presence", planning({ website_url: "https://example.com" }), null)).toBe(
        "Not analysed yet",
      );
    });

    it("is 'Analysing…' while a run is active, even with no prior audit", () => {
      expect(
        computeStepSummary("presence", planning({ status: "analysing", website_audit_id: null }), null),
      ).toBe("Analysing…");
    });

    it("never reads a failed analysis as anything but failed", () => {
      expect(
        computeStepSummary(
          "presence",
          planning({ website_audit_id: "a1", status: "failed" }),
          null,
        ),
      ).toBe("Analysis failed");
    });

    it("distinguishes ready-to-review from explicitly reviewed", () => {
      const p = planning({ website_audit_id: "a1", status: "completed" });
      expect(computeStepSummary("presence", p, null)).toBe("Audit ready to review");
      const cl = checklist([checklistItem(PLANNING_CHECKLIST_TITLES.audit, "complete")]);
      expect(computeStepSummary("presence", p, cl)).toBe("Audit reviewed");
    });

    it("is null on a plain needs_review status, since ProcessNav's own status pill already says that word-for-word right next to it", () => {
      expect(computeStepSummary("presence", planning({ website_audit_id: "a1", status: "needs_review" }), null)).toBeNull();
      expect(
        computeStepSummary(
          "presence",
          planning({ website_plan_generated_at: "2026-01-02T00:00:00Z", status: "needs_review" }),
          null,
        ),
      ).toBeNull();
    });
  });

  describe("improvements", () => {
    it("is null with nothing generated", () => {
      expect(computeStepSummary("improvements", planning(), null)).toBeNull();
    });

    it("counts accepted vs. merely proposed recommendations", () => {
      const proposedOnly = planning({ recommendations: [recommendation(), recommendation({ id: "r2" })] });
      expect(computeStepSummary("improvements", proposedOnly, null)).toBe("2 improvements to review");

      const someAccepted = planning({
        recommendations: [
          recommendation({ status: "accepted" }),
          recommendation({ id: "r2", status: "accepted" }),
          recommendation({ id: "r3", status: "dismissed" }),
        ],
      });
      expect(computeStepSummary("improvements", someAccepted, null)).toBe("2 improvements selected");
    });
  });

  describe("prepare", () => {
    it("is null before any structure or content exists", () => {
      expect(computeStepSummary("prepare", planning(), null)).toBeNull();
    });

    it("reports structure drafted before any content page has sections", () => {
      expect(
        computeStepSummary("prepare", planning({ sitemap_proposal_generated_at: "2026-01-02T00:00:00Z" }), null),
      ).toBe("Structure drafted");
    });

    it("reports 'Draft saved' once a page has content but none are approved", () => {
      const p = planning({ content_pages: [contentPage({ sections: [contentSection()] })] });
      expect(computeStepSummary("prepare", p, null)).toBe("Draft saved");
    });

    it("counts approved pages honestly, never as fully approved until all are", () => {
      const p = planning({
        content_pages: [
          contentPage({ id: "cp1", sections: [contentSection()], status: "approved" }),
          contentPage({ id: "cp2", sections: [contentSection()], status: "draft" }),
        ],
      });
      expect(computeStepSummary("prepare", p, null)).toBe("1 of 2 pages approved");
    });

    it("never reports a failed or in-review content draft as saved/approved", () => {
      expect(computeStepSummary("prepare", planning({ content_draft_status: "failed" }), null)).toBe(
        "Content draft failed",
      );
      expect(computeStepSummary("prepare", planning({ content_draft_status: "needs_review" }), null)).toBe(
        "Content draft needs review",
      );
    });
  });

  describe("handoff", () => {
    it("is null until the brief is explicitly approved", () => {
      expect(computeStepSummary("handoff", planning(), null)).toBeNull();
    });

    it("reads 'Brief approved' straight from the AUTOMATIC checklist item", () => {
      const cl = checklist([
        checklistItem(PLANNING_CHECKLIST_TITLES.buildBriefApproved, "complete", { completion_mode: "automatic" }),
      ]);
      expect(computeStepSummary("handoff", planning(), cl)).toBe("Brief approved");
    });
  });
});
