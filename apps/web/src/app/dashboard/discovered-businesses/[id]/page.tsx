"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  api,
  ApiError,
  DISCOVERED_WEBSITE_STATUS_LABEL,
  INSTAGRAM_CHECK_STATE_LABEL,
  instagramCheckDisplayState,
  type BusinessResearchResult,
  type DiscoveredBusiness,
  type OpportunityScoreResult,
  type ReviewIntelligenceResult,
  type WebsiteQualityAudit,
} from "@/lib/api";
import { StageChecklistBody, useStageChecklist } from "@/components/checklists/StageChecklistPanel";
import { ErrorState } from "@/components/ui/ErrorState";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import {
  describeAnalysisError,
  loadReviewOrder,
  parseReviewQuery,
  reviewNeighbours,
  saveReviewOrder,
  type ReviewOrderContext,
} from "@/lib/reviewQueue";
import { invalidateNavCounts, loadNavCounts } from "@/lib/navCounts";
import { timeAgo } from "@/lib/format";
import { ReviewStatusBadge, ScoreCategoryBadge } from "@/components/ReviewStatusBadge";
import { CardLinkButton, ReviewCard } from "@/components/discovery/ReviewCard";
import { isReviewTextUnavailable } from "@/lib/reviewText";
import { ReviewDetailPanel } from "@/components/discovery/ReviewDetailPanel";
import { ReviewSummaryStrip } from "@/components/discovery/ReviewSummaryStrip";
import {
  CheckStatusBadge,
  DetailedReviewStrip,
  type CheckStatus,
  type PipelineStep,
} from "@/components/discovery/DetailedReviewStrip";
import {
  AuditFindingsBody,
  ContactBody,
  GoogleReviewsSection,
  InstagramSection,
  MissingInfoBody,
  ResearchBody,
  ScoreBody,
  SourcesBody,
} from "@/components/discovery/ReviewSections";
import { ScreenshotsBody, useDiscoveryScreenshot } from "@/components/discovery/ScreenshotPreview";
import {
  checklistPercent,
  checklistSummary,
  findingCounts,
  formatRating,
  isHighSeverity,
  plural,
  SEVERITY_TONE,
  topFindings,
} from "@/lib/reviewBrief";

