import {
  type BlueprintTemplate,
  type ContentPage,
  type ContentSection,
  type ContentSectionType,
  type Planning,
  type PlanningKeyPoint,
  type Recommendation,
  type Requirement,
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

export type FeatureCategory = "content" | "enquiries" | "style" | "experience";
/** What a choice actually IS, so it's never mistaken for something else:
 * - section: a block of content the site should contain;
 * - capability: functionality that needs building/connecting later —
 *   never an already-working integration;
 * - design: a visual preference (not a section, not ordered);
 * - behaviour: something that applies across every page. */
export type FeatureKind = "section" | "capability" | "design" | "behaviour";

export const FEATURE_CATEGORY_ORDER: FeatureCategory[] = ["content", "enquiries", "style", "experience"];
export const FEATURE_CATEGORY_LABEL: Record<FeatureCategory, string> = {
  content: "Content & trust",
  enquiries: "Enquiries & transactions",
  style: "Visual style",
  experience: "Visual experiences",
};
export const FEATURE_KIND_LABEL: Record<FeatureKind, string> = {
  section: "Content section",
  capability: "Functionality",
  design: "Design preference",
  behaviour: "Site-wide behaviour",
};

export type FeatureDefinition = {
  key: string;
  label: string;
  /** One short, neutral line for the card — never a specific business's
   * content, same convention as SECTION_TYPE_DESCRIPTION above. */
  description: string;
  category: FeatureCategory;
  kind: FeatureKind;
  /** The longer explanation, for the card's detail popover only. */
  detail: string;
  /** Mutually exclusive choices share a group (e.g. light vs dark). */
  conflictGroup?: string;
  /** Motion/video guidance, shown in the detail popover and once the
   * choice is on the plan — never as a warning on every card. */
  motionNote?: string;
  /** What real content this needs before it can be built — it's never
   * fabricated (no invented reviews, credentials, numbers or projects). */
  needsRealContent?: string;
};

const CAPABILITY_NOTE = "A requested capability — it still needs choosing, setting up and building; nothing is connected yet.";
const MOTION_NOTE =
  "Keep it subtle, respect visitors' reduced-motion setting, and check it doesn't slow the page on mobile.";

/** The library's full catalogue. The first eight keys are the original
 * vocabulary and never change (saved plans and templates use them);
 * everything else is additive. `feature_key` still accepts any string —
 * `featureLabel` covers keys outside this list. */
export const FEATURE_LIBRARY: FeatureDefinition[] = [
  // --- Content & trust ---
  { key: "services", label: "Services", description: "A list or grid of the services or packages you offer.", category: "content", kind: "section", detail: "What the business offers, usually as short cards linking to more detail." },
  { key: "about", label: "About", description: "Your story, your team, or what makes the business different.", category: "content", kind: "section", detail: "Who's behind the business and why customers should choose them." },
  { key: "gallery", label: "Gallery", description: "A grid of photos showing recent work.", category: "content", kind: "section", detail: "A collection of real photos of the business's work.", needsRealContent: "Real photos the business has permission to use." },
  { key: "pricing", label: "Pricing", description: "Prices or package costs, shown up front.", category: "content", kind: "section", detail: "Prices, packages or 'from' pricing. Only real prices supplied by the business are used.", needsRealContent: "Prices confirmed by the business." },
  { key: "faq", label: "FAQ", description: "Answers to the questions customers ask most.", category: "content", kind: "section", detail: "Short answers to common questions — often drawn from real enquiries and reviews." },
  { key: "testimonials", label: "Testimonials", description: "Reviews and quotes from happy customers.", category: "content", kind: "section", detail: "Quotes or reviews from real customers, shown with their permission.", needsRealContent: "Real reviews or quotes the business can use." },
  { key: "team", label: "Team profiles", description: "Photos and short bios of the people customers will meet.", category: "content", kind: "section", detail: "Individual profiles for staff or practitioners — names, roles and a short bio.", needsRealContent: "Real names, roles, bios and photos." },
  { key: "how_it_works", label: "How it works", description: "The steps a customer goes through, from first contact to done.", category: "content", kind: "section", detail: "A simple numbered process that sets expectations and reduces questions." },
  { key: "service_areas", label: "Service areas", description: "The suburbs or regions the business covers.", category: "content", kind: "section", detail: "A list or map of where the business works — useful for local search too." },
  { key: "opening_hours", label: "Opening hours", description: "When the business is open or available.", category: "content", kind: "section", detail: "Regular hours, plus holiday or seasonal changes if the business provides them." },
  { key: "case_studies", label: "Case studies", description: "Detailed stories of real projects and their results.", category: "content", kind: "section", detail: "A few worked examples: the problem, what was done and the outcome.", needsRealContent: "Real projects the business can describe, with any results they can back up." },
  { key: "before_after", label: "Before & after", description: "Side-by-side comparisons of real work.", category: "content", kind: "section", detail: "Paired before-and-after photos. Can be shown as pairs or an interactive comparison slider.", needsRealContent: "Real before-and-after photos the business has permission to use." },
  { key: "accreditations", label: "Accreditations", description: "Licences, memberships, awards and certifications.", category: "content", kind: "section", detail: "Badges or a list of genuine credentials that build trust.", needsRealContent: "Credentials the business actually holds, ideally with reference numbers." },
  { key: "brochure", label: "Downloadable brochure", description: "A brochure, menu or price list visitors can download.", category: "content", kind: "section", detail: "A downloadable PDF such as a brochure, menu or price list.", needsRealContent: "The actual document to offer." },
  { key: "blog", label: "Blog / news", description: "Articles, updates or announcements.", category: "content", kind: "section", detail: "A place for regular posts. Worth it only if someone will keep it updated." },
  { key: "careers", label: "Careers", description: "Open roles and how to apply.", category: "content", kind: "section", detail: "Job listings and an application route." },

  // --- Enquiries & transactions ---
  { key: "contact", label: "Contact", description: "A way to reach you — form, phone, address, or map.", category: "enquiries", kind: "section", detail: "Phone, email, address, map and/or a contact form." },
  { key: "booking", label: "Booking", description: "Let visitors book an appointment online.", category: "enquiries", kind: "capability", detail: `Online appointment booking. ${CAPABILITY_NOTE}` },
  { key: "quote_request", label: "Quote request", description: "A form for visitors to ask for a quote.", category: "enquiries", kind: "capability", detail: `A structured enquiry form for quotes. ${CAPABILITY_NOTE}` },
  { key: "reservations", label: "Reservation request", description: "Let visitors request a table or time slot.", category: "enquiries", kind: "capability", detail: `A reservation request for hospitality or events. ${CAPABILITY_NOTE}` },
  { key: "newsletter", label: "Newsletter signup", description: "Collect email addresses for updates.", category: "enquiries", kind: "capability", detail: `An email signup form. ${CAPABILITY_NOTE}` },
  { key: "file_upload", label: "File-upload enquiry", description: "Let visitors attach photos or plans to an enquiry.", category: "enquiries", kind: "capability", detail: `An enquiry form that accepts attachments. ${CAPABILITY_NOTE}` },
  { key: "product_catalogue", label: "Product catalogue", description: "Browse products without buying online.", category: "enquiries", kind: "section", detail: "Product listings with photos and details, enquiry-based rather than a checkout.", needsRealContent: "Real product details and photos." },
  { key: "online_store", label: "Online store", description: "Sell products with a cart and checkout.", category: "enquiries", kind: "capability", detail: `A shop with cart and checkout. ${CAPABILITY_NOTE}` },
  { key: "payments", label: "Payments / deposits", description: "Take payments or deposits online.", category: "enquiries", kind: "capability", detail: `Online payments or deposits. ${CAPABILITY_NOTE}` },
  { key: "customer_login", label: "Customer login", description: "A private area for returning customers.", category: "enquiries", kind: "capability", detail: `Accounts and a signed-in area. ${CAPABILITY_NOTE}` },
  { key: "live_chat", label: "Live chat", description: "Chat with visitors while they browse.", category: "enquiries", kind: "capability", detail: `A chat widget, staffed or automated. ${CAPABILITY_NOTE}` },

  // --- Visual style (design preferences, never sections) ---
  { key: "style_light", label: "Light appearance", description: "Light backgrounds with dark text.", category: "style", kind: "design", detail: "An overall light look.", conflictGroup: "appearance" },
  { key: "style_dark", label: "Dark appearance", description: "Dark backgrounds with light text.", category: "style", kind: "design", detail: "An overall dark look.", conflictGroup: "appearance" },
  { key: "style_bold_type", label: "Bold typography", description: "Large, confident headings.", category: "style", kind: "design", detail: "Type-led design with big, heavy headlines." },
  { key: "style_editorial", label: "Minimal editorial", description: "Lots of space and restrained, magazine-like pages.", category: "style", kind: "design", detail: "Generous whitespace, few colours and careful typography." },
  { key: "style_full_width_images", label: "Full-width imagery", description: "Photos that run edge to edge.", category: "style", kind: "design", detail: "Large images spanning the full browser width.", needsRealContent: "High-quality photos large enough to use full width." },
  { key: "style_rounded_cards", label: "Rounded cards", description: "Soft, rounded containers for content.", category: "style", kind: "design", detail: "Content grouped in cards with rounded corners." },
  { key: "style_gradients", label: "Subtle gradients", description: "Gentle colour blends in backgrounds.", category: "style", kind: "design", detail: "Soft gradients used sparingly for depth." },
  { key: "style_texture", label: "Textured backgrounds", description: "Paper, grain or pattern textures.", category: "style", kind: "design", detail: "Subtle textures that add warmth or character." },
  { key: "style_alternating", label: "Alternating image & text", description: "Image and text rows that swap sides.", category: "style", kind: "design", detail: "Rows that alternate image-left and image-right for rhythm." },
  { key: "style_fullscreen_hero", label: "Full-screen hero", description: "A first screen that fills the whole window.", category: "style", kind: "design", detail: "A large opening panel with a headline over an image." },

  // --- Visual experiences ---
  { key: "video_hero", label: "Video hero", description: "A short background video on the first screen.", category: "experience", kind: "design", detail: "A muted looping video behind the headline.", motionNote: `Video adds load time and data use. ${MOTION_NOTE} Provide a still image fallback.`, needsRealContent: "Real video footage of the business." },
  { key: "image_carousel", label: "Image carousel", description: "Photos that slide one after another.", category: "experience", kind: "design", detail: "A slideshow of images with manual controls.", motionNote: "Avoid auto-advancing slides; keep manual controls and respect reduced motion." },
  { key: "filterable_gallery", label: "Filterable gallery", description: "A gallery visitors can filter by type.", category: "experience", kind: "capability", detail: `A gallery with category filters. ${CAPABILITY_NOTE}`, needsRealContent: "Enough real photos to be worth filtering." },
  { key: "animated_stats", label: "Animated statistics", description: "Key numbers that count up as they appear.", category: "experience", kind: "design", detail: "Figures such as years in business or jobs completed.", motionNote: MOTION_NOTE, needsRealContent: "Real, verifiable numbers — never estimates presented as facts." },
  { key: "scroll_reveals", label: "Subtle scroll reveals", description: "Content fades in gently as you scroll.", category: "experience", kind: "behaviour", detail: "Small fade/slide-in effects as sections come into view.", motionNote: MOTION_NOTE },
  { key: "hover_effects", label: "Subtle hover effects", description: "Gentle feedback when pointing at links and cards.", category: "experience", kind: "behaviour", detail: "Small lift, colour or underline changes on hover." },
  { key: "page_transitions", label: "Page transitions", description: "Smooth fades between pages.", category: "experience", kind: "behaviour", detail: "Animated transitions when moving between pages.", motionNote: MOTION_NOTE },
  { key: "sticky_nav", label: "Sticky navigation", description: "The menu stays visible while scrolling.", category: "experience", kind: "behaviour", detail: "A header that stays pinned to the top of the screen." },
  { key: "sticky_cta", label: "Sticky enquiry button", description: "A call or enquiry button that's always in reach.", category: "experience", kind: "behaviour", detail: "A persistent button (often on mobile) for calling or enquiring." },
];

export const FEATURE_BY_KEY: Record<string, FeatureDefinition> = Object.fromEntries(FEATURE_LIBRARY.map((f) => [f.key, f]));

/** Kind for any key — unknown/legacy custom keys count as content. */
export function featureKind(featureKey: string): FeatureKind {
  return FEATURE_BY_KEY[featureKey]?.kind ?? "section";
}

/** Case-insensitive search over label and card description, within an
 * optional category — the "All features" view's compact filter. */
export function filterFeatureLibrary(
  features: FeatureDefinition[],
  query: string,
  category: FeatureCategory | "all",
): FeatureDefinition[] {
  const q = query.trim().toLowerCase();
  return features.filter(
    (f) =>
      (category === "all" || f.category === category) &&
      (!q || f.label.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)),
  );
}

