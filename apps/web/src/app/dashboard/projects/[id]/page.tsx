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
  type Business,
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
  type WebsiteSummary,
} from "@/lib/api";
import { ApprovalPipelineView } from "@/components/ApprovalPipelineView";
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

const detailInputClass = "w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm";

function DetailField({
  label,
  value,
  onSave,
  placeholder,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-fg-subtle">{label}</p>
      <input
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => {
          if (e.target.value !== value) onSave(e.target.value);
        }}
        className={`mt-1 ${detailInputClass}`}
      />
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [showCreatedBanner, setShowCreatedBanner] = useState(false);
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

  const [confirmingDetails, setConfirmingDetails] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [directionDraft, setDirectionDraft] = useState("");
  const [savingDirection, setSavingDirection] = useState(false);
  const [directionSaved, setDirectionSaved] = useState(false);

  const [briefs, setBriefs] = useState<CreativeDirectionBrief[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [targetAudience, setTargetAudience] = useState("");
  const [businessGoals, setBusinessGoals] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  const [websites, setWebsites] = useState<WebsiteSummary[] | null>(null);
  const [generatingInitialWebsite, setGeneratingInitialWebsite] = useState(false);
  const [initialWebsiteError, setInitialWebsiteError] = useState<string | null>(null);

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
        setDirectionDraft(p.build_direction ?? "");
        return api.getBusiness(p.business_id);
      })
      .then((b) => setBusiness(b))
      .catch(() => setError("Couldn't load this project."));
    api.getBrief(projectId).then(setBrief).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api.listActivity({ entity_type: "project", entity_id: projectId }).then(setActivity).catch(() => {});
    loadCreativeDirections();
    loadSitemaps();
    loadWebsiteBriefs();
    api.listWebsites(projectId).then(setWebsites).catch(() => {});
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
      setShowCreatedBanner(true);
      router.replace(`/dashboard/projects/${projectId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function saveBusiness(data: Parameters<typeof api.updateBusiness>[1]) {
    if (!business) return;
    setBusiness(await api.updateBusiness(business.id, data));
  }

  async function handleStageChange(stage: ProjectStage) {
    if (!project) return;
    setProject(await api.updateProject(project.id, { stage }));
    loadApprovalsAndDeployments();
  }

  async function handleAssigneeChange(assigneeId: string) {
    if (!project) return;
    setProject(await api.updateProject(project.id, { assigned_user_id: assigneeId || null }));
  }

  async function handleConfirmDetails() {
    if (!business) return;
    setConfirmingDetails(true);
    setConfirmError(null);
    try {
      await api.updateBrief(projectId, {
        business_name: business.name,
        industry: business.industry ?? "",
        location: [business.suburb, business.state].filter(Boolean).join(", "),
        contact_phone: business.phone ?? "",
        contact_email: business.email ?? "",
        existing_website_url: business.website_url ?? "",
        business_description: business.notes ?? "",
      });
      setBrief(await api.approveBrief(projectId));
      loadApprovalsAndDeployments();
    } catch (err) {
      setConfirmError(err instanceof ApiError ? err.message : "Couldn't confirm the details — try again.");
    } finally {
      setConfirmingDetails(false);
    }
  }

  async function handleSaveDirection() {
    if (!project) return;
    setSavingDirection(true);
    try {
      const updated = await api.updateProject(project.id, { build_direction: directionDraft || null });
      setProject(updated);
      setDirectionSaved(true);
      setTimeout(() => setDirectionSaved(false), 2000);
    } finally {
      setSavingDirection(false);
    }
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
      // The saved build direction is folded in server-side, so only the
      // per-generation notes are sent here.
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

  async function handleGenerateInitialWebsite() {
    setGeneratingInitialWebsite(true);
    setInitialWebsiteError(null);
    try {
      await api.generateInitialWebsite(projectId);
      router.push(`/dashboard/projects/${projectId}/website`);
    } catch (err) {
      setInitialWebsiteError(
        err instanceof ApiError ? err.message : "Couldn't generate the initial website.",
      );
      setGeneratingInitialWebsite(false);
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

  const cdStatus = briefs?.[0]?.status;
  const sitemapStatus = sitemaps?.[0]?.status;
  const wbStatus = websiteBriefs?.[0]?.status;

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!project) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;

  const dl = deadlineStatus(project.deadline);
  const detailsConfirmed = brief?.status === "approved";

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* 1. Project header */}
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
              {" · "}
              {[project.package, money(project.price_cents)].filter((v) => v && v !== "—").join(" · ") || "No package set"}
              {" · "}
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
                  due {new Date(project.deadline).toLocaleDateString()}
                </span>
              ) : (
                "no deadline"
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
            <span className="font-semibold">Project created.</span> Business details are filled in from the lead —
            check them below, add build direction whenever you&apos;re ready, then open the website workspace.
          </p>
          <button
            onClick={() => setShowCreatedBanner(false)}
            className="shrink-0 rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2. Business details — carried over from the lead, editable */}
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Business details</h2>
          {detailsConfirmed ? (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              Confirmed
            </span>
          ) : (
            <button
              onClick={handleConfirmDetails}
              disabled={confirmingDetails || !business}
              className="btn btn-secondary btn-sm"
              title="Locks these details in as the basis for the build"
            >
              {confirmingDetails ? "Confirming…" : "Confirm details"}
            </button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">
          Carried over from the lead. Edit anything that&apos;s wrong — no need to re-enter what we already know.
        </p>
        {confirmError && <p className="mt-2 text-error">{confirmError}</p>}
        {business ? (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField label="Business name" value={business.name} onSave={(v) => saveBusiness({ name: v })} />
            <DetailField
              label="Industry"
              value={business.industry ?? ""}
              onSave={(v) => saveBusiness({ industry: v })}
            />
            <DetailField
              label="Location"
              value={[business.suburb, business.state].filter(Boolean).join(", ")}
              placeholder="Suburb, State"
              onSave={(v) => {
                const [suburb, state] = v.split(",").map((s) => s.trim());
                saveBusiness({ suburb: suburb ?? "", state: state ?? "" });
              }}
            />
            <DetailField label="Phone" value={business.phone ?? ""} onSave={(v) => saveBusiness({ phone: v })} />
            <DetailField label="Email" value={business.email ?? ""} onSave={(v) => saveBusiness({ email: v })} />
            <DetailField
              label="Existing website"
              value={business.website_url ?? ""}
              placeholder="https://…"
              onSave={(v) => saveBusiness({ website_url: v })}
            />
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="text-xs uppercase tracking-wide text-fg-subtle">Business description</p>
              <textarea
                defaultValue={business.notes ?? ""}
                placeholder="What the business does — only if we already know it"
                onBlur={(e) => {
                  if (e.target.value !== (business.notes ?? "")) saveBusiness({ notes: e.target.value });
                }}
                rows={2}
                className={`mt-1 ${detailInputClass}`}
              />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-fg-muted">Loading…</p>
        )}
      </section>

      {/* 3. Website / build workspace — the primary area */}
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Website &amp; build</h2>
          {websites && websites.length === 0 ? (
            <button
              onClick={handleGenerateInitialWebsite}
              disabled={generatingInitialWebsite}
              className="btn btn-primary btn-sm"
            >
              {generatingInitialWebsite ? "Generating…" : "Generate initial website →"}
            </button>
          ) : (
            <Link href={`/dashboard/projects/${projectId}/website`} className="btn btn-primary btn-sm">
              Open website workspace →
            </Link>
          )}
        </div>
        {websites && websites.length === 0 && (
          <p className="mt-2 text-sm text-fg-muted">
            Build a demo website from the business information on file — a starter sitemap and brief are seeded
            automatically. It’s a working draft to preview and show the owner before you make contact.
          </p>
        )}
        {initialWebsiteError && <p className="mt-2 text-error">{initialWebsiteError}</p>}
        <div className="mt-3">
          <ProgressBar
            value={progress}
            label={
              approvalStatus
                ? `${progress}% · ${approvalStatus.checkpoints.filter((c) => c.approved).length} of ${approvalStatus.checkpoints.length} approval stages done`
                : `${progress}% · ${PROJECT_STAGE_LABELS[project.stage]}`
            }
          />
          <p className="mt-2 text-sm text-fg-muted">
            Next:{" "}
            <span className="text-fg">
              {project.delivered_at
                ? "Delivered — nothing outstanding"
                : nextCheckpoint?.blocked_reason ?? nextCheckpoint?.label ?? "On track"}
            </span>
          </p>
        </div>
        {approvalStatus ? (
          <div className="mt-4 space-y-4">
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

      {/* 4. Build direction — bring in direction worked out elsewhere */}
      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="section-title">Build direction</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Optional. Worked out the concept, visual direction, copy direction, page structure or generation prompts in
          ChatGPT or Claude? Paste it here — it&apos;s fed into the creative-direction and sitemap steps as context.
        </p>
        <textarea
          value={directionDraft}
          onChange={(e) => {
            setDirectionDraft(e.target.value);
            setDirectionSaved(false);
          }}
          rows={10}
          placeholder="Paste your build direction, prompts, or instructions here…"
          className="mt-3 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={handleSaveDirection}
            disabled={savingDirection || directionDraft === (project.build_direction ?? "")}
            className="btn btn-secondary btn-sm"
          >
            {savingDirection ? "Saving…" : "Save direction"}
          </button>
          {directionSaved && <span className="text-xs text-emerald-700 dark:text-emerald-400">Saved</span>}
        </div>
      </section>

      {/* Build steps — collapsed */}
      <section className="space-y-2">
        <h2 className="section-title">Build steps</h2>

        <Disclosure
          title="Creative direction"
          hint="Concept, visual and brand direction — review before design/build starts."
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
                Optional — left blank, target audience and business goals come from the business details and your
                saved build direction.
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
          hint="The client-facing rollup — business details + creative direction + sitemap in one editable document."
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
          {doneTasks.length > 0 && <li className="pt-1 text-xs text-fg-subtle">{doneTasks.length} done</li>}
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
