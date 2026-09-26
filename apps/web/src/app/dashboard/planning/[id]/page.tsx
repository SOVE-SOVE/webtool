"use client";

import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, ApiError, PLANNING_STATUS_LABELS, type Lead, type Planning, type PlanningStatus } from "@/lib/api";
import { useStageChecklist } from "@/components/checklists/StageChecklistPanel";
import { DoThisNext } from "@/components/ui/DoThisNext";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { STATUS_BADGE_TONE, planningMode } from "../lib";
import { AnalyseWebsiteAction } from "./AnalyseWebsiteAction";
import { NotesPanel } from "./NotesPanel";
import { PlanStep } from "./PlanStep";
import { ProcessNav } from "./ProcessNav";
import {
  STEP_ORDER,
  computeStepStatus,
  computeStepSummary,
  isStepId,
  lastStepStorageKey,
  legacyTabToStep,
  parseStoredStep,
  resolveStepId,
  stepIndex,
  type StepId,
  type StepStatus,
} from "./processSteps";
import { ResearchStep } from "./ResearchStep";
import { ReviewStep } from "./ReviewStep";
import { computeHandoffReadiness } from "./handoffReadiness";
import { WebsitePreviewPanel } from "./WebsitePreviewPanel";

// "Resume where you left off" — reads/writes are wrapped in try/catch the
// same way components/nav/Sidebar.tsx guards its own localStorage access
// (private browsing / storage disabled shouldn't ever throw here, just
// silently not remember). The key itself and the "is this a real step
// id" check are the pure, tested half — see processSteps.ts.
function readLastStep(planningId: string): StepId | null {
  try {
    return parseStoredStep(localStorage.getItem(lastStepStorageKey(planningId)));
  } catch {
    return null;
  }
}

function writeLastStep(planningId: string, step: StepId): void {
  try {
    localStorage.setItem(lastStepStorageKey(planningId), step);
  } catch {
    // Private browsing / storage disabled — resuming later just won't work.
  }
}

// If a run has been sitting at "analysing" longer than this with no
// progress, the background worker likely never picked it up (or died
// mid-job) — offer a manual retry rather than leaving the operator
// stuck watching a spinner forever.
const STALE_ANALYSING_MS = 60_000;

