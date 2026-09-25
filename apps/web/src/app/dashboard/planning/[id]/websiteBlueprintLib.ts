import {
  type BlueprintTemplate,
  type ContentPage,
  type ContentSection,
  type ContentSectionType,
  type Planning,
  type PlanningKeyPoint,
  type Recommendation,
  type SitemapPageProposal,
} from "@/lib/api";

/**
 * Website Blueprint — pure, unit-testable logic shared by the
 * template picker, the section library, and the wireframe canvas. See
 * WebsiteBlueprintSection.tsx's own docstring for why the Blueprint is
 * a view over the SAME sitemap_pages -> content_pages -> sections
 * hierarchy Content Draft manages, not a parallel data model.
 */

// Mirrors ContentSectionEditor.tsx's own SECTION_TYPE_LABEL exactly —
// the Blueprint's library must show the same vocabulary Content Draft
// already uses for the same section_type. Duplicated (rather than
// imported) because ContentSectionEditor.tsx doesn't export it and is
// out of this task's scope to touch; keep the two in sync if either
// changes.
export const SECTION_TYPE_LABEL: Record<string, string> = {
  hero: "Homepage headline",
  about: "About",
  serviceCards: "Services",
  gallery: "Gallery introduction",
  contact: "Contact & booking",
  cta: "Call to action",
  faq: "FAQs",
};

/** One short, neutral line per section type for the library's cards —
 * describes the section TYPE only (layout/purpose), never a specific
 * business's content. Paired with SECTION_TYPE_LABEL above; keep both in
 * sync when a section type is added. */
export const SECTION_TYPE_DESCRIPTION: Record<ContentSectionType, string> = {
  hero: "A big headline, a line of support copy, and a primary call to action.",
  about: "A photo alongside a few paragraphs introducing the business.",
  serviceCards: "A grid of service or package cards.",
  gallery: "A grid of photos.",
  contact: "A short contact form with a call to action.",
  cta: "A focused call-to-action banner.",
  faq: "A list of frequently asked questions.",
};

export const BLUEPRINT_TEMPLATE_LABEL: Record<BlueprintTemplate, string> = {
  simple: "Simple",
  standard: "Standard",
  expanded: "Expanded",
};

export type BlueprintTemplatePreview = {
  template: BlueprintTemplate;
  label: string;
  pageCount: number;
  outline: { page: string; sections: ContentSectionType[] }[];
};

// A rough, indicative outline for each starter template — not a copy
// of the backend's exact seed data (this stays a frontend-only
// preview; the real pages/sections are whatever `applyBlueprintTemplate`
// actually creates, shown afterwards on the canvas). Kept intentionally
// light per the task's own "don't over-invest in illustration" note.
export const BLUEPRINT_TEMPLATE_PREVIEWS: Record<BlueprintTemplate, BlueprintTemplatePreview> = {
  simple: {
    template: "simple",
    label: "Simple",
    pageCount: 1,
    outline: [{ page: "Home", sections: ["hero", "serviceCards", "about", "contact"] }],
  },
  standard: {
    template: "standard",
    label: "Standard",
    pageCount: 4,
    outline: [
      { page: "Home", sections: ["hero", "serviceCards", "about", "cta"] },
      { page: "About", sections: ["about", "cta"] },
      { page: "Services", sections: ["serviceCards", "cta"] },
      { page: "Contact", sections: ["contact"] },
    ],
  },
  expanded: {
    template: "expanded",
    label: "Expanded",
    pageCount: 6,
    outline: [
      { page: "Home", sections: ["hero", "serviceCards", "about", "gallery", "cta"] },
      { page: "About", sections: ["about", "cta"] },
      { page: "Services", sections: ["serviceCards", "cta"] },
      { page: "Gallery", sections: ["gallery"] },
      { page: "FAQs", sections: ["faq"] },
      { page: "Contact", sections: ["contact"] },
    ],
  },
};

export type SuggestedLibraryItem = { recommendation: Recommendation };

