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
 * The "Keep / Improve / Add" Disclosure — split out of BuildBriefTab so
 * the Planning workspace's "Choose improvements" step can show the same
 * editor (same data, same accept/dismiss/edit controls) without a
 * second copy of this wrapper, while BuildBriefTab itself still renders
 * it inline for `showRecommendations` callers.
 */
export function RecommendationsDisclosure({
  planning,
  onUpdated,
  defaultOpen = true,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  defaultOpen?: boolean;
}) {
  return (
    <Disclosure title="Keep / Improve / Add" hint="Recommendations organised by what to keep, fix, and add" defaultOpen={defaultOpen}>
      <RecommendationsSection planning={planning} onUpdated={onUpdated} />
    </Disclosure>
  );
}

/**
 * Planning's Build Brief (docs/05_DECISIONS.md) — turns Planning's
 * research into a structured, editable, explicitly-approved brief that
 * lands in the real Project tables the build pipeline reads. Built in
 * priority order: Keep/Improve/Add and the approved brief first, then
 * the proposed sitemap, visual direction choices, and assets checklist.
 * Every section is independent — generating/editing one never touches
 * another, and an operator's own edits are never silently overwritten
 * by a later regeneration (see each section's own docstring).
 *
 * `showRecommendations` (default true) hides the "Keep / Improve / Add"
 * Disclosure — the Planning workspace's "Prepare the website" step
 * passes `false` because "Choose improvements" (an earlier step) already
 * shows `RecommendationsDisclosure` itself; nothing else about this
 * component changes.
 */
export function BuildBriefTab({
  planning,
  lead,
  onUpdated,
  showRecommendations = true,
}: {
  planning: Planning;
  lead: LeadBusinessFields | null;
  onUpdated: (p: Planning) => void;
  showRecommendations?: boolean;
}) {
  const summary = computeBuildBriefFacts(planning, lead);
  // Once a project exists, approving again pushes what changed to it (the
  // project's own edits are kept and flagged, never overwritten).
  const handedOff = planning.project_id !== null;
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
      {showRecommendations && <RecommendationsDisclosure planning={planning} onUpdated={onUpdated} />}

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
              {approving
                ? handedOff
                  ? "Syncing…"
                  : "Approving…"
                : handedOff
                  ? "Re-approve & sync to project"
                  : "Approve Build Brief"}
            </button>
          </div>
          {handedOff && (
            <p className="text-xs text-fg-muted">
              This brief has been handed off to a project. Re-approving pushes your Planning changes to it — anything
              the project has edited itself is kept and listed here instead.
            </p>
          )}
          {briefError && <p className="text-error">{briefError}</p>}
          {brief && brief.sync_conflicts.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="font-medium text-amber-900 dark:text-amber-300">
                {brief.sync_conflicts.length} Planning change{brief.sync_conflicts.length === 1 ? " wasn't" : "s weren't"}{" "}
                applied to the project
              </p>
              <ul className="mt-2 space-y-2">
                {brief.sync_conflicts.map((c, i) => (
                  <li key={`${c.area}-${c.item}-${i}`} className="text-amber-900 dark:text-amber-300">
                    <span className="font-medium">
                      {c.area} — {c.item}.
                    </span>{" "}
                    {c.message}
                    <span className="mt-0.5 block text-xs">
                      Planning: {c.planning_value || "—"} · Project: {c.project_value || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
