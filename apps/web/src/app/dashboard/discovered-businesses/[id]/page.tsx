"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  api,
  ApiError,
  DISCOVERED_WEBSITE_STATUS_LABEL,
  INSTAGRAM_WEBSITE_STATUS_LABEL,
  type BusinessResearchResult,
  type DiscoveredBusiness,
  type OpportunityScoreCategory,
  type OpportunityScoreResult,
  type QualityFindingSeverity,
  type ReviewIntelligenceResult,
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

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span aria-hidden className="tracking-tight text-amber-500">
      {"★".repeat(Math.max(0, Math.min(5, full)))}
      {"☆".repeat(5 - Math.max(0, Math.min(5, full)))}
    </span>
  );
}

const TREND_LABEL: Record<string, string> = {
  increasing: "Increasing",
  improving: "Improving",
  stable: "Stable",
  declining: "Declining",
  insufficient_data: "Insufficient data",
};

const ACTIVITY_LABEL: Record<string, string> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  unknown: "UNKNOWN",
};

function GoogleReviewsSection({ result }: { result: ReviewIntelligenceResult }) {
  if (result.data_status === "no_listing") {
    return (
      <div className="mt-6 max-w-2xl border border-border p-4">
        <h2 className="text-sm font-semibold text-fg">Google reviews</h2>
        <p className="mt-2 text-sm text-fg-subtle">{result.data_limitations || "No Google listing on record."}</p>
      </div>
    );
  }

  if (result.data_status === "unavailable") {
    return (
      <div className="mt-6 max-w-2xl border border-border p-4">
        <h2 className="text-sm font-semibold text-fg">Google reviews</h2>
        <p className="mt-2 text-sm text-fg-subtle">
          {result.data_limitations || "Google Places is currently unavailable."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 max-w-2xl border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">Google reviews</h2>
        <span className="text-xs text-fg-subtle">
          Updated {new Date(result.review_data_updated_at).toLocaleString()}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          {result.google_rating !== null ? (
            <div className="flex items-center gap-2">
              <Stars rating={result.google_rating} />
              <span className="text-lg font-semibold text-fg">{result.google_rating.toFixed(1)}</span>
            </div>
          ) : (
            <span className="text-sm text-fg-subtle">No rating available</span>
          )}
          <div className="text-xs text-fg-muted">
            {result.google_review_count !== null ? `${result.google_review_count} reviews` : "Review count unavailable"}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-fg-subtle">Review health</div>
          <div className="text-sm font-medium text-fg">
            {result.review_health_score !== null ? `${result.review_health_score} / 100` : "Insufficient data"}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-fg-subtle">Review activity</div>
          <div className="text-sm font-medium text-fg">
            {ACTIVITY_LABEL[result.review_activity_level]}
            {result.review_frequency_per_month !== null && (
              <span className="ml-1 font-normal text-fg-muted">~{result.review_frequency_per_month}/month</span>
            )}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-fg-subtle">Sentiment trend</div>
          <div className="text-sm font-medium text-fg">{TREND_LABEL[result.review_sentiment_trend]}</div>
        </div>
      </div>

      <div className="mt-2 text-xs text-fg-muted">
        {result.recent_review_count !== null
          ? `${result.recent_review_count} of the visible reviews are from the last 90 days`
          : "Recent activity: insufficient data"}
        {result.last_review_at && (
          <> · Most recent review {new Date(result.last_review_at).toLocaleDateString()}</>
        )}
        {result.review_volume_trend !== "insufficient_data" && (
          <> · Volume trend: {TREND_LABEL[result.review_volume_trend]}</>
        )}
      </div>

      {result.review_summary && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Review summary</h3>
          <p className="mt-1 text-sm text-fg">{result.review_summary}</p>
        </div>
      )}
      {!result.review_summary && result.review_summary_unavailable_reason && (
        <p className="mt-3 text-xs text-fg-subtle">AI summary unavailable — {result.review_summary_unavailable_reason}</p>
      )}

      {result.themes_data_sufficient ? (
        <>
          <div className="mt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Customers most often praise</h3>
            {result.positive_review_themes.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-sm text-fg">
                {result.positive_review_themes.map((t) => (
                  <li key={t.theme}>✓ {t.theme}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-fg-subtle">No recurring praise identified</p>
            )}
          </div>
          <div className="mt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Common friction</h3>
            {result.negative_review_themes.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-sm text-fg">
                {result.negative_review_themes.map((t) => (
                  <li key={t.theme}>• {t.theme}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-fg-subtle">No recurring complaints identified</p>
            )}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-fg-subtle">
          Insufficient review data to identify recurring themes ({result.reviews_with_text} review(s) with text
          available).
        </p>
      )}

      <div className="mt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Rating distribution</h3>
        <p className="mt-1 text-sm text-fg-subtle">
          {result.rating_distribution ? "Available" : "Rating distribution unavailable"}
        </p>
      </div>

      {result.review_evidence.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Evidence</h3>
          <ul className="mt-1 space-y-1.5">
            {result.review_evidence.map((e, i) => (
              <li key={i} className="text-sm text-fg-muted">
                {e.rating !== null && <span className="text-amber-500">{"★".repeat(e.rating)}</span>} &ldquo;{e.snippet}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.data_limitations && <p className="mt-3 text-xs text-fg-subtle">{result.data_limitations}</p>}
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

const LOCATION_CONFIDENCE_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  approximate: "Approximate",
  unknown: "Unknown",
};

/** Phase 1 of Instagram Discovery — shown only for a business with an
 * Instagram handle on record (see modules/discovery/instagram_import.py). */
function InstagramCard({ business }: { business: DiscoveredBusiness }) {
  return (
    <div className="mt-6 max-w-2xl border border-border p-4">
      <div className="flex items-start gap-3">
        {business.instagram_profile_image_url && (
          // eslint-disable-next-line @next/next/no-img-element -- an arbitrary external URL from imported data, not a local/optimizable asset
          <img
            src={business.instagram_profile_image_url}
            alt=""
            referrerPolicy="no-referrer"
            className="h-14 w-14 shrink-0 rounded-full border border-border object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Instagram</h2>
          <a
            href={business.instagram_profile_url ?? `https://instagram.com/${business.instagram_handle}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-fg-muted hover:underline"
          >
            @{business.instagram_handle}
          </a>
          {business.instagram_bio && <p className="mt-1 text-sm text-fg-muted">{business.instagram_bio}</p>}
        </div>
      </div>

      <div className="mt-3">
        <Fact
          label="Followers"
          value={business.instagram_follower_count !== null ? String(business.instagram_follower_count) : null}
        />
        <Fact
          label="Last post"
          value={
            business.instagram_last_post_at ? new Date(business.instagram_last_post_at).toLocaleDateString() : null
          }
        />
        <Fact
          label="Website status"
          value={
            business.instagram_website_status
              ? INSTAGRAM_WEBSITE_STATUS_LABEL[business.instagram_website_status]
              : null
          }
        />
        <Fact
          label="Location confidence"
          value={business.location_confidence ? LOCATION_CONFIDENCE_LABEL[business.location_confidence] : null}
        />
      </div>

      {business.instagram_bio_link_url && (
        <p className="mt-2 text-sm">
          <span className="text-fg-muted">Bio link: </span>
          <a href={business.instagram_bio_link_url} target="_blank" rel="noreferrer" className="hover:underline">
            {business.instagram_bio_link_url}
          </a>
        </p>
      )}
    </div>
  );
}

export default function DiscoveredBusinessDetailPage() {
  const params = useParams<{ id: string }>();
  const [business, setBusiness] = useState<DiscoveredBusiness | null>(null);
  const [research, setResearch] = useState<BusinessResearchResult[] | null>(null);
  const [audits, setAudits] = useState<WebsiteQualityAudit[] | null>(null);
  const [scores, setScores] = useState<OpportunityScoreResult[] | null>(null);
  const [reviewIntel, setReviewIntel] = useState<ReviewIntelligenceResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [analyzingReviews, setAnalyzingReviews] = useState(false);

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
    api
      .listReviewIntelligence(params.id)
      .then(setReviewIntel)
      .catch(() => setError("Couldn't load Google review data for this business."));
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

  async function handleReviewAnalysis() {
    if (!params.id) return;
    setAnalyzingReviews(true);
    setError(null);
    try {
      await api.runReviewIntelligence(params.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't analyze Google reviews for this business.");
    } finally {
      setAnalyzingReviews(false);
    }
  }

  const latest = research && research.length > 0 ? research[0] : null;
  const latestAudit = audits && audits.length > 0 ? audits[0] : null;
  const latestScore = scores && scores.length > 0 ? scores[0] : null;
  const latestReviewIntel = reviewIntel && reviewIntel.length > 0 ? reviewIntel[0] : null;

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
              <p className="text-sm text-fg-subtle">{DISCOVERED_WEBSITE_STATUS_LABEL[business.website_status]}</p>
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
              <button
                onClick={handleReviewAnalysis}
                disabled={analyzingReviews}
                className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-surface-subtle disabled:opacity-50"
              >
                {analyzingReviews ? "Analyzing…" : latestReviewIntel ? "Refresh reviews" : "Analyze Google reviews"}
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

      {business?.instagram_handle && <InstagramCard business={business} />}

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

      {latestReviewIntel && <GoogleReviewsSection result={latestReviewIntel} />}

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
