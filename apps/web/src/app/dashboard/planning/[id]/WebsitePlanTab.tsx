"use client";

import { useState } from "react";
import { api, ApiError, type Planning, type PlanningComparableSite } from "@/lib/api";
import { Disclosure } from "@/components/ui/Disclosure";
import { GenerateWebsitePlanAction } from "./GenerateWebsitePlanAction";

// Shown wherever comparable-site output appears — this is public
// reference research to inform planning, never a copy source and
// never a claim about traffic, rankings, or performance.
const COMPARABLE_LABEL = "Public reference research — not a copy source, not a performance claim.";

function PriorityList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-fg-subtle">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-fg">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ComparableSiteRow({
  site,
  disabled,
  onToggle,
}: {
  site: PlanningComparableSite;
  disabled: boolean;
  onToggle: (included: boolean) => void;
}) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border p-3">
      <input
        type="checkbox"
        checked={site.included}
        onChange={(e) => onToggle(e.target.checked)}
        disabled={disabled}
        className="mt-1 shrink-0"
        aria-label={`Include ${site.business_name} in comparable-site analysis`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-fg">{site.business_name}</p>
          {site.fetch_ok === false && <span className="text-xs text-fg-subtle">Couldn&apos;t be fetched</span>}
        </div>
        <a
          href={site.website_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-fg-muted hover:text-fg hover:underline"
        >
          {site.website_url}
        </a>
        <p className="mt-1 text-xs text-fg-subtle">
          {[site.business_category, site.location_text].filter(Boolean).join(" · ") || "No category/location on file"}
        </p>
        {site.source_evidence && <p className="mt-1 text-xs italic text-fg-subtle">&ldquo;{site.source_evidence}&rdquo;</p>}
      </div>
    </li>
  );
}

/**
 * New Website Plan mode's second tab — the counterpart to AuditTab.tsx
 * for a Lead with no website to audit. The recommended objective,
 * sitemap, and priorities from agents/planning_website_direction.py,
 * plus the optional "Research Comparable Websites" step: search ->
 * operator curates include/exclude -> analyse -> market patterns and
 * opportunities. Every comparable-site section carries the public-
 * reference-research label — this is context for planning, never a
 * copy source and never a performance claim.
 */
