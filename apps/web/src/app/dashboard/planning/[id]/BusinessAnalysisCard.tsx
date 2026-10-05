"use client";

import { useId, useState, type ReactNode } from "react";
import type { Planning } from "@/lib/api";
import { AnimatedHeight } from "@/components/ui/AnimatedHeight";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { SEVERITY_LABEL, SEVERITY_TONE, planningMode } from "../lib";
import { AnalysingProgress } from "./AnalysingProgress";
import {
  loadFailureFinding,
  opRowCopy,
  selectKeyFindings,
  summariseAnalysisStates,
  summaryExcerpt,
  websiteSummaryView,
} from "./analysisSummary";
import type { ResearchOp, ResearchOpId, ResearchOpState } from "./researchRun";
import { AnalysingPreviewPanel, EvidencePanel } from "./SidePanels";

// "unavailable" (e.g. no Google listing) is a result, not a failure —
// neutral, never red. Only a real failure gets "danger".
const OP_STATE_BADGE: Record<ResearchOpState, { label: string; tone: BadgeTone }> = {
  done: { label: "Complete", tone: "success" },
  running: { label: "Running…", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  needed: { label: "Not started", tone: "muted" },
  waiting: { label: "Waiting", tone: "muted" },
  unavailable: { label: "Unavailable", tone: "muted" },
};

/** One compact row of the analysis progress list. Expandable only when
 * there's existing detail beyond its short line (opRowCopy); the
 * disclosure stays inside the left column, so the screenshot never moves. */
function OpRow({
  op,
  state,
  planning,
  showRetry,
  retryDisabled,
  onRetry,
}: {
  op: ResearchOp;
  state: ResearchOpState;
  planning: Planning;
  showRetry: boolean;
  retryDisabled: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const moreId = useId();
  const badge = OP_STATE_BADGE[state];
  const { short, more } = opRowCopy({ ...op, state }, planning);
  const expandable = more.length > 0;
  // The audit job's own real checkpoints, only while that job is live.
  const showJobSteps = op.id === "audit" && planning.status === "analysing";
  // Label and short line share one line when they fit, wrapping only
  // when they don't — keeps four rows compact without truncating either.
  const text = (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-sm font-medium text-fg">{op.label}</span>
      {short && <span className="text-xs text-fg-muted">{short}</span>}
    </span>
  );
  return (
    <li>
      <div className="flex items-start justify-between gap-3">
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={moreId}
            className="-mx-1 -my-0.5 flex min-w-0 flex-1 items-start gap-1.5 rounded px-1 py-0.5 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
          >
            <span
              aria-hidden="true"
              className={`mt-px inline-block w-3 shrink-0 text-xs text-fg-subtle transition-transform duration-[var(--duration-fast)] ease-standard motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            <span className="min-w-0">{text}</span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-1.5">
            <span aria-hidden="true" className="w-3 shrink-0" />
            <span className="min-w-0">{text}</span>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {showRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retryDisabled}
              aria-label={`Retry ${op.label}`}
              className="btn btn-secondary btn-sm"
            >
              Retry
            </button>
          )}
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
      </div>
      {showJobSteps && (
        <div className="pl-[1.125rem]">
          <AnalysingProgress currentStep={planning.current_step} />
        </div>
      )}
      {expandable && (
        <div id={moreId}>
          <AnimatedHeight open={open}>
            <div className="space-y-0.5 pb-0.5 pl-[1.125rem] pt-1 text-xs text-fg-subtle">
              {more.map((line) => (
                <p key={line} className="break-words">
                  {line}
                </p>
              ))}
            </div>
          </AnimatedHeight>
        </div>
      )}
    </li>
  );
}

/** Up to three audit findings, most severe first (selectKeyFindings).
 * Hidden entirely when there are none — no filler. */
function KeyFindings({ planning, onViewAll }: { planning: Planning; onViewAll: () => void }) {
  const findings = selectKeyFindings(planning.key_points);
  if (findings.length === 0) return null;
  const total = planning.key_points.filter((p) => p.category !== "availability").length;
  return (
    <section aria-labelledby="analysis-findings-title" className="border-t border-border pt-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="analysis-findings-title" className="text-xs font-semibold text-fg">
          Key findings
          {total > findings.length && (
            <span className="ml-1.5 font-normal text-fg-subtle">
              {findings.length} of {total}
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={onViewAll}
          className="shrink-0 rounded text-xs font-medium text-fg-muted hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          View all findings →
        </button>
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {findings.map((point, i) => (
          <li key={i} className="flex items-start gap-2">
            <Badge tone={SEVERITY_TONE[point.severity] ?? SEVERITY_TONE.low} className="mt-px w-[3.75rem] shrink-0 text-center">
              {SEVERITY_LABEL[point.severity] ?? point.severity}
            </Badge>
            <span className="line-clamp-2 min-w-0 text-sm text-fg">{point.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The saved website summary as a short excerpt — display only; editing
 * stays in the existing editor under Full detail (`onEdit` opens it). */
function SummaryExcerpt({
  planning,
  editable,
  onEdit,
}: {
  planning: Planning;
  /** The existing summary editor is on the page (an audit or a plan
   * exists) — so a summary was expected, and Edit has somewhere to go. */
  editable: boolean;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const view = websiteSummaryView(planning.website_summary);
  // Nothing has run that would write one — the next action covers it.
  if (view.kind === "none" && !editable) return null;

  const linkClass =
    "rounded text-xs font-medium text-fg-muted hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";
  let body: ReactNode;
  if (view.kind === "summary") {
    const { excerpt, truncated } = summaryExcerpt(view.text);
    body = (
      <p className="break-words text-sm text-fg">
        <span id={bodyId} className="whitespace-pre-line">
          {expanded || !truncated ? view.text : excerpt}
        </span>
        {truncated && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls={bodyId}
              className={`${linkClass} whitespace-nowrap`}
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          </>
        )}
      </p>
    );
  } else if (view.kind === "fallback") {
    body = (
      <div role="note" className="text-xs text-fg-muted">
        <p className="font-medium text-fg">A summary couldn&apos;t be generated for this analysis.</p>
        {view.reason && <p className="mt-0.5 line-clamp-2 break-words">{view.reason}</p>}
      </div>
    );
  } else {
    body = <p className="text-xs text-fg-muted">No summary saved for this analysis.</p>;
  }

  return (
    <section aria-labelledby="analysis-summary-title" className="border-t border-border pt-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="analysis-summary-title" className="text-xs font-semibold text-fg">
          Website summary
        </h3>
        {editable && (
          <button type="button" onClick={onEdit} className={`${linkClass} shrink-0`}>
            {view.kind === "summary" ? "Edit summary" : "Write a summary"}
          </button>
        )}
      </div>
      <div className="mt-1">{body}</div>
    </section>
  );
}

/** The saved screenshot for this step — the same branching (and honest
 * empty states) as WebsitePreviewPanel, which this replaces on Analyse
 * business only. Never captures or fetches anything itself. */
function AnalysisPreview({ planning }: { planning: Planning }) {
  const mode = planningMode(planning);
  const hasAudit = planning.website_audit_id !== null;
  const isAnalysing = planning.status === "analysing";
  const hasScreenshot = Boolean(planning.screenshot_desktop_base64 || planning.screenshot_mobile_base64);

  if (isAnalysing && !hasAudit) return <AnalysingPreviewPanel bare />;

  let emptyStateMessage: string | undefined;
  if (mode === "new" && !hasAudit) {
    emptyStateMessage = planning.website_url
      ? "Not analysed yet — Analyse business captures a preview."
      : "No website on record — nothing to preview.";
  } else if (hasAudit && !hasScreenshot) {
    emptyStateMessage = "The last analysis couldn't capture a screenshot for this site.";
  }

  const captured = mode === "existing" && planning.analysed_at ? new Date(planning.analysed_at) : null;
  const caption = captured
    ? `Captured ${captured.toLocaleDateString()}${isAnalysing ? " · previous run" : ""}`
    : "Saved screenshot";
  // Only the audit's own load-failure finding supports calling this a
  // possible error page — never the image, and never a guessed status.
  const loadFailure = hasScreenshot ? loadFailureFinding(planning.key_points) : null;

  return (
    <div className="space-y-2">
      {/* One EvidencePanel at a stable position, so its Desktop/Mobile
          choice survives every poll-driven update. */}
      <EvidencePanel planning={planning} bare caption={caption} emptyStateMessage={emptyStateMessage} />
      {loadFailure && (
        <div role="note" className="rounded-md bg-pill-warning-bg px-3 py-2 text-xs text-pill-warning-fg">
          <p className="font-medium">The audit recorded that this site didn&apos;t load.</p>
          <p className="mt-0.5">This capture may show an error page rather than the site itself.</p>
          {loadFailure.evidence && (
            <p className="mt-1 line-clamp-2 break-words">{loadFailure.evidence}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Analyse business's one "Business analysis" widget: the header (title
 * and accurate summary), then a left column of compact status rows, key
 * findings, the saved summary and ONE next action, beside the saved
 * website preview with a single divider between them, and a compact
 * footer for the limitations worth knowing. The columns follow the
 * card's own width (`@container`), not the viewport, so they stack
 * wherever the card itself gets narrow. The left column simply grows
 * with its content — no inner scroll, nothing clipped.
 */
export function BusinessAnalysisCard({
  planning,
  ops,
  displayState,
  nextAction,
  actionHint,
  retryHandledByAction,
  notes,
  retryDisabled,
  onRetry,
  summaryEditable,
  onViewFindings,
  onEditSummary,
}: {
  planning: Planning;
  ops: ResearchOp[];
  displayState: (op: ResearchOp) => ResearchOpState;
  /** The single contextual action at the bottom of the left column. */
  nextAction: ReactNode;
  actionHint: string | null;
  /** The op whose retry IS the next action — its row skips its own
   * Retry button so the same action never appears twice. */
  retryHandledByAction: ResearchOpId | null;
  /** Footer lines — shown only when there are any. */
  notes: string[];
  retryDisabled: boolean;
  onRetry: (op: ResearchOp) => void;
  summaryEditable: boolean;
  onViewFindings: () => void;
  onEditSummary: () => void;
}) {
  const summary = summariseAnalysisStates(ops.map(displayState));

  return (
    // `id="analyse-title"` is page.tsx's "View issues" target — it
    // scrolls to this section and focuses the heading.
    <section aria-labelledby="analyse-title" className="card @container overflow-hidden">
      <div className="px-4 pt-4 sm:px-5">
        <h2 id="analyse-title" className="section-title">
          Business analysis
        </h2>
        <p className="mt-0.5 text-xs font-medium text-fg-muted" aria-live="polite">
          {summary}
        </p>
      </div>

      <div className="grid gap-4 px-4 py-4 sm:px-5 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @3xl:gap-0">
        <div className="min-w-0 space-y-2.5 @3xl:pr-5">
          <ol aria-label="Analysis steps" className="space-y-1.5">
            {ops.map((op) => {
              const state = displayState(op);
              return (
                <OpRow
                  key={op.id}
                  op={op}
                  state={state}
                  planning={planning}
                  showRetry={state === "failed" && op.id !== retryHandledByAction}
                  retryDisabled={retryDisabled}
                  onRetry={() => onRetry(op)}
                />
              );
            })}
          </ol>
          <KeyFindings planning={planning} onViewAll={onViewFindings} />
          <SummaryExcerpt planning={planning} editable={summaryEditable} onEdit={onEditSummary} />
          <div className="border-t border-border pt-2.5">
            {nextAction}
            {actionHint && <p className="mt-1.5 text-xs text-fg-muted">{actionHint}</p>}
          </div>
        </div>
        <div className="min-w-0 border-t border-border pt-4 @3xl:border-t-0 @3xl:border-l @3xl:pt-0 @3xl:pl-5">
          <h3 className="sr-only">Website preview</h3>
          <AnalysisPreview planning={planning} />
        </div>
      </div>

      {notes.length > 0 && (
        <div className="space-y-0.5 bg-surface-subtle px-4 py-2.5 text-xs text-fg-muted sm:px-5">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </section>
  );
}
