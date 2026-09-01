"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  type ActivityItem,
  type Brief,
  type CreativeDirectionBrief,
  type DeliveryStatus,
  type Deployment,
  type Meeting,
  type Project,
  type ProjectApprovalStatus,
  type ProjectStage,
  type Sitemap,
  type Task,
  type User,
  type WebsiteBrief,
} from "@/lib/api";
import { ApprovalPipelineView } from "@/components/ApprovalPipelineView";
import { BriefEditor } from "@/components/BriefEditor";
import { CreativeDirectionView } from "@/components/CreativeDirectionView";
import { DeliveryPanel } from "@/components/DeliveryPanel";
import { DeploymentPanel } from "@/components/DeploymentPanel";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { SitemapView } from "@/components/SitemapView";
import { WebsiteBriefView } from "@/components/WebsiteBriefView";
import { Disclosure } from "@/components/ui/Disclosure";
import { ErrorState } from "@/components/ui/ErrorState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { checkpointProgress, deadlineStatus, stageProgress } from "@/lib/projects";

function money(cents: number | null): string {
  return cents === null ? "—" : `$${(cents / 100).toLocaleString()}`;
}

function StatusChip({ status }: { status: "approved" | "draft" | undefined }) {
  if (status === "approved") {
    return (
      <span className="rounded px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-500/15">
        Approved
      </span>
    );
  }
  if (status === "draft") {
    return <span className="rounded bg-surface-subtle px-2 py-0.5 text-xs font-medium text-fg-muted">Draft</span>;
  }
  return <span className="rounded bg-surface-subtle px-2 py-0.5 text-xs font-medium text-fg-subtle">Not started</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-fg-subtle">{label}</p>
      <div className="mt-0.5 text-sm text-fg">{children}</div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  // justCreated is sticky (drives auto-opening the brief once); showCreatedBanner
  // is independently dismissible so closing the banner doesn't also collapse a
  // brief the user is actively filling in.
  const [justCreated, setJustCreated] = useState(false);
  const [showCreatedBanner, setShowCreatedBanner] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<ProjectApprovalStatus | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus | null>(null);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [newTask, setNewTask] = useState("");
  const [addingTask, setAddingTask] = useState(false);

  const [briefs, setBriefs] = useState<CreativeDirectionBrief[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [targetAudience, setTargetAudience] = useState("");
  const [businessGoals, setBusinessGoals] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  const [sitemaps, setSitemaps] = useState<Sitemap[] | null>(null);
  const [sitemapExpandedId, setSitemapExpandedId] = useState<string | null>(null);
  const [generatingSitemap, setGeneratingSitemap] = useState(false);
  const [generateSitemapError, setGenerateSitemapError] = useState<string | null>(null);
  const [showGenerateSitemapForm, setShowGenerateSitemapForm] = useState(false);
  const [sitemapCreativeDirectionId, setSitemapCreativeDirectionId] = useState("");
  const [sitemapAdditionalNotes, setSitemapAdditionalNotes] = useState("");

  const [websiteBriefs, setWebsiteBriefs] = useState<WebsiteBrief[] | null>(null);
  const [websiteBriefExpandedId, setWebsiteBriefExpandedId] = useState<string | null>(null);
  const [generatingWebsiteBrief, setGeneratingWebsiteBrief] = useState(false);
  const [generateWebsiteBriefError, setGenerateWebsiteBriefError] = useState<string | null>(null);

  function loadWebsiteBriefs() {
    api
      .listWebsiteBriefs(projectId)
      .then((list) => {
        setWebsiteBriefs(list);
        if (list.length > 0) setWebsiteBriefExpandedId(list[0].id);
      })
      .catch(() => {});
  }

  function loadSitemaps() {
    api
      .listSitemaps(projectId)
      .then((list) => {
        setSitemaps(list);
        if (list.length > 0) setSitemapExpandedId(list[0].id);
      })
      .catch(() => {});
  }

  function loadCreativeDirections() {
    api
      .listCreativeDirections(projectId)
      .then((list) => {
        setBriefs(list);
        if (list.length > 0) setExpandedId(list[0].id);
      })
      .catch(() => {});
  }

  function loadTasks() {
    api
      .listTasks()
      .then((all) => setTasks(all.filter((t) => t.project_id === projectId)))
      .catch(() => {});
  }

  function load() {
    api
      .getProject(projectId)
      .then((p) => {
        setError(null);
        setProject(p);
      })
      .catch(() => setError("Couldn't load this project."));
    api.getBrief(projectId).then(setBrief).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api.listActivity({ entity_type: "project", entity_id: projectId }).then(setActivity).catch(() => {});
    loadCreativeDirections();
    loadSitemaps();
    loadWebsiteBriefs();
    loadApprovalsAndDeployments();
    loadTasks();
    api.listMeetings({ projectId }).then(setMeetings).catch(() => {});
  }

  function loadApprovalsAndDeployments() {
    api.getProjectApprovals(projectId).then(setApprovalStatus).catch(() => {});
    api.listDeployments(projectId).then(setDeployments).catch(() => {});
    api.getDeliveryStatus(projectId).then(setDeliveryStatus).catch(() => {});
    api.getProject(projectId).then(setProject).catch(() => {});
  }

  useEffect(load, [projectId]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("created")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJustCreated(true);
      setShowCreatedBanner(true);
      router.replace(`/dashboard/projects/${projectId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleStageChange(stage: ProjectStage) {
    if (!project) return;
    setProject(await api.updateProject(project.id, { stage }));
    loadApprovalsAndDeployments();
  }

  async function handleAssigneeChange(assigneeId: string) {
    if (!project) return;
    setProject(await api.updateProject(project.id, { assigned_user_id: assigneeId || null }));
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    setAddingTask(true);
    try {
      await api.createTask({ title: newTask.trim(), project_id: projectId });
      setNewTask("");
      loadTasks();
    } finally {
      setAddingTask(false);
    }
  }

  async function handleToggleTask(id: string, done: boolean) {
    await api.updateTask(id, { done });
    loadTasks();
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setGenerateError(null);
    try {
      const generated = await api.generateCreativeDirection(projectId, {
        target_audience: targetAudience || undefined,
        business_goals: businessGoals || undefined,
        additional_notes: additionalNotes || undefined,
      });
      setBriefs((prev) => [generated, ...(prev ?? [])]);
      setExpandedId(generated.id);
      setShowGenerateForm(false);
      setTargetAudience("");
      setBusinessGoals("");
      setAdditionalNotes("");
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : "Couldn't generate a creative direction.");
    } finally {
      setGenerating(false);
    }
  }

  function handleCreativeDirectionUpdated(updated: CreativeDirectionBrief) {
    setBriefs((prev) => (prev ? prev.map((b) => (b.id === updated.id ? updated : b)) : prev));
    loadApprovalsAndDeployments();
  }

  async function handleGenerateSitemap(e: React.FormEvent) {
    e.preventDefault();
    setGeneratingSitemap(true);
    setGenerateSitemapError(null);
    try {
      const generated = await api.generateSitemap(projectId, {
        creative_direction_id: sitemapCreativeDirectionId || undefined,
        additional_notes: sitemapAdditionalNotes || undefined,
      });
      setSitemaps((prev) => [generated, ...(prev ?? [])]);
      setSitemapExpandedId(generated.id);
      setShowGenerateSitemapForm(false);
      setSitemapCreativeDirectionId("");
      setSitemapAdditionalNotes("");
    } catch (err) {
      setGenerateSitemapError(err instanceof ApiError ? err.message : "Couldn't generate a sitemap.");
    } finally {
      setGeneratingSitemap(false);
    }
  }

  function handleSitemapUpdated(updated: Sitemap) {
    setSitemaps((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev));
    loadApprovalsAndDeployments();
  }

  async function handleGenerateWebsiteBrief() {
    setGeneratingWebsiteBrief(true);
    setGenerateWebsiteBriefError(null);
    try {
      const generated = await api.generateWebsiteBrief(projectId);
      setWebsiteBriefs((prev) => [generated, ...(prev ?? [])]);
      setWebsiteBriefExpandedId(generated.id);
    } catch (err) {
      setGenerateWebsiteBriefError(err instanceof ApiError ? err.message : "Couldn't generate a website brief.");
    } finally {
      setGeneratingWebsiteBrief(false);
    }
  }

  function handleWebsiteBriefUpdated(updated: WebsiteBrief) {
    setWebsiteBriefs((prev) => (prev ? prev.map((b) => (b.id === updated.id ? updated : b)) : prev));
  }

  const openTasks = useMemo(() => (tasks ?? []).filter((t) => !t.done), [tasks]);
  const doneTasks = useMemo(() => (tasks ?? []).filter((t) => t.done), [tasks]);

  const progress = approvalStatus
    ? checkpointProgress(approvalStatus.checkpoints)
    : project
      ? stageProgress(project.stage)
      : 0;
  const nextCheckpoint = approvalStatus?.checkpoints.find((c) => !c.approved) ?? null;
  const nextAction =
    project?.delivered_at
      ? "Delivered — nothing outstanding"
      : approvalStatus?.missing_for_deployment[0] ??
        nextCheckpoint?.blocked_reason ??
        openTasks[0]?.title ??
        "On track";

  const cdStatus = briefs?.[0]?.status;
  const sitemapStatus = sitemaps?.[0]?.status;
  const wbStatus = websiteBriefs?.[0]?.status;
  const briefStatus = brief?.status;

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!project) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;

  const dl = deadlineStatus(project.deadline);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <Link href="/dashboard/projects" className="text-sm text-fg-muted hover:underline">
          ← All projects
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="page-title">{project.name}</h1>
              <ProjectStatusBadge project={project} />
            </div>
            <p className="text-sm text-fg-muted">
              <Link href={`/dashboard/clients/${project.client_id}`} className="hover:underline">
                {project.client_business_name}
              </Link>
              {project.source_lead_id && (
                <>
                  {" · "}
                  <Link href={`/dashboard/leads/${project.source_lead_id}`} className="hover:underline">
                    from lead
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={project.stage}
              onChange={(e) => handleStageChange(e.target.value as ProjectStage)}
              className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
            >
              {PROJECT_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {PROJECT_STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
            <select
              value={project.assigned_user_id ?? ""}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {showCreatedBanner && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <p className="text-sm text-emerald-900 dark:text-emerald-300">
            <span className="font-semibold">Project created.</span> Everything already known about the
            client has been carried into the brief. Add the rest whenever you&apos;re ready — you can
            start the website now.
          </p>
          <button
            onClick={() => setShowCreatedBanner(false)}
            className="shrink-0 rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Snapshot */}
      <section className="rounded-md border border-border bg-surface p-4">
        <ProgressBar
          value={progress}
          label={
            approvalStatus
              ? `${progress}% · ${approvalStatus.checkpoints.filter((c) => c.approved).length} of ${approvalStatus.checkpoints.length} approval stages done`
              : `${progress}% · ${PROJECT_STAGE_LABELS[project.stage]}`
          }
        />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Current phase">{nextCheckpoint?.label ?? PROJECT_STAGE_LABELS[project.stage]}</Field>
          <Field label="Next action">
            <span className="line-clamp-2">{nextAction}</span>
          </Field>
          <Field label="Deadline">
            {project.deadline ? (
              <span
                className={
                  dl === "overdue"
                    ? "text-red-700 dark:text-red-400"
                    : dl === "soon"
                      ? "text-amber-700 dark:text-amber-400"
                      : undefined
                }
              >
                {new Date(project.deadline).toLocaleDateString()}
              </span>
            ) : (
              <span className="text-fg-subtle">Not set</span>
            )}
          </Field>
          <Field label="Package">
            {[project.package, money(project.price_cents)].filter((v) => v && v !== "—").join(" · ") || (
              <span className="text-fg-subtle">Not set</span>
            )}
          </Field>
        </div>
      </section>

      {/* Build & delivery */}
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Build &amp; delivery</h2>
          <Link
            href={`/dashboard/projects/${projectId}/website`}
            className="btn btn-primary btn-sm"
          >
            Open website workspace →
          </Link>
        </div>
        {approvalStatus ? (
          <div className="mt-3 space-y-4">
            <ApprovalPipelineView status={approvalStatus} />
            <DeploymentPanel
              projectId={projectId}
              approvalStatus={approvalStatus}
              deployments={deployments}
              onChanged={loadApprovalsAndDeployments}
            />
            {deliveryStatus && (
              <DeliveryPanel projectId={projectId} deliveryStatus={deliveryStatus} onChanged={loadApprovalsAndDeployments} />
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">Loading build status…</p>
        )}
      </section>

      {/* Tasks */}
      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="section-title">Tasks</h2>
        <form onSubmit={handleAddTask} className="mt-2 flex gap-2">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Add a task for this project…"
            className="flex-1 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm"
          />
          <button type="submit" disabled={addingTask || !newTask.trim()} className="btn btn-secondary btn-sm">
            {addingTask ? "Adding…" : "Add"}
          </button>
        </form>
        <ul className="mt-3 space-y-1.5">
          {tasks === null && <li className="text-sm text-fg-muted">Loading…</li>}
          {tasks !== null && openTasks.length === 0 && doneTasks.length === 0 && (
            <li className="text-sm text-fg-muted">No tasks yet.</li>
          )}
          {openTasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={false}
                onChange={() => handleToggleTask(t.id, true)}
                aria-label={`Mark "${t.title}" done`}
              />
              <span className="text-fg">{t.title}</span>
              {t.due_at && (
                <span className="text-xs text-fg-subtle">· {new Date(t.due_at).toLocaleDateString()}</span>
              )}
            </li>
          ))}
          {doneTasks.length > 0 && (
            <li className="pt-1 text-xs text-fg-subtle">
              {doneTasks.length} done
            </li>
          )}
          {doneTasks.slice(0, 5).map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm text-fg-subtle">
              <input
                type="checkbox"
                checked
                onChange={() => handleToggleTask(t.id, false)}
                aria-label={`Reopen "${t.title}"`}
              />
              <span className="line-through">{t.title}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Build artifacts — collapsed by default */}
      <section className="space-y-2">
        <h2 className="section-title">Build artifacts</h2>

        <Disclosure
          key={justCreated ? "brief-auto-open" : "brief-default"}
          title="Project brief"
          hint="The structured client intake — the source of truth for the build."
          badge={<StatusChip status={briefStatus} />}
          defaultOpen={justCreated}
        >
          {brief ? <BriefEditor brief={brief} onChange={setBrief} /> : <p className="text-sm text-fg-muted">Loading brief…</p>}
        </Disclosure>

        <Disclosure
          title="Creative direction"
          hint="Creative concept, visual and brand direction — review before design/build starts."
          badge={<StatusChip status={cdStatus} />}
        >
          <div className="flex items-center justify-end">
            <button
              onClick={() => setShowGenerateForm((v) => !v)}
              disabled={generating}
              className="btn btn-secondary btn-sm"
            >
              {showGenerateForm ? "Cancel" : briefs && briefs.length > 0 ? "Regenerate" : "Generate"}
            </button>
          </div>
          {showGenerateForm && (
            <form onSubmit={handleGenerate} className="mt-3 space-y-3 rounded-md border border-border p-3">
              <p className="text-xs text-fg-muted">
                Optional — left blank, target audience and business goals come from the brief; gaps are flagged
                as assumptions to confirm.
              </p>
              <textarea
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
                placeholder="Target audience"
              />
              <textarea
                value={businessGoals}
                onChange={(e) => setBusinessGoals(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
                placeholder="Business goals for the new site"
              />
              <textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
                placeholder="Additional notes"
              />
              <button type="submit" disabled={generating} className="btn btn-primary btn-sm">
                {generating ? "Generating…" : "Generate"}
              </button>
            </form>
          )}
          {generating && <p className="mt-2 text-sm text-fg-muted">Generating — this can take up to a minute.</p>}
          {generateError && <p className="mt-2 text-error">{generateError}</p>}
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {briefs && briefs.length === 0 && !generating && (
              <li className="px-3 py-3 text-sm text-fg-muted">Not generated yet.</li>
            )}
            {briefs?.map((cd) => {
              const expanded = expandedId === cd.id;
              return (
                <li key={cd.id} className="px-3 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => setExpandedId(expanded ? null : cd.id)} className="text-left text-fg hover:underline">
                      {expanded ? "▾" : "▸"} {new Date(cd.generated_at).toLocaleString()}
                    </button>
                    <div className="flex items-center gap-2">
                      <StatusChip status={cd.status} />
                      {cd.flagged_for_review && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                          Flagged
                        </span>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3">
                      <CreativeDirectionView brief={cd} onChange={handleCreativeDirectionUpdated} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Disclosure>

        <Disclosure
          title="Sitemap"
          hint="The page structure — review, edit, then approve. Becomes the source of truth for generation."
          badge={<StatusChip status={sitemapStatus} />}
        >
          <div className="flex items-center justify-end">
            <button
              onClick={() => setShowGenerateSitemapForm((v) => !v)}
              disabled={generatingSitemap}
              className="btn btn-secondary btn-sm"
            >
              {showGenerateSitemapForm ? "Cancel" : sitemaps && sitemaps.length > 0 ? "Regenerate" : "Generate"}
            </button>
          </div>
          {showGenerateSitemapForm && (
            <form onSubmit={handleGenerateSitemap} className="mt-3 space-y-3 rounded-md border border-border p-3">
              <select
                value={sitemapCreativeDirectionId}
                onChange={(e) => setSitemapCreativeDirectionId(e.target.value)}
                className="w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
              >
                <option value="">Creative direction: auto (latest approved)</option>
                {briefs?.map((cd) => (
                  <option key={cd.id} value={cd.id}>
                    {new Date(cd.generated_at).toLocaleString()} — {cd.status}
                  </option>
                ))}
              </select>
              <textarea
                value={sitemapAdditionalNotes}
                onChange={(e) => setSitemapAdditionalNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
                placeholder="Additional notes"
              />
              <button type="submit" disabled={generatingSitemap} className="btn btn-primary btn-sm">
                {generatingSitemap ? "Generating…" : "Generate"}
              </button>
            </form>
          )}
          {generatingSitemap && <p className="mt-2 text-sm text-fg-muted">Generating — this can take up to a minute.</p>}
          {generateSitemapError && <p className="mt-2 text-error">{generateSitemapError}</p>}
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {sitemaps && sitemaps.length === 0 && !generatingSitemap && (
              <li className="px-3 py-3 text-sm text-fg-muted">Not generated yet.</li>
            )}
            {sitemaps?.map((s) => {
              const expanded = sitemapExpandedId === s.id;
              return (
                <li key={s.id} className="px-3 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => setSitemapExpandedId(expanded ? null : s.id)}
                      className="text-left text-fg hover:underline"
                    >
                      {expanded ? "▾" : "▸"} {new Date(s.generated_at).toLocaleString()} ({s.pages.length} pages)
                    </button>
                    <div className="flex items-center gap-2">
                      <StatusChip status={s.status} />
                      {s.flagged_for_review && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                          Flagged
                        </span>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3">
                      <SitemapView sitemap={s} onChange={handleSitemapUpdated} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Disclosure>

        <Disclosure
          title="Website brief"
          hint="The client-facing rollup — brief + creative direction + sitemap in one editable document."
          badge={<StatusChip status={wbStatus} />}
        >
          <div className="flex items-center justify-end">
            <button
              onClick={handleGenerateWebsiteBrief}
              disabled={generatingWebsiteBrief}
              className="btn btn-secondary btn-sm"
            >
              {generatingWebsiteBrief ? "Generating…" : websiteBriefs && websiteBriefs.length > 0 ? "Regenerate" : "Generate"}
            </button>
          </div>
          {generatingWebsiteBrief && <p className="mt-2 text-sm text-fg-muted">Generating — this can take up to a minute.</p>}
          {generateWebsiteBriefError && <p className="mt-2 text-error">{generateWebsiteBriefError}</p>}
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {websiteBriefs && websiteBriefs.length === 0 && !generatingWebsiteBrief && (
              <li className="px-3 py-3 text-sm text-fg-muted">Not generated yet.</li>
            )}
            {websiteBriefs?.map((b) => {
              const expanded = websiteBriefExpandedId === b.id;
              return (
                <li key={b.id} className="px-3 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => setWebsiteBriefExpandedId(expanded ? null : b.id)}
                      className="text-left text-fg hover:underline"
                    >
                      {expanded ? "▾" : "▸"} {new Date(b.generated_at).toLocaleString()}
                    </button>
                    <StatusChip status={b.status} />
                  </div>
                  {expanded && (
                    <div className="mt-3">
                      <WebsiteBriefView brief={b} onChange={handleWebsiteBriefUpdated} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Disclosure>
      </section>

      {/* Meetings + activity */}
      <div className="grid gap-2 lg:grid-cols-2">
        <Disclosure title="Meetings" badge={<span className="text-xs text-fg-muted">{meetings?.length ?? 0}</span>}>
          <ul className="divide-y divide-border rounded-md border border-border">
            {meetings && meetings.length === 0 && (
              <li className="px-3 py-3 text-sm text-fg-muted">No meetings scheduled.</li>
            )}
            {meetings?.map((m) => (
              <li key={m.id} className="px-3 py-2 text-sm">
                <span className="text-fg">{m.title}</span>
                <span className="ml-2 text-xs text-fg-muted">
                  {new Date(m.scheduled_at).toLocaleString()} · {m.status.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/dashboard/calendar" className="mt-2 inline-block text-xs text-fg-muted hover:underline">
            Schedule on calendar →
          </Link>
        </Disclosure>

        <Disclosure title="Activity history" badge={<span className="text-xs text-fg-muted">{activity?.length ?? 0}</span>}>
          <ul className="divide-y divide-border rounded-md border border-border">
            {activity && activity.length === 0 && <li className="px-3 py-3 text-sm text-fg-muted">No activity yet.</li>}
            {activity?.slice(0, 20).map((item) => (
              <li key={item.id} className="px-3 py-2 text-sm">
                <span className="text-fg">{item.summary ?? item.action}</span>
                <span className="ml-2 text-xs text-fg-muted">
                  {item.user_name ?? "System"} · {new Date(item.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </div>
  );
}
