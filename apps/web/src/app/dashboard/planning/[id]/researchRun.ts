import type { Planning } from "@/lib/api";
import { reviewDisplayState } from "../../../../lib/reviewText";

/**
 * "Analyse business" — one primary action over the EXISTING research
 * operations, run in dependency order and only where a current,
 * successful result doesn't already exist. Pure planning logic (which
 * operation is in which state, which one runs next); the side effects
 * live in useResearchRunner.ts. Nothing here adds a research source or
 * calls anything new — each id maps 1:1 onto an existing endpoint:
 *
 *   audit           → POST /analyse               (background job; backend dedupes)
 *   websitePlan     → POST /generate-website-plan (no-website path)
 *   reviews         → POST /review-insights       (backend reuses fresh review data)
 *   recommendations → POST /recommendations/generate
 *   details         → POST /assets/refresh        (no AI/paid call; only adds rows,
 *                                                  never touches operator edits)
 */
export type ResearchOpId = "audit" | "websitePlan" | "reviews" | "recommendations" | "details";

/** `waiting` = can't run until an earlier operation settles.
 * `unavailable` = ran (or can't run) and there's genuinely nothing to use
 * — e.g. no Google listing — which is a result, not a failure, and never
 * blocks the operations after it. */
export type ResearchOpState = "done" | "running" | "failed" | "needed" | "waiting" | "unavailable";

export type ResearchOp = {
  id: ResearchOpId;
  label: string;
  state: ResearchOpState;
  /** One honest line: what happened, or why it's waiting/unavailable. */
  detail: string | null;
};

export const RESEARCH_OP_LABEL: Record<ResearchOpId, string> = {
  audit: "Website audit",
  websitePlan: "New-website plan",
  reviews: "Google Review Insights",
  recommendations: "Recommendations",
  details: "Business details & assets",
};

/** Errors from this browser session's own calls to the synchronous
 * operations (they don't all persist a failure server-side), and the
 * ones found to have nothing to work with. Cleared on a successful retry. */
export type ResearchSessionState = {
  errors: Partial<Record<ResearchOpId, string>>;
  unavailable: Partial<Record<ResearchOpId, true>>;
};

export const EMPTY_SESSION: ResearchSessionState = { errors: {}, unavailable: {} };

function settled(state: ResearchOpState): boolean {
  return state === "done" || state === "failed" || state === "unavailable";
}

function auditOp(planning: Planning, session: ResearchSessionState): ResearchOp {
  const base = { id: "audit" as const, label: RESEARCH_OP_LABEL.audit };
  if (planning.status === "analysing") return { ...base, state: "running", detail: "Analysing the website…" };
  if (session.errors.audit) return { ...base, state: "failed", detail: session.errors.audit };
  if (planning.status === "failed") {
    return {
      ...base,
      state: "failed",
      detail:
        planning.website_audit_id !== null
          ? "The last re-analysis didn't finish — the previous results are still shown."
          : (planning.error_message ?? "The analysis didn't finish."),
    };
  }
  if (planning.website_audit_id !== null) {
    return {
      ...base,
      state: "done",
      detail: planning.status === "needs_review" ? "Finished, but part of it needs a look." : null,
    };
  }
  return { ...base, state: "needed", detail: null };
}

function websitePlanOp(planning: Planning, session: ResearchSessionState): ResearchOp {
  const base = { id: "websitePlan" as const, label: RESEARCH_OP_LABEL.websitePlan };
  if (session.errors.websitePlan) return { ...base, state: "failed", detail: session.errors.websitePlan };
  if (planning.website_plan_generated_at !== null) {
    return {
      ...base,
      state: "done",
      detail: planning.status === "needs_review" ? "Generated, but part of it needs a look." : null,
    };
  }
  return { ...base, state: "needed", detail: null };
}

function reviewsOp(planning: Planning, session: ResearchSessionState, prior: ResearchOp): ResearchOp {
  const base = { id: "reviews" as const, label: RESEARCH_OP_LABEL.reviews };
  if (session.errors.reviews) return { ...base, state: "failed", detail: session.errors.reviews };
  if (planning.review_synthesis_status === "failed") {
    return {
      ...base,
      state: "failed",
      detail: planning.review_synthesis_error ?? "Reviews were fetched, but the insights step didn't finish.",
    };
  }
  const display = reviewDisplayState(planning.review_intelligence);
  if (planning.review_insights_generated_at !== null) {
    if (display === "no_listing") return { ...base, state: "unavailable", detail: "No Google listing found." };
    if (display === "fetch_failed") {
      return { ...base, state: "failed", detail: "Google reviews couldn't be fetched." };
    }
    if (display === "no_google_reviews" || display === "text_unavailable") {
      return { ...base, state: "unavailable", detail: "No written Google reviews to learn from." };
    }
    return { ...base, state: "done", detail: null };
  }
  if (session.unavailable.reviews) return { ...base, state: "unavailable", detail: "No Google reviews available." };
  // Synthesis reads the audit's findings, so it waits for the audit/plan
  // to settle — a failed or unavailable one still lets it run.
  if (!settled(prior.state)) return { ...base, state: "waiting", detail: `Runs after the ${prior.label.toLowerCase()}.` };
  return { ...base, state: "needed", detail: null };
}

