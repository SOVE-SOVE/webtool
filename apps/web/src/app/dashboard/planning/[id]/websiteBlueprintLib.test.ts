import { describe, expect, it } from "vitest";
import {
  availableLibraryFeatures,
  availableRecommendedFeatures,
  acceptedRecommendationIdsForFeature,
  clampGapIndex,
  computeBlueprintSummary,
  computePlanSelectionSummary,
  computeRequirementEvidence,
  conflictingSelections,
  featureKind,
  filterFeatureLibrary,
  describeRequirementTemplateEffect,
  deriveRecommendedRequirements,
  deriveRecommendedSections,
  deriveSuggestedSections,
  diffRequirementTemplate,
  FEATURE_LIBRARY,
  featureLabel,
  findContentPage,
  gapToMoveIndex,
  getSectionWireframe,
  inferAppliedRequirementTemplate,
  isSiteWideRecommendation,
  recommendationFeatureKey,
  recommendationIdsForFeature,
  isRequirementSelectionCustomised,
  mapKeyPointToFeatureKey,
  mapRecommendationToFeatureKey,
  mapRecommendationToSectionType,
  REQUIREMENT_TEMPLATE_SUMMARY,
  REQUIREMENT_TEMPLATES,
  reorderSections,
  SECTION_TYPE_LABEL,
  sitemapPagePathLabel,
  unplacedAcceptedFeatureRecommendations,
} from "./websiteBlueprintLib";
import type {
  ContentPage,
  ContentSection,
  Planning,
  PlanningKeyPoint,
  PlanningSocialProfile,
  Recommendation,
  Requirement,
} from "@/lib/api";

function keyPoint(overrides: Partial<PlanningKeyPoint> = {}): PlanningKeyPoint {
  return {
    area: "usability",
    category: "conversion_path",
    severity: "high",
    message: "No clear way for a visitor to get in touch was found on the homepage — no phone/email link or contact form.",
    evidence: "No mailto/tel link or <form> found on the page",
    confidence: 0.8,
    ...overrides,
  };
}

