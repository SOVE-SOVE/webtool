import type { ComparableResearchStatus, Lead, Planning, PlanningKeyPoint, PlanningStatus, ReviewIntelligenceResult } from "@/lib/api";

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

export const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  medium: "bg-surface-subtle text-fg-muted",
  low: "bg-surface-subtle text-fg-subtle",
};

export const STATUS_BADGE_CLASS: Record<PlanningStatus, string> = {
  ready_to_analyse: "bg-surface-subtle text-fg-muted",
  analysing: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  needs_review: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

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

export type BusinessInputRowKey = "business_details" | "location" | "contact" | "google_reviews" | "comparable_research";

export const BUSINESS_INPUT_ROW_LABELS: Record<BusinessInputRowKey, string> = {
  business_details: "Business details",
  location: "Location",
  contact: "Contact details",
  google_reviews: "Google reviews",
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
      key: "comparable_research",
      label: BUSINESS_INPUT_ROW_LABELS.comparable_research,
      state: comparableResearchRowState(planning.comparable_research_status),
    },
  ];
}
