import type { Planning, StageChecklist, StageChecklistItem } from "@/lib/api";
import { planningMode } from "../lib";
import { computePlanSelectionSummary } from "./websiteBlueprintLib";

/**
 * The Planning workspace's 3-step guided process — pure step/status
 * logic, split out so it's testable without rendering anything (same
 * precedent as lib/delayedVisible.ts). ProcessNav.tsx and page.tsx are
 * the only consumers.
 *
 * Research = the old "Understand the business" + "Review current
 * presence"; Plan = the old "Choose improvements" + "Prepare the
 * website"; Review & build = the old "Review & hand off". The old ids
 * still arrive from bookmarks, shared links and remembered steps — see
 * `LEGACY_STEP_TO_STEP`.
 */
export type StepId = "research" | "plan" | "review";

export const STEP_ORDER: readonly StepId[] = ["research", "plan", "review"];

// Ids stay "research" | "plan" | "review" so every existing URL and
// remembered step keeps working; only the visible wording changed.
export const STEP_LABEL: Record<StepId, string> = {
  research: "Analyse business",
  plan: "Choose your website",
  review: "Confirm & create project",
};

export function isStepId(value: string | null | undefined): value is StepId {
  return !!value && (STEP_ORDER as readonly string[]).includes(value);
}

export function stepIndex(id: StepId): number {
  return STEP_ORDER.indexOf(id);
}

// --- Old step ids -> new step (the 5-step process's `?step=` values) ---

const LEGACY_STEP_TO_STEP: Record<string, StepId> = {
  understand: "research",
  presence: "research",
  improvements: "plan",
  prepare: "plan",
  handoff: "review",
};

/** A current step id as-is, an old 5-step id mapped forward, or `null`
 * for anything else (nothing, garbage, a removed id). */
export function resolveStepId(value: string | null | undefined): StepId | null {
  if (isStepId(value)) return value;
  return (value && LEGACY_STEP_TO_STEP[value]) || null;
}

// --- Old ?tab= -> new step, for existing bookmarks/shared links --------
// "notes" isn't mapped here: Notes is no longer a step (see NotesPanel),
// it opens the persistent Notes control instead — callers should check
// for "notes" themselves before falling back to this map.

const LEGACY_TAB_TO_STEP: Record<string, StepId> = {
  overview: "research",
  audit: "research",
  reviews: "research",
  "build-brief": "plan",
  "content-draft": "plan",
};

export function legacyTabToStep(tab: string): StepId | null {
  return LEGACY_TAB_TO_STEP[tab] ?? null;
}

// --- Resume where you left off --------------------------------------
// "Remember the last step visited, per plan" — same wdos-* localStorage
// naming convention as SIDEBAR_COLLAPSED_KEY (components/nav/Sidebar.tsx)
// and the sessionStorage read in this same route's page.tsx. The actual
// localStorage read/write happens in page.tsx (same place Sidebar.tsx
// does its own try/catch around the browser API) — these two functions
// are the pure, testable pieces: building the key, and turning whatever
// came back into either a real StepId or an honest "nothing usable here"
// signal the caller falls back from, rather than a second place that
// could itself throw.

export function lastStepStorageKey(planningId: string): string {
  return `wdos-planning-step:${planningId}`;
}

/**
 * A remembered step — an old 5-step id (remembered before the merge) maps
 * forward; `null` for anything else (nothing stored yet, or a stale value
 * naming a step a future version removed) so the caller can fall back to
 * the default step instead of erroring.
 */
export function parseStoredStep(raw: string | null | undefined): StepId | null {
  return resolveStepId(raw);
}

// --- Step status ---------------------------------------------------------
// Status vocabulary is deliberately small and only ever applied where
// real evidence backs it — see docs note in page.tsx. The old
// "understand" half of Research has no persisted evidence of its own (no
// checklist item, no generation/approval event exists for "the business
// is understood"), so it contributes nothing to Research's status rather
// than a guess from data presence.

export type StepStatus = "not_started" | "in_progress" | "needs_review" | "complete" | "skipped";

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_review: "Needs review",
  complete: "Complete",
  skipped: "Skipped",
};

