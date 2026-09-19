"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  api,
  ApiError,
  DISCOVERED_WEBSITE_STATUS_LABEL,
  INSTAGRAM_CHECK_STATE_LABEL,
  instagramCheckDisplayState,
  type BusinessResearchResult,
  type DiscoveredBusiness,
  type OpportunityScoreResult,
  type QualityFindingSeverity,
  type ReviewIntelligenceResult,
  type WebsiteQualityAudit,
} from "@/lib/api";
import { StageChecklistPanel } from "@/components/checklists/StageChecklistPanel";
import { ErrorState } from "@/components/ui/ErrorState";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Disclosure } from "@/components/ui/Disclosure";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { invalidateNavCounts, loadNavCounts } from "@/lib/navCounts";
import { timeAgo } from "@/lib/format";
import { ReviewStatusBadge, ScoreCategoryBadge } from "@/components/ReviewStatusBadge";

const SEVERITY_TONE: Record<QualityFindingSeverity, BadgeTone> = {
  critical: "danger",
  high: "warning",
  medium: "warning",
  low: "muted",
};

function Fact({ label, value }: { label: string; value: string | boolean | null }) {
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

// A run-once/check-status pill shared by every analysis type on this
// page (research/audit/score) — "clearly distinguish completed,
// pending, unavailable, and failed" is the explicit requirement this
// exists to satisfy, in one place rather than four ad hoc renderings.
type CheckStatus = "not_run" | "running" | "done" | "failed" | "unavailable";
const CHECK_STATUS_TONE: Record<CheckStatus, BadgeTone> = {
  not_run: "muted",
  running: "info",
  done: "success",
  failed: "danger",
  unavailable: "muted",
};
const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  not_run: "Not run yet",
  running: "Running…",
  done: "Completed",
  failed: "Failed",
  unavailable: "Not applicable",
};
function CheckStatusBadge({ status }: { status: CheckStatus }) {
  return <Badge tone={CHECK_STATUS_TONE[status]}>{CHECK_STATUS_LABEL[status]}</Badge>;
}