/** Selected features that directly conflict with `featureKey` (same
 * conflict group) — the caller asks the user to replace or cancel;
 * nothing is ever swapped silently. */
export function conflictingSelections(featureKey: string, selectedKeys: Iterable<string>): string[] {
  const group = FEATURE_BY_KEY[featureKey]?.conflictGroup;
  if (!group) return [];
  return [...selectedKeys].filter((k) => k !== featureKey && FEATURE_BY_KEY[k]?.conflictGroup === group);
}

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
   * added — the primary (earliest order_index) supporting recommendation,
   * when one exists. Null for a suggestion that comes only from an audit
   * finding (see below): a `PlanningKeyPoint` has no corresponding
   * `lead_planning_recommendations` row to reference, and the column is a
   * real FK (`ON DELETE SET NULL`) — inventing an id here would fail the
   * insert, so an add from a finding-only card simply carries no
   * `source_recommendation_id` at all. */
  sourceRecommendationId: string | null;
  /** EVERY non-dismissed recommendation that supports this feature (the
   * dedupe keeps one card, never drops a source reference) — adding the
   * card accepts all of them, removing it returns them to proposed. */
  recommendationIds: string[];
  /** At least one supporting recommendation is already accepted (an
   * earlier decision, or an operator-authored one, which starts accepted)
   * — while the feature isn't on the canvas, that's a choice made
   * elsewhere that the plan doesn't reflect yet, shown rather than hidden. */
  hasAcceptedRecommendation: boolean;
  /** Evidence-backed "why suggested" text — quotes/paraphrases whichever
   * real source(s) produced this suggestion (one or more recommendations'
   * own titles, one or more audit findings' own messages, or both, when
   * the same feature key is independently supported by each). Never
   * fabricated, never invented for a feature key nothing in the plan's
   * own data actually supports. */
  reason: string;
};

