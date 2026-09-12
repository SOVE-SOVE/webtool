"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, PLANNING_STATUS_LABELS, type Planning, type PlanningStatus } from "@/lib/api";
import { TabBar, type TabItem } from "@/components/ui/Tabs";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/ToastProvider";
import { STATUS_BADGE_CLASS } from "../lib";
import { AnalyseWebsiteAction } from "./AnalyseWebsiteAction";
import { AnalysingProgress } from "./AnalysingProgress";
import { AuditTab } from "./AuditTab";
import { NotesTab } from "./NotesTab";
import { OverviewTab } from "./OverviewTab";
import { ReviewInsightsTab } from "./ReviewInsightsTab";

// If a run has been sitting at "analysing" longer than this with no
// progress, the background worker likely never picked it up (or died
// mid-job) — offer a manual retry rather than leaving the operator
// stuck watching a spinner forever.
const STALE_ANALYSING_MS = 60_000;

const TABS: TabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "audit", label: "Website Audit" },
  { id: "reviews", label: "Google Review Insights" },
  { id: "notes", label: "Notes" },
];

export default function PlanningDetailPage() {
  const params = useParams<{ id: string }>();
  const planningId = params.id;
  const router = useRouter();
  const confirm = useConfirm();
  const showToast = useToast();

  const [planning, setPlanning] = useState<Planning | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

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

  // Only poll while a run is actually in progress — ready_to_analyse is
  // a stable resting state (waiting on the operator), not transient.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!planning || planning.status !== "analysing") return;
    const id = setInterval(() => {
      load();
      setNow(Date.now());
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning?.status, planningId]);

  // "Completed: automatically open Overview" — only on the transition
  // into completed (e.g. a run finished while the operator had Notes
  // open), never re-forcing the tab back on every subsequent poll.
  const prevStatusRef = useRef<PlanningStatus | undefined>(undefined);
  useEffect(() => {
    if (!planning) return;
    if (prevStatusRef.current === "analysing" && planning.status === "completed") {
      setActiveTab("overview");
    }
    prevStatusRef.current = planning.status;
  }, [planning]);

  async function handleCreateProject() {
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
  if (!planning) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;

  const isAnalysing = planning.status === "analysing";
  const isStale = isAnalysing && now - new Date(planning.updated_at).getTime() > STALE_ANALYSING_MS;
  const hasAudit = planning.website_audit_id !== null;
  const readyForHandoff = hasAudit && !isAnalysing;
  const showLastUpdated = Boolean(planning.analysed_at || planning.review_insights_generated_at);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/dashboard/leads/${planning.lead_id}`} className="text-sm text-fg-muted hover:underline">
          ← Back to lead
        </Link>
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

      {/* Header — business name, website, audit status, last updated, and the one restrained handoff action. */}
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {planning.lead_business_name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[planning.status]}`}>
              {PLANNING_STATUS_LABELS[planning.status]}
            </span>
            {showLastUpdated && (
              <span className="text-xs text-fg-subtle">Last updated {new Date(planning.updated_at).toLocaleString()}</span>
            )}
          </div>
        </div>
        {readyForHandoff && (
          <div className="shrink-0">
            {createdProjectId ? (
              <Link href={`/dashboard/projects/${createdProjectId}`} className="btn btn-primary btn-sm">
                Open project →
              </Link>
            ) : (
              <button type="button" onClick={handleCreateProject} disabled={creatingProject} className="btn btn-primary btn-sm">
                {creatingProject ? "Creating…" : "Create project"}
              </button>
            )}
          </div>
        )}
      </header>
      {createProjectError && <p className="text-error">{createProjectError}</p>}

      {isAnalysing ? (
        <div className="rounded-md border border-border bg-surface p-6">
          <h2 className="section-title">Analysing this website</h2>
          <p className="mt-0.5 text-sm text-fg-muted">This page updates automatically once the run finishes.</p>
          <AnalysingProgress startedAt={planning.updated_at} />
          {isStale && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="text-sm text-amber-900 dark:text-amber-300">This is taking longer than expected — it may be stuck.</p>
              <button type="button" onClick={handleRetry} disabled={retrying} className="btn btn-secondary btn-sm shrink-0">
                {retrying ? "Retrying…" : "Retry analysis"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
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
                This analysis needs a quick look — part of it (visual review or summary) may be incomplete. Check the
                findings before relying on them.
              </p>
            </div>
          )}

          <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />

          <div>
            {activeTab === "overview" && (
              <OverviewTab
                planning={planning}
                onUpdated={setPlanning}
                onOpenAuditTab={() => setActiveTab("audit")}
                onOpenNotesTab={() => setActiveTab("notes")}
              />
            )}
            {activeTab === "audit" && <AuditTab planning={planning} />}
            {activeTab === "reviews" && <ReviewInsightsTab planning={planning} onUpdated={setPlanning} />}
            {activeTab === "notes" && <NotesTab planning={planning} onUpdated={setPlanning} />}
          </div>
        </>
      )}
    </div>
  );
}
