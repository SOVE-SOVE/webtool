import type {
  ComparableResearchStatus,
  Lead,
  Planning,
  PlanningKeyPoint,
  PlanningListItem,
  PlanningSocialProfile,
  PlanningStatus,
  ReviewIntelligenceResult,
} from "@/lib/api";
import type { BadgeTone } from "@/components/ui/Badge";

// Which of Planning's two modes a workspace is in — derived, never
// stored (mirrors the backend: see LeadPlanning's docstring). A Lead
// with no website audit yet is in New Website Plan mode, whether
// that's because it has no website at all or one just hasn't been
// analysed — the "Analyse Website" empty state still wins whenever a
// website_url is on record (see AnalyseWebsiteAction/OverviewTab).
export type PlanningMode = "existing" | "new";

export function planningMode(planning: Planning): PlanningMode {
  return planning.website_audit_id !== null ? "existing" : "new";
}

// Shared between the Planning list page and the standalone Planning
// workspace (detail page + tabs) so status colours and the
// finding-grouping rules stay in exactly one place.

export const AREA_LABELS: Record<string, string> = {
  technical: "Technical",
  seo: "SEO",
  accessibility: "Accessibility",
  usability: "Usability",
  visual: "Visual",
};

export const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SEVERITY_TONE: Record<string, BadgeTone> = {
  critical: "danger",
  high: "warning",
  medium: "muted",
  low: "muted",
};

export const STATUS_BADGE_TONE: Record<PlanningStatus, BadgeTone> = {
  ready_to_analyse: "muted",
  analysing: "warning",
  completed: "success",
  needs_review: "warning",
  failed: "danger",
};

export const PLANNING_MODE_LABEL: Record<PlanningMode, string> = {
  existing: "Website redesign",
  new: "New website",
};

export type PlanningListItemMode = Pick<PlanningListItem, "website_audit_id">;

/** Same website_audit_id !== null check as planningMode(), just for the
 * lighter list-item shape (which doesn't carry the rest of Planning's
 * fields) — the Planning grid's mode filter/badge reads this instead of
 * duplicating the derivation. */
export function planningListItemMode(item: PlanningListItemMode): PlanningMode {
  return item.website_audit_id !== null ? "existing" : "new";
}

export type PlanningCardActionKind = "analyse" | "generate" | "progress" | "open";

/**
 * The Planning grid's one primary action per card — reuses exactly the
 * same state → action mapping the detail page's own OverviewTab already
 * applies (website_audit_id for mode, website_plan_generated_at for
 * "has a plan been generated", status for "is a run in progress"), so
 * the label a card shows always matches what the destination page will
 * actually present. Every kind links to the same Planning workspace —
 * this only decides the label, never triggers a job itself.
 */
export function planningCardAction(
  item: Pick<PlanningListItem, "status" | "website_audit_id" | "website_url" | "website_plan_generated_at">,
): { kind: PlanningCardActionKind; label: string } {
  if (item.status === "analysing") {
    return { kind: "progress", label: "View Progress" };
  }
  if (item.website_audit_id === null && item.website_plan_generated_at === null) {
    return item.website_url
      ? { kind: "analyse", label: "Analyse Website" }
      : { kind: "generate", label: "Generate Website Plan" };
  }
  return { kind: "open", label: "Open Planning" };
}

export const REVIEW_TREND_LABEL: Record<string, string> = {
  increasing: "Increasing",
  improving: "Improving",
  stable: "Stable",
  declining: "Declining",
  insufficient_data: "Insufficient data",
};

export function groupByArea(points: PlanningKeyPoint[]): [string, PlanningKeyPoint[]][] {
  const groups = new Map<string, PlanningKeyPoint[]>();
  for (const point of points) {
    const list = groups.get(point.area) ?? [];
    list.push(point);
    groups.set(point.area, list);
  }
  return Array.from(groups.entries());
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 4;
}

// --- Compact audit status (Overview tab) -----------------------------------
// A restrained "how's this site doing" row per dimension, derived purely
// from the already-recorded key_points/review_intelligence — no new
// scoring logic, just a presentation-layer grouping of the existing
// evidence-backed findings.

export type RowState = "good" | "review" | "improve" | "not_checked";

export const ROW_STATE_LABEL: Record<RowState, string> = {
  good: "Good",
  review: "Review",
  improve: "Improve",
  not_checked: "Not checked",
};

export const ROW_STATE_DOT: Record<RowState, string> = {
  good: "bg-emerald-500",
  review: "bg-amber-500",
  improve: "bg-red-500",
  not_checked: "bg-fg-subtle",
};