/**
 * The exact default titles apps/api/app/modules/stage_checklists/
 * service.py::DEFAULT_PLANNING_TASKS seeds this checklist with. A
 * renamed or removed item just falls back to the generation-evidence
 * checks below (never guessed) — this only matches the seeded default.
 */
export const PLANNING_CHECKLIST_TITLES = {
  audit: "Review website audit or new-website research",
  reviewInsights: "Review Google Review Insights, where available",
  recommendations: "Review improvement recommendations",
  structure: "Select website structure and direction",
  assets: "Review content and asset requirements",
  buildBriefApproved: "Approve the build brief",
} as const;

export function findChecklistItem(
  checklist: StageChecklist | null,
  title: string,
): StageChecklistItem | undefined {
  return checklist?.items.find((item) => item.title === title);
}

/**
 * A checklist item's own (server-computed) status, translated into the
 * step vocabulary. `null` means "this item has nothing to say" — either
 * there's no matching item, or it's still `pending`, which alone
 * doesn't distinguish "nothing generated yet" from "generated, not yet
 * reviewed" (the caller adds that from generation evidence).
 *
 * "blocked" (an operator's own override, distinct from "not_required")
 * doesn't have its own word in the 5-value vocabulary — it's mapped to
 * "needs_review" as the closest honest fit ("this needs a look"),
 * rather than silently treated as "not started".
 */
export function checklistItemStepStatus(item: StageChecklistItem | undefined): StepStatus | null {
  if (!item) return null;
  switch (item.status) {
    case "complete":
      return "complete";
    case "not_required":
      return "skipped";
    case "needs_review":
      return "needs_review";
    case "blocked":
      return "needs_review";
    case "pending":
      return null;
    default:
      return null;
  }
}

/** Combines several sub-signals covered by one step into that step's
 * single displayed status. A job actively running anywhere in the step
 * always wins (it's happening right now); otherwise an explicit
 * needs-review beats a plain not-started, which beats a mix that's
 * actually done. Only "every part skipped" reads as the step itself
 * being skipped — one skipped part next to a complete one is still a
 * complete step, not a skipped one. */
export function combineStepStatuses(statuses: StepStatus[]): StepStatus {
  if (statuses.length === 0) return "not_started";
  if (statuses.includes("in_progress")) return "in_progress";
  if (statuses.includes("needs_review")) return "needs_review";
  if (statuses.includes("not_started")) return "not_started";
  if (statuses.every((s) => s === "skipped")) return "skipped";
  return "complete";
}

/** Research's "current website" half — the website audit for Existing
 * Website mode, or the generated Website Plan standing in for it in New
 * Website Plan mode (see planningMode's own docstring: the "Analyse
 * Website" empty state wins whenever a website_url is on record, even
 * though `planningMode` itself still reads "new" until an audit
 * actually exists). Mirrors the exact branches the old OverviewTab used
 * to decide what to render, not a fresh interpretation of the data. */
export function auditOrPlanStepStatus(planning: Planning, checklist: StageChecklist | null): StepStatus {
  const item = checklistItemStepStatus(findChecklistItem(checklist, PLANNING_CHECKLIST_TITLES.audit));

  // A run is literally happening right now — wins regardless of mode,
  // the same `status === "analysing"` check the composed content
  // itself branches on first (see ResearchStep.tsx / AnalysingOverview),
  // including the "never-yet-audited site currently being analysed"
  // case, where `planningMode` still reads "new" (no audit exists yet).
  if (planning.status === "analysing") return "in_progress";

  if (planningMode(planning) === "existing") {
    if (item) return item;
    if (planning.status === "failed" || planning.status === "needs_review") return "needs_review";
    return "in_progress"; // an audit exists (mode is "existing"), just not yet reviewed
  }

  // New Website Plan mode: no site to audit yet.
  if (planning.website_plan_generated_at === null) {
    // A failed *audit* attempt (a website_url on record whose analysis
    // never produced one) still shows the "Retry analysis" empty state
    // here too, not "Generate Website Plan" — see planningMode's own
    // docstring: the Analyse Website empty state wins over "new" mode
    // whenever a website_url is on record, and that empty state's own
    // "isRetry" is exactly `status === "failed"`.
    return planning.status === "failed" ? "needs_review" : "not_started";
  }
  if (item) return item;
  return planning.status === "needs_review" ? "needs_review" : "in_progress";
}

