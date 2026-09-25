import { describe, expect, it } from "vitest";
import {
  availableLibraryFeatures,
  availableRecommendedFeatures,
  clampGapIndex,
  computeBlueprintSummary,
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
  isRequirementSelectionCustomised,
  mapKeyPointToFeatureKey,
  mapRecommendationToFeatureKey,
  mapRecommendationToSectionType,
  REQUIREMENT_TEMPLATES,
  reorderSections,
  SECTION_TYPE_LABEL,
  sitemapPagePathLabel,
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
    expect(withoutGallery.map((f) => f.key)).toEqual(["gallery", "faq", "contact", "booking", "about", "testimonials"]);
  });
});

describe("availableRecommendedFeatures", () => {
  const cards = [
    { featureKey: "faq", sourceRecommendationId: "r1", reason: "x" },
    { featureKey: "gallery", sourceRecommendationId: "r2", reason: "y" },
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