/** Accepted "Add" recommendations — the library's "Suggested" group.
 * Never anything else: a "keep"/"improve" recommendation, or one that's
 * proposed/dismissed rather than accepted, doesn't belong here. */
export function deriveSuggestedSections(planning: Planning): SuggestedLibraryItem[] {
  return planning.recommendations
    .filter((r) => r.status === "accepted" && r.category === "add")
    .sort((a, b) => a.order_index - b.order_index)
    .map((recommendation) => ({ recommendation }));
}

// --- Library "Recommended" view: recommendation -> section type mapping ---
//
// Turns `deriveSuggestedSections`'s own accepted "Add" recommendations into
// section-library cards, matched to a section type only on a real, keyword
// correspondence in the recommendation's own already-written title/
// explanation — never an LLM call, never invented wording, and never a
// second recommendation source. A recommendation about a cross-page,
// non-visual concern (accessibility, page speed, SEO, mobile-friendliness,
// and the like) never maps to a section: it belongs in the Build Brief.

const EXCLUDED_RECOMMENDATION_PATTERN =
  /\b(accessib\w*|page[- ]?speed|site[- ]?speed|load(?:ing)?[- ]?time|performance|seo|search engine|meta (?:title|description)s?|mobile[- ]?friendl\w*|responsive design|core web vitals|alt text|schema markup|structured data)\b/i;

/** Checked in order, so a recommendation whose text matches more than one
 * group picks the first (most specific/common) match — order reflects
 * roughly how these terms show up in real recommendation wording, not a
 * semantic ranking beyond that. */
const SECTION_TYPE_KEYWORD_PATTERNS: { type: ContentSectionType; pattern: RegExp }[] = [
  { type: "faq", pattern: /\b(faqs?|frequently asked|common questions)\b/i },
  { type: "gallery", pattern: /\b(photos?|images?|portfolio|before[- ]and[- ]after|gallery)\b/i },
  { type: "serviceCards", pattern: /\b(pricing|prices?|packages?|services?|offerings?|menu)\b/i },
  {
    type: "contact",
    pattern: /\b(contact (?:us|form|page)?|booking|book (?:a|an|now)|appointment|phone number|opening hours|business hours)\b/i,
  },
  { type: "about", pattern: /\b(testimonials?|reviews?|about (?:us|the business)|our story|meet the team)\b/i },
  { type: "hero", pattern: /\b(headline|hero (?:section|image|banner)|homepage message|tagline|first impression)\b/i },
];

/** Maps one recommendation to the single section type it defensibly
 * supports, or `null` when it doesn't correspond to a visible section — a
 * cross-page concern, or wording with no real keyword match. */
export function mapRecommendationToSectionType(
  recommendation: Pick<Recommendation, "title" | "explanation">,
): ContentSectionType | null {
  const text = `${recommendation.title} ${recommendation.explanation}`;
  if (EXCLUDED_RECOMMENDATION_PATTERN.test(text)) return null;
  const match = SECTION_TYPE_KEYWORD_PATTERNS.find((m) => m.pattern.test(text));
  return match ? match.type : null;
}

export type RecommendedLibrarySection = {
  sectionType: ContentSectionType;
  /** The primary (earliest order_index) recommendation — its id is what a
   * section added from this card carries as `source_recommendation_id`. */
  primary: Recommendation;
  recommendations: Recommendation[];
  /** Evidence-backed reason, built only from the supporting
   * recommendations' own title text — never fabricated. */
  reason: string;
};

function reasonFor(recommendations: Recommendation[]): string {
  if (recommendations.length === 1) {
    return `Supports the accepted recommendation "${recommendations[0].title}".`;
  }
  return `Supports ${recommendations.length} accepted recommendations: ${recommendations
    .map((r) => `"${r.title}"`)
    .join(", ")}.`;
}