export function WebsitePlanTab({ planning, onUpdated }: { planning: Planning; onUpdated: (p: Planning) => void }) {
  const [searching, setSearching] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [comparableError, setComparableError] = useState<string | null>(null);

  if (planning.website_plan_generated_at === null) {
    return <GenerateWebsitePlanAction planning={planning} onGenerated={onUpdated} />;
  }

  const hasSites = planning.comparable_sites.length > 0;
  const includedCount = planning.comparable_sites.filter((s) => s.included).length;
  const isAnalysingComparable = planning.comparable_research_status === "analysing";
  const hasComparableOutput =
    planning.comparable_research_patterns.length > 0 || planning.comparable_research_opportunities.length > 0;

  async function handleSearch() {
    setSearching(true);
    setComparableError(null);
    try {
      onUpdated(await api.searchComparableSites(planning.id));
    } catch (err) {
      setComparableError(err instanceof ApiError ? err.message : "Couldn't search for comparable websites.");
    } finally {
      setSearching(false);
    }
  }

  async function handleToggle(siteId: string, included: boolean) {
    try {
      onUpdated(await api.updateComparableSite(planning.id, siteId, included));
    } catch {
      // The checkbox will simply reflect the last-saved state on the next poll/reload.
    }
  }

  async function handleAnalyse() {
    setAnalysing(true);
    setComparableError(null);
    try {
      onUpdated(await api.analyseComparableSites(planning.id));
    } catch (err) {
      setComparableError(err instanceof ApiError ? err.message : "Couldn't start the comparable-site analysis.");
    } finally {
      setAnalysing(false);
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <h2 className="section-title">Recommended objective</h2>
        <p className="mt-1.5 text-sm text-fg">
          {planning.recommended_objective ?? "Not generated yet — regenerate the plan below."}
        </p>
      </section>

      {planning.priority_pages.length > 0 && (
        <Disclosure title="Priority pages" hint={`${planning.priority_pages.length} page(s)`} defaultOpen>
          <ul className="space-y-2">
            {planning.priority_pages.map((p, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-fg">{p.title}</span>
                <span className="text-fg-muted"> — {p.purpose}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {(planning.content_priorities.length > 0 ||
        planning.contact_priorities.length > 0 ||
        planning.visual_priorities.length > 0) && (
        <Disclosure title="Content, contact & visual priorities" hint="What to emphasise">
          <div className="space-y-3">
            <PriorityList title="Content" items={planning.content_priorities} />
            <PriorityList title="Contact" items={planning.contact_priorities} />
            <PriorityList title="Visual" items={planning.visual_priorities} />
          </div>
        </Disclosure>
      )}

      {planning.open_questions.length > 0 && (
        <Disclosure
          title="Open questions"
          hint={`${planning.open_questions.length} to confirm`}
          badge={
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              Needs confirmation
            </span>
          }
        >
          <ul className="list-disc space-y-1.5 pl-4 text-sm text-fg">
            {planning.open_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      <GenerateWebsitePlanAction planning={planning} onGenerated={onUpdated} variant="inline" />

      <div className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="section-title">Research Comparable Websites</h2>
            <p className="mt-0.5 max-w-md text-xs text-fg-muted">{COMPARABLE_LABEL}</p>
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={searching}
            className="btn btn-secondary btn-sm shrink-0"
          >
            {searching ? "Searching…" : hasSites ? "Search again" : "Research Comparable Websites"}
          </button>
        </div>
        {comparableError && <p className="mt-2 text-error">{comparableError}</p>}

        {hasSites && (
          <div className="mt-3 space-y-3">
            <ul className="space-y-2">
              {planning.comparable_sites.map((site) => (
                <ComparableSiteRow
                  key={site.id}
                  site={site}
                  disabled={isAnalysingComparable}
                  onToggle={(included) => handleToggle(site.id, included)}
                />
              ))}
            </ul>
            <button
              type="button"
              onClick={handleAnalyse}
              disabled={analysing || isAnalysingComparable || includedCount === 0}
              className="btn btn-primary btn-sm"
            >
              {isAnalysingComparable
                ? "Analysing…"
                : analysing
                  ? "Starting…"
                  : `Analyse ${includedCount} included site${includedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {hasComparableOutput && (
          <div className="mt-4 space-y-3 rounded-md border border-border bg-surface-subtle p-3">
            <p className="text-xs font-medium text-fg-subtle">{COMPARABLE_LABEL}</p>
            {planning.comparable_research_patterns.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Market patterns</p>
                <ul className="mt-1 space-y-1.5">
                  {planning.comparable_research_patterns.map((p, i) => (
                    <li key={i} className="text-sm">
                      <span className="text-fg">{p.pattern}</span>
                      <span className="block text-xs text-fg-subtle">{p.evidence}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {planning.comparable_research_opportunities.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Opportunities for this website
                </p>
                <ul className="mt-1 space-y-1.5">
                  {planning.comparable_research_opportunities.map((o, i) => (
                    <li key={i} className="text-sm">
                      <span className="text-fg">{o.opportunity}</span>
                      <span className="block text-xs text-fg-subtle">{o.rationale}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {planning.comparable_research_status === "needs_review" && (
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            Comparable-site analysis needs a look — {planning.comparable_research_error ?? "part of it may be incomplete."}
          </p>
        )}
        {planning.comparable_research_status === "failed" && (
          <p className="mt-2 text-error">
            Comparable-site analysis failed{planning.comparable_research_error ? `: ${planning.comparable_research_error}` : "."}
          </p>
        )}
      </div>
    </div>
  );
}
