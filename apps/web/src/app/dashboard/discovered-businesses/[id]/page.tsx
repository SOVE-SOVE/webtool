"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  api,
  ApiError,
  type BusinessResearchResult,
  type DiscoveredBusiness,
  type OpportunityScoreCategory,
  type OpportunityScoreResult,
  type QualityFindingSeverity,
  type WebsiteQualityAudit,
} from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";

const SEVERITY_STYLE: Record<QualityFindingSeverity, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  low: "bg-surface-subtle text-fg-muted",
};

const CATEGORY_STYLE: Record<OpportunityScoreCategory, string> = {
  hot: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  warm: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  cold: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  review: "bg-surface-hover text-fg-muted",
};

function Fact({ label, value }: { label: string; value: string | boolean | null }) {
  return (
    <div className="flex justify-between border-b border-border py-1.5 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="text-fg">
        {value === null ? "Unknown" : typeof value === "boolean" ? (value ? "Yes" : "No") : value}
      </span>
    </div>
  );
}

function ListSection({ title, items, tone }: { title: string; items: string[]; tone: "confirmed" | "inferred" | "unavailable" }) {
  if (items.length === 0) return null;
  const toneClass =
    tone === "confirmed" ? "text-fg-muted" : tone === "inferred" ? "text-amber-700 dark:text-amber-400" : "text-fg-subtle";
  return (
    <div className="mt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
      <ul className={`mt-1 list-inside list-disc space-y-0.5 text-sm ${toneClass}`}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function DiscoveredBusinessDetailPage() {
  const params = useParams<{ id: string }>();
  const [business, setBusiness] = useState<DiscoveredBusiness | null>(null);
  const [research, setResearch] = useState<BusinessResearchResult[] | null>(null);
  const [audits, setAudits] = useState<WebsiteQualityAudit[] | null>(null);
  const [scores, setScores] = useState<OpportunityScoreResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [scoring, setScoring] = useState(false);

  function load() {
    if (!params.id) return;
    api
      .getDiscoveredBusiness(params.id)
      .then((b) => {
        setError(null);
        setBusiness(b);
      })
      .catch(() => setError("Couldn't load this business."));
    api
      .listBusinessResearch(params.id)
      .then(setResearch)
      .catch(() => setError("Couldn't load research for this business."));
    api
      .listQualityAudits(params.id)
      .then(setAudits)
      .catch(() => setError("Couldn't load quality audits for this business."));
    api
      .listOpportunityScores(params.id)
      .then(setScores)
      .catch(() => setError("Couldn't load opportunity scores for this business."));
  }

  useEffect(load, [params.id]);

  async function handleResearch() {
    if (!params.id) return;
    setResearching(true);
    setError(null);
    try {
      await api.runBusinessResearch(params.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't research this business.");
    } finally {
      setResearching(false);
    }
  }

  async function handleAudit() {
    if (!params.id) return;
    setAuditing(true);
    setError(null);
    try {
      await api.runQualityAudit(params.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't audit this business.");
    } finally {
      setAuditing(false);
    }
  }

  async function handleScore() {
    if (!params.id) return;
    setScoring(true);
    setError(null);
    try {
      await api.runOpportunityScore(params.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't score this business.");
    } finally {
      setScoring(false);
    }
  }

  const latest = research && research.length > 0 ? research[0] : null;
  const latestAudit = audits && audits.length > 0 ? audits[0] : null;
  const latestScore = scores && scores.length > 0 ? scores[0] : null;

  return (
    <div className="p-6">
      {business && (
        <Link href={`/dashboard/discovery/${business.discovery_search_id}`} className="text-sm text-fg-muted hover:underline">
          &larr; Back to search results
        </Link>
      )}

      {business && (
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">{business.name}</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {[business.industry, [business.suburb, business.state].filter(Boolean).join(", ")]
                .filter(Boolean)
                .join(" · ") || "No details on record"}
            </p>
            {business.website_url ? (
              <a
                href={business.website_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-fg-muted hover:underline"
              >
                {business.website_url}
              </a>
            ) : (
              <p className="text-sm text-fg-subtle">No website on record</p>
            )}
          </div>
          <div className="text-right">
            <span className="inline-block rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-fg-muted">
              {business.status}
            </span>
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleResearch}
                disabled={researching}
                className="btn btn-primary"
              >
                {researching ? "Researching…" : latest ? "Research again" : "Run research"}
              </button>
              <button
                onClick={handleAudit}
                disabled={auditing || !latest}
                title={!latest ? "Run research first" : undefined}
                className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-surface-subtle disabled:opacity-50"
              >
                {auditing ? "Auditing…" : "Audit quality"}
              </button>
              <button
                onClick={handleScore}
                disabled={scoring || !latest}
                title={!latest ? "Run research first" : undefined}
                className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-surface-subtle disabled:opacity-50"
              >
                {scoring ? "Scoring…" : "Score opportunity"}
              </button>
            </div>
            {latestScore && (
              <div className="mt-2">
                <span
                  className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${CATEGORY_STYLE[latestScore.category]}`}
                >
                  {latestScore.category} · {latestScore.overall_score}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {research && research.length === 0 && !error && (
        <div className="mt-6 rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
          No research yet for this business.
        </div>
      )}

      {latest && (
        <div className="mt-6 max-w-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Website research</h2>
            <span className="text-xs text-fg-subtle">
              {new Date(latest.researched_at).toLocaleString()}
            </span>
          </div>

          {latest.research_error ? (
            <p className="mt-2 text-error">Could not load website: {latest.research_error}</p>
          ) : (
            <div className="mt-2">
              <Fact label="Reachable" value={latest.website_reachable} />
              <Fact label="HTTPS" value={latest.https} />
              <Fact label="Page title" value={latest.page_title} />
              <Fact label="Mobile viewport tag" value={latest.mobile_viewport_present} />
              <Fact label="Contact path found" value={latest.contact_cta_present} />
              <Fact label="Estimated age" value={latest.estimated_site_age} />
              <Fact label="Appears template/placeholder" value={latest.appears_template_or_placeholder} />
            </div>
          )}

          <ListSection title="Confirmed" items={latest.confirmed_facts} tone="confirmed" />
          <ListSection title="Inferred" items={latest.inferred_facts} tone="inferred" />
          <ListSection title="Technical issues" items={latest.technical_issues} tone="inferred" />
          <ListSection title="Social presence" items={latest.social_presence} tone="confirmed" />
          <ListSection title="Unavailable" items={latest.unavailable_fields} tone="unavailable" />
        </div>
      )}

      {latestAudit && (
        <div className="mt-6 max-w-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Website quality audit</h2>
            <span className="text-xs text-fg-subtle">{new Date(latestAudit.audited_at).toLocaleString()}</span>
          </div>
          <p className="mt-2 text-sm text-fg-muted">{latestAudit.summary}</p>

          {latestAudit.findings.length > 0 && (
            <ul className="mt-3 space-y-2">
              {latestAudit.findings.map((finding, i) => (
                <li key={i} className="border border-border p-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[finding.severity]}`}
                    >
                      {finding.severity}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-fg-subtle">{finding.category}</span>
                    <span className="ml-auto text-xs text-fg-subtle">
                      {Math.round(finding.confidence * 100)}% confidence
                    </span>
                  </div>
                  <p className="mt-1 text-fg">{finding.message}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">Evidence: {finding.evidence}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {latestScore && (
        <div className="mt-6 max-w-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Opportunity score</h2>
            <span className="text-xs text-fg-subtle">{new Date(latestScore.scored_at).toLocaleString()}</span>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold uppercase ${CATEGORY_STYLE[latestScore.category]}`}
            >
              {latestScore.category}
            </span>
            <span className="text-2xl font-semibold text-fg">{latestScore.overall_score}</span>
            <span className="text-xs text-fg-muted">
              {Math.round(latestScore.confidence * 100)}% confidence
            </span>
          </div>

          <p className="mt-2 text-sm text-fg-muted">{latestScore.recommendation_reason}</p>

          <ListSection title="Positive signals" items={latestScore.positive_signals} tone="confirmed" />
          <ListSection title="Negative signals" items={latestScore.negative_signals} tone="inferred" />

          {latestScore.factors.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Score breakdown</h3>
              <ul className="mt-1 space-y-1">
                {latestScore.factors.map((factor, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span className="text-fg-muted">{factor.explanation}</span>
                    <span className="ml-2 shrink-0 text-fg-muted">+{factor.points}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