/** The library's "Recommended" view — one card per section type, deduped.
 * Multiple accepted "Add" recommendations mapping to the same section type
 * collapse into a single card whose reason references all of them; a
 * recommendation with no defensible section-type match (see
 * `mapRecommendationToSectionType`) is left out entirely rather than
 * guessed at. */
export function deriveRecommendedSections(planning: Planning): RecommendedLibrarySection[] {
  const byType = new Map<ContentSectionType, Recommendation[]>();
  for (const { recommendation } of deriveSuggestedSections(planning)) {
    const type = mapRecommendationToSectionType(recommendation);
    if (!type) continue;
    const existing = byType.get(type);
    if (existing) existing.push(recommendation);
    else byType.set(type, [recommendation]);
  }
  return Array.from(byType.entries()).map(([sectionType, recommendations]) => ({
    sectionType,
    primary: recommendations[0],
    recommendations,
    reason: reasonFor(recommendations),
  }));
}

// --- Requirements board: the simplified feature-picker view -----------
//
// A flat, position-independent alternative to the section library above
// — see `Requirement`/`blueprint_requirements` in lib/api.ts and the
// backend's `LeadPlanningRequirement` docstring for why this is a
// genuinely separate concept from `sitemap_pages`/`content_pages`/
// sections. `feature_key` is a free string on the wire; the starter
// vocabulary and its labels/icons live here, on the frontend only.

export type FeatureDefinition = {
  key: string;
  label: string;
  /** One short, neutral line describing the feature itself — never a
   * specific business's content, same convention as
   * SECTION_TYPE_DESCRIPTION above. */
  description: string;
};

/** The starter set the library shows under "All features". Not an
 * exhaustive/fixed list — `feature_key` accepts any string, so a
 * recommendation-derived or otherwise custom key still round-trips
 * fine (see `featureLabel`'s fallback below); this is just the
 * hand-picked common set worth surfacing up front. */
export const FEATURE_LIBRARY: FeatureDefinition[] = [
  { key: "services", label: "Services", description: "A list or grid of the services or packages you offer." },
  { key: "gallery", label: "Gallery", description: "A grid of photos showing recent work." },
  { key: "pricing", label: "Pricing", description: "Prices or package costs, shown up front." },
  { key: "faq", label: "FAQ", description: "Answers to the questions customers ask most." },
  { key: "contact", label: "Contact", description: "A way to reach you — form, phone, address, or map." },
  { key: "booking", label: "Booking", description: "Let visitors book an appointment online." },
  { key: "about", label: "About", description: "Your story, your team, or what makes the business different." },
  { key: "testimonials", label: "Testimonials", description: "Reviews and quotes from happy customers." },
];

export const FEATURE_LABEL: Record<string, string> = Object.fromEntries(FEATURE_LIBRARY.map((f) => [f.key, f.label]));
export const FEATURE_DESCRIPTION: Record<string, string> = Object.fromEntries(
  FEATURE_LIBRARY.map((f) => [f.key, f.description]),
);

/** A human label for any `feature_key` — the starter vocabulary's own
 * label when it's a known key, or a formatted fallback (snake_case /
 * camelCase -> "Title case words") for anything else, e.g. a key carried
 * over from a source this task didn't anticipate. Never the raw string. */
export function featureLabel(featureKey: string): string {
  const known = FEATURE_LABEL[featureKey];
  if (known) return known;
  const words = featureKey
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!words) return featureKey;
  const lower = words.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// --- Requirements board "Recommended" view: recommendation -> feature_key ---
//
// The same real, keyword-correspondence approach as
// `mapRecommendationToSectionType` above, adapted to the feature-key
// vocabulary instead of section types — see that function's own comment
// for the shared exclusion rule (cross-page concerns never map). A
// recommendation about pricing/packages and one about services/offerings
// now map to two distinct feature keys (they were both `serviceCards`
// under the old section vocabulary); testimonials/reviews wording gets
// its own `testimonials` key rather than folding into `about`.