function GoogleReviewsSection({ result }: { result: ReviewIntelligenceResult }) {
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

/** Shown for any business with an Instagram handle on record — from
 * either instagram_import (Phase 1, manual CSV) or instagram_search
 * (Phase 2, automated site:instagram.com search). */
function InstagramSection({
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

/**
 * The Discovery workspace's full review page — extended from what was
 * already the discovered-business detail page (research/audit/score/
 * Google-reviews history) rather than building a second review system.
 * Reached from Review Queue's "Review" action (previously a small
 * `ReviewItemDrawer` popup, now this real page — see
 * docs/07_SESSION_LOG.md), from Map Discovery's "View details" links,
 * and from map popups' "View details" link. All three keep working
 * unchanged since none of their hrefs moved.
 *
 * New here: the decision actions (approve/reject/archive/Add to Leads)
 * that used to live only in the now-deleted drawer, a sticky header so
 * they stay reachable while scrolling a long review, a "Back to Review
 * Queue" link that restores that list's exact filters/tab/sort/scroll
 * (`wdos-list-return:discovery-review`, written by `ReviewQueueWorkspace`
 * on every render), a single "Run Detailed Review" action that
 * sequences the existing research→audit→score endpoints with visible
 * per-step status instead of three separate buttons, and `Disclosure`-
 * wrapped detail sections so the page opens on a concise overview.
 * Google Reviews analysis and the Instagram website-check stay their
 * own independent actions (separate evidence sources, already
 * separately freshness-cached server-side) — folding them into "Run
 * Detailed Review" would blur "detailed *website* review" with data
 * this page already treats as distinct.
 */
export default function DiscoveredBusinessDetailPage() {
  const params = useParams<{ id: string }>();
  const confirm = useConfirm();
  const [business, setBusiness] = useState<DiscoveredBusiness | null>(null);
  const [research, setResearch] = useState<BusinessResearchResult[] | null>(null);
  const [audits, setAudits] = useState<WebsiteQualityAudit[] | null>(null);
  const [scores, setScores] = useState<OpportunityScoreResult[] | null>(null);
  const [reviewIntel, setReviewIntel] = useState<ReviewIntelligenceResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [analyzingReviews, setAnalyzingReviews] = useState(false);
  const [checkingWebsite, setCheckingWebsite] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [importing, setImporting] = useState(false);

  // "Run Detailed Review" — sequences research → audit → score using
  // the exact same endpoints the old three-button UI called, just
  // orchestrated with visible per-step progress instead of requiring
  // three separate clicks. `pipelineStep` is which one is in flight
  // right now (or null when idle); `pipelineFailedStep` is which one
  // to offer a retry for for.
  const [pipelineStep, setPipelineStep] = useState<"research" | "audit" | "score" | null>(null);
  const [pipelineFailedStep, setPipelineFailedStep] = useState<"research" | "audit" | "score" | null>(null);

  const backTo =
    typeof window !== "undefined" ? sessionStorage.getItem("wdos-list-return:discovery-review") : null;

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

  // Loads whatever has already been saved — never triggers a fresh
  // (paid) research/audit/score/review-analysis run on its own. Those
  // only ever happen from an explicit click below.
  useEffect(load, [params.id]);

  async function handleCheckWebsite() {
    if (!params.id) return;
    setCheckingWebsite(true);
    setActionError(null);
    try {
      await api.checkInstagramWebsite(params.id);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't check for a website.");
    } finally {
      setCheckingWebsite(false);
    }
  }

  async function handleReviewAnalysis() {
    if (!params.id) return;
    setAnalyzingReviews(true);
    setActionError(null);
    try {
      await api.runReviewIntelligence(params.id);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't analyze Google reviews for this business.");
    } finally {
      setAnalyzingReviews(false);
    }
  }

  // One click, three existing endpoints in sequence — never re-runs a
  // step that already has a fresh-enough result (each service's own
  // freshness cache still applies, e.g. research's 7-day window), and
  // skips the audit step entirely for a business with no reachable
  // website rather than showing a misleading "failed" audit.
  async function handleRunDetailedReview() {
    if (!params.id) return;
    setActionError(null);
    setPipelineFailedStep(null);

    setPipelineStep("research");
    let latestResearch: BusinessResearchResult;
    try {
      latestResearch = await api.runBusinessResearch(params.id);
      setResearch((rows) => [latestResearch, ...(rows ?? []).filter((r) => r.id !== latestResearch.id)]);
    } catch (err) {
      setPipelineFailedStep("research");
      setPipelineStep(null);
      setActionError(err instanceof ApiError ? err.message : "Couldn't research this business.");
      return;
    }

    const hasWebsite = !latestResearch.research_error && latestResearch.website_reachable === true;
    if (hasWebsite) {
      setPipelineStep("audit");
      try {
        const audit = await api.runQualityAudit(params.id);
        setAudits((rows) => [audit, ...(rows ?? []).filter((a) => a.id !== audit.id)]);
      } catch (err) {
        setPipelineFailedStep("audit");
        setPipelineStep(null);
        setActionError(err instanceof ApiError ? err.message : "Couldn't audit this business.");
        return;
      }
    }

    setPipelineStep("score");
    try {
      const score = await api.runOpportunityScore(params.id);
      setScores((rows) => [score, ...(rows ?? []).filter((s) => s.id !== score.id)]);
    } catch (err) {
      setPipelineFailedStep("score");
      setPipelineStep(null);
      setActionError(err instanceof ApiError ? err.message : "Couldn't score this business.");
      return;
    }

    setPipelineStep(null);
    load(); // reconcile business.status/opportunity_score etc. from the server
  }

  async function retryPipelineStep(step: "research" | "audit" | "score") {
    if (!params.id) return;
    setActionError(null);
    setPipelineFailedStep(null);
    setPipelineStep(step);
    try {
      if (step === "research") {
        const r = await api.runBusinessResearch(params.id);
        setResearch((rows) => [r, ...(rows ?? []).filter((x) => x.id !== r.id)]);
      } else if (step === "audit") {
        const a = await api.runQualityAudit(params.id);
        setAudits((rows) => [a, ...(rows ?? []).filter((x) => x.id !== a.id)]);
      } else {
        const s = await api.runOpportunityScore(params.id);
        setScores((rows) => [s, ...(rows ?? []).filter((x) => x.id !== s.id)]);
      }
      setPipelineStep(null);
      load();
    } catch (err) {
      setPipelineFailedStep(step);
      setPipelineStep(null);
      setActionError(err instanceof ApiError ? err.message : "That step failed again.");
    }
  }

  async function runDecision(action: () => Promise<unknown>) {
    setDeciding(true);
    setActionError(null);
    try {
      await action();
      load();
      invalidateNavCounts();
      loadNavCounts({ force: true }).catch(() => {});
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That action failed.");
    } finally {
      setDeciding(false);
    }
  }

  async function handleApprove() {
    if (!params.id) return;
    await runDecision(() => api.approveDiscoveredBusiness(params.id));
  }

  async function handleReject() {
    if (!params.id || !business) return;
    const ok = await confirm({
      title: "Reject this business?",
      description: `${business.name} will be marked rejected and drop out of the active queue.`,
      confirmLabel: "Reject",
      danger: true,
    });
    if (!ok) return;
    await runDecision(() => api.rejectDiscoveredBusiness(params.id));
  }

  async function handleArchive() {
    if (!params.id || !business) return;
    const ok = await confirm({
      title: "Archive this business?",
      description: `${business.name} will drop out of the default queue with no way to bring it back except finding it under the Archived tab.`,
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    await runDecision(() => api.archiveDiscoveredBusiness(params.id));
  }

  async function handleImport() {
    if (!params.id || !business) return;
    const ok = await confirm({
      title: "Add to CRM?",
      description: `Creates a business and lead record for ${business.name}.`,
      confirmLabel: "Add to CRM",
    });
    if (!ok) return;
    setImporting(true);
    await runDecision(() => api.importDiscoveredBusiness(params.id));
    setImporting(false);
  }

  const latest = research && research.length > 0 ? research[0] : null;
  const latestAudit = audits && audits.length > 0 ? audits[0] : null;
  const latestScore = scores && scores.length > 0 ? scores[0] : null;
  const latestReviewIntel = reviewIntel && reviewIntel.length > 0 ? reviewIntel[0] : null;

  // Same gating as the old ReviewItemDrawer's canDecide/canImport —
  // approve/reject/archive only make sense before a decision is
  // already made; Add to CRM stays available for a not-yet-decided or
  // already-approved business, just not a rejected/archived one.
  const canDecide = business ? !["approved", "rejected", "archived", "imported"].includes(business.status) : false;
  const canImport = business ? !["rejected", "archived", "imported"].includes(business.status) : false;

  const knownNoWebsite = business?.website_status === "none";
  const websiteReachable = latest ? !latest.research_error && latest.website_reachable === true : null;

  const researchStatus: CheckStatus =
    pipelineStep === "research"
      ? "running"
      : pipelineFailedStep === "research"
        ? "failed"
        : latest
          ? latest.research_error
            ? "failed"
            : "done"
          : "not_run";
  const auditStatus: CheckStatus =
    pipelineStep === "audit"
      ? "running"
      : pipelineFailedStep === "audit"
        ? "failed"
        : knownNoWebsite || websiteReachable === false
          ? "unavailable"
          : latestAudit
            ? "done"
            : "not_run";
  const scoreStatus: CheckStatus =
    pipelineStep === "score"
      ? "running"
      : pipelineFailedStep === "score"
        ? "failed"
        : latestScore
          ? "done"
          : latest
            ? "not_run"
            : "unavailable";

  // "Missing information and facts requiring confirmation" — one place
  // that lists every gap this page already knows about, instead of
  // making the operator hunt through each section for what's absent.
  const missingInfo: string[] = [];
  if (!business?.phone && !business?.email) missingInfo.push("No phone or email on record");
  if (!latest) missingInfo.push("Website research hasn't run yet");
  if (latest?.unavailable_fields.length) missingInfo.push(...latest.unavailable_fields);
  if (!latestReviewIntel) missingInfo.push("Google review data hasn't been analyzed yet");
  else if (latestReviewIntel.data_status === "no_listing") missingInfo.push("No Google Business listing found");
  if (!latestScore) missingInfo.push("Not yet scored for opportunity");

  const socialLinks = business?.social_links?.split("\n").filter(Boolean) ?? [];

  return (
    <div>
      {business && (
        // No negative margins: the dashboard layout gives pages no padding of
        // their own, so `-mx-*` here pushed the header 24px past both edges
        // of the content column (over the sidebar, and a horizontal scrollbar
        // that shifted the whole page). The padding lives on the inner
        // wrapper instead, so it lines up with the body's `max-w-5xl p-6`.
        <header className="sticky top-12 z-20 border-b border-border bg-surface lg:top-11">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <Link href={backTo || "/dashboard/discovery/review"} className="text-fg-muted hover:text-fg hover:underline">
                &larr; Back to Review Queue
              </Link>
              <span className="text-fg-subtle">·</span>
              <Link
                href={`/dashboard/discovery/map/${business.discovery_search_id}`}
                className="text-fg-muted hover:text-fg hover:underline"
              >
                Back to search results
              </Link>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold text-fg">{business.name}</h1>
                <p className="mt-1 text-sm text-fg-muted">
                  {[business.business_category || business.industry, [business.suburb, business.state].filter(Boolean).join(", ")]
                    .filter(Boolean)
                    .join(" · ") || "No details on record"}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <ReviewStatusBadge status={business.status} />
                  {latestScore && <ScoreCategoryBadge category={latestScore.category} score={latestScore.overall_score} />}
                  {business.review_queued_at && <Badge tone="muted">In Review Queue</Badge>}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                {business.status === "imported" && business.imported_lead_id ? (
                  <Link href={`/dashboard/leads/${business.imported_lead_id}`} className="btn btn-primary btn-sm">
                    Open Lead →
                  </Link>
                ) : (
                  <>
                    {canDecide && (
                      <button onClick={handleApprove} disabled={deciding} className="btn btn-primary btn-sm">
                        {deciding ? "Working…" : "Approve"}
                      </button>
                    )}
                    {canImport && (
                      <button onClick={handleImport} disabled={deciding || importing} className="btn btn-secondary btn-sm">
                        Add to CRM
                      </button>
                    )}
                    {canDecide && (
                      <button
                        onClick={handleReject}
                        disabled={deciding}
                        className="btn btn-sm text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
                      >
                        Reject
                      </button>
                    )}
                    {canDecide && (
                      <button onClick={handleArchive} disabled={deciding} className="btn btn-sm text-fg-muted hover:underline disabled:opacity-50">
                        Archive
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </header>
      )}

      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={load} compact />
          </div>
        )}
        {actionError && (
          <div className="mt-4">
            <ErrorState message={actionError} onRetry={() => setActionError(null)} compact />
          </div>
        )}

        {!business && !error && <p className="mt-6 text-sm text-fg-muted">Loading…</p>}

        {business && (
          <>
            {/* Overview — concise, always visible: who they are, how to
                reach them, and the headline signals, before any
                expandable technical evidence below. */}
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="panel">
                <h2 className="text-sm font-semibold text-fg">Contact & location</h2>
                <div className="mt-2">
                  <Fact label="Address" value={business.address || [business.suburb, business.state, business.postcode].filter(Boolean).join(", ") || null} />
                  <Fact label="Phone" value={business.phone} />
                  <Fact label="Email" value={business.email} />
                  <Fact
                    label="Website"
                    value={business.website_url ?? DISCOVERED_WEBSITE_STATUS_LABEL[business.website_status]}
                  />
                </div>
                {socialLinks.length > 0 && (
                  <div className="mt-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Social links</h3>
                    <ul className="mt-1 space-y-0.5">
                      {socialLinks.map((link, i) => (
                        <li key={i}>
                          <a href={link} target="_blank" rel="noreferrer" className="text-sm text-fg-muted hover:underline">
                            {link}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="panel">
                <h2 className="text-sm font-semibold text-fg">Opportunity score</h2>
                {latestScore ? (
                  <>
                    <div className="mt-2 flex items-center gap-3">
                      <ScoreCategoryBadge category={latestScore.category} />
                      <span className="text-2xl font-semibold text-fg">{latestScore.overall_score}</span>
                      <span className="text-xs text-fg-muted">{Math.round(latestScore.confidence * 100)}% confidence</span>
                    </div>
                    <p className="mt-2 text-sm text-fg-muted">{latestScore.recommendation_reason}</p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-fg-subtle">Not scored yet — run a detailed review below.</p>
                )}
                <div className="mt-3 border-t border-border pt-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Google reviews</h3>
                  {latestReviewIntel && latestReviewIntel.data_status === "ok" ? (
                    <div className="mt-1 flex items-center gap-2">
                      {latestReviewIntel.google_rating !== null && <Stars rating={latestReviewIntel.google_rating} />}
                      <span className="text-sm text-fg">
                        {latestReviewIntel.google_rating?.toFixed(1) ?? "—"}
                        {latestReviewIntel.google_review_count !== null && ` (${latestReviewIntel.google_review_count})`}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-fg-subtle">
                      {latestReviewIntel ? "No Google listing found" : "Not analyzed yet"}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {missingInfo.length > 0 && (
              <div className="mt-4 panel">
                <h2 className="text-sm font-semibold text-fg">Missing information</h2>
                <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-fg-muted">
                  {missingInfo.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Run Detailed Review — one action orchestrating the
                existing research/audit/score endpoints in sequence,
                with real per-step status instead of three separate
                buttons. Audit is skipped (marked "Not applicable") for
                a business confirmed to have no reachable website,
                rather than showing a misleading failed audit. */}
            <div className="mt-4 panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-fg">Detailed review</h2>
                <button onClick={handleRunDetailedReview} disabled={pipelineStep !== null} className="btn btn-primary btn-sm">
                  {pipelineStep
                    ? `${pipelineStep === "research" ? "Researching" : pipelineStep === "audit" ? "Auditing" : "Scoring"}…`
                    : latest
                      ? "Run Detailed Review again"
                      : "Run Detailed Review"}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">
                    Website research
                    {latest && !latest.research_error && (
                      <span className="ml-2 text-xs text-fg-subtle">{timeAgo(latest.researched_at)}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <CheckStatusBadge status={researchStatus} />
                    {researchStatus === "failed" && (
                      <button onClick={() => retryPipelineStep("research")} className="text-xs text-fg-muted hover:underline">
                        Retry
                      </button>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">
                    Website quality audit
                    {latestAudit && <span className="ml-2 text-xs text-fg-subtle">{timeAgo(latestAudit.audited_at)}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <CheckStatusBadge status={auditStatus} />
                    {auditStatus === "failed" && (
                      <button onClick={() => retryPipelineStep("audit")} className="text-xs text-fg-muted hover:underline">
                        Retry
                      </button>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">
                    Opportunity score
                    {latestScore && <span className="ml-2 text-xs text-fg-subtle">{timeAgo(latestScore.scored_at)}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <CheckStatusBadge status={scoreStatus} />
                    {scoreStatus === "failed" && (
                      <button onClick={() => retryPipelineStep("score")} className="text-xs text-fg-muted hover:underline">
                        Retry
                      </button>
                    )}
                  </span>
                </div>
                {knownNoWebsite && (
                  <p className="pt-1 text-xs text-fg-subtle">
                    No website on record for this business — the audit step focuses on business, review, and social
                    evidence instead of website findings that don&rsquo;t apply here.
                  </p>
                )}
              </div>
            </div>

            {business.instagram_handle && (
              <div className="mt-4">
                <Disclosure title="Instagram" defaultOpen hint={`@${business.instagram_handle}`}>
                  <InstagramSection business={business} onCheckWebsite={handleCheckWebsite} checking={checkingWebsite} />
                </Disclosure>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={handleReviewAnalysis} disabled={analyzingReviews} className="btn btn-secondary btn-sm">
                {analyzingReviews ? "Analyzing…" : latestReviewIntel ? "Refresh Google reviews" : "Analyze Google reviews"}
              </button>
            </div>
            <div className="mt-2">
              <Disclosure
                title="Google reviews — full detail"
                hint={
                  latestReviewIntel
                    ? `Updated ${timeAgo(latestReviewIntel.review_data_updated_at)}`
                    : "Not analyzed yet"
                }
              >
                {latestReviewIntel ? (
                  <GoogleReviewsSection result={latestReviewIntel} />
                ) : (
                  <p className="text-sm text-fg-subtle">No Google review analysis has run yet.</p>
                )}
              </Disclosure>
            </div>

            <div className="mt-4">
              <Disclosure
                title="Website research evidence"
                hint={latest ? (latest.research_error ? "Research failed" : "Confirmed & inferred facts") : "Not researched yet"}
              >
                {latest ? (
                  latest.research_error ? (
                    <p className="text-error">Could not load website: {latest.research_error}</p>
                  ) : (
                    <div>
                      <Fact label="Reachable" value={latest.website_reachable} />
                      <Fact label="HTTPS" value={latest.https} />
                      <Fact label="Page title" value={latest.page_title} />
                      <Fact label="Mobile viewport tag" value={latest.mobile_viewport_present} />
                      <Fact label="Contact path found" value={latest.contact_cta_present} />
                      <Fact label="Estimated age" value={latest.estimated_site_age} />
                      <Fact label="Appears template/placeholder" value={latest.appears_template_or_placeholder} />
                      <ListSection title="Confirmed" items={latest.confirmed_facts} tone="confirmed" />
                      <ListSection title="Inferred" items={latest.inferred_facts} tone="inferred" />
                      <ListSection title="Technical issues" items={latest.technical_issues} tone="inferred" />
                      <ListSection title="Social presence" items={latest.social_presence} tone="confirmed" />
                      <ListSection title="Unavailable" items={latest.unavailable_fields} tone="unavailable" />
                    </div>
                  )
                ) : (
                  <p className="text-sm text-fg-subtle">No research yet for this business.</p>
                )}
              </Disclosure>
            </div>

            <div className="mt-4">
              <Disclosure
                title="Website quality audit — findings"
                hint={latestAudit ? latestAudit.summary : knownNoWebsite ? "Not applicable — no website" : "Not run yet"}
              >
                {latestAudit ? (
                  <div>
                    <p className="text-sm text-fg-muted">{latestAudit.summary}</p>
                    {latestAudit.findings.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {latestAudit.findings.map((finding, i) => (
                          <li key={i} className="border border-border p-2.5 text-sm">
                            <div className="flex items-center gap-2">
                              <Badge tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</Badge>
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
                ) : (
                  <p className="text-sm text-fg-subtle">
                    {knownNoWebsite
                      ? "This business has no website on record, so there's nothing to audit — see the business/review/social evidence above instead."
                      : "No quality audit has run yet."}
                  </p>
                )}
              </Disclosure>
            </div>

            <div className="mt-4">
              <Disclosure title="Opportunity score — full breakdown" hint={latestScore ? `${latestScore.overall_score} / 100` : "Not scored yet"}>
                {latestScore ? (
                  <div>
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
                ) : (
                  <p className="text-sm text-fg-subtle">No opportunity score yet.</p>
                )}
              </Disclosure>
            </div>

            <div className="mt-4">
              <Disclosure title="Desktop / mobile screenshots" hint="Not available at this stage">
                <p className="text-sm text-fg-subtle">
                  Discovery-stage research doesn&rsquo;t capture screenshots — they&rsquo;re generated later, once this
                  business becomes a Lead and moves into Planning.
                </p>
              </Disclosure>
            </div>

            <div className="mt-4">
              <Disclosure
                title="Sources, timestamps & confidence"
                hint="Where each finding above came from"
              >
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between border-b border-border py-1">
                    <span className="text-fg-muted">Discovered via</span>
                    <span className="text-fg">
                      {business.source_provider} · {timeAgo(business.discovered_at)}
                    </span>
                  </div>
                  {latest && !latest.research_error && (
                    <div className="flex justify-between border-b border-border py-1">
                      <span className="text-fg-muted">Website research</span>
                      <span className="text-fg">{new Date(latest.researched_at).toLocaleString()}</span>
                    </div>
                  )}
                  {latestAudit && (
                    <div className="flex justify-between border-b border-border py-1">
                      <span className="text-fg-muted">Quality audit</span>
                      <span className="text-fg">{new Date(latestAudit.audited_at).toLocaleString()}</span>
                    </div>
                  )}
                  {latestScore && (
                    <div className="flex justify-between border-b border-border py-1">
                      <span className="text-fg-muted">Opportunity score</span>
                      <span className="text-fg">
                        {new Date(latestScore.scored_at).toLocaleString()} · {Math.round(latestScore.confidence * 100)}%
                        confidence
                      </span>
                    </div>
                  )}
                  {latestReviewIntel && latestReviewIntel.data_status === "ok" && (
                    <div className="flex justify-between py-1">
                      <span className="text-fg-muted">Google reviews</span>
                      <span className="text-fg">{new Date(latestReviewIntel.review_data_updated_at).toLocaleString()}</span>
                    </div>
                  )}
                  {business.reviewed_at && (
                    <div className="flex justify-between border-t border-border py-1 pt-2">
                      <span className="text-fg-muted">Last reviewed</span>
                      <span className="text-fg">
                        {new Date(business.reviewed_at).toLocaleString()}
                        {business.review_notes ? ` — ${business.review_notes}` : ""}
                      </span>
                    </div>
                  )}
                </div>
              </Disclosure>
            </div>

            <div className="mt-4">
              <StageChecklistPanel ownerType="discovered-business" ownerId={params.id} title="Stage checklist" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