export type AuditRowKey = "performance" | "mobile" | "seo" | "contact_path" | "visual" | "usability" | "google_reviews";

export const AUDIT_ROW_LABELS: Record<AuditRowKey, string> = {
  performance: "Performance",
  mobile: "Mobile",
  seo: "SEO",
  contact_path: "Contact path",
  visual: "Visual appearance",
  usability: "Usability",
  google_reviews: "Google reviews",
};

export type AuditRow = {
  key: AuditRowKey;
  label: string;
  state: RowState;
  points: PlanningKeyPoint[];
};

function stateFromPoints(points: PlanningKeyPoint[]): RowState {
  if (points.some((p) => p.severity === "critical" || p.severity === "high")) return "improve";
  if (points.length > 0) return "review";
  return "good";
}

/** Shared between the audit-status "Google reviews" row and New Website
 * Plan mode's business-inputs "Google reviews" row — same evidence,
 * same read. */
function googleReviewsRowState(review: ReviewIntelligenceResult | null): RowState {
  if (!review) return "not_checked";
  if (review.data_status !== "ok") return "review";
  if (review.review_health_score !== null) {
    if (review.review_health_score >= 70) return "good";
    if (review.review_health_score >= 40) return "review";
    return "improve";
  }
  if (review.google_rating !== null) {
    if (review.google_rating >= 4.3) return "good";
    if (review.google_rating >= 3.5) return "review";
    return "improve";
  }
  return "review";
}

export function computeAuditRows(planning: Planning): AuditRow[] {
  const hasAudit = planning.website_audit_id !== null;
  const points = planning.key_points;
  const hasScreenshots = Boolean(planning.screenshot_desktop_base64 || planning.screenshot_mobile_base64);

  const performancePts = points.filter((p) => p.area === "technical");
  const mobilePts = points.filter((p) => p.area === "usability" && p.category === "mobile");
  const seoPts = points.filter((p) => p.area === "seo");
  const contactPts = points.filter((p) => p.area === "usability" && p.category === "conversion_path");
  const visualPts = points.filter((p) => p.area === "visual");
  const usabilityPts = points.filter(
    (p) => (p.area === "usability" && p.category !== "mobile" && p.category !== "conversion_path") || p.area === "accessibility",
  );

  const googleState = googleReviewsRowState(planning.review_intelligence);

  return [
    {
      key: "performance",
      label: AUDIT_ROW_LABELS.performance,
      state: hasAudit ? stateFromPoints(performancePts) : "not_checked",
      points: performancePts,
    },
    {
      key: "mobile",
      label: AUDIT_ROW_LABELS.mobile,
      state: hasAudit ? stateFromPoints(mobilePts) : "not_checked",
      points: mobilePts,
    },
    {
      key: "seo",
      label: AUDIT_ROW_LABELS.seo,
      state: hasAudit ? stateFromPoints(seoPts) : "not_checked",
      points: seoPts,
    },
    {
      key: "contact_path",
      label: AUDIT_ROW_LABELS.contact_path,
      state: hasAudit ? stateFromPoints(contactPts) : "not_checked",
      points: contactPts,
    },
    {
      key: "visual",
      label: AUDIT_ROW_LABELS.visual,
      state: hasAudit && hasScreenshots ? stateFromPoints(visualPts) : "not_checked",
      points: visualPts,
    },
    {
      key: "usability",
      label: AUDIT_ROW_LABELS.usability,
      state: hasAudit ? stateFromPoints(usabilityPts) : "not_checked",
      points: usabilityPts,
    },
    { key: "google_reviews", label: AUDIT_ROW_LABELS.google_reviews, state: googleState, points: [] },
  ];
}

// --- Top opportunities (Overview tab) --------------------------------------
// Ranked, deduped view over the same evidence the compact rows use, plus
// this workspace's own review-based synthesis (already evidence-grounded
// — see agents/planning_review_insights.py) — never invented copy.

export type Opportunity = {
  id: string;
  text: string;
  source: "audit" | "review";
  severity?: string;
  basis: string;
};