const FEATURE_KEYWORD_PATTERNS: { key: string; pattern: RegExp }[] = [
  { key: "faq", pattern: /\b(faqs?|frequently asked|common questions)\b/i },
  { key: "gallery", pattern: /\b(photos?|images?|portfolio|before[- ]and[- ]after|gallery)\b/i },
  { key: "pricing", pattern: /\b(pricing|prices?|packages?|cost)\b/i },
  { key: "services", pattern: /\b(services?|offerings?|menu)\b/i },
  { key: "booking", pattern: /\b(booking|book (?:a|an|now)|appointment|online booking)\b/i },
  {
    key: "contact",
    pattern: /\b(contact (?:us|form|page)?|phone number|opening hours|business hours)\b/i,
  },
  { key: "testimonials", pattern: /\b(testimonials?|reviews?)\b/i },
  { key: "about", pattern: /\b(about (?:us|the business)|our story|meet the team)\b/i },
];

/** Maps one recommendation to the single feature key it defensibly
 * supports, or `null` when it doesn't correspond to a website feature —
 * a cross-page concern, or wording with no real keyword match. */
export function mapRecommendationToFeatureKey(
  recommendation: Pick<Recommendation, "title" | "explanation">,
): string | null {
  const text = `${recommendation.title} ${recommendation.explanation}`;
  if (EXCLUDED_RECOMMENDATION_PATTERN.test(text)) return null;
  const match = FEATURE_KEYWORD_PATTERNS.find((m) => m.pattern.test(text));
  return match ? match.key : null;
}

export type RecommendedFeatureCard = {
  featureKey: string;
  /** `source_recommendation_id` to send when this card's feature is
   * added — the primary (earliest order_index) accepted recommendation
   * that supports it, when one exists. Null for a suggestion that comes
   * only from an audit finding (see below): a `PlanningKeyPoint` has no
   * corresponding `lead_planning_recommendations` row to reference, and
   * the column is a real FK (`ON DELETE SET NULL`) — inventing an id here
   * would fail the insert, so an add from a finding-only card simply
   * carries no `source_recommendation_id` at all. */
  sourceRecommendationId: string | null;
  /** Evidence-backed "why suggested" text — quotes/paraphrases whichever
   * real source(s) produced this suggestion (one or more accepted
   * recommendations' own titles, one or more audit findings' own
   * messages, or both, when the same feature key is independently
   * supported by each). Never fabricated, never invented for a feature
   * key nothing in the plan's own data actually supports. */
  reason: string;
};

/** The requirements board's "Recommended" view — one card per feature
 * key, deduped, built from TWO independent, real evidence sources that
 * both feed the same list (never two separate tabs/sections for them):
 * the plan's own accepted "Add" recommendations (`deriveSuggestedSections`,
 * shared with the old section library), and the website audit's own
 * `key_points` findings (see `mapKeyPointToFeatureKey` below). A feature
 * key supported by both collapses into one card whose reason cites both;
 * a plan with no accepted recommendations and no usable findings (a
 * failed/incomplete audit, or one whose findings are all cross-page
 * technical concerns) simply returns an empty list — this function never
 * manufactures a suggestion to "fill the panel". */
export function deriveRecommendedRequirements(planning: Planning): RecommendedFeatureCard[] {
  const byKey = new Map<string, { sourceRecommendationId: string | null; reasons: string[] }>();

  const recommendationsByKey = new Map<string, Recommendation[]>();
  for (const { recommendation } of deriveSuggestedSections(planning)) {
    const key = mapRecommendationToFeatureKey(recommendation);
    if (!key) continue;
    const existing = recommendationsByKey.get(key);
    if (existing) existing.push(recommendation);
    else recommendationsByKey.set(key, [recommendation]);
  }
  for (const [key, recommendations] of recommendationsByKey) {
    byKey.set(key, { sourceRecommendationId: recommendations[0].id, reasons: [reasonFor(recommendations)] });
  }

  const keyPointsByKey = new Map<string, PlanningKeyPoint[]>();
  for (const point of planning.key_points) {
    const key = mapKeyPointToFeatureKey(point);
    if (!key) continue;
    const existing = keyPointsByKey.get(key);
    if (existing) existing.push(point);
    else keyPointsByKey.set(key, [point]);
  }
  for (const [key, points] of keyPointsByKey) {
    const existing = byKey.get(key);
    if (existing) existing.reasons.push(reasonForKeyPoints(points));
    else byKey.set(key, { sourceRecommendationId: null, reasons: [reasonForKeyPoints(points)] });
  }

  return Array.from(byKey.entries()).map(([featureKey, { sourceRecommendationId, reasons }]) => ({
    featureKey,
    sourceRecommendationId,
    reason: reasons.join(" "),
  }));
}