// --- Plan step: which recommendations are decided where ------------------
//
// The Plan step merges the old "Choose improvements" and "Prepare the
// website" screens, so each recommendation now has exactly ONE place its
// decision is made:
// - a website-feature recommendation (an "add" or "improve" whose own
//   wording maps to a feature key) is decided by adding/removing that
//   feature in the library — adding accepts it, removing returns it to
//   proposed (see RequirementsBoard + the backend's
//   `accept_recommendation_ids`/`deselect_recommendation_ids`);
// - everything else ("keep" strengths, and cross-page concerns like speed
//   or accessibility, which `mapRecommendationToFeatureKey` never maps) is
//   decided with the existing Accept/Dismiss controls in the compact
//   "Site-wide improvements" area.
// Dismissed recommendations stay out of the library either way — that was
// an explicit "no", never silently revived.

const FEATURE_RECOMMENDATION_CATEGORIES = new Set<Recommendation["category"]>(["add", "improve"]);

/** The feature key a recommendation is decided through in the library, or
 * `null` when it belongs in "Site-wide improvements" instead. */
export function recommendationFeatureKey(
  recommendation: Pick<Recommendation, "category" | "title" | "explanation">,
): string | null {
  if (!FEATURE_RECOMMENDATION_CATEGORIES.has(recommendation.category)) return null;
  return mapRecommendationToFeatureKey(recommendation);
}

