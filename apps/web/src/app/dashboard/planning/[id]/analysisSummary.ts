import type { Planning, PlanningKeyPoint } from "@/lib/api";
import { severityRank } from "../lib";
import type { ResearchOp, ResearchOpId, ResearchOpState, ResearchProgress } from "./researchRun";

/**
 * Pure wording for the "Business analysis" widget (BusinessAnalysisCard).
 * Each operation counts under exactly one bucket, so an unavailable or
 * skipped one (e.g. no Google listing) is never reported as complete,
 * and "waiting" — queued behind an earlier operation — is honestly
 * "not started" rather than progress.
 */
export type AnalysisSummaryCounts = {
  complete: number;
  running: number;
  failed: number;
  unavailable: number;
  notStarted: number;
};

const BUCKET: Record<ResearchOpState, keyof AnalysisSummaryCounts> = {
  done: "complete",
  running: "running",
  failed: "failed",
  unavailable: "unavailable",
  needed: "notStarted",
  waiting: "notStarted",
};

const PHRASE: [keyof AnalysisSummaryCounts, string][] = [
  ["complete", "complete"],
  ["running", "running"],
  ["failed", "failed"],
  ["unavailable", "unavailable"],
  ["notStarted", "not started"],
];

export function countAnalysisStates(states: ResearchOpState[]): AnalysisSummaryCounts {
  const counts: AnalysisSummaryCounts = { complete: 0, running: 0, failed: 0, unavailable: 0, notStarted: 0 };
  for (const state of states) counts[BUCKET[state]] += 1;
  return counts;
}

/** e.g. "2 complete · 1 unavailable · 1 not started" — zero buckets omitted. */
export function formatAnalysisSummary(counts: AnalysisSummaryCounts): string {
  const parts = PHRASE.filter(([key]) => counts[key] > 0).map(([key, phrase]) => `${counts[key]} ${phrase}`);
  return parts.length > 0 ? parts.join(" · ") : "No analysis steps";
}

export function summariseAnalysisStates(states: ResearchOpState[]): string {
  return formatAnalysisSummary(countAnalysisStates(states));
}

/** The audit's own record that the page failed to load (planning_audit.py
 * emits exactly one "availability" finding when the capture errored).
 * The only signal on a Planning record that supports "this screenshot
 * may be an error page" — nothing is inferred from the image itself. */
export function loadFailureFinding(keyPoints: PlanningKeyPoint[]): PlanningKeyPoint | null {
  return keyPoints.find((p) => p.category === "availability") ?? null;
}

/** What a finished audit found — kept apart from "it ran", so a
 * complete audit never reads as a healthy website. */
export function auditOutcomeNote(keyPoints: PlanningKeyPoint[]): string {
  if (loadFailureFinding(keyPoints)) return "Ran, but the site didn't load";
  const n = keyPoints.length;
  if (n === 0) return "No issues recorded";
  return `${n} finding${n === 1 ? "" : "s"} recorded`;
}

// --- Left column: compact rows, key findings, summary, next action ------

/** A status row's always-visible line (`short`) and the existing extra
 * detail behind its disclosure (`more`). `more` is empty when there's
 * nothing beyond `short` — those rows aren't expandable. */
export type OpRowCopy = { short: string | null; more: string[] };

const RUNS_AFTER = /^Runs after (?:the )?(.+?)\.?$/i;
const NEEDS_FIRST = /^Needs (?:the )?(.+?) first\.?$/i;

/** researchRun's waiting lines, shortened so three stacked rows don't
 * repeat "Runs after the website audit." in full. Anything unrecognised
 * is kept exactly as it was. */
export function shortWaitingLine(detail: string | null): string | null {
  if (!detail) return null;
  const after = RUNS_AFTER.exec(detail);
  if (after) return `After ${after[1]}`;
  const needs = NEEDS_FIRST.exec(detail);
  if (needs) return `Needs ${needs[1]} first`;
  return detail;
}

/** Only facts already on the Planning record — nothing derived beyond
 * counting. The audit's findings themselves are never listed here (Key
 * findings shows them), so expanding a row never repeats them. */