// --- Requirements board "Recommended" view: audit finding -> feature_key ---
//
// A second, independent evidence source into the exact same "Recommended"
// list above — built from `planning.key_points` (the audit's `Finding`
// list: area/category/severity/message/evidence/confidence, see
// PlanningKeyPoint in lib/api.ts), never a new AI/LLM call or a second
// fetch. The deterministic audit (agents/planning_audit.py) uses a fixed
// `category` taxonomy, but several of those categories name cross-page,
// non-visual technical concerns (page speed, broken links, markup,
// contrast, heading structure, technical/local SEO, availability,
// security) that must never turn into a feature-card suggestion — those
// stay exactly where they already are, in the Build Brief/recommendations
// workflow. `business_information` is excluded too despite the name: in
// this audit it's specifically about the page's <title>/meta description,
// not "is there visible contact info". The LLM-based visual review
// (agents/planning_visual_review.py) uses free-form `category` strings
// instead (never a fixed enum — see that module's own comment), so this
// never trusts `category` alone to mean "this is feature-relevant" for
// anything outside the excluded set above; every finding that isn't
// excluded by category still has to pass the same real keyword match
// (and the same cross-page-technical exclusion pattern) that
// `mapRecommendationToFeatureKey` already applies to recommendation text.

const KEY_POINT_EXCLUDED_CATEGORIES = new Set([
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
]);

function reasonForKeyPoints(points: PlanningKeyPoint[]): string {
  if (points.length === 1) {
    return `From the website audit: "${points[0].message}"`;
  }
  return `From the website audit: ${points.map((p) => `"${p.message}"`).join(" ")}`;
}

/** Maps one audit finding to the single feature key it defensibly
 * supports, or `null` when it doesn't — either its category names a
 * cross-page technical concern outright, or its own message/evidence text
 * carries no real, defensible keyword match (the same rule
 * `mapRecommendationToFeatureKey` applies to recommendation text; see
 * that function's own comment for the shared exclusion pattern and
 * keyword list). Never a guess based on category name alone for anything
 * outside the fixed excluded set — a free-form visual-review category can
 * say anything, and even a non-excluded deterministic category (e.g.
 * `conversion_path`) still has to earn its match on real wording. */
export function mapKeyPointToFeatureKey(
  point: Pick<PlanningKeyPoint, "category" | "message" | "evidence">,
): string | null {
  if (KEY_POINT_EXCLUDED_CATEGORIES.has(point.category)) return null;
  const text = `${point.message} ${point.evidence}`;
  if (EXCLUDED_RECOMMENDATION_PATTERN.test(text)) return null;
  const match = FEATURE_KEYWORD_PATTERNS.find((m) => m.pattern.test(text));
  return match ? match.key : null;
}

// --- Requirements board library: hide already-added features -----------
//
// Once a feature_key is on the canvas (present in
// `planning.blueprint_requirements`), it must disappear from BOTH library
// views entirely — not show as disabled/"Added" — so there is exactly one
// duplicate-prevention mechanism (nothing left to add it from) rather than
// two that could drift apart. Both functions are plain filters over the
// STATIC library order (`FEATURE_LIBRARY`'s own order, and
// `deriveRecommendedRequirements`'s own order), so a feature removed from
// the canvas reappears here in its original position — never re-sorted or
// appended at the end. `addedKeys` is expected to be derived straight from
// `planning.blueprint_requirements` by the caller (see RequirementsBoard),
// never tracked separately.

