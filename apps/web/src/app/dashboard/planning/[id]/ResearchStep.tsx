"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, type Lead, type Planning } from "@/lib/api";
import { AnimatedHeight } from "@/components/ui/AnimatedHeight";
import { AutoSaveTextarea } from "@/components/ui/AutoSaveTextarea";
import { Badge } from "@/components/ui/Badge";
import { Disclosure } from "@/components/ui/Disclosure";
import {
  ROW_STATE_DOT,
  ROW_STATE_LABEL,
  computeBuildBriefFacts,
  computeBusinessInputRows,
  computeTopOpportunities,
  planningMode,
  type Opportunity,
} from "../lib";
import { AnalyseWebsiteAction } from "./AnalyseWebsiteAction";
import { chooseNextAction } from "./analysisSummary";
import { AuditTab } from "./AuditTab";
import { BusinessAnalysisCard } from "./BusinessAnalysisCard";
import type { ResearchOp, ResearchOpState } from "./researchRun";
import { ReviewInsightsTab } from "./ReviewInsightsTab";
import { StepFooter } from "./StepFooter";
import { useResearchRunner } from "./useResearchRunner";
import { WebsitePlanTab } from "./WebsitePlanTab";

type LeadResearchFields = Pick<Lead, "industry" | "suburb" | "state" | "business_phone" | "business_email">;

const BUSINESS_ROW_KEYS = ["business_details", "location", "contact"] as const;

/** How many items each summary group shows before "Show all". */
const SUMMARY_LIMIT = 4;

function businessBadge(lead: LeadResearchFields | null, confirmed: number, total: number) {
  // A failed lead fetch is swallowed upstream (page.tsx), so `null` can't
  // be told apart from "still loading" — said as exactly that.
  if (lead === null) return <Badge>Not loaded</Badge>;
  if (confirmed === total) return <Badge tone="success">On file</Badge>;
  return <Badge tone={confirmed === 0 ? "muted" : "warning"}>{`${confirmed} of ${total} on file`}</Badge>;
}

/** One opportunity, with its evidence tucked behind a per-item toggle —
 * same progressive-disclosure shape as AuditTab's own finding rows. */