/** Non-dismissed feature recommendations, grouped by feature key, each
 * group in order_index order — the dedupe the library card is built on. */
export function featureRecommendationsByKey(planning: Planning): Map<string, Recommendation[]> {
  const byKey = new Map<string, Recommendation[]>();
  const sorted = [...planning.recommendations].sort((a, b) => a.order_index - b.order_index);
  for (const recommendation of sorted) {
    if (recommendation.status === "dismissed") continue;
    const key = recommendationFeatureKey(recommendation);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) existing.push(recommendation);
    else byKey.set(key, [recommendation]);
  }
  return byKey;
}

/** Ids to accept when `featureKey` is added — however it's added (a
 * Recommended card, the "All features" list, or a template), since the
 * decision is the same one. Empty when no recommendation supports it. */
export function recommendationIdsForFeature(planning: Planning, featureKey: string): string[] {
  return (featureRecommendationsByKey(planning).get(featureKey) ?? []).map((r) => r.id);
}

/** Ids to return to proposed when `featureKey` is removed — only the
 * accepted ones (the backend applies the same rule; this just keeps the
 * request honest about what it's asking for). */
export function acceptedRecommendationIdsForFeature(planning: Planning, featureKey: string): string[] {
  return (featureRecommendationsByKey(planning).get(featureKey) ?? [])
    .filter((r) => r.status === "accepted")
    .map((r) => r.id);
}

