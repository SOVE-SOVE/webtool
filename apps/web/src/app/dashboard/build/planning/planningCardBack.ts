import type { PlanningChecklistSummary, PlanningListItem } from "@/lib/api";
// Relative (not "@/") so vitest, which has no path alias, can load them.
import { planningListItemMode } from "../../planning/lib";
import { PLANNING_CHECKLIST_TITLES, STEP_LABEL, type StepId } from "../../planning/[id]/processSteps";

/**
 * What the back of a Planning list card says: the current step of the
 * three-step workflow, one next action, and where "Continue planning"
 * goes. Pure, and derived ONLY from what the list page already holds —
 * the list item itself plus the bulk checklist summary (one request for
 * the whole grid, already loaded for the front's progress bar). Never a
 * per-card fetch, and never the remembered last-visited step: visiting a
 * step isn't evidence it's done.
 *
 * Where these two sources can't place a plan in a step, `step` is null
 * and the copy says so plainly rather than guessing.
 */
export type PlanningCardBackInput = Pick<
  PlanningListItem,
  "id" | "project_id" | "status" | "website_url" | "website_audit_id" | "website_plan_generated_at" | "content_draft_status"
>;

export type PlanningCardBackChecklist = Pick<PlanningChecklistSummary, "completed" | "total" | "next_item_title">;

export type PlanningCardBack = {
  step: StepId | null;
  /** STEP_LABEL[step], or null alongside a null step. */
  stepLabel: string | null;
  /** The next action, or — when `attention` — a short explanation of what went wrong. */
  message: string;
  attention: boolean;
  href: string;
  cta: string;
};

const CONTINUE = "Continue planning →";

/** Always an explicit `?step=` — a bare workspace URL resumes the remembered step, which isn't evidence of anything. */
export function planningStepHref(planningId: string, step: StepId): string {
  return `/dashboard/planning/${planningId}?step=${step}`;
}

/**
 * The seeded checklist items (processSteps' PLANNING_CHECKLIST_TITLES,
 * matching the backend's DEFAULT_PLANNING_TASKS) → the step whose
 * screen holds them, and the action that item asks for. A renamed or
 * custom item matches nothing and falls back to "unknown".
 */
function checklistNext(title: string, mode: "existing" | "new"): { step: StepId; message: string } | null {
  switch (title) {
    case PLANNING_CHECKLIST_TITLES.audit:
      return {
        step: "research",
        message: mode === "existing" ? "Review the website audit findings." : "Review the generated website plan.",
      };
    case PLANNING_CHECKLIST_TITLES.reviewInsights:
      return { step: "research", message: "Review the Google review insights, where available." };
    case PLANNING_CHECKLIST_TITLES.recommendations:
      return { step: "plan", message: "Review the improvement recommendations." };
    case PLANNING_CHECKLIST_TITLES.structure:
      return { step: "plan", message: "Choose the website structure and direction." };
    case PLANNING_CHECKLIST_TITLES.assets:
      return { step: "plan", message: "Review the content and asset requirements." };
    case PLANNING_CHECKLIST_TITLES.buildBriefApproved:
      return { step: "review", message: "Approve the build brief, then create the project." };
    default:
      return null;
  }
}

function atStep(item: PlanningCardBackInput, step: StepId, message: string, attention = false): PlanningCardBack {
  return { step, stepLabel: STEP_LABEL[step], message, attention, href: planningStepHref(item.id, step), cta: CONTINUE };
}

function unknownStep(item: PlanningCardBackInput, message: string, step: StepId = "research"): PlanningCardBack {
  // `step` here is only where the button lands, never a claim about progress.
  return { step: null, stepLabel: null, message, attention: false, href: planningStepHref(item.id, step), cta: CONTINUE };
}

export function planningCardBack(
  item: PlanningCardBackInput,
  checklist: PlanningCardBackChecklist | undefined,
): PlanningCardBack {
  // Handed off: the project is where the work continues (the same
  // destination the card's "Open Project" menu item already uses).
  if (item.project_id) {
    return {
      step: "review",
      stepLabel: STEP_LABEL.review,
      message: "A project was created from this plan. Carry on there.",
      attention: false,
      href: `/dashboard/projects/${item.project_id}`,
      cta: "Open project →",
    };
  }

  if (item.status === "analysing") {
    return atStep(item, "research", "The analysis is running. Check back when it finishes.");
  }

  const hasOutput = item.website_audit_id !== null || item.website_plan_generated_at !== null;

  // A failed run: explain, and send the button to where the existing
  // "Retry analysis" control lives — opening it never starts anything.
  if (item.status === "failed") {
    return atStep(
      item,
      "research",
      hasOutput
        ? "The last re-analysis didn't finish. Earlier results are kept — retry from Analyse business."
        : "The analysis didn't finish. Retry it from Analyse business.",
      true,
    );
  }

  if (!hasOutput) {
    return atStep(
      item,
      "research",
      item.website_url ? "Analyse the website to start this plan." : "No website on record — generate a website plan to start.",
    );
  }

  // Content draft generation is part of "Choose your website"; its own
  // Retry sits in that step's Content draft section.
  if (item.content_draft_status === "failed") {
    return atStep(item, "plan", "The content draft didn't generate. Retry it from Choose your website.", true);
  }
  if (item.content_draft_status === "generating") {
    return atStep(item, "plan", "The content draft is generating. Check back when it's ready.");
  }

  // Past here, which step a plan is on rests on its checklist — the
  // only per-step completion evidence the list page has.
  const placed = fromChecklist(item, checklist);

  // A degraded ("needs review") run is flagged while Research is still
  // the open step, or nothing can place the plan. Once its review is
  // checked off and the plan has moved on, the workspace itself stops
  // counting it against Research (auditOrPlanStepStatus: the checklist
  // item wins), so the card does too.
  if (item.status === "needs_review" && (placed.step === null || placed.step === "research")) {
    return atStep(item, "research", "Part of the last analysis may be incomplete. Check it before relying on it.", true);
  }
  return placed;
}

function fromChecklist(item: PlanningCardBackInput, checklist: PlanningCardBackChecklist | undefined): PlanningCardBack {
  if (!checklist) return unknownStep(item, "Open to see what's next.");

  if (checklist.next_item_title) {
    const next = checklistNext(checklist.next_item_title, planningListItemMode(item));
    return next ? atStep(item, next.step, next.message) : unknownStep(item, "Open to see what's next.");
  }

  // No pending or needs-review task left. Every required task done → the
  // remaining step is creating the project (the backend still checks the
  // approved brief itself). Otherwise what's left is blocked, and the
  // checklist that says why lives in Confirm & create project.
  if (checklist.total > 0 && checklist.completed >= checklist.total) {
    return atStep(item, "review", "All planning tasks are done. Create the project.");
  }
  if (checklist.total > 0) {
    return unknownStep(item, "A planning task is blocked. Open the checklist to see why.", "review");
  }
  return unknownStep(item, "Open to see what's next.");
}
