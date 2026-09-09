"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, PLANNING_STATUS_LABELS, type Planning } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/ToastProvider";

const AREA_LABELS: Record<string, string> = {
  technical: "Technical",
  seo: "SEO",
  accessibility: "Accessibility",
  usability: "Usability",
  visual: "Visual",
};

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  medium: "bg-surface-subtle text-fg-muted",
  low: "bg-surface-subtle text-fg-subtle",
};

// If a run has been sitting at "analysing" longer than this with no
// progress, the background worker likely never picked it up (or died
// mid-job) — offer a manual retry rather than leaving the operator
// stuck watching a spinner forever.
const STALE_ANALYSING_MS = 60_000;

const STATUS_BADGE_CLASS: Record<Planning["status"], string> = {
  ready_to_analyse: "bg-surface-subtle text-fg-muted",
  analysing: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  needs_review: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

function groupByArea(points: Planning["key_points"]): [string, Planning["key_points"]][] {
  const groups = new Map<string, Planning["key_points"]>();
  for (const point of points) {
    const list = groups.get(point.area) ?? [];
    list.push(point);
    groups.set(point.area, list);
  }
  return Array.from(groups.entries());
}

function AnalyseWebsiteCard({
  planning,
  onAnalysed,
}: {
  planning: Planning;
  onAnalysed: (updated: Planning) => void;
}) {
  const [url, setUrl] = useState(planning.website_url ?? "");
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyse(e: React.FormEvent) {
    e.preventDefault();
    setAnalysing(true);
    setError(null);
    try {
      onAnalysed(await api.analysePlanning(planning.id, url.trim() ? { website_url: url.trim() } : undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the analysis.");
    } finally {
      // Always clear the local "Starting…" state once the request
      // settles — previously only cleared on error, so a successful
      // call that didn't immediately flip `planning.status` away from
      // ready_to_analyse/failed left this button stuck saying
      // "Starting…" forever even though the request had long finished.
      setAnalysing(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="section-title">
        {planning.status === "failed" ? "Try analysing again" : "Analyse this website"}
      </h2>
      <p className="mt-0.5 text-sm text-fg-muted">
        Runs the public website analysis — technical, SEO, mobile, and visual findings, plus a neutral summary —
        and shows progress here.
      </p>
      <form onSubmit={handleAnalyse} className="mt-3 flex flex-wrap items-center gap-2">
        {!planning.website_url && (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            required
            className="w-full max-w-sm rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm sm:w-auto"
          />
        )}
        <button type="submit" disabled={analysing || !url.trim()} className="btn btn-primary btn-sm">
          {analysing ? "Starting…" : "Analyse Website"}
        </button>
      </form>
      {error && <p className="mt-2 text-error">{error}</p>}
    </div>
  );
}

export default function PlanningDetailPage() {
  const params = useParams<{ id: string }>();
  const planningId = params.id;
  const router = useRouter();
  const confirm = useConfirm();
  const showToast = useToast();

  const [planning, setPlanning] = useState<Planning | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingSummary, setSavingSummary] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [retryingStale, setRetryingStale] = useState(false);

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
  // now a stable resting state (waiting on the operator), not transient.
  // `now` only ever changes inside this effect (never read impurely
  // during render) — it's what lets the "stale, still analysing" check
  // below re-evaluate on the same cadence as the refetch.
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

  async function handleSaveSummary(value: string) {
    if (!planning || value === (planning.website_summary ?? "")) return;
    setSavingSummary(true);
    try {
      setPlanning(await api.updatePlanning(planningId, { website_summary: value }));
    } finally {
      setSavingSummary(false);
    }
  }

  async function handleSaveNotes(value: string) {
    if (!planning || value === (planning.operator_notes ?? "")) return;
    setSavingNotes(true);
    try {
      setPlanning(await api.updatePlanning(planningId, { operator_notes: value }));
    } finally {
      setSavingNotes(false);
    }
  }

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

  async function handleRetryStale() {
    setRetryingStale(true);
    try {
      setPlanning(await api.analysePlanning(planningId));
      showToast("Retrying the analysis.");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Couldn't retry the analysis.", "error");
    } finally {
      setRetryingStale(false);
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

  const groupedPoints = groupByArea(planning.key_points);
  const isAnalysing = planning.status === "analysing";
  const isStale = isAnalysing && now - new Date(planning.updated_at).getTime() > STALE_ANALYSING_MS;
  const canAnalyse = planning.status === "ready_to_analyse" || planning.status === "failed";
  const hasAudit = planning.website_audit_id !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
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

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="page-title">{planning.website_url ?? "No website yet"}</h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              Started {new Date(planning.created_at).toLocaleString()}
              {planning.analysed_at && ` · analysed ${new Date(planning.analysed_at).toLocaleString()}`}
              {planning.detected_technology && ` · built with ${planning.detected_technology}`}
            </p>
          </div>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[planning.status]}`}>
            {PLANNING_STATUS_LABELS[planning.status]}
          </span>
        </div>
        {isAnalysing && !isStale && (
          <p className="mt-3 text-sm text-fg-muted">
            Running the analysis in the background — this page updates automatically.
          </p>
        )}
        {isStale && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-sm text-amber-900 dark:text-amber-300">
              This is taking longer than expected — it may be stuck.
            </p>
            <button
              onClick={handleRetryStale}
              disabled={retryingStale}
              className="btn btn-secondary btn-sm shrink-0"
            >
              {retryingStale ? "Retrying…" : "Retry analysis"}
            </button>
          </div>
        )}
        {planning.status === "failed" && planning.error_message && (
          <p className="mt-3 text-error">{planning.error_message}</p>
        )}
      </div>

      {canAnalyse && <AnalyseWebsiteCard planning={planning} onAnalysed={setPlanning} />}

      {hasAudit && !isAnalysing && (
        <>
          {/* Website Summary */}
          <div>
            <h2 className="section-title">Website summary</h2>
            <textarea
              key={planning.id + (planning.analysed_at ?? "")}
              defaultValue={planning.website_summary ?? ""}
              onBlur={(e) => handleSaveSummary(e.target.value)}
              rows={4}
              disabled={savingSummary}
              className="mt-1.5 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
            />
          </div>

          {/* Key Points */}
          <div>
            <h2 className="section-title">Key points</h2>
            {groupedPoints.length === 0 ? (
              <p className="mt-1.5 text-sm text-fg-muted">No issues found in this analysis.</p>
            ) : (
              <div className="mt-1.5 space-y-3">
                {groupedPoints.map(([area, points]) => (
                  <div key={area}>
                    <p className="text-xs font-medium text-fg-subtle">{AREA_LABELS[area] ?? area}</p>
                    <ul className="mt-1 space-y-1.5">
                      {points.map((point, i) => (
                        <li key={i} className="rounded-md border border-border p-2 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-fg">{point.message}</span>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                                SEVERITY_CLASS[point.severity] ?? SEVERITY_CLASS.low
                              }`}
                            >
                              {point.severity}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-fg-subtle">Evidence: {point.evidence}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Evidence screenshots */}
          {(planning.screenshot_desktop_base64 || planning.screenshot_mobile_base64) && (
            <div>
              <button
                onClick={() => setShowEvidence((v) => !v)}
                className="section-title hover:text-fg"
              >
                {showEvidence ? "▾" : "▸"} Evidence screenshots
              </button>
              {showEvidence && (
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {planning.screenshot_desktop_base64 && (
                    <div>
                      <p className="mb-1 text-xs text-fg-subtle">Desktop</p>
                      <img
                        src={`data:image/png;base64,${planning.screenshot_desktop_base64}`}
                        alt="Desktop screenshot of the business's website"
                        className="w-full rounded-md border border-border"
                      />
                    </div>
                  )}
                  {planning.screenshot_mobile_base64 && (
                    <div>
                      <p className="mb-1 text-xs text-fg-subtle">Mobile</p>
                      <img
                        src={`data:image/png;base64,${planning.screenshot_mobile_base64}`}
                        alt="Mobile screenshot of the business's website"
                        className="max-w-[240px] rounded-md border border-border"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Operator Notes */}
          <div>
            <h2 className="section-title">Operator notes</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              Your own observations, preparation, or build ideas — independent of the analysis above.
            </p>
            <textarea
              key={planning.id + "-notes"}
              defaultValue={planning.operator_notes ?? ""}
              onBlur={(e) => handleSaveNotes(e.target.value)}
              rows={3}
              disabled={savingNotes}
              placeholder="Notes for the next conversation or the build itself…"
              className="mt-1.5 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
            />
          </div>

          {/* Create Project handoff */}
          <div className="card p-4">
            <h2 className="section-title">Create project</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              Converts this lead to a client and starts an intake-stage project, carrying this analysis&apos;s
              summary and key points into the project&apos;s build direction.
            </p>
            {createProjectError && <p className="mt-2 text-error">{createProjectError}</p>}
            {createdProjectId ? (
              <Link href={`/dashboard/projects/${createdProjectId}`} className="btn btn-primary btn-sm mt-3">
                Open project →
              </Link>
            ) : (
              <button onClick={handleCreateProject} disabled={creatingProject} className="btn btn-primary btn-sm mt-3">
                {creatingProject ? "Creating…" : "Create project"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