function recommendationsOp(planning: Planning, session: ResearchSessionState, prior: ResearchOp): ResearchOp {
  const base = { id: "recommendations" as const, label: RESEARCH_OP_LABEL.recommendations };
  if (session.errors.recommendations) return { ...base, state: "failed", detail: session.errors.recommendations };
  if (planning.recommendations_generated_at !== null || planning.recommendations.length > 0) {
    return { ...base, state: "done", detail: null };
  }
  if (prior.state !== "done") {
    return {
      ...base,
      state: "waiting",
      detail: prior.state === "failed" ? `Needs the ${prior.label.toLowerCase()} first.` : `Runs after the ${prior.label.toLowerCase()}.`,
    };
  }
  return { ...base, state: "needed", detail: null };
}

/** The routine gathering the old "Details needed" prompts asked the
 * operator for: contact, booking destination, photos, service copy — the
 * existing Assets Checklist seeds these from records already on file. It
 * runs once the audit/plan has settled (a proposed portfolio page adds a
 * gallery row), and never blocks anything after it. */
function detailsOp(planning: Planning, session: ResearchSessionState, prior: ResearchOp): ResearchOp {
  const base = { id: "details" as const, label: RESEARCH_OP_LABEL.details };
  if (session.errors.details) return { ...base, state: "failed", detail: session.errors.details };
  if (planning.assets_checklist_generated_at !== null) return { ...base, state: "done", detail: null };
  if (!settled(prior.state)) return { ...base, state: "waiting", detail: `Runs after the ${prior.label.toLowerCase()}.` };
  return { ...base, state: "needed", detail: null };
}

/** The applicable operations, in the order they run. A business with a
 * website gets the audit; one without gets the new-website plan (the
 * existing no-website path) — never both. */
export function computeResearchOps(planning: Planning, session: ResearchSessionState = EMPTY_SESSION): ResearchOp[] {
  const primary = planning.website_url ? auditOp(planning, session) : websitePlanOp(planning, session);
  const reviews = reviewsOp(planning, session, primary);
  // Recommendations only need the audit/plan; reviews enrich them but a
  // missing or failed review step must never block them.
  const recommendations = recommendationsOp(planning, session, primary);
  const details = detailsOp(planning, session, primary);
  if (reviews.state === "waiting" || reviews.state === "needed" || reviews.state === "running") {
    // Keep the documented order: recommendations run after reviews settle.
    if (recommendations.state === "needed") {
      return [primary, reviews, { ...recommendations, state: "waiting", detail: "Runs after Google Review Insights." }, details];
    }
  }
  return [primary, reviews, recommendations, details];
}

/** The next operation "Analyse business" should start, or null when
 * nothing is left it can run (all done/unavailable, something running,
 * or only failed ones — those wait for an explicit per-operation retry). */
export function nextResearchOp(ops: ResearchOp[]): ResearchOpId | null {
  if (ops.some((op) => op.state === "running")) return null;
  return ops.find((op) => op.state === "needed")?.id ?? null;
}

export type ResearchProgress = {
  done: number;
  total: number;
  running: boolean;
  failed: ResearchOp[];
  /** Nothing left to run and nothing failed. */
  complete: boolean;
  /** Something is still runnable by the primary action. */
  hasRemaining: boolean;
};

export function summariseResearch(ops: ResearchOp[]): ResearchProgress {
  const finished = ops.filter((op) => op.state === "done" || op.state === "unavailable").length;
  const failed = ops.filter((op) => op.state === "failed");
  const running = ops.some((op) => op.state === "running");
  // A `waiting` op only counts while something ahead of it can still
  // move — one stuck behind a failure needs that failure's retry first.
  const hasRemaining = ops.some((op) => op.state === "needed") || (running && ops.some((op) => op.state === "waiting"));
  return {
    done: finished,
    total: ops.length,
    running,
    failed,
    complete: !running && failed.length === 0 && !hasRemaining,
    hasRemaining,
  };
}