// useSearchParams() needs a Suspense-boundary ancestor for Next's static
// generation (see dashboard/settings/page.tsx for the same pattern) —
// it also carries the business name across the Lead→Planning
// navigation for continuity while this page's own fetch is in flight.
function PlanningDetailPageInner() {
  const params = useParams<{ id: string }>();
  const planningId = params.id;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const continuityName = searchParams.get("name");
  const confirm = useConfirm();
  const showToast = useToast();

  // Step is URL-addressable the same way the old `?tab=` was — a plain
  // query param, shareable/back-button-safe, no local state to keep in
  // sync. Old `?tab=` deep links (and a bare "notes" one, which no
  // longer names a step at all) and old 5-step `?step=` ids
  // (understand/presence/improvements/prepare/handoff — resolveStepId)
  // are read here too and mapped forward — see the redirect effect
  // below, which cleans the URL to the current `?step=` form without
  // changing what's on screen.
  const stepParam = searchParams.get("step");
  const legacyTab = searchParams.get("tab");
  const legacyMappedStep = legacyTab && legacyTab !== "notes" ? legacyTabToStep(legacyTab) : null;
  const resolvedStepParam = resolveStepId(stepParam);
  const isLegacyStepParam = resolvedStepParam !== null && !isStepId(stepParam);
  const activeStep: StepId = resolvedStepParam ?? legacyMappedStep ?? "research";

  function setStep(id: StepId) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("tab");
    if (id === "research") next.delete("step");
    else next.set("step", id);
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    writeLastStep(planningId, id);
  }

  // Plan's unsaved edits (a feature's notes, or the advanced layout
  // editor's section inspector — reported up by PlanStep) guard EVERY way
  // of leaving that step through this page — Previous/Continue and the
  // stepper alike — rather than only its own Continue button.
  const [planDirty, setPlanDirty] = useState(false);
  async function requestStep(id: StepId) {
    if (id !== activeStep && activeStep === "plan" && planDirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        description: "Plan has edits that haven't been saved yet. Leaving this step will discard them.",
        confirmLabel: "Discard changes",
        danger: true,
      });
      if (!ok) return;
      setPlanDirty(false);
    }
    setStep(id);
  }

  // Resume where the operator left off on THIS plan — but only landing
  // here with nothing explicit in the URL already; an explicit `?step=`
  // (handled above) or a legacy `?tab=` (handled below, which itself
  // calls setStep and so also wins) always takes priority over the
  // remembered step, and browser Back/Forward never re-triggers this
  // (it depends on `planningId`, not on the URL). An invalid/stale
  // remembered id (parseStoredStep) or nothing stored at all just leaves
  // the URL alone, which already defaults to "research". A step
  // remembered before the 3-step merge (e.g. "prepare") maps forward in
  // parseStoredStep and is re-written in the new form by setStep.
  useEffect(() => {
    if (stepParam || legacyTab) return;
    const remembered = readLastStep(planningId);
    if (remembered && remembered !== "research") setStep(remembered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planningId]);

  // A bare old `?tab=notes` link opens the Notes panel once, on arrival
  // — a lazy initializer (not an effect-driven setState) so it's read
  // exactly once, from whatever the URL was on mount.
  const [notesOpen, setNotesOpen] = useState(() => searchParams.get("tab") === "notes");

  useEffect(() => {
    if (!legacyTab && !isLegacyStepParam) return;
    setStep(activeStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyTab, isLegacyStepParam]);

  // Restores the exact filters/scroll the operator left the Planning
  // list in, instead of always resetting to the bare list URL.
  const [planningReturnUrl] = useState(
    () =>
      (typeof window !== "undefined" && sessionStorage.getItem("wdos-list-return:planning")) ||
      "/dashboard/build/planning",
  );

  const [planning, setPlanning] = useState<Planning | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Lifted (rather than left inside a child) so both the always-visible
  // checklist widget below and the step process's own status badges
  // (ProcessNav/computeStepStatus, and Review & build's own concise summary)
  // read the exact same fetch — see useStageChecklist's own docstring
  // for why it tolerates an empty id ahead of `planning` loading.
  const {
    checklist,
    users: checklistUsers,
    error: checklistError,
    setChecklist,
    reload: reloadChecklist,
  } = useStageChecklist("planning", planning?.id ?? "");

  function load() {
    api
      .getPlanningItem(planningId)
      .then((p) => {
        setLoadError(null);
        setPlanning(p);
      })
      .catch(() => setLoadError("Couldn't load this Planning item."));
  }

  useEffect(load, [planningId]);

  // The Lead's own business record (industry/location/contact) — needed
  // for Research's business-details rows and New Website Plan mode's
  // completeness rows, but cheap enough to just always have on hand.
  useEffect(() => {
    if (!planning) return;
    api
      .getLead(planning.lead_id)
      .then(setLead)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning?.lead_id]);

  // Only poll while a run is actually in progress — ready_to_analyse is
  // a stable resting state (waiting on the operator), not transient.
  // Covers both the main audit pipeline (status) and the optional
  // comparable-site analysis job (comparable_research_status) — two
  // independent background runs that can each be "in progress".
  const [now, setNow] = useState(() => Date.now());
  const isAnalysing = planning?.status === "analysing";
  const isAnalysingComparableSites = planning?.comparable_research_status === "analysing";
  const isGeneratingContentDraft = planning?.content_draft_status === "generating";
  useEffect(() => {
    if (!isAnalysing && !isAnalysingComparableSites && !isGeneratingContentDraft) return;
    const id = setInterval(() => {
      load();
      setNow(Date.now());
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnalysing, isAnalysingComparableSites, isGeneratingContentDraft, planningId]);

  // "Completed: automatically open Research" — only on
  // the transition into completed (e.g. a run finished while the
  // operator had Notes open), never re-forcing the step back on every
  // subsequent poll. This is where the old Overview tab used to jump to
  // as well — the freshly-completed audit/plan now lives in Research.
  const prevStatusRef = useRef<PlanningStatus | undefined>(undefined);
  useEffect(() => {
    if (!planning) return;
    // Never yanks the operator off Plan mid-edit (see requestStep).
    if (prevStatusRef.current === "analysing" && planning.status === "completed" && !planDirty) {
      setStep("research");
    }
    prevStatusRef.current = planning.status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning]);

  // Publishes the real, current height of everything above the step
  // content (back-nav row, sticky header, any notice banners, the
  // stepper) as `--planning-above-h` on `outerRef` — the same measured-
  // CSS-variable approach dashboard/discovery/layout.tsx uses for
  // `--discovery-layer-h`, adapted here because this chrome's height
  // genuinely varies (a stale/failed/needs-review banner can appear or
  // disappear, the header can wrap onto a second line) in a way no fixed
  // offset could account for. Only "Plan" reads it (see
  // PlanStep.tsx, which combines it with its own measured height to
  // size the Website Blueprint editor to the real remaining viewport) —
  // for every other step this is simply never observed, at no cost.
  const chromeRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outer = outerRef.current;
    const chrome = chromeRef.current;
    if (activeStep !== "plan" || !outer || !chrome) {
      outerRef.current?.style.removeProperty("--planning-above-h");
      return;
    }
    const publish = () => outer.style.setProperty("--planning-above-h", `${chrome.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(chrome);
    return () => {
      observer.disconnect();
      outer.style.removeProperty("--planning-above-h");
    };
    // `planning` (not just `activeStep`) is a real dependency here: while
    // it's still loading, the skeleton branch below renders neither ref,
    // so this would otherwise run once against two nulls and never again
    // once the real chrome mounts — `activeStep` alone never changes
    // across that loading→loaded transition to re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, Boolean(planning)]);

  // A ref, not state: two clicks in the same tick both see
  // `creatingProject === false` before React re-renders, and the backend's
  // "already has a project" check isn't atomic under concurrent requests —
  // a same-tick double-click previously created two projects.
  const createInFlight = useRef(false);
  async function handleCreateProject() {
    if (createInFlight.current) return;
    createInFlight.current = true;
    setCreatingProject(true);
    setCreateProjectError(null);
    try {
      const project = await api.createProjectFromPlanning(planningId);
      setCreatedProjectId(project.id);
    } catch (err) {
      setCreateProjectError(
        err instanceof ApiError ? err.message : "Couldn't create a project from this Planning item.",
      );
    } finally {
      createInFlight.current = false;
      setCreatingProject(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      setPlanning(await api.analysePlanning(planningId));
      showToast("Retrying the analysis.");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Couldn't retry the analysis.", "error");
    } finally {
      setRetrying(false);
    }
  }

  async function handleRetryContentDraft() {
    setRetrying(true);
    try {
      setPlanning(await api.generateContentDraft(planningId));
      showToast("Retrying content draft generation.");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Couldn't retry content draft generation.", "error");
    } finally {
      setRetrying(false);
    }
  }

  async function handleRemove() {
    if (!planning) return;
    const ok = await confirm({
      title: "Remove this Planning item?",
      description:
        `This removes the Planning record for ${planning.website_url ?? "this lead"} — including its audit ` +
        "findings and screenshots. It does not delete the underlying lead, or any client or project attached to " +
        "it. You can start Planning for this lead again later.",
      confirmLabel: "Remove from Planning",
      danger: true,
    });
    if (!ok) return;

    setRemoving(true);
    setRemoveError(null);
    try {
      await api.deletePlanning(planningId);
      showToast("Removed from Planning.");
      router.push("/dashboard/planning");
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : "Couldn't remove this Planning item.");
      setRemoving(false);
    }
  }

  if (loadError) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState message={loadError} onRetry={load} />
      </div>
    );
  }
  if (!planning) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        {continuityName && (
          <h1 className="truncate text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{continuityName}</h1>
        )}
        <div className="space-y-3">
          <div className="skeleton h-4 w-48" />
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-2/3" />
        </div>
      </div>
    );
  }

  const isStale = isAnalysing && now - new Date(planning.updated_at).getTime() > STALE_ANALYSING_MS;
  const isContentDraftStale =
    isGeneratingContentDraft && now - new Date(planning.updated_at).getTime() > STALE_ANALYSING_MS;
  const hasAudit = planning.website_audit_id !== null;
  const mode = planningMode(planning);
  // "Ready to hand off" for either mode: a real audit, or a generated
  // Website Plan — and never mid-run.
  // Blockers vs warnings for Create project — only the existing
  // prerequisite rules (research on file + not mid-run, and the backend's
  // approved-Build-Brief rule), see handoffReadiness.ts.
  const readiness = computeHandoffReadiness(planning, checklist);
  const showLastUpdated = Boolean(
    planning.analysed_at || planning.review_insights_generated_at || planning.website_plan_generated_at,
  );

  const stepStatuses = Object.fromEntries(
    STEP_ORDER.map((id) => [id, computeStepStatus(id, planning, checklist)]),
  ) as Record<StepId, StepStatus>;
  const stepSummaries = Object.fromEntries(
    STEP_ORDER.map((id) => [id, computeStepSummary(id, planning, checklist)]),
  ) as Record<StepId, string | null>;

  const currentIndex = stepIndex(activeStep);
  const goPrevious = currentIndex > 0 ? () => requestStep(STEP_ORDER[currentIndex - 1]) : undefined;
  const goNext = currentIndex < STEP_ORDER.length - 1 ? () => requestStep(STEP_ORDER[currentIndex + 1]) : undefined;
  // A project already made from this plan (this session, or earlier —
  // the handoff is idempotent server-side) always offers "Open project",
  // never a second "Create project".
  const projectId = createdProjectId ?? planning.project_id;

  return (
    <div className="content-reveal p-4 sm:p-6">
    {/* Tighter `gap-4` (was `space-y-6`) between the rows below — the
        vertical room that removing the 220px nav column and the top
        checklist panel freed up. `chromeRef` wraps everything down
        through the stepper — on "Plan" its measured
        height feeds `--planning-above-h` (see the effect below), the one
        genuinely dynamic input the Website Blueprint's height calc needs
        (see PlanStep.tsx for the other half and the full explanation:
        a live-measured value, not a guessed offset, because notices here
        can appear/disappear and the header can wrap). */}
    <div ref={outerRef} className="flex flex-col gap-4">
      <div ref={chromeRef} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Link href={planningReturnUrl} className="text-fg-muted hover:underline">
            ← All Planning
          </Link>
          <Link href={`/dashboard/leads/${planning.lead_id}`} className="text-fg-muted hover:underline">
            ← Back to lead
          </Link>
        </div>
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className="text-sm text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
        >
          {removing ? "Removing…" : "Remove from Planning"}
        </button>
      </div>
      {removeError && <p className="text-error">{removeError}</p>}

      {/* Header — business name, website, audit status, last updated, and the one restrained handoff action.
          Sticky so it stays visible while scrolling: top-12 clears the
          existing mobile fixed top bar (h-12), lg:top-11 clears the
          new desktop header strip (h-11) added in dashboard/layout.tsx.
          Negative-margin-then-repad bleeds the opaque background full-
          width past the page's own edge padding; the inner div keeps
          content aligned to that same edge (no max-w cap — this page
          fills the dashboard's available content width). Vertical
          padding tightened to py-3 (was py-4) as part of this same pass. */}
      <header className="sticky top-12 z-20 -mx-4 border-b border-border bg-surface px-4 py-3 sm:-mx-6 sm:px-6 lg:top-11">
      {/* Below `sm` this stays the plain stacked column it always was
          (name, then metadata, then the action) — nothing here changes
          for mobile. At `sm` and up it becomes a 3-track grid
          (`[1fr_auto_1fr]`): the name+metadata block always sits in the
          fixed middle track (`sm:col-start-2`, its text centered) and the
          action sits in the right track (`sm:col-start-3`, pinned to that
          track's own end) — column 1 is a deliberately empty spacer
          track. Because both outer tracks are the same `1fr` weight, they
          stay equal width regardless of whether the action is actually
          rendered (an empty `1fr` track still claims its fair share of
          the row's free space), which is what keeps the name block
          genuinely centered on the FULL row width whether or not
          "Create project"/"Open project" is showing — not just centered
          in whatever space happens to be left of one visible action. */}
      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-start sm:gap-4">
        <div className="min-w-0 sm:col-start-2 sm:text-center">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {planning.lead_business_name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:justify-center">
            {planning.website_url ? (
              <a
                href={planning.website_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-fg-muted hover:text-fg hover:underline"
              >
                {planning.website_url}
              </a>
            ) : (
              <span className="text-sm text-fg-subtle">No website on record</span>
            )}
            <span title="Analysis status">
              <Badge tone={STATUS_BADGE_TONE[planning.status]}>{PLANNING_STATUS_LABELS[planning.status]}</Badge>
            </span>
            {showLastUpdated && (
              <span className="text-xs text-fg-subtle">Last updated {new Date(planning.updated_at).toLocaleString()}</span>
            )}
          </div>
        </div>
        {/* Only "Open project" lives up here now — creating one happens on
            "Confirm & create project", after its summary and blockers,
            rather than from a second button that skips them. */}
        {projectId && (
          <div className="shrink-0 sm:col-start-3 sm:justify-self-end">
            <Link href={`/dashboard/projects/${projectId}`} className="btn btn-primary btn-sm">
              Open project →
            </Link>
          </div>
        )}
      </div>
      </header>
      {createProjectError && <p className="text-error">{createProjectError}</p>}

      {isStale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm text-amber-900 dark:text-amber-300">This is taking longer than expected — it may be stuck.</p>
          <button type="button" onClick={handleRetry} disabled={retrying} className="btn btn-secondary btn-sm shrink-0">
            {retrying ? "Retrying…" : "Retry analysis"}
          </button>
        </div>
      )}
      {isContentDraftStale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm text-amber-900 dark:text-amber-300">
            Content draft generation is taking longer than expected — it may be stuck.
          </p>
          <button
            type="button"
            onClick={handleRetryContentDraft}
            disabled={retrying}
            className="btn btn-secondary btn-sm shrink-0"
          >
            {retrying ? "Retrying…" : "Retry generation"}
          </button>
        </div>
      )}
      {planning.status === "failed" && hasAudit && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
          <p className="text-sm text-red-800 dark:text-red-300">
            {planning.error_message ?? "The last re-analysis didn't finish — the findings below are from the previous run."}
          </p>
          <AnalyseWebsiteAction planning={planning} onAnalysed={setPlanning} variant="inline" />
        </div>
      )}
      {planning.status === "needs_review" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm text-amber-900 dark:text-amber-300">
            This workspace needs a quick look — part of it may be incomplete. Check{" "}
            {mode === "existing" ? "the findings" : "the plan"} before relying on it.
          </p>
        </div>
      )}

      {/* Horizontal stepper — replaces the old 220px vertical sidebar.
          Centered within the available width via the intrinsically-sized
          `<ol>` inside ProcessNav; capped here so it never stretches
          edge-to-edge on very wide screens. The top-level "Planning
          checklist" panel that used to sit here is gone — its data
          (`checklist`/`checklistUsers`/`checklistError`) is untouched and
          now only reaches the UI through Review & build's own quiet "View
          checklist" control (see ReviewStep.tsx) and the step statuses
          below. */}
      {/* Capped/centered (`max-w-3xl`) for every step except "Plan" —
          that step's own content column below drops that same
          cap (see the step-content wrapper's className further down,
          `activeStep === "plan"`) since its canvas wants the full
          available width, not a comfortable reading column. Matching
          this row's own cap to that — both `w-full`, both direct children
          of `outerRef` — is what puts the "Notes" button's right edge on
          the same vertical line as the canvas's right edge below and
          "View current website"'s right edge inside it (PlanStep.tsx):
          all three simply span the same unconstrained parent width, so
          there's nothing here that could drift out of sync the way two
          independently hard-coded offsets could. */}
      <div className={activeStep === "plan" ? "w-full" : "mx-auto w-full max-w-3xl"}>
        <ProcessNav
          active={activeStep}
          statuses={stepStatuses}
          summaries={stepSummaries}
          onChange={requestStep}
          hasNotes={Boolean(planning.operator_notes && planning.operator_notes.trim())}
          onOpenNotes={() => setNotesOpen(true)}
        />
      </div>
      </div>

      {/* step content / website preview. Below `xl` this is a plain stack
          (content, then the preview drawer) — no cramming. Only at `xl`
          (1280px+, where there's genuinely room) does the preview get its
          own 320px sidebar column beside the content. It's a single
          `WebsitePreviewPanel` instance in both shapes — never remounted
          by breakpoint or by `activeStep` (that key only wraps the step
          content below) — so its own collapse state and EvidencePanel's
          Desktop/Mobile + Expand state persist across both.

          "Plan" is the one exception, in two ways: it
          drops the `xl` 320px preview column entirely (no reserved-but-
          empty column) and gives that width to the requirements board's
          canvas instead (see PlanStep's own "View current website"
          trigger, CurrentWebsiteDialog, for the on-demand replacement);
          and it drops the `mx-auto max-w-6xl` centering every other step
          gets, since the canvas wants the full available width, not a
          comfortable reading column. The `WebsitePreviewPanel` instance
          below stays mounted either way (`hidden`, never removed from the
          tree) so switching back to any other step finds it exactly as it
          was left — nothing about its own collapse/Desktop-Mobile/Expand
          state is reset by visiting Plan. */}
      <div
        className={
          activeStep === "plan" ? "" : "mx-auto w-full max-w-6xl xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8"
        }
      >
        <div key={activeStep} className="min-w-0">
          {activeStep === "research" && (
            <ResearchStep planning={planning} lead={lead} onUpdated={setPlanning} onNext={goNext!} />
          )}
          {activeStep === "plan" && (
            <PlanStep
              planning={planning}
              lead={lead}
              onUpdated={setPlanning}
              onDirtyChange={setPlanDirty}
              onBriefApproved={reloadChecklist}
              onPrevious={goPrevious!}
              onNext={goNext!}
            />
          )}
          {activeStep === "review" && (
            <ReviewStep
              planning={planning}
              lead={lead}
              checklist={checklist}
              checklistUsers={checklistUsers}
              checklistError={checklistError}
              onChecklistUpdated={setChecklist}
              onUpdated={setPlanning}
              readiness={readiness}
              onBriefApproved={reloadChecklist}
              creatingProject={creatingProject}
              createProjectError={createProjectError}
              projectId={projectId}
              onCreateProject={handleCreateProject}
              onPrevious={goPrevious!}
            />
          )}
        </div>

        <div className={`mt-4 xl:mt-0 xl:self-start ${activeStep === "plan" ? "hidden" : ""}`}>
          <WebsitePreviewPanel planning={planning} />
        </div>
      </div>
    </div>

    {notesOpen && <NotesPanel planning={planning} onUpdated={setPlanning} onClose={() => setNotesOpen(false)} />}

    {/* Scoped to the project this Planning item has been transferred
        to, if any — renders nothing before that handoff happens (see
        DoThisNext.tsx), rather than a global cross-workspace queue. */}
    <DoThisNext projectId={planning.project_id} />
    </div>
  );
}

export default function PlanningDetailPage() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6" />}>
      <PlanningDetailPageInner />
    </Suspense>
  );
}