/** "All features" view, filtered to the ones not already on the canvas. */
export function availableLibraryFeatures(addedKeys: ReadonlySet<string>): FeatureDefinition[] {
  return FEATURE_LIBRARY.filter((feature) => !addedKeys.has(feature.key));
}

/** "Recommended" view, filtered to the ones not already on the canvas. */
export function availableRecommendedFeatures(
  recommended: RecommendedFeatureCard[],
  addedKeys: ReadonlySet<string>,
): RecommendedFeatureCard[] {
  return recommended.filter((item) => !addedKeys.has(item.featureKey));
}

// --- Requirements board templates ---------------------------------------
//
// A NEW, frontend-only "template" concept, scoped entirely to the
// requirements board's flat `feature_key` set — do not confuse this with
// `BlueprintTemplate`/`BLUEPRINT_TEMPLATES` above, which seeds the old
// page-by-page `sitemap_pages`/`content_pages`/sections editor via the
// backend's `apply_blueprint_template`. Applying one of these never calls
// that endpoint and never touches `sitemap_pages`/`content_pages` — it's
// just a defined starter `feature_key` set, added through the exact same
// `api.addRequirement` calls a manual "+ Add" already uses (looping, one
// call per missing key), so every existing filtering/dedup/persistence
// rule for `blueprint_requirements` covers it automatically with no
// second mechanism. No backend field records which template (if any) is
// currently applied — "customised" is derived purely by comparing the
// board's actual current `feature_key`s against a template's own defined
// set (see `isRequirementSelectionCustomised` below), never a stored flag.
export const REQUIREMENT_TEMPLATE_ORDER = ["blank", "simple", "standard", "expanded"] as const;
export type RequirementTemplateKey = (typeof REQUIREMENT_TEMPLATE_ORDER)[number];

export const REQUIREMENT_TEMPLATE_LABEL: Record<RequirementTemplateKey, string> = {
  blank: "Blank",
  simple: "Simple",
  standard: "Standard",
  expanded: "Expanded",
};

export const REQUIREMENT_TEMPLATE_DESCRIPTION: Record<RequirementTemplateKey, string> = {
  blank: "No features selected — start from an empty canvas.",
  simple: "The essentials for a one-page site.",
  standard: "A well-rounded small-business site.",
  expanded: "A fuller site with everything on offer.",
};

/** The defined starter feature set for each template — a plain, ordered
 * list of `FEATURE_LIBRARY` keys. Each is a superset of the one before it
 * (simple ⊂ standard ⊂ expanded) so moving "up" a tier is always a pure
 * addition with nothing to remove; only moving "down" a tier, or to
 * Blank, ever has anything to remove (see `diffRequirementTemplate`). */
export const REQUIREMENT_TEMPLATES: Record<RequirementTemplateKey, string[]> = {
  blank: [],
  simple: ["services", "contact"],
  standard: ["services", "about", "contact", "gallery"],
  expanded: ["services", "about", "contact", "gallery", "pricing", "faq", "testimonials", "booking"],
};

function sameFeatureSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

/** Which template (if any) the board's CURRENT feature set exactly
 * matches — used only to initialise the selector's own "applied" state
 * (e.g. on first load/mount), never re-derived from a stored preference.
 * Returns `null` when the current set matches no template exactly (an
 * entirely custom/manual selection, or a partial match). */
export function inferAppliedRequirementTemplate(currentKeys: string[]): RequirementTemplateKey | null {
  const current = new Set(currentKeys);
  for (const key of REQUIREMENT_TEMPLATE_ORDER) {
    if (sameFeatureSet(current, new Set(REQUIREMENT_TEMPLATES[key]))) return key;
  }
  return null;
}