/** The sections of the review brief that open a detail panel. */
type PanelKey =
  | "audit"
  | "score"
  | "reviews"
  | "research"
  | "contact"
  | "missing"
  | "instagram"
  | "screenshots"
  | "sources"
  | "checklist";

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
 * per-step status instead of three separate buttons, and a compact
 * "review brief" so the page opens on a concise overview: a summary
 * strip (score, priority, audit, reviews), decision-critical cards
 * (audit, score) and dense supporting cards, each opening its full
 * detail in a side panel instead of a tall accordion stack.
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
  // Set only by a successful, explicit Add to Leads — drives the result
  // banner that offers "Review next" (never navigates on its own).
  const [imported, setImported] = useState<{ businessId: string; leadId: string } | null>(null);
  // Only meaningful for the business it was set on — navigating to another
  // business (Previous/Next) must not carry the banner along.
  const importedLeadId = imported?.businessId === params.id ? imported.leadId : null;
  const router = useRouter();
  const [pageLoading, setPageLoading] = useState(false);
  // The queue's order as it was when this review was opened, so Previous/
  // Next follow the operator's current sort/filters. Empty when this page
  // was reached from somewhere other than the queue.
  const [queueOrder, setQueueOrder] = useState<ReviewOrderContext | null>(() =>
    typeof window !== "undefined" ? loadReviewOrder() : null,
  );
  const neighbours = reviewNeighbours(queueOrder, params.id);

  // Previous/Next at the edge of a queue page: fetch the adjacent page
  // with the list's own criteria (one page, never the whole queue), make
  // it the list's current page so "Back to Review Queue" lands there, and
  // open its first (Next) or last (Previous) business.
  async function goAdjacentPage(direction: 1 | -1) {
    if (!queueOrder || pageLoading) return;
    setPageLoading(true);
    setActionError(null);
    try {
      const q = parseReviewQuery(new URLSearchParams(queueOrder.query));
      const res = await api.listReviewQueuePage({ ...q, page: queueOrder.page + direction, pageSize: queueOrder.pageSize });
      const target = direction === 1 ? res.items[0] : res.items[res.items.length - 1];
      if (!target) return;
      const sp = new URLSearchParams(queueOrder.query);
      if (res.page <= 1) sp.delete("page");
      else sp.set("page", String(res.page));
      const ctx: ReviewOrderContext = {
        ids: res.items.map((i) => i.id),
        page: res.page,
        pageSize: res.page_size,
        total: res.total,
        totalPages: res.total_pages,
        query: sp.toString(),
      };
      saveReviewOrder(ctx);
      sessionStorage.setItem("wdos-list-return:discovery-review", `/dashboard/discovery/review?${ctx.query}`);
      setQueueOrder(ctx);
      router.push(`/dashboard/discovered-businesses/${target.id}`);
    } catch {
      setActionError("Couldn't load the next page of the queue.");
    } finally {
      setPageLoading(false);
    }
  }

  // "Run Detailed Review" — sequences research → audit → score using
  // the exact same endpoints the old three-button UI called, just
  // orchestrated with visible per-step progress instead of requiring
  // three separate clicks. `pipelineStep` is which one is in flight
  // right now (or null when idle); `pipelineFailedStep` is which one
  // to offer a retry for for.
  const [pipelineStep, setPipelineStep] = useState<PipelineStep | null>(null);
  const [pipelineFailedStep, setPipelineFailedStep] = useState<PipelineStep | null>(null);

  // Which section's detail panel is open (null = none — the brief itself
  // is the whole page; nothing expands by default).
  const [panel, setPanel] = useState<PanelKey | null>(null);
  const stageChecklist = useStageChecklist("discovered-business", params.id);
  const screenshot = useDiscoveryScreenshot(business?.imported_lead_id ?? null);

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

  async function retryPipelineStep(step: PipelineStep) {
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
      title: "Add to Leads?",
      description: `Creates a business and lead record for ${business.name}.`,
      confirmLabel: "Add to Leads",
    });
    if (!ok) return;
    setImporting(true);
    setImported(null);
    await runDecision(async () => {
      const result = await api.importDiscoveredBusiness(params.id);
      setImported({ businessId: params.id, leadId: result.imported_lead_id ?? "" });
    });
    setImporting(false);
  }

  const latest = research && research.length > 0 ? research[0] : null;
  const latestAudit = audits && audits.length > 0 ? audits[0] : null;
  const latestScore = scores && scores.length > 0 ? scores[0] : null;
  const latestReviewIntel = reviewIntel && reviewIntel.length > 0 ? reviewIntel[0] : null;

  // Same gating as the old ReviewItemDrawer's canDecide/canImport —
  // approve/reject/archive only make sense before a decision is
  // already made; Add to Leads stays available for a not-yet-decided or
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

  // --- Review brief: what each card says at a glance --------------------------

  const auditCounts = latestAudit ? findingCounts(latestAudit.findings) : null;
  const surfacedFindings = latestAudit ? topFindings(latestAudit.findings) : [];
  const auditNote = knownNoWebsite ? "Not applicable — no website" : "Not run yet";

  const contactSummary =
    [
      business?.phone,
      business?.email,
      business?.website_url
        ? business.website_kind === "social_profile"
          ? `${business.website_platform ?? "Social"} profile (not an owned website)`
          : business.website_url
        : business
          ? DISCOVERED_WEBSITE_STATUS_LABEL[business.website_status]
          : null,
    ]
      .filter(Boolean)
      .join(" · ") || "No contact details on record";

  const reviewsSummary: ReactNode = !latestReviewIntel
    ? "Not analyzed yet"
    : latestReviewIntel.data_status === "no_listing"
      ? "No Google listing found"
      : latestReviewIntel.data_status === "unavailable"
        ? "Google Places currently unavailable"
        : [
            formatRating(latestReviewIntel.google_rating, latestReviewIntel.google_review_count),
            latestReviewIntel.review_health_score !== null
              ? `Health ${latestReviewIntel.review_health_score}/100${isReviewTextUnavailable(latestReviewIntel) ? " (rating and count only)" : ""}`
              : null,
            isReviewTextUnavailable(latestReviewIntel) ? "No written reviews returned" : null,
          ]
            .filter(Boolean)
            .join(" · ");

  const researchSummary: ReactNode = !latest
    ? "Not researched yet"
    : latest.research_error
      ? `The check couldn't complete — ${describeAnalysisError(latest.research_error)}`
      : [
          latest.website_reachable === false ? "Unreachable" : "Reachable",
          latest.https === null ? null : latest.https ? "HTTPS" : "No HTTPS",
          latest.mobile_viewport_present === false ? "No mobile viewport" : null,
          `${latest.confirmed_facts.length} confirmed, ${latest.inferred_facts.length} inferred facts`,
        ]
          .filter(Boolean)
          .join(" · ");

  const igState = business ? instagramCheckDisplayState(business) : null;
  const instagramSummary = business?.instagram_handle
    ? [
        `@${business.instagram_handle}`,
        business.instagram_follower_count !== null ? `${plural(business.instagram_follower_count, "follower")}` : null,
        igState ? `Website: ${INSTAGRAM_CHECK_STATE_LABEL[igState]}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const checklist = stageChecklist.checklist;
  const checklistPct = checklist ? checklistPercent(checklist.progress) : null;

  // --- Detail panel: full content for whichever card was opened ---------------

  function panelContent(key: PanelKey): { title: string; subtitle?: ReactNode; actions?: ReactNode; body: ReactNode } | null {
    if (!business) return null;
    switch (key) {
      case "audit":
        return {
          title: "Website quality audit",
          subtitle: auditCounts ? `${plural(auditCounts.total, "finding")} · ${timeAgo(latestAudit!.audited_at)}` : auditNote,
          body: <AuditFindingsBody audit={latestAudit} knownNoWebsite={knownNoWebsite === true} />,
        };
      case "score":
        return {
          title: "Opportunity score",
          subtitle: latestScore ? `Scored ${timeAgo(latestScore.scored_at)}` : "Not scored yet",
          body: <ScoreBody score={latestScore} />,
        };
      case "reviews":
        return {
          title: "Google reviews",
          subtitle: latestReviewIntel ? `Updated ${timeAgo(latestReviewIntel.review_data_updated_at)}` : "Not analyzed yet",
          actions: (
            <button onClick={handleReviewAnalysis} disabled={analyzingReviews} className="btn btn-secondary btn-sm">
              {analyzingReviews ? "Analyzing…" : latestReviewIntel ? "Refresh Google reviews" : "Analyze Google reviews"}
            </button>
          ),
          body: latestReviewIntel ? (
            <GoogleReviewsSection result={latestReviewIntel} />
          ) : (
            <p className="text-sm text-fg-subtle">No Google review analysis has run yet.</p>
          ),
        };
      case "research":
        return {
          title: "Website research evidence",
          subtitle: latest ? (latest.research_error ? "Research failed" : "Confirmed & inferred facts") : "Not researched yet",
          body: <ResearchBody research={latest} />,
        };
      case "contact":
        return { title: "Contact & location", body: <ContactBody business={business} socialLinks={socialLinks} /> };
      case "missing":
        return { title: "Missing information", body: <MissingInfoBody items={missingInfo} /> };
      case "instagram":
        return {
          title: "Instagram",
          subtitle: `@${business.instagram_handle}`,
          body: <InstagramSection business={business} onCheckWebsite={handleCheckWebsite} checking={checkingWebsite} />,
        };
      case "screenshots":
        return {
          title: "Desktop / mobile screenshots",
          subtitle: screenshot.src ? "Captured by Planning" : "Not available at this stage",
          body: <ScreenshotsBody src={screenshot.src} onError={screenshot.markFailed} />,
        };
      case "sources":
        return {
          title: "Sources, timestamps & confidence",
          subtitle: "Where each finding came from",
          body: (
            <SourcesBody business={business} research={latest} audit={latestAudit} score={latestScore} reviews={latestReviewIntel} />
          ),
        };
      case "checklist":
        return {
          title: "Stage checklist",
          subtitle: checklist ? checklistSummary(checklist.progress) : undefined,
          body: stageChecklist.error ? (
            <p className="text-error">{stageChecklist.error}</p>
          ) : checklist ? (
            <StageChecklistBody
              ownerType="discovered-business"
              ownerId={params.id}
              checklist={checklist}
              users={stageChecklist.users}
              onUpdated={stageChecklist.setChecklist}
            />
          ) : (
            <p className="text-sm text-fg-subtle">Loading…</p>
          ),
        };
    }
  }

  const openPanel = panel ? panelContent(panel) : null;

  return (
    <div>
      {business && (
        // No negative margins: the dashboard layout gives pages no padding of
        // their own, so `-mx-*` here pushed the header 24px past both edges
        // of the content column (over the sidebar, and a horizontal scrollbar
        // that shifted the whole page). The padding lives on the inner
        // wrapper instead, so it lines up with the body's `max-w-6xl p-6`.
        <header className="sticky top-12 z-20 border-b border-border bg-surface lg:top-11">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6">
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
              {neighbours && (
                <nav aria-label="Queue navigation" className="ml-auto flex items-center gap-1">
                  <span className="mr-1 text-xs tabular-nums text-fg-subtle">
                    {neighbours.position} of {neighbours.total}
                  </span>
                  {neighbours.previous ? (
                    <Link href={`/dashboard/discovered-businesses/${neighbours.previous}`} className="btn btn-secondary btn-sm min-h-8">
                      &larr; Previous
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void goAdjacentPage(-1)}
                      disabled={!neighbours.hasPreviousPage || pageLoading}
                      className="btn btn-secondary btn-sm min-h-8"
                    >
                      &larr; Previous
                    </button>
                  )}
                  {neighbours.next ? (
                    <Link href={`/dashboard/discovered-businesses/${neighbours.next}`} className="btn btn-secondary btn-sm min-h-8">
                      Next &rarr;
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void goAdjacentPage(1)}
                      disabled={!neighbours.hasNextPage || pageLoading}
                      className="btn btn-secondary btn-sm min-h-8"
                    >
                      Next &rarr;
                    </button>
                  )}
                </nav>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold text-fg">{business.name}</h1>
                <p className="mt-0.5 text-sm text-fg-muted">
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
                        Add to Leads
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

      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        {error && (
          <div className="mb-3">
            <ErrorState message={error} onRetry={load} compact />
          </div>
        )}
        {actionError && (
          <div className="mb-3">
            <ErrorState message={actionError} onRetry={() => setActionError(null)} compact />
          </div>
        )}

        {importedLeadId !== null && business?.status === "imported" && (
          <div
            role="status"
            className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-strong bg-surface-subtle px-3 py-2 text-sm"
          >
            <span className="text-fg">
              <strong className="font-semibold">{business.name}</strong> was added to Leads.
            </span>
            <span className="flex items-center gap-2">
              {(importedLeadId || business.imported_lead_id) && (
                <Link href={`/dashboard/leads/${importedLeadId || business.imported_lead_id}`} className="btn btn-secondary btn-sm min-h-8">
                  Open Lead
                </Link>
              )}
              {neighbours && (neighbours.next || neighbours.hasNextPage) && (
                neighbours.next ? (
                  <Link href={`/dashboard/discovered-businesses/${neighbours.next}`} className="btn btn-primary btn-sm min-h-8">
                    Review next &rarr;
                  </Link>
                ) : (
                  <button type="button" onClick={() => void goAdjacentPage(1)} disabled={pageLoading} className="btn btn-primary btn-sm min-h-8">
                    Review next &rarr;
                  </button>
                )
              )}
            </span>
          </div>
        )}

        {!business && !error && <p className="mt-2 text-sm text-fg-muted">Loading…</p>}

        {business && (
          <div className="space-y-3">
            <ReviewSummaryStrip score={latestScore} audit={latestAudit} auditNote={auditNote} reviews={latestReviewIntel} />

            {/* Run Detailed Review — one action orchestrating the
                existing research/audit/score endpoints in sequence,
                with real per-step status instead of three separate
                buttons. Audit is skipped (marked "Not applicable") for
                a business confirmed to have no reachable website,
                rather than showing a misleading failed audit. */}
            <DetailedReviewStrip
              rows={[
                { step: "research", label: "Website research", status: researchStatus, at: latest?.researched_at ?? null },
                { step: "audit", label: "Website quality audit", status: auditStatus, at: latestAudit?.audited_at ?? null },
                { step: "score", label: "Opportunity score", status: scoreStatus, at: latestScore?.scored_at ?? null },
              ]}
              pipelineStep={pipelineStep}
              hasRun={latest !== null}
              knownNoWebsite={knownNoWebsite === true}
              onRun={handleRunDetailedReview}
              onRetry={retryPipelineStep}
            />

            {researchStatus === "failed" && latest?.research_error && (
              <div className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs text-fg-muted">
                <p>
                  The website check couldn&apos;t complete — {describeAnalysisError(latest.research_error)}. This is not a
                  finding about the website.
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer">Technical detail</summary>
                  <p className="mt-1 break-words font-mono">{latest.research_error}</p>
                </details>
              </div>
            )}

            {/* Decision-critical: the two sections a reviewer weighs before
                approving. Larger, and first in reading and tab order. */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <ReviewCard
                prominent
                title="Website quality audit"
                detailLabel="open all findings"
                onOpen={() => setPanel("audit")}
                badge={<CheckStatusBadge status={auditStatus} />}
                summary={
                  latestAudit ? (
                    latestAudit.summary ? (
                      <p className="line-clamp-2">{latestAudit.summary}</p>
                    ) : null
                  ) : (
                    <p>{knownNoWebsite ? "No website on record, so there is nothing to audit." : "No quality audit yet — run a detailed review."}</p>
                  )
                }
                footer={
                  latestAudit && latestAudit.findings.length > 0 ? (
                    <>
                      <CardLinkButton onClick={() => setPanel("audit")}>
                        View all findings ({latestAudit.findings.length})
                      </CardLinkButton>
                      {latestAudit.findings.length > surfacedFindings.length && (
                        <span className="text-xs text-fg-subtle">
                          +{latestAudit.findings.length - surfacedFindings.length} more
                        </span>
                      )}
                    </>
                  ) : undefined
                }
              >
                {latestAudit && surfacedFindings.length > 0 && (
                  <ul className="mt-2.5 space-y-2" aria-label="Most severe findings">
                    {surfacedFindings.map((finding, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Badge tone={SEVERITY_TONE[finding.severity]} className="mt-0.5 shrink-0">
                          {finding.severity}
                        </Badge>
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-fg">{finding.message}</p>
                          <p className="text-xs uppercase tracking-wide text-fg-subtle">
                            {finding.category}
                            {!isHighSeverity(finding.severity) && " · top finding"}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {latestAudit && auditCounts && auditCounts.total === 0 && (
                  <p className="mt-2 text-sm text-fg-subtle">The audit found no issues.</p>
                )}
              </ReviewCard>

              <ReviewCard
                prominent
                title="Opportunity score"
                detailLabel="open full breakdown"
                onOpen={() => setPanel("score")}
                badge={latestScore ? <ScoreCategoryBadge category={latestScore.category} score={latestScore.overall_score} /> : undefined}
                summary={
                  latestScore ? (
                    <p className="line-clamp-3">{latestScore.recommendation_reason}</p>
                  ) : (
                    <p>Not scored yet — run a detailed review.</p>
                  )
                }
                footer={
                  latestScore ? (
                    <>
                      <CardLinkButton onClick={() => setPanel("score")}>View score breakdown</CardLinkButton>
                      <span className="text-xs text-fg-subtle">{Math.round(latestScore.confidence * 100)}% confidence</span>
                    </>
                  ) : undefined
                }
              >
                {latestScore && (latestScore.positive_signals.length > 0 || latestScore.negative_signals.length > 0) && (
                  <div className="mt-2.5 grid grid-cols-2 gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold uppercase tracking-wide text-fg-subtle">Positive</p>
                      <ul className="mt-0.5 space-y-0.5 text-fg-muted">
                        {latestScore.positive_signals.slice(0, 2).map((signal, i) => (
                          <li key={i} className="line-clamp-2">
                            ✓ {signal}
                          </li>
                        ))}
                        {latestScore.positive_signals.length === 0 && <li className="text-fg-subtle">None recorded</li>}
                      </ul>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold uppercase tracking-wide text-fg-subtle">Negative</p>
                      <ul className="mt-0.5 space-y-0.5 text-fg-muted">
                        {latestScore.negative_signals.slice(0, 2).map((signal, i) => (
                          <li key={i} className="line-clamp-2">
                            • {signal}
                          </li>
                        ))}
                        {latestScore.negative_signals.length === 0 && <li className="text-fg-subtle">None recorded</li>}
                      </ul>
                    </div>
                  </div>
                )}
              </ReviewCard>
            </div>

            {/* Supporting evidence — compact cards: title, one summary line,
                a status badge. Full detail opens in the side panel. */}
            <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Supporting evidence</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <ReviewCard
                title="Google reviews"
                detailLabel="open review analysis"
                onOpen={() => setPanel("reviews")}
                summary={reviewsSummary}
                actions={
                  <CardLinkButton onClick={handleReviewAnalysis} disabled={analyzingReviews}>
                    {analyzingReviews ? "Analyzing…" : latestReviewIntel ? "Refresh" : "Analyze"}
                  </CardLinkButton>
                }
              />

              <ReviewCard
                title="Website research"
                detailLabel="open research evidence"
                onOpen={() => setPanel("research")}
                summary={researchSummary}
                badge={<CheckStatusBadge status={researchStatus} />}
              />

              <ReviewCard
                title="Contact & location"
                detailLabel="open contact details"
                onOpen={() => setPanel("contact")}
                summary={contactSummary}
              />

              {missingInfo.length > 0 && (
                <ReviewCard
                  title="Missing information"
                  detailLabel="open list"
                  onOpen={() => setPanel("missing")}
                  summary={missingInfo.length > 1 ? `${missingInfo[0]} · +${missingInfo.length - 1} more` : missingInfo[0]}
                  badge={<Badge tone="warning">{missingInfo.length}</Badge>}
                />
              )}

              {business.instagram_handle && (
                <ReviewCard
                  title="Instagram"
                  detailLabel="open Instagram details"
                  onOpen={() => setPanel("instagram")}
                  summary={instagramSummary}
                  actions={
                    igState && igState !== "website_found" ? (
                      <CardLinkButton onClick={handleCheckWebsite} disabled={checkingWebsite}>
                        {checkingWebsite ? "Checking…" : igState === "check_pending" ? "Check now" : "Check for website"}
                      </CardLinkButton>
                    ) : undefined
                  }
                />
              )}

              <ReviewCard
                title="Desktop / mobile screenshots"
                detailLabel="open screenshots"
                onOpen={() => setPanel("screenshots")}
                summary={screenshot.src ? "Capture from Planning" : "Not captured yet — generated in Planning"}
                badge={
                  screenshot.src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- an authenticated API route, not an optimizable static asset
                    <img
                      src={screenshot.src}
                      alt=""
                      loading="lazy"
                      onError={screenshot.markFailed}
                      className="h-8 w-14 rounded border border-border object-cover object-top"
                    />
                  ) : undefined
                }
              />

              <ReviewCard
                title="Sources, timestamps & confidence"
                detailLabel="open sources"
                onOpen={() => setPanel("sources")}
                summary={`Discovered via ${business.source_provider} · ${timeAgo(business.discovered_at)}`}
                badge={latestScore ? <Badge tone="muted">{Math.round(latestScore.confidence * 100)}% confidence</Badge> : undefined}
              />

              <ReviewCard
                title="Stage checklist"
                detailLabel="open checklist"
                onOpen={() => setPanel("checklist")}
                summary={
                  stageChecklist.error ? stageChecklist.error : checklist ? checklistSummary(checklist.progress) : "Loading…"
                }
                badge={checklistPct !== null ? <Badge tone={checklistPct === 100 ? "success" : "muted"}>{checklistPct}%</Badge> : undefined}
              />
            </div>
          </div>
        )}
      </div>

      {openPanel && (
        <ReviewDetailPanel
          key={panel}
          title={openPanel.title}
          subtitle={openPanel.subtitle}
          actions={openPanel.actions}
          onClose={() => setPanel(null)}
        >
          {openPanel.body}
        </ReviewDetailPanel>
      )}
    </div>
  );
}