function socialProfile(): PlanningSocialProfile {
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
    inspiration_references: [],
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

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "r1",
    category: "add",
    title: "Add a testimonials section",
    explanation: "Reviews mention trust a lot — showing a few builds it fast.",
    source_type: "review_theme",
    source_evidence: null,
    status: "accepted",
    order_index: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function section(overrides: Partial<ContentSection> = {}): ContentSection {
  return {
    id: "s1",
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

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: "req1",
    order_index: 0,
    feature_key: "services",
    notes: null,
    source_recommendation_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function contentPage(overrides: Partial<ContentPage> = {}): ContentPage {
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

describe("deriveSuggestedSections", () => {
  it("keeps only accepted 'add' recommendations, ordered by order_index", () => {
    const p = planning({
      recommendations: [
        recommendation({ id: "r2", order_index: 1, title: "Second" }),
        recommendation({ id: "r1", order_index: 0, title: "First" }),
        recommendation({ id: "r-keep", category: "keep", status: "accepted" }),
        recommendation({ id: "r-improve", category: "improve", status: "accepted" }),
        recommendation({ id: "r-proposed", category: "add", status: "proposed" }),
        recommendation({ id: "r-dismissed", category: "add", status: "dismissed" }),
      ],
    });

    const result = deriveSuggestedSections(p);

    expect(result.map((s) => s.recommendation.id)).toEqual(["r1", "r2"]);
  });

  it("returns an empty list when there are no accepted 'add' recommendations", () => {
    expect(deriveSuggestedSections(planning())).toEqual([]);
  });
});

describe("mapRecommendationToSectionType", () => {
  it("maps pricing/services wording to serviceCards", () => {
    expect(
      mapRecommendationToSectionType(
        recommendation({ title: "Add a pricing section", explanation: "Show package prices up front." }),
      ),
    ).toBe("serviceCards");
  });

  it("maps photo/portfolio wording to gallery", () => {
    expect(
      mapRecommendationToSectionType(
        recommendation({ title: "Add a photo gallery", explanation: "Showcase recent work with images." }),
      ),
    ).toBe("gallery");
  });

  it("maps FAQ/questions wording to faq", () => {
    expect(
      mapRecommendationToSectionType(
        recommendation({ title: "Add an FAQ section", explanation: "Answer frequently asked questions." }),
      ),
    ).toBe("faq");
  });

  it("maps testimonials/reviews wording to about", () => {
    expect(
      mapRecommendationToSectionType(
        recommendation({ title: "Add customer testimonials", explanation: "Reviews build trust fast." }),
      ),
    ).toBe("about");
  });

  it("maps contact/booking wording to contact", () => {
    expect(
      mapRecommendationToSectionType(
        recommendation({ title: "Add a booking call to action", explanation: "Let visitors book an appointment." }),
      ),
    ).toBe("contact");
  });

  it("maps headline/hero wording to hero", () => {
    expect(
      mapRecommendationToSectionType(
        recommendation({ title: "Sharpen the homepage headline", explanation: "The current tagline is generic." }),
      ),
    ).toBe("hero");
  });

  it("does not map cross-page, non-visual concerns", () => {
    const excluded = [
      recommendation({ title: "Improve accessibility", explanation: "Add alt text to images site-wide." }),
      recommendation({ title: "Speed up the homepage", explanation: "Reduce page load time on mobile." }),
      recommendation({ title: "Improve SEO", explanation: "Add meta descriptions to every page." }),
      recommendation({ title: "Fix mobile layout", explanation: "The site isn't mobile-friendly yet." }),
    ];
    for (const r of excluded) {
      expect(mapRecommendationToSectionType(r)).toBeNull();
    }
  });

  it("returns null for wording with no defensible keyword match", () => {
    expect(mapRecommendationToSectionType(recommendation({ title: "Something vague", explanation: "No clear ask here." }))).toBeNull();
  });
});

describe("deriveRecommendedSections", () => {
  it("returns an empty list when there are no accepted 'add' recommendations", () => {
    expect(deriveRecommendedSections(planning())).toEqual([]);
  });

  it("returns an empty list when accepted recommendations exist but none map to a section", () => {
    const p = planning({
      recommendations: [recommendation({ title: "Improve SEO", explanation: "Add meta descriptions." })],
    });
    expect(deriveRecommendedSections(p)).toEqual([]);
  });

  it("maps and dedupes: two recommendations for the same type collapse into one card", () => {
    const r1 = recommendation({ id: "r1", order_index: 0, title: "Add a pricing table", explanation: "Show prices." });
    const r2 = recommendation({ id: "r2", order_index: 1, title: "Add a services list", explanation: "List every service offered." });
    const p = planning({ recommendations: [r1, r2] });

    const result = deriveRecommendedSections(p);

    expect(result).toHaveLength(1);
    expect(result[0].sectionType).toBe("serviceCards");
    expect(result[0].recommendations.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(result[0].primary.id).toBe("r1");
    expect(result[0].reason).toContain("Add a pricing table");
    expect(result[0].reason).toContain("Add a services list");
  });

  it("produces one card per distinct mapped section type, excluding unmapped recommendations", () => {
    const p = planning({
      recommendations: [
        recommendation({ id: "r1", order_index: 0, title: "Add an FAQ section", explanation: "Answer common questions." }),
        recommendation({ id: "r2", order_index: 1, title: "Add a photo gallery", explanation: "Show recent work." }),
        recommendation({ id: "r3", order_index: 2, title: "Improve page speed", explanation: "Reduce load time." }),
      ],
    });

    const result = deriveRecommendedSections(p);

    expect(result.map((r) => r.sectionType).sort()).toEqual(["faq", "gallery"]);
  });
});

describe("findContentPage", () => {
  it("finds the content page keyed by sitemap_page_id", () => {
    const p = planning({ content_pages: [contentPage({ id: "cp1", sitemap_page_id: "sp1" })] });
    expect(findContentPage(p, "sp1")?.id).toBe("cp1");
  });

  it("returns undefined when the sitemap page has no content page yet", () => {
    expect(findContentPage(planning(), "sp-none")).toBeUndefined();
  });
});

describe("reorderSections", () => {
  const sections = [
    section({ id: "a", order_index: 0 }),
    section({ id: "b", order_index: 1 }),
    section({ id: "c", order_index: 2 }),
  ];

  it("moves a section later and reindexes everything contiguously from 0", () => {
    expect(reorderSections(sections, 0, 2)).toEqual([
      { id: "b", order_index: 0 },
      { id: "c", order_index: 1 },
      { id: "a", order_index: 2 },
    ]);
  });

  it("moves a section earlier", () => {
    expect(reorderSections(sections, 2, 0)).toEqual([
      { id: "c", order_index: 0 },
      { id: "a", order_index: 1 },
      { id: "b", order_index: 2 },
    ]);
  });

  it("clamps an out-of-range target index instead of dropping a section", () => {
    expect(reorderSections(sections, 0, 99)).toEqual([
      { id: "b", order_index: 0 },
      { id: "c", order_index: 1 },
      { id: "a", order_index: 2 },
    ]);
  });
});

describe("sitemapPagePathLabel", () => {
  it("labels the home page as the root path, regardless of its title", () => {
    expect(sitemapPagePathLabel({ title: "Home", page_type: "home" })).toBe("/");
    expect(sitemapPagePathLabel({ title: "Welcome", page_type: "home" })).toBe("/");
  });

  it("slugifies a plain title", () => {
    expect(sitemapPagePathLabel({ title: "About Us", page_type: "about" })).toBe("/about-us");
  });

  it("collapses punctuation and whitespace into single hyphens, trimmed at the edges", () => {
    expect(sitemapPagePathLabel({ title: "Contact & Booking!", page_type: "contact" })).toBe("/contact-booking");
  });

  it("falls back to the page_type when the title slugifies to nothing", () => {
    expect(sitemapPagePathLabel({ title: "  ", page_type: "gallery" })).toBe("/gallery");
  });
});

describe("getSectionWireframe", () => {
  it("returns a non-empty layout, starting with a heading block, for every known section type", () => {
    for (const type of Object.keys(SECTION_TYPE_LABEL)) {
      const blocks = getSectionWireframe(type);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].role).toBe("heading");
    }
  });

  it("gives hero a call-to-action block", () => {
    expect(getSectionWireframe("hero").some((b) => b.role === "cta")).toBe(true);
  });

  it("gives contact form-field blocks and a call-to-action", () => {
    const blocks = getSectionWireframe("contact");
    expect(blocks.some((b) => b.role === "field")).toBe(true);
    expect(blocks.some((b) => b.role === "cta")).toBe(true);
  });

  it("gives serviceCards a card-style grid and gallery an image-style grid", () => {
    expect(getSectionWireframe("serviceCards").find((b) => b.role === "grid")?.variant).toBe("cards");
    expect(getSectionWireframe("gallery").find((b) => b.role === "grid")?.variant).toBe("images");
  });

  it("gives faq a list block", () => {
    expect(getSectionWireframe("faq").some((b) => b.role === "list")).toBe(true);
  });

  it("falls back to a generic heading+subtext layout for an unrecognised section_type", () => {
    expect(getSectionWireframe("not-a-real-type")).toEqual([{ role: "heading" }, { role: "subtext", count: 2 }]);
  });
});

describe("clampGapIndex", () => {
  it("passes through a value already in range", () => {
    expect(clampGapIndex(2, 5)).toBe(2);
  });

  it("clamps below zero up to zero", () => {
    expect(clampGapIndex(-3, 5)).toBe(0);
  });

  it("clamps above sectionCount down to sectionCount (the 'after the last section' gap)", () => {
    expect(clampGapIndex(99, 5)).toBe(5);
  });
});

describe("gapToMoveIndex", () => {
  it("keeps a gap before the dragged section's own position unchanged", () => {
    expect(gapToMoveIndex(0, 2)).toBe(0);
  });

  it("shifts a gap after the dragged section's position down by one, since removing it closes the gap", () => {
    expect(gapToMoveIndex(4, 2)).toBe(3);
  });

  it("treats the gap immediately after the dragged section as a no-op landing at its own index", () => {
    expect(gapToMoveIndex(3, 2)).toBe(2);
  });
});

describe("computeBlueprintSummary", () => {
  it("reports no template and zero counts for an empty blueprint", () => {
    expect(computeBlueprintSummary(planning())).toEqual({
      template: null,
      templateLabel: null,
      pageCount: 0,
      sectionCount: 0,
      pagesWithoutSections: 0,
      requirementCount: 0,
      requirementLabels: [],
    });
  });

  it("counts pages/sections and flags pages with no sections yet", () => {
    const p = planning({
      blueprint_template: "standard",
      sitemap_pages: [
        { id: "sp1", order_index: 0, title: "Home", page_type: "home", purpose: "", reason: "", key_sections: [], needs_confirmation: false, created_at: "", updated_at: "" },
        { id: "sp2", order_index: 1, title: "About", page_type: "about", purpose: "", reason: "", key_sections: [], needs_confirmation: false, created_at: "", updated_at: "" },
      ],
      content_pages: [contentPage({ id: "cp1", sitemap_page_id: "sp1", sections: [section({ id: "s1" }), section({ id: "s2" })] })],
    });

    expect(computeBlueprintSummary(p)).toEqual({
      template: "standard",
      templateLabel: "Standard",
      pageCount: 2,
      sectionCount: 2,
      pagesWithoutSections: 1,
      requirementCount: 0,
      requirementLabels: [],
    });
  });

  it("reports the requirements board's flat count and labels, independent of pages/sections", () => {
    const p = planning({
      blueprint_requirements: [
        requirement({ id: "r1", feature_key: "faq" }),
        requirement({ id: "r2", feature_key: "services" }),
        requirement({ id: "r3", feature_key: "custom_thing" }),
      ],
    });

    const summary = computeBlueprintSummary(p);
    expect(summary.requirementCount).toBe(3);
    // Alphabetically sorted — order_index is assignment order only, never
    // a meaningful sequence this summary should imply.
    expect(summary.requirementLabels).toEqual(["Custom thing", "FAQ", "Services"]);
  });
});

describe("featureLabel", () => {
  it("returns the starter vocabulary's own label for a known key", () => {
    expect(featureLabel("services")).toBe("Services");
    expect(featureLabel("faq")).toBe("FAQ");
  });

  it("formats an unknown snake_case key into a title-cased fallback", () => {
    expect(featureLabel("online_store")).toBe("Online store");
  });

  it("formats an unknown camelCase key into a title-cased fallback", () => {
    expect(featureLabel("liveChat")).toBe("Live chat");
  });
});

describe("mapRecommendationToFeatureKey", () => {
  it("maps pricing wording to pricing, distinct from services", () => {
    expect(
      mapRecommendationToFeatureKey(
        recommendation({ title: "Add a pricing table", explanation: "Show package prices up front." }),
      ),
    ).toBe("pricing");
  });

  it("maps services/offerings wording to services", () => {
    expect(
      mapRecommendationToFeatureKey(
        recommendation({ title: "Add a services list", explanation: "List every service offered." }),
      ),
    ).toBe("services");
  });

  it("maps photo/gallery wording to gallery", () => {
    expect(
      mapRecommendationToFeatureKey(
        recommendation({ title: "Add a photo gallery", explanation: "Showcase recent work with images." }),
      ),
    ).toBe("gallery");
  });

  it("maps FAQ wording to faq", () => {
    expect(
      mapRecommendationToFeatureKey(
        recommendation({ title: "Add an FAQ section", explanation: "Answer frequently asked questions." }),
      ),
    ).toBe("faq");
  });

  it("maps booking/appointment wording to booking, distinct from contact", () => {
    expect(
      mapRecommendationToFeatureKey(
        recommendation({ title: "Add online booking", explanation: "Let visitors book an appointment." }),
      ),
    ).toBe("booking");
  });

  it("maps contact wording to contact", () => {
    expect(
      mapRecommendationToFeatureKey(
        recommendation({ title: "Add a contact section", explanation: "Show opening hours and a phone number." }),
      ),
    ).toBe("contact");
  });

  it("maps testimonials/reviews wording to testimonials, distinct from about", () => {
    expect(
      mapRecommendationToFeatureKey(
        recommendation({ title: "Add customer testimonials", explanation: "Reviews build trust fast." }),
      ),
    ).toBe("testimonials");
  });

  it("maps about-us wording to about", () => {
    expect(
      mapRecommendationToFeatureKey(
        recommendation({ title: "Add an about-us section", explanation: "Tell our story and introduce the team." }),
      ),
    ).toBe("about");
  });

  it("does not map cross-page, non-visual concerns", () => {
    const excluded = [
      recommendation({ title: "Improve accessibility", explanation: "Add alt text to images site-wide." }),
      recommendation({ title: "Speed up the homepage", explanation: "Reduce page load time on mobile." }),
      recommendation({ title: "Improve SEO", explanation: "Add meta descriptions to every page." }),
    ];
    for (const r of excluded) {
      expect(mapRecommendationToFeatureKey(r)).toBeNull();
    }
  });

  it("returns null for wording with no defensible keyword match", () => {
    expect(mapRecommendationToFeatureKey(recommendation({ title: "Something vague", explanation: "No clear ask here." }))).toBeNull();
  });
});

describe("deriveRecommendedRequirements", () => {
  it("returns an empty list when there are no accepted 'add' recommendations and no key_points", () => {
    expect(deriveRecommendedRequirements(planning())).toEqual([]);
  });

  it("maps and dedupes: two recommendations for the same feature key collapse into one card", () => {
    const r1 = recommendation({ id: "r1", order_index: 0, title: "Add a services list", explanation: "List every service offered." });
    const r2 = recommendation({ id: "r2", order_index: 1, title: "Highlight our offerings", explanation: "Make the services menu clear." });
    const p = planning({ recommendations: [r1, r2] });

    const result = deriveRecommendedRequirements(p);

    expect(result).toHaveLength(1);
    expect(result[0].featureKey).toBe("services");
    expect(result[0].sourceRecommendationId).toBe("r1");
    expect(result[0].reason).toContain("Add a services list");
    expect(result[0].reason).toContain("Highlight our offerings");
  });

  it("produces one card per distinct mapped feature key, excluding unmapped recommendations", () => {
    const p = planning({
      recommendations: [
        recommendation({ id: "r1", order_index: 0, title: "Add an FAQ section", explanation: "Answer common questions." }),
        recommendation({ id: "r2", order_index: 1, title: "Add a photo gallery", explanation: "Show recent work." }),
        recommendation({ id: "r3", order_index: 2, title: "Improve page speed", explanation: "Reduce load time." }),
      ],
    });

    const result = deriveRecommendedRequirements(p);

    expect(result.map((r) => r.featureKey).sort()).toEqual(["faq", "gallery"]);
  });

  it("returns an empty list when the audit has no key_points (failed/incomplete audit) and no recommendations", () => {
    expect(deriveRecommendedRequirements(planning({ key_points: [] }))).toEqual([]);
  });

  it("maps the real, deterministic contact_cta_present finding to a contact suggestion with no source_recommendation_id", () => {
    const p = planning({ key_points: [keyPoint()] });

    const result = deriveRecommendedRequirements(p);

    expect(result).toHaveLength(1);
    expect(result[0].featureKey).toBe("contact");
    expect(result[0].sourceRecommendationId).toBeNull();
    expect(result[0].reason).toContain("No clear way for a visitor to get in touch");
  });

  it("never maps a cross-page technical finding category to a feature suggestion", () => {
    const excluded = [
      keyPoint({ category: "performance", message: "Slow loading on mobile.", evidence: "LCP 6.2s" }),
      keyPoint({ category: "contrast", message: "Low contrast text found.", evidence: "1.8:1" }),
      keyPoint({ category: "mobile", message: "Content overflows horizontally at tablet width.", evidence: "overflow" }),
      keyPoint({
        category: "business_information",
        message: "The page has no title — this also hurts how the business shows up in search results.",
        evidence: "No <title> content found",
      }),
      keyPoint({ category: "technical_seo", message: "No sitemap.xml was found.", evidence: "404" }),
    ];
    expect(deriveRecommendedRequirements(planning({ key_points: excluded }))).toEqual([]);
  });

  it("does not invent a services suggestion when no finding or recommendation actually supports it", () => {
    const p = planning({
      key_points: [keyPoint({ category: "performance", message: "Slow loading.", evidence: "LCP 6s" })],
    });
    expect(deriveRecommendedRequirements(p).some((c) => c.featureKey === "services")).toBe(false);
  });

  it("merges a recommendation-backed and a finding-backed suggestion for the same feature key into one card citing both", () => {
    const p = planning({
      recommendations: [recommendation({ id: "r1", title: "Add a contact section", explanation: "Show a phone number." })],
      key_points: [keyPoint()],
    });

    const result = deriveRecommendedRequirements(p);

    expect(result).toHaveLength(1);
    expect(result[0].featureKey).toBe("contact");
    expect(result[0].sourceRecommendationId).toBe("r1");
    expect(result[0].reason).toContain("Add a contact section");
    expect(result[0].reason).toContain("No clear way for a visitor to get in touch");
  });
});

describe("mapKeyPointToFeatureKey", () => {
  it("maps the real contact_cta_present finding to contact", () => {
    expect(mapKeyPointToFeatureKey(keyPoint())).toBe("contact");
  });

  it("excludes every category the deterministic audit uses for cross-page/technical concerns", () => {
    const excludedCategories = [
      "performance",
      "broken_links",
      "errors",
      "markup",
      "mobile",
      "contrast",
      "heading_structure",
      "technical_seo",
      "local_seo",
      "availability",
      "security",
      "business_information",
    ];
    for (const category of excludedCategories) {
      expect(mapKeyPointToFeatureKey(keyPoint({ category, message: "Add a contact form.", evidence: "" }))).toBeNull();
    }
  });

  it("still requires a real keyword match for a non-excluded category", () => {
    expect(mapKeyPointToFeatureKey(keyPoint({ category: "conversion_path", message: "Something vague and unrelated.", evidence: "" }))).toBeNull();
  });

  it("matches free-form visual-review categories on message text, not on the category name", () => {
    expect(
      mapKeyPointToFeatureKey(
        keyPoint({ category: "some-llm-phrased-category", message: "No customer testimonials or reviews are shown anywhere.", evidence: "" }),
      ),
    ).toBe("testimonials");
  });

  it("never maps cross-page technical wording even under a non-excluded category", () => {
    expect(
      mapKeyPointToFeatureKey(keyPoint({ category: "conversion_path", message: "The page is not mobile-friendly.", evidence: "" })),
    ).toBeNull();
  });
});

describe("requirement templates", () => {
  it("defines each of the four templates with a real FEATURE_LIBRARY key", () => {
    const knownKeys = new Set(FEATURE_LIBRARY.map((f) => f.key));
    for (const keys of Object.values(REQUIREMENT_TEMPLATES)) {
      for (const key of keys) expect(knownKeys.has(key)).toBe(true);
    }
  });

  it("blank defines an empty feature set", () => {
    expect(REQUIREMENT_TEMPLATES.blank).toEqual([]);
  });

  it("each tier is a superset of the one before it", () => {
    const simple = new Set(REQUIREMENT_TEMPLATES.simple);
    const standard = new Set(REQUIREMENT_TEMPLATES.standard);
    const expanded = new Set(REQUIREMENT_TEMPLATES.expanded);
    for (const key of simple) expect(standard.has(key)).toBe(true);
    for (const key of standard) expect(expanded.has(key)).toBe(true);
  });
});

describe("inferAppliedRequirementTemplate", () => {
  it("matches blank for an empty current set", () => {
    expect(inferAppliedRequirementTemplate([])).toBe("blank");
  });

  it("matches a template whose set exactly equals the current keys, regardless of order", () => {
    expect(inferAppliedRequirementTemplate([...REQUIREMENT_TEMPLATES.standard].reverse())).toBe("standard");
  });

  it("returns null for a set that matches no template exactly", () => {
    expect(inferAppliedRequirementTemplate(["services", "faq"])).toBeNull();
  });
});

describe("isRequirementSelectionCustomised", () => {
  it("is false when the current set still exactly matches the applied template", () => {
    expect(isRequirementSelectionCustomised(REQUIREMENT_TEMPLATES.simple, "simple")).toBe(false);
  });

  it("is true once a feature is removed from the applied template's set", () => {
    expect(isRequirementSelectionCustomised(["services"], "simple")).toBe(true);
  });

  it("is true once a feature is added beyond the applied template's set", () => {
    expect(isRequirementSelectionCustomised([...REQUIREMENT_TEMPLATES.simple, "faq"], "simple")).toBe(true);
  });

  it("is false when no template has been applied — there is no baseline to have drifted from", () => {
    expect(isRequirementSelectionCustomised(["services", "faq"], null)).toBe(false);
  });
});

describe("diffRequirementTemplate", () => {
  it("from an empty board, toAdd is the whole template and toRemove is empty", () => {
    expect(diffRequirementTemplate([], "standard")).toEqual({ toAdd: REQUIREMENT_TEMPLATES.standard, toRemove: [] });
  });

  it("moving from simple to standard only adds — standard is a superset of simple", () => {
    const { toAdd, toRemove } = diffRequirementTemplate(REQUIREMENT_TEMPLATES.simple, "standard");
    expect(toRemove).toEqual([]);
    expect(toAdd.sort()).toEqual(
      REQUIREMENT_TEMPLATES.standard.filter((k) => !REQUIREMENT_TEMPLATES.simple.includes(k)).sort(),
    );
  });

  it("moving from expanded down to simple removes everything simple doesn't define", () => {
    const { toAdd, toRemove } = diffRequirementTemplate(REQUIREMENT_TEMPLATES.expanded, "simple");
    expect(toAdd).toEqual([]);
    expect(toRemove.sort()).toEqual(
      REQUIREMENT_TEMPLATES.expanded.filter((k) => !REQUIREMENT_TEMPLATES.simple.includes(k)).sort(),
    );
  });

  it("switching to blank removes every currently selected feature", () => {
    expect(diffRequirementTemplate(["services", "faq"], "blank")).toEqual({ toAdd: [], toRemove: ["services", "faq"] });
  });

  it("a manually-added extra outside the target template is reported in toRemove", () => {
    const { toRemove } = diffRequirementTemplate([...REQUIREMENT_TEMPLATES.simple, "booking"], "simple");
    expect(toRemove).toEqual(["booking"]);
  });
});

describe("availableLibraryFeatures", () => {
  it("returns the full starter library, in its static order, when nothing is added yet", () => {
    expect(availableLibraryFeatures(new Set())).toEqual(FEATURE_LIBRARY);
  });

  it("excludes any feature key already added, keeping the rest in their original order", () => {
    const result = availableLibraryFeatures(new Set(["gallery", "booking"]));
    expect(result.map((f) => f.key)).toEqual(FEATURE_LIBRARY.map((f) => f.key).filter((k) => k !== "gallery" && k !== "booking"));
  });

  it("returns an empty list once every library feature has been added", () => {
    const allKeys = new Set(FEATURE_LIBRARY.map((f) => f.key));
    expect(availableLibraryFeatures(allKeys)).toEqual([]);
  });

  it("restores a removed feature to its original position rather than appending it", () => {
    // Remove "gallery" (index 1) from the added set, as if its requirement
    // had just been deleted from the canvas.
    const withoutGallery = availableLibraryFeatures(new Set(["services", "pricing"]));
    expect(withoutGallery.map((f) => f.key)).toEqual(
      FEATURE_LIBRARY.map((f) => f.key).filter((k) => k !== "services" && k !== "pricing"),
    );
    expect(withoutGallery.at(-1)?.key).not.toBe("gallery"); // back in place, not appended
  });
});

describe("availableRecommendedFeatures", () => {
  const cards = [
    { featureKey: "faq", sourceRecommendationId: "r1", recommendationIds: ["r1"], hasAcceptedRecommendation: false, reason: "x" },
    { featureKey: "gallery", sourceRecommendationId: "r2", recommendationIds: ["r2"], hasAcceptedRecommendation: false, reason: "y" },
  ];

  it("returns every recommended card, in order, when nothing is added yet", () => {
    expect(availableRecommendedFeatures(cards, new Set())).toEqual(cards);
  });

  it("excludes a recommended card whose feature key is already added", () => {
    expect(availableRecommendedFeatures(cards, new Set(["faq"]))).toEqual([cards[1]]);
  });

  it("returns an empty list once every recommended feature has been added", () => {
    expect(availableRecommendedFeatures(cards, new Set(["faq", "gallery"]))).toEqual([]);
  });
});

describe("Plan step: recommendation decisions live in one place", () => {
  const faqProposed = recommendation({ id: "faq1", order_index: 0, title: "Add an FAQ section", explanation: "Answer common questions.", status: "proposed" });
  const faqAccepted = recommendation({ id: "faq2", order_index: 1, title: "Answer common questions up front", explanation: "Visitors ask the same things.", status: "accepted" });
  const faqDismissed = recommendation({ id: "faq3", order_index: 2, title: "Add a FAQs page", explanation: "More FAQs.", status: "dismissed" });
  const speed = recommendation({ id: "speed", order_index: 3, category: "improve", title: "Improve page speed", explanation: "Reduce load time.", status: "proposed" });
  const keepBrand = recommendation({ id: "keep", order_index: 4, category: "keep", title: "Keep the photo-led homepage", explanation: "Great images.", status: "accepted" });
  const improveGallery = recommendation({ id: "gal", order_index: 5, category: "improve", title: "Improve the gallery", explanation: "Photos are low resolution.", status: "proposed" });

  it("maps add/improve feature wording to a feature key; keep and cross-page concerns stay site-wide", () => {
    expect(recommendationFeatureKey(faqProposed)).toBe("faq");
    expect(recommendationFeatureKey(improveGallery)).toBe("gallery");
    expect(recommendationFeatureKey(keepBrand)).toBeNull();
    expect(recommendationFeatureKey(speed)).toBeNull();
    expect(isSiteWideRecommendation(keepBrand)).toBe(true);
    expect(isSiteWideRecommendation(speed)).toBe(true);
    expect(isSiteWideRecommendation(faqProposed)).toBe(false);
  });

  it("offers proposed recommendations in the library (not just already-accepted ones), deduped with every source id kept", () => {
    const p = planning({ recommendations: [faqProposed, faqAccepted, faqDismissed, speed, keepBrand, improveGallery] });
    const cards = deriveRecommendedRequirements(p);
    const faq = cards.find((c) => c.featureKey === "faq")!;
    expect(cards.map((c) => c.featureKey).sort()).toEqual(["faq", "gallery"]);
    expect(faq.recommendationIds).toEqual(["faq1", "faq2"]); // dismissed never revived
    expect(faq.sourceRecommendationId).toBe("faq1");
    expect(faq.hasAcceptedRecommendation).toBe(true);
    expect(faq.reason).not.toContain("accepted");
    expect(cards.find((c) => c.featureKey === "gallery")!.hasAcceptedRecommendation).toBe(false);
  });

  it("accepts every supporting recommendation on add, and only returns accepted ones to proposed on remove", () => {
    const p = planning({ recommendations: [faqProposed, faqAccepted, faqDismissed, speed] });
    expect(recommendationIdsForFeature(p, "faq")).toEqual(["faq1", "faq2"]);
    expect(acceptedRecommendationIdsForFeature(p, "faq")).toEqual(["faq2"]);
    expect(recommendationIdsForFeature(p, "booking")).toEqual([]);
  });

  it("surfaces accepted feature recommendations whose feature isn't on the canvas — never drops them", () => {
    const offBoard = planning({ recommendations: [faqAccepted, keepBrand], blueprint_requirements: [] });
    expect(unplacedAcceptedFeatureRecommendations(offBoard).map((r) => r.id)).toEqual(["faq2"]);
    const onBoard = planning({
      recommendations: [faqAccepted, keepBrand],
      blueprint_requirements: [requirement({ feature_key: "faq" })],
    });
    expect(unplacedAcceptedFeatureRecommendations(onBoard)).toEqual([]);
  });

  it("summarises features, site-wide decisions and gaps for Review & build", () => {
    const p = planning({
      recommendations: [faqAccepted, speed, keepBrand],
      blueprint_requirements: [requirement({ feature_key: "services" }), requirement({ id: "req2", feature_key: "about" })],
    });
    const summary = computePlanSelectionSummary(p);
    expect(summary.featureLabels).toEqual(["About", "Services"]);
    expect(summary.siteWideAccepted.map((r) => r.id)).toEqual(["keep"]);
    expect(summary.siteWideProposed).toBe(1);
    expect(summary.unplacedAccepted.map((r) => r.id)).toEqual(["faq2"]);
  });
});

describe("template descriptions and apply preview", () => {
  it("each summary names exactly the features its template defines — no more, no fewer", () => {
    for (const [key, keys] of Object.entries(REQUIREMENT_TEMPLATES)) {
      const summary = REQUIREMENT_TEMPLATE_SUMMARY[key as keyof typeof REQUIREMENT_TEMPLATES];
      const mentioned = new Set(FEATURE_LIBRARY.filter((f) => new RegExp(`\\b${f.label}\\b`).test(summary)).map((f) => f.key));
      if (/Everything in Standard/.test(summary)) for (const k of REQUIREMENT_TEMPLATES.standard) mentioned.add(k);
      expect([...mentioned].sort(), key).toEqual([...keys].sort());
    }
  });

  it("empty plan: everything is an addition", () => {
    expect(describeRequirementTemplateEffect([], "expanded")).toEqual({
      toAdd: REQUIREMENT_TEMPLATES.expanded,
      alreadySelected: [],
      toRemove: [],
      toRemoveWithNotes: [],
    });
    expect(describeRequirementTemplateEffect([], "blank").toAdd).toEqual([]);
  });

  it("partial selection: counts what's already there and adds the rest", () => {
    const effect = describeRequirementTemplateEffect([requirement({ feature_key: "services" }), requirement({ id: "q2", feature_key: "contact" })], "expanded");
    expect(effect.toAdd).toHaveLength(6);
    expect(effect.alreadySelected).toEqual(["services", "contact"]);
    expect(effect.toRemove).toEqual([]);
  });

  it("customised selection: custom picks outside the template are removed, with notes flagged", () => {
    const effect = describeRequirementTemplateEffect(
      [requirement({ feature_key: "services" }), requirement({ id: "q2", feature_key: "booking", notes: "Use Fresha" }), requirement({ id: "q3", feature_key: "custom_quote" })],
      "simple",
    );
    expect(effect.toAdd).toEqual(["contact"]);
    expect(effect.alreadySelected).toEqual(["services"]);
    expect(effect.toRemove).toEqual(["booking", "custom_quote"]);
    expect(effect.toRemoveWithNotes).toEqual(["booking"]);
  });
});

describe("computeRequirementEvidence", () => {
  const noContact = { business_phone: null, business_email: null };
  const asset = (category: string, status: string, note: string | null = null) =>
    ({ id: category, category, label: category, status, note, created_at: "", updated_at: "" }) as never;

  it("reports what's on file per selected feature, with its source, and asks nothing routine", () => {
    const p = planning({
      blueprint_requirements: [
        requirement({ id: "a", order_index: 0, feature_key: "booking" }),
        requirement({ id: "b", order_index: 1, feature_key: "pricing" }),
        requirement({ id: "c", order_index: 2, feature_key: "services" }),
      ],
      assets: [asset("booking_destination", "ready_to_use"), asset("service_descriptions", "missing")],
    });
    const byKey = Object.fromEntries(
      computeRequirementEvidence(p, { business_phone: "0400 000 000", business_email: null }).map((e) => [e.featureKey, e]),
    );
    expect(byKey.booking.known.map((k) => k.source)).toEqual(["Assets checklist", "Lead record"]);
    expect(byKey.booking.essentialQuestion).toBeNull();
    expect(byKey.pricing).toMatchObject({ featureKey: "pricing", known: [], essentialQuestion: null }); // never invented
    expect(byKey.pricing.contentNeeded).toBe("Prices confirmed by the business.");
    expect(byKey.services.known[0].text).toContain("not supplied yet");
  });

  it("the one essential question: a contact method, only when the lead has neither phone nor email", () => {
    const p = planning({ blueprint_requirements: [requirement({ feature_key: "contact" })] });
    expect(computeRequirementEvidence(p, noContact)[0].essentialQuestion).toContain("lead record");
    expect(computeRequirementEvidence(p, { business_phone: null, business_email: "hi@x.test" })[0]).toMatchObject({
      essentialQuestion: null,
      known: [{ text: "Email: hi@x.test", source: "Lead record" }],
    });
    expect(computeRequirementEvidence(p, null)[0].essentialQuestion).toBeNull(); // still loading — don't guess
  });

  it("draws on research already done (reviews, FAQ ideas) without touching notes", () => {
    const p = planning({
      blueprint_requirements: [
        requirement({ id: "a", feature_key: "faq", notes: "Operator's own" }),
        requirement({ id: "b", order_index: 1, feature_key: "testimonials" }),
      ],
      review_faq_opportunities: [{ question: "Do you do weekends?", answer_hint: "", source_theme: "" }] as never,
      review_intelligence: { google_rating: 4.7, google_review_count: 23, reviews_with_text: 5 } as never,
    });
    const [faq, testimonials] = computeRequirementEvidence(p, noContact);
    expect(faq.known).toEqual([{ text: "Do you do weekends?", source: "Review Insights" }]);
    expect(testimonials.known[0].text).toBe("4.7★ from 23 Google reviews, 5 with written text");
  });
});

describe("expanded feature catalogue", () => {
  it("keeps every original key and has no duplicate keys or labels", () => {
    const keys = FEATURE_LIBRARY.map((f) => f.key);
    for (const k of ["services", "gallery", "pricing", "faq", "contact", "booking", "about", "testimonials"]) expect(keys).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(FEATURE_LIBRARY.map((f) => f.label.toLowerCase())).size).toBe(keys.length);
    expect(keys.every((k) => k.length <= 50)).toBe(true); // feature_key is String(50)
  });

  it("every capability says it still needs implementing; evidence-dependent features say what's needed", () => {
    for (const f of FEATURE_LIBRARY.filter((f) => f.kind === "capability")) expect(f.detail).toContain("nothing is connected yet");
    for (const k of ["testimonials", "accreditations", "case_studies", "animated_stats"]) {
      expect(FEATURE_LIBRARY.find((f) => f.key === k)?.needsRealContent).toBeTruthy();
    }
  });

  it("filters by search text and category", () => {
    expect(filterFeatureLibrary(FEATURE_LIBRARY, "quote req", "all").map((f) => f.key)).toEqual(["quote_request"]);
    expect(filterFeatureLibrary(FEATURE_LIBRARY, "QUOTE", "all").map((f) => f.key)).toEqual(["testimonials", "quote_request"]);
    expect(filterFeatureLibrary(FEATURE_LIBRARY, "", "style").every((f) => f.category === "style")).toBe(true);
    expect(filterFeatureLibrary(FEATURE_LIBRARY, "gallery", "experience").map((f) => f.key)).toEqual(["filterable_gallery"]);
  });

  it("light and dark appearance conflict; unrelated styles don't", () => {
    expect(conflictingSelections("style_dark", ["style_light", "style_bold_type"])).toEqual(["style_light"]);
    expect(conflictingSelections("style_bold_type", ["style_light"])).toEqual([]);
  });

  it("templates never remove or count design preferences / site-wide behaviours", () => {
    const current = ["services", "contact", "style_dark", "sticky_nav"];
    expect(inferAppliedRequirementTemplate(current)).toBe("simple");
    expect(diffRequirementTemplate(current, "blank").toRemove).toEqual(["services", "contact"]);
    expect(diffRequirementTemplate(current, "standard")).toEqual({ toAdd: ["about", "gallery"], toRemove: [] });
    expect(featureKind("style_dark")).toBe("design");
    expect(featureKind("some_legacy_key")).toBe("section");
  });

  it("the review summary keeps sections, functionality and design preferences apart", () => {
    const p = planning({
      blueprint_requirements: [
        requirement({ id: "a", feature_key: "services" }),
        requirement({ id: "b", order_index: 1, feature_key: "payments" }),
        requirement({ id: "c", order_index: 2, feature_key: "style_dark" }),
        requirement({ id: "d", order_index: 3, feature_key: "sticky_nav" }),
      ],
    });
    const summary = computePlanSelectionSummary(p);
    expect(summary.featureLabels).toEqual(["Services"]);
    expect(summary.capabilityLabels).toEqual(["Payments / deposits"]);
    expect(summary.designLabels).toEqual(["Dark appearance", "Sticky navigation"]);
  });
});