export function computeTopOpportunities(planning: Planning, maxCount = 5): Opportunity[] {
  const audit: Opportunity[] = [...planning.key_points]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.confidence - a.confidence)
    .map((p, i) => ({ id: `audit-${i}`, text: p.message, source: "audit", severity: p.severity, basis: p.evidence }));

  const reviewOpportunities: Opportunity[] = planning.review_website_opportunities.map((o, i) => ({
    id: `review-opp-${i}`,
    text: o.recommendation,
    source: "review",
    basis: `Based on: ${o.based_on_theme}`,
  }));

  const reviewGaps: Opportunity[] = planning.review_website_gaps.map((g, i) => ({
    id: `review-gap-${i}`,
    text: g.gap,
    source: "review",
    basis: `Based on: ${g.based_on_theme}`,
  }));

  const highSeverity = audit.filter((o) => o.severity === "critical" || o.severity === "high");
  const restAudit = audit.filter((o) => o.severity !== "critical" && o.severity !== "high");
  const ordered = [...highSeverity, ...reviewOpportunities, ...reviewGaps, ...restAudit];

  const seen = new Set<string>();
  const result: Opportunity[] = [];
  for (const o of ordered) {
    const key = o.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(o);
    if (result.length >= maxCount) break;
  }
  return result;
}

// --- Business inputs (New Website Plan mode's Overview) --------------------
// The equivalent of the compact audit-status rows above, but for input
// completeness rather than audit severity: "is there enough verified
// information on file to plan from" instead of "what did the audit
// find". Same restrained dot+label shape, reused as-is.

export type BusinessInputRowKey =
  | "business_details"
  | "location"
  | "contact"
  | "google_reviews"
  | "social_presence"
  | "comparable_research";

export const BUSINESS_INPUT_ROW_LABELS: Record<BusinessInputRowKey, string> = {
  business_details: "Business details",
  location: "Location",
  contact: "Contact details",
  google_reviews: "Google reviews",
  social_presence: "Social presence",
  comparable_research: "Comparable research",
};

export type BusinessInputRow = {
  key: BusinessInputRowKey;
  label: string;
  state: RowState;
};

function comparableResearchRowState(status: ComparableResearchStatus | null): RowState {
  switch (status) {
    case null:
      return "not_checked";
    case "ready_for_review":
    case "analysing":
      return "review";
    case "completed":
      return "good";
    case "needs_review":
    case "failed":
      return "improve";
  }
}

export function computeBusinessInputRows(
  planning: Planning,
  lead: Pick<Lead, "industry" | "suburb" | "state" | "business_phone" | "business_email"> | null,
): BusinessInputRow[] {
  return [
    {
      key: "business_details",
      label: BUSINESS_INPUT_ROW_LABELS.business_details,
      state: lead?.industry ? "good" : "not_checked",
    },
    {
      key: "location",
      label: BUSINESS_INPUT_ROW_LABELS.location,
      state: lead && (lead.suburb || lead.state) ? "good" : "not_checked",
    },
    {
      key: "contact",
      label: BUSINESS_INPUT_ROW_LABELS.contact,
      state: lead && (lead.business_phone || lead.business_email) ? "good" : "not_checked",
    },
    {
      key: "google_reviews",
      label: BUSINESS_INPUT_ROW_LABELS.google_reviews,
      state: googleReviewsRowState(planning.review_intelligence),
    },
    {
      key: "social_presence",
      label: BUSINESS_INPUT_ROW_LABELS.social_presence,
      state: planning.social_profile.has_any ? "good" : "not_checked",
    },
    {
      key: "comparable_research",
      label: BUSINESS_INPUT_ROW_LABELS.comparable_research,
      state: comparableResearchRowState(planning.comparable_research_status),
    },
  ];
}

// --- Information to Confirm (New Website Plan mode) ------------------------
// Deterministic gap checks (never invented, purely presence-based) shown
// ahead of the website-plan agent's own open_questions — both together
// back the "Information to Confirm" Disclosure in WebsitePlanTab.

export function computeInformationToConfirm(
  planning: Planning,
  lead: Pick<Lead, "business_phone" | "business_email"> | null,
  social: PlanningSocialProfile,
): string[] {
  const items: string[] = [];

  if (!social.instagram_handle && !social.instagram_profile_url) {
    items.push("Confirm whether this business has an Instagram profile.");
  }
  if (!social.facebook_page_url) {
    items.push("Confirm whether this business has a Facebook Page.");
  }
  if (lead && !lead.business_phone && !lead.business_email) {
    items.push("No phone or email on file — confirm a primary contact method.");
  }

  const seen = new Set(items.map((i) => i.trim().toLowerCase()));
  for (const q of planning.open_questions) {
    const key = q.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(q);
  }
  return items;
}

// --- Build Brief: Facts, Suggestions & Open Questions -----------------------
// A lightweight, always-on-hand summary computed purely from the already-
// fetched Planning object (mirrors the backend's compute_build_brief, but
// recomputes instantly on every local update — no extra fetch needed just
// to show this section of the Build Brief tab).

export type BuildBriefFact = { fact: string; source: string };

export type BuildBriefSummary = {
  confirmedFacts: BuildBriefFact[];
  proposedDecisions: string[];
  openQuestions: string[];
};