/** Recommendations decided in "Site-wide improvements" (any status —
 * RecommendationsSection applies its own dismissed filter). */
export function isSiteWideRecommendation(recommendation: Recommendation): boolean {
  return recommendationFeatureKey(recommendation) === null;
}

/** Accepted feature recommendations whose feature is NOT on the canvas —
 * the one reconciliation gap existing plans can carry into the merged
 * step (accepted on the old "Choose improvements" screen, never added on
 * "Prepare"). Surfaced, never auto-added and never dropped. */
export function unplacedAcceptedFeatureRecommendations(planning: Planning): Recommendation[] {
  const placed = new Set(planning.blueprint_requirements.map((r) => r.feature_key));
  const result: Recommendation[] = [];
  for (const [key, recommendations] of featureRecommendationsByKey(planning)) {
    if (placed.has(key)) continue;
    result.push(...recommendations.filter((r) => r.status === "accepted"));
  }
  return result;
}

/** Same wording shape as `reasonFor`, minus "accepted" — a library card's
 * recommendations can still be awaiting the decision the card itself is. */
function featureReasonFor(recommendations: Recommendation[]): string {
  if (recommendations.length === 1) return `Recommended: "${recommendations[0].title}".`;
  return `Supported by ${recommendations.length} recommendations: ${recommendations
    .map((r) => `"${r.title}"`)
    .join(", ")}.`;
}

/** Review & build's selection summary — read straight off `planning`. */
export type PlanSelectionSummary = {
  /** Content sections (plus unknown/legacy keys). */
  featureLabels: string[];
  /** Requested functionality — still needs building/connecting. */
  capabilityLabels: string[];
  /** Visual preferences and site-wide behaviours — not sections. */
  designLabels: string[];
  siteWideAccepted: Recommendation[];
  siteWideProposed: number;
  unplacedAccepted: Recommendation[];
};