function OpportunityRow({ opportunity, index }: { opportunity: Opportunity; index: number }) {
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <li className="rounded-md border border-border p-2.5 text-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-px shrink-0 text-xs font-semibold text-fg-subtle">{index + 1}</span>
        <span className="text-fg">{opportunity.text}</span>
      </div>
      <button
        type="button"
        onClick={() => setShowEvidence((v) => !v)}
        aria-expanded={showEvidence}
        className="mt-1.5 flex items-center gap-1 pl-5 text-xs text-fg-muted hover:text-fg hover:underline"
      >
        <span
          aria-hidden="true"
          className={`inline-block transition-transform duration-[var(--duration-fast)] ease-standard motion-reduce:transition-none ${showEvidence ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        {showEvidence ? "Hide evidence" : "Show evidence"}
      </button>
      <AnimatedHeight open={showEvidence}>
        <p className="mt-1 pl-5 text-xs text-fg-subtle">{opportunity.basis}</p>
      </AnimatedHeight>
    </li>
  );
}

/** A labelled group in the summary card. The coloured dot is a
 * secondary cue only — the heading and tag say the same in words. */
function SummaryGroup({
  id,
  title,
  tag,
  children,
}: {
  id: string;
  title: string;
  tag: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="py-3 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4"
    >
      <div>
        <h3 id={id} className="section-title">
          {title}
        </h3>
        <div className="mt-1">{tag}</div>
      </div>
      <div className="mt-2 min-w-0 sm:mt-0">{children}</div>
    </section>
  );
}

function SummaryItem({ dot, children, note }: { dot: string; children: ReactNode; note?: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className="text-fg">{children}</span>
        {note && <span className="ml-1.5 text-xs text-fg-subtle">{note}</span>}
      </span>
    </li>
  );
}

/** A short list that shows the first few items, with an in-place
 * "Show all" for the rest — keeps each group scannable. */
function ClampedList({ items }: { items: ReactNode[] }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = items.length - SUMMARY_LIMIT;
  return (
    <>
      <ul className="space-y-1.5">{expanded ? items : items.slice(0, SUMMARY_LIMIT)}</ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1.5 text-xs font-medium text-fg-muted hover:text-fg hover:underline"
        >
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
    </>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-sm text-fg-muted">{children}</p>;
}

/**
 * Step 1 — "Analyse business" (id stays "research"). One primary action
 * runs whatever research is still missing (useResearchRunner), with an
 * honest per-operation progress list beside the saved website preview
 * (BusinessAnalysisCard — page.tsx hides its own preview column on this
 * step so it isn't shown twice). Below it, a short summary split
 * into three visibly different kinds of thing — confirmed facts,
 * suggestions, and what still needs the operator — and then the full
 * evidence behind collapsed Disclosures. Nothing is accepted or
 * dismissed here; decisions happen in "Choose your website".
 */
export function ResearchStep({
  planning,
  lead,
  onUpdated,
  onNext,
}: {
  planning: Planning;
  lead: LeadResearchFields | null;
  onUpdated: (p: Planning) => void;
  onNext: () => void;
}) {
  const { ops, progress, active, busyOp, start, retry } = useResearchRunner(planning, onUpdated);

  const hasAudit = planning.website_audit_id !== null;
  const mode = planningMode(planning);
  const isAnalysing = planning.status === "analysing";

  const businessRows = computeBusinessInputRows(planning, lead).filter((r) =>
    (BUSINESS_ROW_KEYS as readonly string[]).includes(r.key),
  );
  const confirmedCount = businessRows.filter((r) => r.state === "good").length;
  const opportunities = mode === "existing" ? computeTopOpportunities(planning) : [];
  const { confirmedFacts, openQuestions } = computeBuildBriefFacts(planning, lead);
  // The open questions already ask for a missing phone/email — don't list
  // the contact row a second time in the same group.
  const contactAlreadyAsked = openQuestions.some((q) => /phone or email/i.test(q));
  const missingRows =
    lead === null
      ? []
      : businessRows.filter((r) => r.state !== "good" && !(r.key === "contact" && contactAlreadyAsked));

  // Suggestions: ranked audit/review opportunities first, then Improve/Add
  // recommendations not already dismissed — de-duplicated by wording.
  const suggestions: { key: string; text: string; note: string }[] = [];
  const seen = new Set<string>();
  const addSuggestion = (key: string, text: string, note: string) => {
    const norm = text.trim().toLowerCase();
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    suggestions.push({ key, text, note });
  };
  for (const o of opportunities) addSuggestion(o.id, o.text, o.source === "audit" ? "Website audit" : "Google reviews");
  for (const r of planning.recommendations) {
    if (r.category === "keep" || r.status === "dismissed") continue;
    addSuggestion(r.id, r.title, r.category === "improve" ? "Improve" : "Add");
  }

  const displayState = (op: ResearchOp): ResearchOpState => (busyOp === op.id ? "running" : op.state);
  const nothingRunYet = ops.every((op) => op.state === "needed" || op.state === "waiting");
  const working = active || progress.running;
  const websiteSummary = planning.website_summary?.trim() ?? "";

  async function handleSaveSummary(value: string) {
    onUpdated(await api.updatePlanning(planning.id, { website_summary: value }));
  }

  // --- Next action ---------------------------------------------------------
  // ONE contextual action at the bottom of Business analysis's left column
  // (chooseNextAction) — the card header no longer repeats it. "Continue to
  // website plan" is navigation only: it calls the same `onNext` as the
  // step footer, which only changes the active step (StepFooter.tsx).
  const next = chooseNextAction(ops, progress, working);
  let nextAction: ReactNode;
  let actionHint: string | null = null;
  switch (next.kind) {
    case "running":
      nextAction = (
        <button type="button" disabled className="btn btn-primary">
          Analysing…
        </button>
      );
      actionHint = "Working through each step in order — this page updates as each one finishes.";
      break;
    case "start":
      nextAction = (
        <button type="button" onClick={start} className="btn btn-primary">
          {next.label}
        </button>
      );
      actionHint =
        next.label === "Analyse business"
          ? "Runs each step in order. Anything already done is reused, never repeated."
          : "Picks up where the analysis left off, reusing everything already done.";
      break;
    case "retry":
      nextAction = (
        <button type="button" onClick={() => retry(next.opId)} disabled={working} className="btn btn-primary">
          {next.label}
        </button>
      );
      actionHint = "This step didn't finish — retry it to carry on.";
      break;
    case "continue":
      nextAction = (
        <button type="button" onClick={onNext} className="btn btn-primary">
          {next.label} →
        </button>
      );
      break;
  }
  const cardNotes = ops.some((op) => op.id === "reviews")
    ? ["Google reviews are optional — planning can continue without them."]
    : [];

  // "View all findings" / "Edit summary" open the existing Full detail
  // section (Website audit / Website plan) rather than repeating it — the
  // Disclosure keeps its own open state, so it's opened via its own
  // toggle, then scrolled clear of the sticky header (same offset rule as
  // page.tsx's "View issues") and focused.
  const siteDetailRef = useRef<HTMLDivElement>(null);
  function openSiteDetail(focus: "section" | "summary") {
    const wrap = siteDetailRef.current;
    const toggle = wrap?.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (!wrap || !toggle) return;
    if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    // This runs inside the calling button's own click handler, so the
    // open state above is batched until it returns — a macrotask later
    // the editor inside is mounted and laid out.
    setTimeout(() => {
      const header = document.querySelector<HTMLElement>("header.sticky");
      const offset = header ? header.getBoundingClientRect().bottom + 12 : 0;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({
        top: wrap.getBoundingClientRect().top + window.scrollY - offset,
        behavior: reduced ? "auto" : "smooth",
      });
      const target = focus === "summary" ? wrap.querySelector<HTMLTextAreaElement>("textarea") : null;
      (target ?? toggle).focus({ preventScroll: true });
    }, 0);
  }
  // The summary editor below exists only once an audit or plan does.
  const summaryEditable = !(isAnalysing && !hasAudit) && (hasAudit || planning.website_plan_generated_at !== null);

  // --- Website audit / plan content -------------------------------------
  let currentSiteContent;
  if (isAnalysing && !hasAudit) {
    // Live progress and the capture placeholder are in Business analysis
    // above — not repeated in here.
    currentSiteContent = (
      <EmptyLine>Analysing the website — findings appear here once the audit finishes.</EmptyLine>
    );
  } else if (mode === "new") {
    const analyseInstead = !planning.website_url && !working && (
      <div className="rounded-md border border-dashed border-border p-3">
        <p className="text-xs font-medium text-fg">Have a website? Analyse it instead.</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          Enter its address to audit the current site rather than plan from scratch.
        </p>
        <div className="mt-2">
          <AnalyseWebsiteAction planning={planning} onAnalysed={onUpdated} variant="inline" />
        </div>
      </div>
    );
    if (planning.website_plan_generated_at === null) {
      currentSiteContent = (
        <div className="space-y-3">
          <EmptyLine>
            {planning.website_url
              ? "Not analysed yet — Analyse business runs the website audit."
              : "No website on record — Analyse business builds a new-website plan instead of an audit."}
          </EmptyLine>
          {analyseInstead}
        </div>
      );
    } else {
      currentSiteContent = (
        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-fg">Website summary</h3>
            <p className="mt-0.5 text-xs text-fg-muted">A neutral, editable summary of the plan.</p>
            {/* Free-text prose reads better at a narrower measure than the
                full step column — a local constraint on just this block. */}
            <div className="mt-1.5 max-w-2xl">
              <AutoSaveTextarea
                key={planning.id + (planning.website_plan_generated_at ?? "")}
                defaultValue={planning.website_summary ?? ""}
                onSave={handleSaveSummary}
                rows={4}
              />
            </div>
          </section>
          <WebsitePlanTab planning={planning} lead={lead} onUpdated={onUpdated} />
          {analyseInstead}
        </div>
      );
    }
  } else {
    currentSiteContent = (
      <div className="space-y-5">
        {isAnalysing && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs text-fg-muted">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden="true" />
            Re-analysing — the results below are from the previous run.
          </div>
        )}
        <section>
          <h3 className="text-sm font-semibold text-fg">Website summary</h3>
          <p className="mt-0.5 text-xs text-fg-muted">A neutral, editable summary of the current site.</p>
          {/* Same local width constraint as the New Website Plan mode's
              summary above. */}
          <div className="mt-1.5 max-w-2xl">
            <AutoSaveTextarea
              key={planning.id + (planning.analysed_at ?? "")}
              defaultValue={planning.website_summary ?? ""}
              onSave={handleSaveSummary}
              rows={4}
            />
          </div>
        </section>
        <AuditTab planning={planning} />
      </div>
    );
  }

  const leadHref = `/dashboard/leads/${planning.lead_id}`;

  return (
    <div className="content-reveal space-y-4">
      {/* Primary action, honest progress and the saved website preview */}
      <BusinessAnalysisCard
        planning={planning}
        ops={ops}
        displayState={displayState}
        nextAction={nextAction}
        actionHint={actionHint}
        retryHandledByAction={next.kind === "retry" ? next.opId : null}
        notes={cardNotes}
        retryDisabled={working}
        onRetry={(op) => retry(op.id)}
        summaryEditable={summaryEditable}
        onViewFindings={() => openSiteDetail("section")}
        onEditSummary={() => openSiteDetail("summary")}
      />

      {/* Summary: facts, suggestions and open questions kept visibly apart */}
      <section aria-labelledby="summary-title" className="card p-4">
        <h2 id="summary-title" className="sr-only">
          Summary
        </h2>
        <div className="divide-y divide-border">
          <SummaryGroup id="summary-known" title="What we know" tag={<Badge tone="success">Confirmed</Badge>}>
            {confirmedFacts.length === 0 && !websiteSummary ? (
              <EmptyLine>
                {lead === null
                  ? "The lead record hasn't loaded."
                  : "Nothing confirmed yet — add details on the lead record, or run Analyse business."}
              </EmptyLine>
            ) : (
              <>
                {confirmedFacts.length > 0 && (
                  <ClampedList
                    items={confirmedFacts.map((f) => (
                      <SummaryItem key={f.fact} dot={ROW_STATE_DOT.good} note={f.source}>
                        {f.fact}
                      </SummaryItem>
                    ))}
                  />
                )}
                {websiteSummary && (
                  <div className={confirmedFacts.length > 0 ? "mt-3" : ""}>
                    <p className="text-xs font-medium text-fg-muted">
                      Website summary{" "}
                      <span className="font-normal text-fg-subtle">
                        · {mode === "existing" ? "Website audit" : "Website plan"}
                      </span>
                    </p>
                    <p className="mt-0.5 line-clamp-3 max-w-2xl text-sm text-fg">{websiteSummary}</p>
                  </div>
                )}
              </>
            )}
          </SummaryGroup>

          <SummaryGroup id="summary-improve" title="What could improve" tag={<Badge tone="info">Suggestions</Badge>}>
            {suggestions.length === 0 ? (
              <EmptyLine>
                {nothingRunYet ? "Run Analyse business to fill this in." : "No suggestions from the analysis so far."}
              </EmptyLine>
            ) : (
              <>
                <ClampedList
                  items={suggestions.map((s) => (
                    <SummaryItem key={s.key} dot="bg-accent" note={s.note}>
                      {s.text}
                    </SummaryItem>
                  ))}
                />
                <p className="mt-2 text-xs text-fg-subtle">
                  Suggestions, not decisions — you decide what to include in the next step, Choose your website.
                </p>
              </>
            )}
          </SummaryGroup>

          <SummaryGroup
            id="summary-confirm"
            title="Needs your confirmation"
            tag={
              missingRows.length + openQuestions.length > 0 ? (
                <Badge tone="warning">{`${missingRows.length + openQuestions.length} to check`}</Badge>
              ) : (
                <Badge>Nothing open</Badge>
              )
            }
          >
            {missingRows.length === 0 && openQuestions.length === 0 ? (
              <EmptyLine>Nothing needs confirming right now.</EmptyLine>
            ) : (
              <>
                <ClampedList
                  items={[
                    ...missingRows.map((row) => (
                      <SummaryItem key={row.key} dot={ROW_STATE_DOT.review} note="Lead record">
                        {`${row.label} not on file`}
                      </SummaryItem>
                    )),
                    ...openQuestions.map((q) => (
                      <SummaryItem key={q} dot={ROW_STATE_DOT.review}>
                        {q}
                      </SummaryItem>
                    )),
                  ]}
                />
                <Link
                  href={leadHref}
                  className="mt-2 inline-block text-xs font-medium text-fg-muted hover:text-fg hover:underline"
                >
                  Edit business details on the lead record →
                </Link>
              </>
            )}
          </SummaryGroup>
        </div>
      </section>

      {/* Full detail — collapsed, so the summary above reads first. */}
      <div className="space-y-2">
        <h2 className="section-title">Full detail</h2>

        <Disclosure
          title="Business details"
          hint="Industry, location and contact on the lead record"
          badge={businessBadge(lead, confirmedCount, businessRows.length)}
        >
          <p className="text-xs text-fg-muted">
            A row marked &ldquo;{ROW_STATE_LABEL.not_checked}&rdquo; means it genuinely hasn&apos;t been confirmed yet,
            not that the answer is &ldquo;no&rdquo;.
          </p>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {businessRows.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm text-fg">{row.label}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${ROW_STATE_DOT[row.state]}`} aria-hidden="true" />
                  {ROW_STATE_LABEL[row.state]}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href={leadHref}
            className="mt-2 inline-block text-xs font-medium text-fg-muted hover:text-fg hover:underline"
          >
            Edit business details on the lead record →
          </Link>
          <p className="mt-3 text-xs text-fg-subtle">
            Services, target audience, and goals aren&apos;t captured as their own fields yet — use Notes (reachable
            from every step) to record anything about them worth keeping.
          </p>
        </Disclosure>

        <div ref={siteDetailRef}>
          <Disclosure
            title={mode === "existing" ? "Website audit" : "Website plan"}
            hint={
              mode === "existing"
                ? "Editable summary and evidence-backed findings"
                : "Editable summary and the new-website plan"
            }
          >
            {currentSiteContent}
          </Disclosure>
        </div>

        {opportunities.length > 0 && (
          <Disclosure title="Top opportunities" hint="Ranked evidence from the audit and Google Review Insights">
            <p className="text-xs text-fg-muted">For reference when you plan — not a decision by itself.</p>
            <ol className="mt-2 space-y-1.5">
              {opportunities.map((o, i) => (
                <OpportunityRow key={o.id} opportunity={o} index={i} />
              ))}
            </ol>
          </Disclosure>
        )}

        <Disclosure
          title="Google Review Insights"
          hint="Optional — reputation, themes and website opportunities from Google reviews"
        >
          <ReviewInsightsTab planning={planning} onUpdated={onUpdated} />
        </Disclosure>
      </div>

      <StepFooter onPrevious={null} onNext={onNext} nextLabel="Continue to choose your website" />
    </div>
  );
}