/** Whether the board's current feature set has drifted from whichever
 * template was last applied (added/removed beyond that template's own
 * defined set) — a pure comparison, not a new persisted flag. `null` for
 * `appliedTemplate` (no template applied/matched this session) always
 * reads as "not customised": there's no baseline to have drifted from. */
export function isRequirementSelectionCustomised(
  currentKeys: string[],
  appliedTemplate: RequirementTemplateKey | null,
): boolean {
  if (appliedTemplate === null) return false;
  return !sameFeatureSet(new Set(currentKeys), new Set(REQUIREMENT_TEMPLATES[appliedTemplate]));
}

/** What applying `templateKey` would change relative to the board's
 * current feature set — every key the template defines that isn't
 * selected yet (`toAdd`), and every currently-selected key the template
 * doesn't define (`toRemove`). `toRemove` is what makes a switch
 * destructive: an empty `toRemove` means nothing currently selected would
 * be lost, so the caller can apply immediately; a non-empty one is what
 * `RequirementsBoard`'s confirm-before-switch preview is built from. */
export function diffRequirementTemplate(
  currentKeys: string[],
  templateKey: RequirementTemplateKey,
): { toAdd: string[]; toRemove: string[] } {
  const target = new Set(REQUIREMENT_TEMPLATES[templateKey]);
  const current = new Set(currentKeys);
  return {
    toAdd: REQUIREMENT_TEMPLATES[templateKey].filter((key) => !current.has(key)),
    toRemove: currentKeys.filter((key) => !target.has(key)),
  };
}

export function findContentPage(planning: Planning, sitemapPageId: string): ContentPage | undefined {
  return planning.content_pages.find((p) => p.sitemap_page_id === sitemapPageId);
}

/** Moves the section at `fromIndex` to `toIndex` within an already
 * order_index-sorted list, and returns the full reindexed
 * `{id, order_index}` payload `reorderContentSections` expects (0..n-1,
 * contiguous, for every section on the page — not just the ones that
 * moved). */
export function reorderSections(
  sortedSections: ContentSection[],
  fromIndex: number,
  toIndex: number,
): { id: string; order_index: number }[] {
  const clampedTo = Math.max(0, Math.min(toIndex, sortedSections.length - 1));
  const next = [...sortedSections];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return sortedSections.map((s, i) => ({ id: s.id, order_index: i }));
  next.splice(clampedTo, 0, moved);
  return next.map((s, i) => ({ id: s.id, order_index: i }));
}

// --- Browser-chrome canvas: page label, wireframe shapes, drop math ----
//
// Pure logic backing BlueprintCanvas's visual rework — kept here (rather
// than inline in the component) so the mapping/math is unit-testable
// without mounting React or simulating drag events.

/** A non-functioning "address bar" label for the canvas's browser-chrome
 * toolbar — derived from the page's own title/type, never invented.
 * Purely cosmetic (it labels the preview, it doesn't navigate anything). */
export function sitemapPagePathLabel(page: Pick<SitemapPageProposal, "title" | "page_type">): string {
  if (page.page_type === "home") return "/";
  const slug = page.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `/${slug || page.page_type || "page"}`;
}

/** One rough shape in a section's wireframe. `role` picks the visual
 * treatment (see BlueprintCanvas); `count` repeats it (grid tiles, form
 * fields, FAQ rows); `variant` distinguishes two looks for the same role
 * (a service-card grid vs. a plain image grid). Rendering never invents
 * copy — a `heading`/`subtext` block shows the section's own already-set
 * `heading`/`draft_text` when present, and falls back to a plain grey
 * placeholder shape only when it isn't. */
export type WireframeBlockRole = "heading" | "subtext" | "media" | "cta" | "grid" | "field" | "list";
export type WireframeBlock = {
  role: WireframeBlockRole;
  count?: number;
  variant?: "cards" | "images";
};

const DEFAULT_WIREFRAME: WireframeBlock[] = [{ role: "heading" }, { role: "subtext", count: 2 }];

/** Rough, indicative wireframe layout per `section_type` — deliberately
 * generic placeholder shapes (a real design pass happens later in
 * Content Draft/visual direction), not a pixel-accurate preview. */