export function computePlanSelectionSummary(planning: Planning): PlanSelectionSummary {
  const siteWide = planning.recommendations
    .filter(isSiteWideRecommendation)
    .sort((a, b) => a.order_index - b.order_index);
  const labelsOf = (kinds: FeatureKind[]) =>
    planning.blueprint_requirements
      .filter((r) => kinds.includes(featureKind(r.feature_key)))
      .map((r) => featureLabel(r.feature_key))
      .sort((a, b) => a.localeCompare(b));
  return {
    featureLabels: labelsOf(["section"]),
    capabilityLabels: labelsOf(["capability"]),
    designLabels: labelsOf(["design", "behaviour"]),
    siteWideAccepted: siteWide.filter((r) => r.status === "accepted"),
    siteWideProposed: siteWide.filter((r) => r.status === "proposed").length,
    unplacedAccepted: unplacedAcceptedFeatureRecommendations(planning),
  };
}

/** The Plan step library's "Recommended" view — one card per feature
 * key, deduped, built from TWO independent, real evidence sources that
 * both feed the same list (never two separate tabs/sections for them):
 * the plan's own non-dismissed feature recommendations
 * (`featureRecommendationsByKey`), and the website audit's own
 * `key_points` findings (see `mapKeyPointToFeatureKey` below). A feature
 * key supported by both collapses into one card whose reason cites both;
 * a plan with no such recommendations and no usable findings (a
 * failed/incomplete audit, or one whose findings are all cross-page
 * technical concerns) simply returns an empty list — this function never
 * manufactures a suggestion to "fill the panel". */