/** Research's "Google Review Insights" half. `review_synthesis_status` is
 * the one place an explicit, recorded "skipped" decision actually shows
 * up (never inferred from reviews merely being absent). */
export function reviewInsightsStepStatus(planning: Planning, checklist: StageChecklist | null): StepStatus {
  const item = checklistItemStepStatus(findChecklistItem(checklist, PLANNING_CHECKLIST_TITLES.reviewInsights));
  if (item) return item;
  if (planning.review_synthesis_status === "skipped") return "skipped";
  if (planning.review_synthesis_status === "failed") return "needs_review";
  return planning.review_insights_generated_at !== null ? "in_progress" : "not_started";
}

/** Plan's recommendations part — Keep/Improve/Add. */
export function improvementsStepStatus(planning: Planning, checklist: StageChecklist | null): StepStatus {
  const item = checklistItemStepStatus(findChecklistItem(checklist, PLANNING_CHECKLIST_TITLES.recommendations));
  if (item) return item;
  const generated = planning.recommendations_generated_at !== null || planning.recommendations.length > 0;
  return generated ? "in_progress" : "not_started";
}

/** Plan's "structure" part — proposed sitemap + visual direction. */
export function structureStepStatus(planning: Planning, checklist: StageChecklist | null): StepStatus {
  const item = checklistItemStepStatus(findChecklistItem(checklist, PLANNING_CHECKLIST_TITLES.structure));
  if (item) return item;
  const generated = planning.sitemap_proposal_generated_at !== null || planning.visual_directions_generated_at !== null;
  return generated ? "in_progress" : "not_started";
}

/** Plan's "assets & content" part — assets checklist + content draft. */
export function assetsStepStatus(planning: Planning, checklist: StageChecklist | null): StepStatus {
  if (planning.content_draft_status === "generating") return "in_progress";
  const item = checklistItemStepStatus(findChecklistItem(checklist, PLANNING_CHECKLIST_TITLES.assets));
  if (planning.content_draft_status === "needs_review" || planning.content_draft_status === "failed") {
    return "needs_review";
  }
  if (item) return item;
  const generated = planning.assets_checklist_generated_at !== null || planning.content_draft_generated_at !== null;
  return generated ? "in_progress" : "not_started";
}

/** Review & build — the build brief's own approval, an AUTOMATIC checklist item
 * (`done` fully determines it server-side — see
 * stage_checklists/signals.py's module docstring), so its status is
 * read straight from the checklist with no extra generation-evidence
 * fallback needed. */
export function handoffStepStatus(planning: Planning, checklist: StageChecklist | null): StepStatus {
  const item = checklistItemStepStatus(findChecklistItem(checklist, PLANNING_CHECKLIST_TITLES.buildBriefApproved));
  return item ?? "not_started";
}

/** The single status shown against each step in ProcessNav. Each merged
 * step combines the SAME per-part statuses the 5 old steps showed
 * (`combineStepStatuses`), so a merged step only reads complete when
 * every underlying part is — never a new completion rule. */
export function computeStepStatus(
  stepId: StepId,
  planning: Planning,
  checklist: StageChecklist | null,
): StepStatus {
  switch (stepId) {
    case "research":
      return combineStepStatuses([
        auditOrPlanStepStatus(planning, checklist),
        reviewInsightsStepStatus(planning, checklist),
      ]);
    case "plan":
      return combineStepStatuses([
        improvementsStepStatus(planning, checklist),
        structureStepStatus(planning, checklist),
        assetsStepStatus(planning, checklist),
      ]);
    case "review":
      return handoffStepStatus(planning, checklist);
  }
}