const SECTION_WIREFRAME: Record<ContentSectionType, WireframeBlock[]> = {
  hero: [{ role: "heading" }, { role: "subtext", count: 2 }, { role: "cta" }],
  about: [{ role: "heading" }, { role: "media" }, { role: "subtext", count: 3 }],
  serviceCards: [{ role: "heading" }, { role: "grid", count: 3, variant: "cards" }],
  gallery: [{ role: "heading" }, { role: "grid", count: 4, variant: "images" }],
  contact: [{ role: "heading" }, { role: "field", count: 3 }, { role: "cta" }],
  cta: [{ role: "heading" }, { role: "subtext", count: 1 }, { role: "cta" }],
  faq: [{ role: "heading" }, { role: "list", count: 3 }],
};

/** Looks up the wireframe layout for a section's `section_type`, falling
 * back to a generic heading+text shape for any value outside the known
 * `ContentSectionType` union (defensive — `section_type` is a plain
 * string on the wire, not a validated enum on this side). */
export function getSectionWireframe(sectionType: string): WireframeBlock[] {
  return SECTION_WIREFRAME[sectionType as ContentSectionType] ?? DEFAULT_WIREFRAME;
}

/** Clamps a drop's target "gap" — 0 (before the first section) through
 * `sectionCount` (after the last) inclusive, one more position than
 * there are sections — into range. Guards the canvas's pointer-position
 * math against an out-of-range value before it reaches `reorderSections`. */
export function clampGapIndex(gapIndex: number, sectionCount: number): number {
  return Math.max(0, Math.min(gapIndex, sectionCount));
}

/** Converts a drop target expressed as a "gap" in the CURRENT,
 * pre-removal section order (see `clampGapIndex`) into the target index
 * `reorderSections` expects — i.e. where the moved section should land
 * once it's already been spliced out of `fromIndex`. Dropping into the
 * gap immediately before or after a section's own position is a no-op
 * either way, since removing it shifts every later gap down by one. */
export function gapToMoveIndex(gapIndex: number, fromIndex: number): number {
  return gapIndex > fromIndex ? gapIndex - 1 : gapIndex;
}

export type BlueprintSummary = {
  template: BlueprintTemplate | null;
  templateLabel: string | null;
  pageCount: number;
  sectionCount: number;
  pagesWithoutSections: number;
  /** The requirements board's own flat count — `planning.blueprint_requirements`
   * is a completely separate set from the pages/sections above (see the
   * module comment for the requirements board), never folded into
   * `sectionCount`. */
  requirementCount: number;
  /** Human labels, one per requirement, sorted alphabetically rather than
   * by `order_index` — that field is assignment order only, never a
   * meaningful sequence, and this summary shouldn't imply otherwise. */
  requirementLabels: string[];
};

/** Handoff step's own honest summary — every number here is read
 * straight off `planning`, never a new "readiness" judgement. */
export function computeBlueprintSummary(planning: Planning): BlueprintSummary {
  const pageCount = planning.sitemap_pages.length;
  const sectionCount = planning.content_pages.reduce((sum, p) => sum + p.sections.length, 0);
  const pagesWithSections = new Set(
    planning.content_pages.filter((p) => p.sections.length > 0).map((p) => p.sitemap_page_id),
  );
  const pagesWithoutSections = planning.sitemap_pages.filter((p) => !pagesWithSections.has(p.id)).length;
  const requirementLabels = planning.blueprint_requirements
    .map((r) => featureLabel(r.feature_key))
    .sort((a, b) => a.localeCompare(b));
  return {
    template: planning.blueprint_template,
    templateLabel: planning.blueprint_template ? BLUEPRINT_TEMPLATE_LABEL[planning.blueprint_template] : null,
    pageCount,
    sectionCount,
    pagesWithoutSections,
    requirementCount: planning.blueprint_requirements.length,
    requirementLabels,
  };
}