export function opRowCopy(op: ResearchOp, planning: Planning): OpRowCopy {
  if (op.state === "failed") {
    return { short: "Didn't finish", more: op.detail ? [op.detail] : [] };
  }
  if (op.state === "waiting") return { short: shortWaitingLine(op.detail), more: [] };
  if (op.state === "running") return { short: op.id === "audit" ? null : "In progress", more: [] };
  if (op.state === "needed") return { short: null, more: [] };

  // done / unavailable
  const extra = op.detail && op.state === "done" ? [op.detail] : [];
  switch (op.id) {
    case "audit":
      return { short: auditOutcomeNote(planning.key_points), more: extra };
    case "reviews": {
      const ri = planning.review_intelligence;
      const rating =
        ri && ri.google_rating !== null
          ? [
              `Google rating ${ri.google_rating}${ri.google_review_count !== null ? ` from ${ri.google_review_count} review${ri.google_review_count === 1 ? "" : "s"}` : ""}.`,
            ]
          : [];
      return { short: op.state === "unavailable" ? op.detail : null, more: [...extra, ...rating] };
    }
    case "recommendations": {
      const recs = planning.recommendations;
      if (recs.length === 0) return { short: "None suggested", more: extra };
      const by = (c: string) => recs.filter((r) => r.category === c).length;
      const split = [
        ["Keep", by("keep")],
        ["Improve", by("improve")],
        ["Add", by("add")],
      ]
        .filter(([, n]) => (n as number) > 0)
        .map(([label, n]) => `${label} ${n}`)
        .join(" · ");
      return { short: `${recs.length} suggestion${recs.length === 1 ? "" : "s"}`, more: [...extra, ...(split ? [split] : [])] };
    }
    case "details": {
      const n = planning.assets.length;
      return { short: n > 0 ? `${n} checklist item${n === 1 ? "" : "s"}` : null, more: extra };
    }
    default:
      return { short: op.state === "unavailable" ? op.detail : null, more: extra };
  }
}

/**
 * Up to `max` audit findings for the widget, in the same order the
 * existing ranking uses (lib.ts computeTopOpportunities): severity,
 * then the audit's own confidence; ties keep the stored order. The
 * load-failure ("availability") finding is left out on purpose — the
 * screenshot's note already reports it in careful wording, and its own
 * message reads one failed capture as what visitors experience.
 */
export function selectKeyFindings(keyPoints: PlanningKeyPoint[], max = 3): PlanningKeyPoint[] {
  const seen = new Set<string>();
  return keyPoints
    .filter((p) => p.category !== "availability" && p.message.trim() !== "")
    .map((p, i) => ({ p, i }))
    .sort((a, b) => severityRank(a.p.severity) - severityRank(b.p.severity) || b.p.confidence - a.p.confidence || a.i - b.i)
    .map(({ p }) => p)
    .filter((p) => {
      const key = p.message.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

/** The exact sentences planning/service.py writes into website_summary
 * when the AI step couldn't run (`_no_llm_summary_fallback`,
 * `_no_llm_website_plan_fallback`). No flag is stored for this, so these
 * fixed backend strings are the only reliable signal — keep in sync. */
export const SUMMARY_FALLBACK_SUFFIX = " The key points below are drawn directly from the audit findings.";
export const PLAN_FALLBACK_MARKER = " No plan could be generated — here is what's on file instead:";

export type WebsiteSummaryView =
  | { kind: "none" }
  | { kind: "fallback"; reason: string }
  | { kind: "summary"; text: string };

export function websiteSummaryView(summary: string | null): WebsiteSummaryView {
  const text = summary?.trim() ?? "";
  if (!text) return { kind: "none" };
  if (text.endsWith(SUMMARY_FALLBACK_SUFFIX.trim())) {
    return { kind: "fallback", reason: text.slice(0, text.length - SUMMARY_FALLBACK_SUFFIX.trim().length).trim() };
  }
  const plan = text.indexOf(PLAN_FALLBACK_MARKER.trim());
  if (plan !== -1) return { kind: "fallback", reason: text.slice(0, plan).trim() };
  return { kind: "summary", text };
}

/** A word-boundary excerpt for display only — the saved text is never
 * changed. `truncated` says whether a Read more control is needed. */
export function summaryExcerpt(text: string, maxChars = 110): { excerpt: string; truncated: boolean } {
  const clean = text.trim();
  if (clean.length <= maxChars) return { excerpt: clean, truncated: false };
  const cut = clean.slice(0, maxChars);
  const space = cut.lastIndexOf(" ");
  const base = (space > maxChars * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "");
  return { excerpt: `${base}…`, truncated: true };
}

/** Optional operations — a failure there never stands in the way of
 * moving on (the widget's own footer says so). */
const OPTIONAL_OPS: ResearchOpId[] = ["reviews"];

export type NextAction =
  | { kind: "running" }
  | { kind: "start"; label: "Analyse business" | "Continue analysis" }
  | { kind: "retry"; opId: ResearchOpId; label: string }
  | { kind: "continue"; label: "Continue to website plan" };

/**
 * The one action at the bottom of the left column. Work that the primary
 * action can still run comes first; then a failed required operation's
 * retry; otherwise moving on. Continuing is navigation only and has no
 * prerequisite of its own (StepFooter's Continue is never gated either).
 */
export function chooseNextAction(ops: ResearchOp[], progress: ResearchProgress, working: boolean): NextAction {
  if (working) return { kind: "running" };
  if (progress.hasRemaining) {
    const nothingRunYet = ops.every((op) => op.state === "needed" || op.state === "waiting");
    return { kind: "start", label: nothingRunYet ? "Analyse business" : "Continue analysis" };
  }
  const blocking = progress.failed.find((op) => !OPTIONAL_OPS.includes(op.id));
  if (blocking) return { kind: "retry", opId: blocking.id, label: `Retry ${blocking.label.toLowerCase()}` };
  return { kind: "continue", label: "Continue to website plan" };
}