// --- Step summaries --------------------------------------------------
// A short, second line under each step's label in ProcessNav — real
// counts/state from `planning`/`checklist`, never a guess. `null` means
// exactly what it does everywhere else in this file: there's no evidence
// to make that specific claim yet, so nothing is shown rather than a
// generic filler line. A failed/needs-review state always gets its own
// honest word here too — never folded into a "such-and-such done" phrase
// that would read as success.

function auditOrPlanStepSummary(planning: Planning, checklist: StageChecklist | null): string | null {
  if (planning.status === "analysing") return "Analysing…";

  const item = findChecklistItem(checklist, PLANNING_CHECKLIST_TITLES.audit);
  const reviewed = item?.status === "complete";

  if (planningMode(planning) === "existing") {
    if (planning.status === "failed") return "Analysis failed";
    // A plain `needs_review` here says nothing the step's own status pill
    // (right next to this line) doesn't already say word-for-word — see
    // ProcessNav — so it's left null rather than echoed back.
    if (planning.status === "needs_review") return null;
    return reviewed ? "Audit reviewed" : "Audit ready to review";
  }

  // New Website Plan mode.
  if (planning.website_plan_generated_at === null) {
    if (planning.status === "failed") return "Analysis failed";
    return planning.website_url ? "Not analysed yet" : "No website on record";
  }
  if (planning.status === "needs_review") return null; // same reasoning as above
  return reviewed ? "Plan reviewed" : "Plan generated";
}

function planSelectionStepSummary(planning: Planning): string | null {
  const { featureLabels, siteWideAccepted } = computePlanSelectionSummary(planning);
  const parts: string[] = [];
  if (featureLabels.length > 0) parts.push(`${featureLabels.length} feature${featureLabels.length === 1 ? "" : "s"}`);
  if (siteWideAccepted.length > 0) {
    parts.push(`${siteWideAccepted.length} site-wide improvement${siteWideAccepted.length === 1 ? "" : "s"}`);
  }
  if (parts.length > 0) return `${parts.join(", ")} selected`;
  const total = planning.recommendations.filter((r) => r.status !== "dismissed").length;
  return total > 0 ? `${total} recommendation${total === 1 ? "" : "s"} to review` : null;
}

function prepareStepSummary(planning: Planning): string | null {
  if (planning.content_draft_status === "generating") return "Generating content draft…";
  if (planning.content_draft_status === "failed") return "Content draft failed";
  if (planning.content_draft_status === "needs_review") return "Content draft needs review";

  const pagesWithContent = planning.content_pages.filter((p) => p.sections.length > 0);
  if (pagesWithContent.length > 0) {
    const approved = pagesWithContent.filter((p) => p.status === "approved").length;
    if (approved === pagesWithContent.length) return "Content draft approved";
    if (approved > 0) return `${approved} of ${pagesWithContent.length} pages approved`;
    return "Draft saved";
  }

  if (planning.sitemap_proposal_generated_at !== null || planning.visual_directions_generated_at !== null) {
    return "Structure drafted";
  }
  return null;
}

function handoffStepSummary(planning: Planning, checklist: StageChecklist | null): string | null {
  const item = findChecklistItem(checklist, PLANNING_CHECKLIST_TITLES.buildBriefApproved);
  return item?.status === "complete" ? "Brief approved" : null;
}

/** Plan's short line — the content draft's own failure/in-progress
 * states win (they need attention), then what's been selected. */
function planStepSummary(planning: Planning): string | null {
  if (
    planning.content_draft_status === "generating" ||
    planning.content_draft_status === "failed" ||
    planning.content_draft_status === "needs_review"
  ) {
    return prepareStepSummary(planning);
  }
  return planSelectionStepSummary(planning) ?? prepareStepSummary(planning);
}

/** The short second line ProcessNav shows under a step's label. */
export function computeStepSummary(
  stepId: StepId,
  planning: Planning,
  checklist: StageChecklist | null,
): string | null {
  switch (stepId) {
    case "research":
      return auditOrPlanStepSummary(planning, checklist);
    case "plan":
      return planStepSummary(planning);
    case "review":
      return handoffStepSummary(planning, checklist);
  }
}