export function computeBuildBriefFacts(
  planning: Planning,
  lead: Pick<Lead, "industry" | "suburb" | "state" | "business_phone" | "business_email"> | null,
): BuildBriefSummary {
  const confirmedFacts: BuildBriefFact[] = [];
  if (lead?.industry) confirmedFacts.push({ fact: `Category: ${lead.industry}`, source: "Business record" });
  const location = [lead?.suburb, lead?.state].filter(Boolean).join(", ");
  if (location) confirmedFacts.push({ fact: `Location: ${location}`, source: "Business record" });
  if (lead?.business_phone) confirmedFacts.push({ fact: `Phone: ${lead.business_phone}`, source: "Business record" });
  if (lead?.business_email) confirmedFacts.push({ fact: `Email: ${lead.business_email}`, source: "Business record" });
  if (planning.social_profile.instagram_handle) {
    confirmedFacts.push({ fact: `Instagram: @${planning.social_profile.instagram_handle}`, source: "Social Presence" });
  }
  if (planning.social_profile.facebook_page_url) {
    confirmedFacts.push({ fact: `Facebook Page: ${planning.social_profile.facebook_page_url}`, source: "Social Presence" });
  }
  if (planning.review_intelligence?.google_rating != null) {
    confirmedFacts.push({
      fact: `Google rating: ${planning.review_intelligence.google_rating}★ (${planning.review_intelligence.google_review_count ?? 0} reviews)`,
      source: "Google Review Insights",
    });
  }

  const proposedDecisions: string[] = [];
  if (planning.recommendations_objective) proposedDecisions.push(`Objective: ${planning.recommendations_objective}`);
  const acceptedCount = planning.recommendations.filter((r) => r.status === "accepted").length;
  if (acceptedCount > 0) {
    proposedDecisions.push(`${acceptedCount} accepted Keep/Improve/Add recommendation${acceptedCount === 1 ? "" : "s"}`);
  }
  if (planning.sitemap_pages.length > 0) {
    proposedDecisions.push(`${planning.sitemap_pages.length} proposed page${planning.sitemap_pages.length === 1 ? "" : "s"}`);
  }
  if (planning.selected_visual_direction) {
    proposedDecisions.push(`Visual direction selected: ${planning.selected_visual_direction.character}`);
  }

  const openQuestions = computeInformationToConfirm(planning, lead, planning.social_profile);
  const seen = new Set(openQuestions.map((q) => q.trim().toLowerCase()));
  const add = (q: string) => {
    const key = q.trim().toLowerCase();
    if (!seen.has(key)) {
      openQuestions.push(q);
      seen.add(key);
    }
  };
  for (const page of planning.sitemap_pages) {
    if (page.needs_confirmation) add(`Confirm content for the proposed '${page.title}' page.`);
  }
  for (const asset of planning.assets) {
    if (asset.status === "missing") add(`Missing asset: ${asset.label}.`);
  }

  return { confirmedFacts, proposedDecisions, openQuestions };
}

// --- Content Draft -----------------------------------------------------
// A pre-generation explainer, computed purely from the already-fetched
// Planning object — no extra request. Sitemap pages are the one
// essential input (content is organised by page); everything else
// informs quality but never blocks generation.

export type ContentDraftReadinessItem = { label: string; available: boolean };

export type ContentDraftReadiness = {
  items: ContentDraftReadinessItem[];
  blocker: string | null;
};

export function computeContentDraftReadiness(planning: Planning): ContentDraftReadiness {
  const acceptedCount = planning.recommendations.filter((r) => r.status === "accepted").length;
  const hasReviewThemes = Boolean(
    planning.review_intelligence &&
      (planning.review_intelligence.positive_review_themes.length > 0 ||
        planning.review_intelligence.negative_review_themes.length > 0),
  );

  const items: ContentDraftReadinessItem[] = [
    { label: "Website objective", available: Boolean(planning.recommendations_objective) },
    { label: `Accepted Keep/Improve/Add (${acceptedCount})`, available: acceptedCount > 0 },
    { label: `Proposed sitemap (${planning.sitemap_pages.length} page${planning.sitemap_pages.length === 1 ? "" : "s"})`, available: planning.sitemap_pages.length > 0 },
    { label: "Selected visual direction", available: Boolean(planning.selected_visual_direction) },
    { label: "Google review themes", available: hasReviewThemes },
    { label: "Social presence", available: planning.social_profile.has_any },
  ];

  const blocker =
    planning.sitemap_pages.length === 0 ? "Generate a proposed sitemap in Build Brief before drafting content." : null;

  return { items, blocker };
}
