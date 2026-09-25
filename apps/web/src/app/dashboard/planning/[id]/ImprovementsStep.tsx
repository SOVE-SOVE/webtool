"use client";

import { useState } from "react";
import type { Planning } from "@/lib/api";
import { AnimatedHeight } from "@/components/ui/AnimatedHeight";
import { computeTopOpportunities, planningMode, type Opportunity } from "../lib";
import { RecommendationsDisclosure } from "./BuildBriefTab";
import { StepFooter } from "./StepFooter";

/** One opportunity, with its evidence tucked behind a per-item toggle —
 * same progressive-disclosure shape as AuditTab's own finding rows,
 * used here instead of the old Overview tab's click-to-select side
 * panel (that panel showed the matching screenshot too, which now lives
 * in Step 2 — see the report for this trade-off). */
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

/**
 * Step 3 — "Choose improvements". Evidence stays separate from
 * suggestions: the ranked, read-only "Top opportunities" (audit
 * findings + review-based opportunities/gaps, same ranking
 * `computeTopOpportunities` already used on the old Overview tab) comes
 * first as *evidence*, and the actual selection/approval workflow —
 * `RecommendationsSection`'s Keep/Improve/Add, reused unchanged via
 * `RecommendationsDisclosure` — follows as the *decision* the operator
 * makes from it. No new recommendations are generated here — this is
 * presentation only, same generation pipeline as before.
 */
export function ImprovementsStep({
  planning,
  onUpdated,
  onPrevious,
  onNext,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const showOpportunities = planningMode(planning) === "existing" && planning.website_audit_id !== null;
  const opportunities = showOpportunities ? computeTopOpportunities(planning) : [];

  return (
    <div className="content-reveal space-y-5">
      <p className="text-sm text-fg-muted">
        Decide which improvements to carry into the build brief — Keep, Improve, or Add.
      </p>

      {showOpportunities && (
        <section>
          <h2 className="section-title">Top opportunities</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Evidence from the audit and Google Review Insights, ranked — for reference while you decide below, not a
            decision by itself.
          </p>
          {planning.status === "analysing" && (
            <p className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden="true" />
              Re-analysing — the list below is from the previous run.
            </p>
          )}
          {opportunities.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">No notable opportunities identified from this analysis.</p>
          ) : (
            <ol className="mt-2 space-y-1.5">
              {opportunities.map((o, i) => (
                <OpportunityRow key={o.id} opportunity={o} index={i} />
              ))}
            </ol>
          )}
        </section>
      )}

      <RecommendationsDisclosure planning={planning} onUpdated={onUpdated} />

      <StepFooter onPrevious={onPrevious} onNext={onNext} />
    </div>
  );
}
