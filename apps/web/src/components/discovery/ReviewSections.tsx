"use client";

import type { ReactNode } from "react";
import {
  DISCOVERED_WEBSITE_STATUS_LABEL,
  INSTAGRAM_CHECK_STATE_LABEL,
  instagramCheckDisplayState,
  type BusinessResearchResult,
  type DiscoveredBusiness,
  type OpportunityScoreResult,
  type ReviewIntelligenceResult,
  type WebsiteQualityAudit,
} from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { ScoreCategoryBadge } from "@/components/ReviewStatusBadge";
import { timeAgo } from "@/lib/format";
import { SEVERITY_TONE, sortFindings } from "@/lib/reviewBrief";

export function Fact({ label, value }: { label: string; value: string | boolean | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 text-sm">
      <span className="shrink-0 text-fg-muted">{label}</span>
      {/* min-w-0 + overflow-wrap:anywhere so a long unbroken value (a website
          URL) wraps inside the card instead of widening the whole page. */}
      <span className="min-w-0 text-right text-fg [overflow-wrap:anywhere]">
        {value === null ? "Unknown" : typeof value === "boolean" ? (value ? "Yes" : "No") : value}
      </span>
    </div>
  );
}

export function Stars({ rating }: { rating: number }) {
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

export function GoogleReviewsSection({ result }: { result: ReviewIntelligenceResult }) {
  if (result.data_status === "no_listing") {
    return <p className="text-sm text-fg-subtle">{result.data_limitations || "No Google listing on record."}</p>;
  }

  if (result.data_status === "unavailable") {
    return (
      <p className="text-sm text-fg-subtle">
        {result.data_limitations || "Google Places is currently unavailable."}
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
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
        {result.last_review_at && <> · Most recent review {new Date(result.last_review_at).toLocaleDateString()}</>}
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

      {result.review_evidence.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Evidence excerpts</h3>
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

export function ListSection({ title, items, tone }: { title: string; items: string[]; tone: "confirmed" | "inferred" | "unavailable" }) {
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

/** Shown for any business with an Instagram handle on record — from
 * either instagram_import (Phase 1, manual CSV) or instagram_search
 * (Phase 2, automated site:instagram.com search). */
export function InstagramSection({
  business,
  onCheckWebsite,
  checking,
}: {
  business: DiscoveredBusiness;
  onCheckWebsite: () => void;
  checking: boolean;
}) {
  const igState = instagramCheckDisplayState(business);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
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
            <a
              href={business.instagram_profile_url ?? `https://instagram.com/${business.instagram_handle}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-fg hover:underline"
            >
              @{business.instagram_handle}
            </a>
            {business.instagram_bio && <p className="mt-1 text-sm text-fg-muted">{business.instagram_bio}</p>}
          </div>
        </div>
        {igState && igState !== "website_found" && (
          <button onClick={onCheckWebsite} disabled={checking} className="btn btn-secondary btn-sm shrink-0">
            {checking ? "Checking…" : igState === "check_pending" ? "Check now" : "Check for website"}
          </button>
        )}
      </div>

      <div className="mt-3">
        <Fact
          label="Followers"
          value={business.instagram_follower_count !== null ? String(business.instagram_follower_count) : null}
        />
        <Fact
          label="Last post"
          value={business.instagram_last_post_at ? new Date(business.instagram_last_post_at).toLocaleDateString() : null}
        />
        {igState === "website_found" && business.website_url ? (
          <div className="flex justify-between border-b border-border py-1.5 text-sm">
            <span className="text-fg-muted">Website status</span>
            <a href={business.website_url} target="_blank" rel="noreferrer" className="text-fg hover:underline">
              {business.website_url}
            </a>
          </div>
        ) : (
          <Fact label="Website status" value={igState ? INSTAGRAM_CHECK_STATE_LABEL[igState] : null} />
        )}
        <Fact
          label="Location confidence"
          value={business.location_confidence ? LOCATION_CONFIDENCE_LABEL[business.location_confidence] : null}
        />
        <Fact
          label="Website last checked"
          value={
            business.instagram_website_checked_at
              ? new Date(business.instagram_website_checked_at).toLocaleString()
              : "Never checked"
          }
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

      {business.raw_snippet && (
        <p className="mt-3 border-t border-border pt-2 text-xs text-fg-subtle">
          <span className="font-medium text-fg-muted">Source evidence: </span>
          &ldquo;{business.raw_snippet}&rdquo;
        </p>
      )}
    </div>
  );
}


// --- Detail-panel bodies -----------------------------------------------------
// One per review-brief card. These hold everything the old accordion
// sections held (nothing dropped) — the cards only summarise it.

export function AuditFindingsBody({
  audit,
  knownNoWebsite,
}: {
  audit: WebsiteQualityAudit | null;
  knownNoWebsite: boolean;
}) {
  if (!audit) {
    return (
      <p className="text-sm text-fg-subtle">
        {knownNoWebsite
          ? "This business has no website on record, so there's nothing to audit — see the business/review/social evidence instead."
          : "No quality audit has run yet."}
      </p>
    );
  }
  return (
    <div>
      {audit.summary && <p className="text-sm text-fg-muted">{audit.summary}</p>}
      <p className="mt-1 text-xs text-fg-subtle">Audited {timeAgo(audit.audited_at)}</p>
      {audit.findings.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {sortFindings(audit.findings).map((finding, i) => (
            <li key={i} className="rounded-md border border-border p-2.5 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</Badge>
                <span className="text-xs uppercase tracking-wide text-fg-subtle">{finding.category}</span>
                <span className="ml-auto text-xs text-fg-subtle">{Math.round(finding.confidence * 100)}% confidence</span>
              </div>
              <p className="mt-1 text-fg">{finding.message}</p>
              <p className="mt-0.5 text-xs text-fg-muted">Evidence: {finding.evidence}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-fg-subtle">The audit found no issues.</p>
      )}
    </div>
  );
}

export function ScoreBody({ score }: { score: OpportunityScoreResult | null }) {
  if (!score) return <p className="text-sm text-fg-subtle">No opportunity score yet.</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <ScoreCategoryBadge category={score.category} />
        <span
          className={`text-2xl font-semibold tabular-nums ${score.overall_score === null ? "text-fg-subtle" : "text-fg"}`}
        >
          {score.overall_score ?? "Not assessed"}
        </span>
        <span className="text-xs text-fg-muted">{Math.round(score.confidence * 100)}% confidence</span>
      </div>
      <p className="mt-2 text-sm text-fg-muted">{score.recommendation_reason}</p>
      <ListSection title="Positive signals" items={score.positive_signals} tone="confirmed" />
      <ListSection title="Negative signals" items={score.negative_signals} tone="inferred" />
      {score.factors.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Score breakdown</h3>
          <ul className="mt-1 space-y-1">
            {score.factors.map((factor, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span className="text-fg-muted">{factor.explanation}</span>
                <span className="ml-2 shrink-0 text-fg-muted">+{factor.points}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ResearchBody({ research }: { research: BusinessResearchResult | null }) {
  if (!research) return <p className="text-sm text-fg-subtle">No research yet for this business.</p>;
  if (research.research_error) return <p className="text-error">Could not load website: {research.research_error}</p>;
  return (
    <div>
      <Fact label="Reachable" value={research.website_reachable} />
      <Fact label="HTTPS" value={research.https} />
      <Fact label="Page title" value={research.page_title} />
      <Fact label="Mobile viewport tag" value={research.mobile_viewport_present} />
      <Fact label="Contact path found" value={research.contact_cta_present} />
      <Fact label="Estimated age" value={research.estimated_site_age} />
      <Fact label="Appears template/placeholder" value={research.appears_template_or_placeholder} />
      <ListSection title="Confirmed" items={research.confirmed_facts} tone="confirmed" />
      <ListSection title="Inferred" items={research.inferred_facts} tone="inferred" />
      <ListSection title="Technical issues" items={research.technical_issues} tone="inferred" />
      <ListSection title="Social presence" items={research.social_presence} tone="confirmed" />
      <ListSection title="Unavailable" items={research.unavailable_fields} tone="unavailable" />
    </div>
  );
}

export function ContactBody({ business, socialLinks }: { business: DiscoveredBusiness; socialLinks: string[] }) {
  return (
    <div>
      <Fact
        label="Address"
        value={
          business.address || [business.suburb, business.state, business.postcode].filter(Boolean).join(", ") || null
        }
      />
      <Fact label="Phone" value={business.phone} />
      <Fact label="Email" value={business.email} />
      <Fact label="Website" value={business.website_url ?? DISCOVERED_WEBSITE_STATUS_LABEL[business.website_status]} />
      {socialLinks.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Social links</h3>
          <ul className="mt-1 space-y-0.5">
            {socialLinks.map((link, i) => (
              <li key={i}>
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-fg-muted hover:underline [overflow-wrap:anywhere]"
                >
                  {link}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function MissingInfoBody({ items }: { items: string[] }) {
  return (
    <ul className="list-inside list-disc space-y-1 text-sm text-fg-muted">
      {items.map((m, i) => (
        <li key={i}>{m}</li>
      ))}
    </ul>
  );
}

function SourceRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1 ${last ? "" : "border-b border-border"}`}>
      <span className="shrink-0 text-fg-muted">{label}</span>
      <span className="min-w-0 text-right text-fg [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

export function SourcesBody({
  business,
  research,
  audit,
  score,
  reviews,
}: {
  business: DiscoveredBusiness;
  research: BusinessResearchResult | null;
  audit: WebsiteQualityAudit | null;
  score: OpportunityScoreResult | null;
  reviews: ReviewIntelligenceResult | null;
}) {
  return (
    <div className="space-y-1.5 text-sm">
      <SourceRow label="Discovered via">
        {business.source_provider} · {timeAgo(business.discovered_at)}
      </SourceRow>
      {research && !research.research_error && (
        <SourceRow label="Website research">{new Date(research.researched_at).toLocaleString()}</SourceRow>
      )}
      {audit && <SourceRow label="Quality audit">{new Date(audit.audited_at).toLocaleString()}</SourceRow>}
      {score && (
        <SourceRow label="Opportunity score">
          {new Date(score.scored_at).toLocaleString()} · {Math.round(score.confidence * 100)}% confidence
        </SourceRow>
      )}
      {reviews && reviews.data_status === "ok" && (
        <SourceRow label="Google reviews">{new Date(reviews.review_data_updated_at).toLocaleString()}</SourceRow>
      )}
      {business.reviewed_at && (
        <SourceRow label="Last reviewed" last>
          {new Date(business.reviewed_at).toLocaleString()}
          {business.review_notes ? ` — ${business.review_notes}` : ""}
        </SourceRow>
      )}
    </div>
  );
}
