"use client";

import { useState } from "react";
import { api, ApiError, type BuildBrief, type Lead, type Planning } from "@/lib/api";
import { Disclosure } from "@/components/ui/Disclosure";
import { Badge } from "@/components/ui/Badge";
import { computeBuildBriefFacts } from "../lib";
import { AssetsChecklistSection } from "./AssetsChecklistSection";
import { RecommendationsSection } from "./RecommendationsSection";
import { SitemapProposalSection } from "./SitemapProposalSection";
import { VisualDirectionsSection } from "./VisualDirectionsSection";

type LeadBusinessFields = Pick<Lead, "industry" | "suburb" | "state" | "business_phone" | "business_email">;

/**
 * Planning's Build Brief (docs/05_DECISIONS.md) — turns Planning's
 * research into a structured, editable, explicitly-approved brief that
 * lands in the real Project tables the build pipeline reads. Built in
 * priority order: Keep/Improve/Add and the approved brief first, then
 * the proposed sitemap, visual direction choices, and assets checklist.
 * Every section is independent — generating/editing one never touches
 * another, and an operator's own edits are never silently overwritten
 * by a later regeneration (see each section's own docstring).
 */
export function BuildBriefTab({
  planning,
  lead,
  onUpdated,
}: {
  planning: Planning;
  lead: LeadBusinessFields | null;
  onUpdated: (p: Planning) => void;
}) {
  const summary = computeBuildBriefFacts(planning, lead);
  const [brief, setBrief] = useState<BuildBrief | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [approving, setApproving] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  async function loadBrief() {
    setLoadingBrief(true);
    setBriefError(null);
    try {
      setBrief(await api.getBuildBrief(planning.id));
    } catch (err) {
      setBriefError(err instanceof ApiError ? err.message : "Couldn't load the Build Brief preview.");
    } finally {
      setLoadingBrief(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setBriefError(null);
    try {
      setBrief(await api.approveBuildBrief(planning.id));
    } catch (err) {
      setBriefError(err instanceof ApiError ? err.message : "Couldn't approve the Build Brief.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Disclosure title="Keep / Improve / Add" hint="Recommendations organised by what to keep, fix, and add" defaultOpen>
        <RecommendationsSection planning={planning} onUpdated={onUpdated} />
      </Disclosure>

      <Disclosure title="Proposed Sitemap and Homepage Outline" hint="Pages and sections suggested for this website">
        <SitemapProposalSection planning={planning} onUpdated={onUpdated} />
      </Disclosure>

      <Disclosure title="Visual Direction Choices" hint="2-3 distinct starting points for a designer to refine">
        <VisualDirectionsSection planning={planning} onUpdated={onUpdated} />
      </Disclosure>

      <Disclosure title="Assets Checklist" hint="What's ready, referenced, pending approval, or missing">
        <AssetsChecklistSection planning={planning} onUpdated={onUpdated} />
      </Disclosure>

      <Disclosure title="Facts, Suggestions & Open Questions" hint="What's confirmed, what's proposed, what still needs an answer">
        <div className="space-y-4">
          {summary.confirmedFacts.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Confirmed</p>
              <ul className="mt-1 space-y-1">
                {summary.confirmedFacts.map((f, i) => (
                  <li key={i} className="text-sm text-fg">
                    {f.fact} <span className="text-xs text-fg-subtle">({f.source})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.proposedDecisions.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Proposed</p>
              <ul className="mt-1 space-y-1">
                {summary.proposedDecisions.map((d, i) => (
                  <li key={i} className="text-sm text-fg-muted">
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.openQuestions.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Open questions</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {summary.openQuestions.map((q, i) => (
                  <li key={i} className="text-sm text-fg">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.confirmedFacts.length === 0 && summary.proposedDecisions.length === 0 && summary.openQuestions.length === 0 && (
            <p className="text-xs text-fg-subtle">Nothing to show yet — generate a plan above first.</p>
          )}
        </div>
      </Disclosure>

      <Disclosure
        title="Approved Build Brief"
        hint="A compiled preview, ready to hand off to Create Project"
        defaultOpen
        badge={brief?.is_approved ? <Badge tone="success">Approved</Badge> : undefined}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={loadBrief} disabled={loadingBrief} className="btn btn-secondary btn-sm">
              {loadingBrief ? "Loading…" : "Preview brief"}
            </button>
            <button type="button" onClick={handleApprove} disabled={approving} className="btn btn-primary btn-sm">
              {approving ? "Approving…" : "Approve Build Brief"}
            </button>
          </div>
          {briefError && <p className="text-error">{briefError}</p>}
          {brief && (
            <div className="space-y-2 rounded-md border border-border bg-surface-subtle p-3 text-sm">
              <p className="text-fg">
                <span className="font-medium">Objective:</span> {brief.objective || "Not generated yet."}
              </p>
              <p className="text-fg-muted">
                {brief.confirmed_facts.length} confirmed fact(s) · {brief.accepted_recommendations.length} accepted
                recommendation(s) · {brief.sitemap.length} page(s) ·{" "}
                {brief.visual_direction ? "a visual direction selected" : "no visual direction selected yet"} ·{" "}
                {brief.assets.length} asset(s) tracked
              </p>
              {brief.open_questions.length > 0 && (
                <p className="text-amber-800 dark:text-amber-300">{brief.open_questions.length} open question(s) remain.</p>
              )}
              {brief.is_approved && (
                <p className="text-xs text-fg-subtle">
                  Approved {brief.approved_at ? new Date(brief.approved_at).toLocaleString() : ""}
                  {brief.project_id ? " — already handed off to a project." : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