export function deriveRecommendedRequirements(planning: Planning): RecommendedFeatureCard[] {
  const byKey = new Map<
    string,
    { sourceRecommendationId: string | null; recommendationIds: string[]; accepted: boolean; reasons: string[] }
  >();

  for (const [key, recommendations] of featureRecommendationsByKey(planning)) {
    byKey.set(key, {
      sourceRecommendationId: recommendations[0].id,
      recommendationIds: recommendations.map((r) => r.id),
      accepted: recommendations.some((r) => r.status === "accepted"),
      reasons: [featureReasonFor(recommendations)],
    });
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
    else
      byKey.set(key, {
        sourceRecommendationId: null,
        recommendationIds: [],
        accepted: false,
        reasons: [reasonForKeyPoints(points)],
      });
  }

  return Array.from(byKey.entries()).map(([featureKey, entry]) => ({
    featureKey,
    sourceRecommendationId: entry.sourceRecommendationId,
    recommendationIds: entry.recommendationIds,
    hasAcceptedRecommendation: entry.accepted,
    reason: entry.reasons.join(" "),
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

/** Plain-language copy for the template selector — describes ONLY what
 * `REQUIREMENT_TEMPLATES` actually contains (a flat feature set; these
 * templates define no pages or layout, so none is described). Kept next
 * to the definitions so a change to a bundle is a visible prompt to
 * update its words; websiteBlueprintLib.test.ts checks the two agree. */
export const REQUIREMENT_TEMPLATE_SUMMARY: Record<RequirementTemplateKey, string> = {
  blank: "Starts with no preset features. Choose each one yourself from the library.",
  simple: "The two essentials: Services, to show what the business offers, and Contact.",
  standard: "Services and Contact, plus an About section and a Gallery of recent work.",
  expanded: "Everything in Standard, plus Pricing, FAQ, Testimonials and Booking.",
};

export const REQUIREMENT_TEMPLATE_BEST_FOR: Record<RequirementTemplateKey, string> = {
  blank: "Plans where you'd rather pick every feature yourself.",
  simple: "Businesses that mainly need to be found and contacted.",
  standard: "Most small businesses with work worth showing.",
  expanded: "Businesses that take appointments or field lots of questions before buying.",
};

/** Extra wording for features whose library description could read as a
 * working integration — in a template they're a planned requirement only. */
export const TEMPLATE_FEATURE_QUALIFIER: Record<string, string> = {
  booking: "Planned requirement — no booking system is connected.",
};

export type RequirementTemplateEffect = {
  /** Template features not selected yet — what applying adds. */
  toAdd: string[];
  /** Template features already selected — kept as they are, notes included. */
  alreadySelected: string[];
  /** Selected features the template doesn't include — applying removes
   * them (after the existing confirmation), including any custom picks. */
  toRemove: string[];
  /** The subset of `toRemove` carrying notes that would be discarded. */
  toRemoveWithNotes: string[];
};

/** Exactly what `RequirementsBoard.handleApplyTemplate` would do to the
 * current selection — the same `diffRequirementTemplate` it runs, so the
 * preview can never promise something different from the apply. */
export function describeRequirementTemplateEffect(
  requirements: Pick<Requirement, "feature_key" | "notes">[],
  templateKey: RequirementTemplateKey,
): RequirementTemplateEffect {
  const currentKeys = requirements.map((r) => r.feature_key);
  const { toAdd, toRemove } = diffRequirementTemplate(currentKeys, templateKey);
  const current = new Set(currentKeys);
  return {
    toAdd,
    alreadySelected: REQUIREMENT_TEMPLATES[templateKey].filter((key) => current.has(key)),
    toRemove,
    toRemoveWithNotes: requirements
      .filter((r) => toRemove.includes(r.feature_key) && r.notes && r.notes.trim())
      .map((r) => r.feature_key),
  };
}

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
/** Templates choose content and functionality only. Design preferences
 * and site-wide behaviours sit outside them: applying, matching or
 * "customising" a template never counts, adds or removes those. */
function templateScopedKeys(keys: string[]): string[] {
  return keys.filter((k) => {
    const kind = featureKind(k);
    return kind === "section" || kind === "capability";
  });
}

export function inferAppliedRequirementTemplate(currentKeys: string[]): RequirementTemplateKey | null {
  const current = new Set(templateScopedKeys(currentKeys));
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
  return !sameFeatureSet(new Set(templateScopedKeys(currentKeys)), new Set(REQUIREMENT_TEMPLATES[appliedTemplate]));
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
    toRemove: templateScopedKeys(currentKeys).filter((key) => !target.has(key)),
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

// --- Choose your website: what's already known about each chosen feature ---
//
// Replaces the old per-feature "Details needed" prompts: instead of asking
// the operator to type routine facts, each selected feature shows what the
// plan ALREADY holds — read-only, with its source — from records gathered
// automatically (the lead record, the Assets Checklist that Analyse
// business seeds, Instagram/Facebook details, Google reviews, review-based
// FAQ ideas). Nothing is inferred beyond what those records say, nothing
// is written into the operator's own notes, and an unknown simply stays
// unknown. Exactly one thing is treated as essential and un-inferable:
// how customers get in touch, when neither a phone nor an email is on file
// — that gets a single specific question (`essentialQuestion`), answered
// on the lead record where contact details already live.

export type EvidenceItem = { text: string; source: string };

export type RequirementEvidence = {
  featureKey: string;
  known: EvidenceItem[];
  essentialQuestion: string | null;
  /** Real content this feature needs before it can be built (never
   * fabricated) — from the catalogue; null when none is required. */
  contentNeeded: string | null;
  /** Motion/performance guidance for heavy visual options. */
  motionNote: string | null;
};

type LeadContactFields = {
  business_phone: string | null;
  business_email: string | null;
  suburb?: string | null;
  state?: string | null;
};

const ASSET_STATUS_WORD: Record<string, string> = {
  ready_to_use: "ready to use",
  reference_only: "reference only — needs the owner's approval",
  missing: "not supplied yet",
  not_needed: "not needed",
};

function assetEvidence(planning: Planning, categories: string[]): EvidenceItem[] {
  return planning.assets
    .filter((a) => categories.includes(a.category))
    .map((a) => ({
      text: `${a.label}: ${ASSET_STATUS_WORD[a.status] ?? a.status}${a.note ? ` (${a.note})` : ""}`,
      source: "Assets checklist",
    }));
}

function contactEvidence(lead: LeadContactFields | null): EvidenceItem[] {
  if (!lead) return [];
  const items: EvidenceItem[] = [];
  if (lead.business_phone) items.push({ text: `Phone: ${lead.business_phone}`, source: "Lead record" });
  if (lead.business_email) items.push({ text: `Email: ${lead.business_email}`, source: "Lead record" });
  const place = [lead.suburb, lead.state].filter(Boolean).join(", ");
  if (place) items.push({ text: `Location: ${place}`, source: "Lead record" });
  return items;
}

export function computeRequirementEvidence(planning: Planning, lead: LeadContactFields | null): RequirementEvidence[] {
  const social = planning.social_profile;
  const reviews = planning.review_intelligence;
  return [...planning.blueprint_requirements]
    .sort((a, b) => a.order_index - b.order_index)
    .map((requirement) => {
      const key = requirement.feature_key;
      const known: EvidenceItem[] = [];
      let essentialQuestion: string | null = null;
      switch (key) {
        case "contact":
          known.push(...contactEvidence(lead));
          known.push(...assetEvidence(planning, ["contact_details"]));
          // Unknown while the lead is still loading — never ask on a guess.
          if (lead && !lead.business_phone && !lead.business_email) {
            essentialQuestion = "How should customers get in touch? No phone or email is on file — add one to the lead record.";
          }
          break;
        case "booking":
          known.push(...assetEvidence(planning, ["booking_destination"]));
          if (lead?.business_phone) known.push({ text: `Enquiries can go to ${lead.business_phone}`, source: "Lead record" });
          else if (lead?.business_email) known.push({ text: `Enquiries can go to ${lead.business_email}`, source: "Lead record" });
          break;
        case "services":
          known.push(...assetEvidence(planning, ["service_descriptions"]));
          break;
        case "gallery":
          known.push(...assetEvidence(planning, ["photos", "portfolio_images"]));
          if (social?.instagram_profile_url) {
            known.push({ text: `Instagram: ${social.instagram_handle ? `@${social.instagram_handle}` : social.instagram_profile_url}`, source: "Social profile" });
          }
          break;
        case "testimonials":
          if (reviews && reviews.google_rating !== null && reviews.google_review_count) {
            known.push({
              text: `${reviews.google_rating}★ from ${reviews.google_review_count} Google reviews${reviews.reviews_with_text ? `, ${reviews.reviews_with_text} with written text` : ""}`,
              source: "Google reviews",
            });
          }
          break;
        case "faq":
          for (const faq of planning.review_faq_opportunities.slice(0, 3)) {
            known.push({ text: faq.question, source: "Review Insights" });
          }
          break;
        case "about":
          if (planning.website_summary) {
            // Shortened for display only — the full summary stays in Analyse business.
            const summary = planning.website_summary.trim();
            known.push({
              text: summary.length > 220 ? `${summary.slice(0, 217).trimEnd()}…` : summary,
              source: planning.website_audit_id ? "Website audit" : "Website plan",
            });
          }
          break;
        // pricing and anything else: nothing on file is ever turned into a
        // price or claim — it stays unset until the operator adds it.
      }
      return {
        featureKey: key,
        known,
        essentialQuestion,
        contentNeeded: FEATURE_BY_KEY[key]?.needsRealContent ?? null,
        motionNote: FEATURE_BY_KEY[key]?.motionNote ?? null,
      };
    });
}
