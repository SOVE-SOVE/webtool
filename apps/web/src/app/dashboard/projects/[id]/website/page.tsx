"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  WORKFLOW_STATUS_LABELS,
  type Deployment,
  type DeliveryStatus,
  type Project,
  type ProjectApprovalStatus,
  type QaReport,
  type Website,
  type WebsiteSummary,
} from "@/lib/api";
import { DeliveryPanel } from "@/components/DeliveryPanel";
import { DeploymentPanel } from "@/components/DeploymentPanel";
import { PreviewLinksPanel } from "@/components/PreviewLinksPanel";
import { PreviewSiteRenderer } from "@/components/PreviewSiteRenderer";
import { QaReportView } from "@/components/QaReportView";
import { WebsiteFeedbackPanel } from "@/components/WebsiteFeedbackPanel";
import { WebsiteView } from "@/components/WebsiteView";
import { WebsiteWorkflowPanel } from "@/components/WebsiteWorkflowPanel";
import { ErrorState } from "@/components/ui/ErrorState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { buildChecklist, checklistProgress, type ChecklistItem } from "@/lib/websiteChecklist";

const TABS = [
  { id: "content", label: "Pages & content" },
  { id: "preview", label: "Preview" },
  { id: "qa", label: "QA" },
  { id: "approval", label: "Approval" },
  { id: "deployment", label: "Deployment" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const STATUS_MARK: Record<ChecklistItem["status"], { mark: string; cls: string }> = {
  done: { mark: "✓", cls: "text-emerald-700 dark:text-emerald-400" },
  active: { mark: "●", cls: "text-amber-700 dark:text-amber-400" },
  todo: { mark: "○", cls: "text-fg-subtle" },
};

export default function ProjectWebsiteWorkspace() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<WebsiteSummary[] | null>(null);
  const [website, setWebsite] = useState<Website | null>(null);
  const [approvals, setApprovals] = useState<ProjectApprovalStatus | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus | null>(null);
  const [qaReport, setQaReport] = useState<QaReport | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [runningQa, setRunningQa] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [approvingQa, setApprovingQa] = useState(false);
  const [qaApproveError, setQaApproveError] = useState<string | null>(null);
  const [approvingWebsite, setApprovingWebsite] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [clientApproving, setClientApproving] = useState(false);
  const [clientApproveError, setClientApproveError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("content");
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);

  function loadLatestQaReport(websiteId: string) {
    api
      .listQaReports(websiteId)
      .then((reports) => {
        if (reports.length === 0) {
          setQaReport(null);
          return;
        }
        api.getQaReport(reports[0].id).then(setQaReport).catch(() => {});
      })
      .catch(() => {});
  }

  function loadSupporting() {
    api.getProject(projectId).then(setProject).catch(() => {});
    api.getProjectApprovals(projectId).then(setApprovals).catch(() => {});
    api.listDeployments(projectId).then(setDeployments).catch(() => {});
    api.getDeliveryStatus(projectId).then(setDeliveryStatus).catch(() => {});
  }

  function loadVersions(selectId?: string) {
    api
      .listWebsites(projectId)
      .then((list) => {
        setLoadError(null);
        setVersions(list);
        const target = selectId ?? list[0]?.id;
        if (target) {
          api
            .getWebsite(target)
            .then((w) => {
              setWebsite(w);
              setPreviewSlug((cur) => cur ?? w.pages[0]?.slug ?? null);
              loadLatestQaReport(w.id);
            })
            .catch(() => {});
        } else {
          setWebsite(null);
          setQaReport(null);
        }
      })
      .catch(() => setLoadError("Couldn't load this project's website."));
  }

  useEffect(() => {
    loadVersions();
    loadSupporting();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenerate(forceRegenerateAll: boolean) {
    setGenerating(true);
    setGenerateError(null);
    try {
      const generated = await api.generateWebsite(projectId, { force_regenerate_all: forceRegenerateAll });
      setWebsite(generated);
      loadVersions(generated.id);
      loadSupporting();
    } catch {
      setGenerateError("Couldn't generate — this project needs an approved sitemap with pages first.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRunQa() {
    if (!website) return;
    setRunningQa(true);
    setQaError(null);
    try {
      setQaReport(await api.generateQaReport(website.id));
      loadSupporting();
    } catch {
      setQaError("Couldn't run the QA check.");
    } finally {
      setRunningQa(false);
    }
  }

  async function handleApproveQa() {
    if (!qaReport) return;
    setApprovingQa(true);
    setQaApproveError(null);
    try {
      setQaReport(await api.approveQaReport(qaReport.id));
      loadSupporting();
    } catch {
      setQaApproveError("Couldn't approve — it may still have unresolved critical issues, or the website isn't approved yet.");
    } finally {
      setApprovingQa(false);
    }
  }

  function applyWebsiteApproval(updated: Website) {
    setWebsite(updated);
    api.listWebsites(projectId).then(setVersions).catch(() => {});
    loadSupporting();
  }

  async function handleApproveWebsite() {
    if (!website) return;
    setApprovingWebsite(true);
    setApproveError(null);
    try {
      applyWebsiteApproval(await api.approveWebsite(website.id));
    } catch {
      setApproveError("Couldn't approve — the brief, creative direction, and sitemap all need to be approved first.");
    } finally {
      setApprovingWebsite(false);
    }
  }

  async function handleClientApprove() {
    if (!website) return;
    setClientApproving(true);
    setClientApproveError(null);
    try {
      applyWebsiteApproval(await api.clientApproveWebsite(website.id));
    } catch {
      setClientApproveError("Couldn't record client approval — the website and QA both need to be approved first.");
    } finally {
      setClientApproving(false);
    }
  }

  function handleSelectVersion(id: string) {
    api
      .getWebsite(id)
      .then((w) => {
        setWebsite(w);
        loadLatestQaReport(w.id);
      })
      .catch(() => {});
  }

  function handleWebsiteChange(updated: Website) {
    setWebsite(updated);
    setQaReport(null);
    api.listWebsites(projectId).then(setVersions).catch(() => {});
    loadSupporting();
  }

  const checklist = useMemo(
    () => buildChecklist({ approvals, website, qaReport, deployments }),
    [approvals, website, qaReport, deployments],
  );
  const progress = checklistProgress(checklist);

  const liveDeployment = deployments.find((d) => d.status === "success" && d.verified_at) ?? deployments.find((d) => d.status === "success");
  const activePreview = website?.pages.find((p) => p.slug === previewSlug) ?? website?.pages[0] ?? null;

  if (loadError) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState message={loadError} onRetry={() => loadVersions()} />
      </div>
    );
  }
  if (versions === null) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Link href={`/dashboard/projects/${projectId}`} className="text-sm text-fg-muted hover:underline">
        ← Back to project
      </Link>

      {/* 1. Overview */}
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="page-title">{project?.name ?? "Website"}</h1>
            <p className="text-sm text-fg-muted">
              {project ? (
                <Link href={`/dashboard/clients/${project.client_id}`} className="hover:underline">
                  {project.client_business_name}
                </Link>
              ) : (
                "Loading…"
              )}
              {website && (
                <>
                  {" · "}
                  <span className="text-fg">{WORKFLOW_STATUS_LABELS[website.workflow_status]}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {website && (
              <button
                onClick={() => handleGenerate(true)}
                disabled={generating}
                className="btn btn-secondary btn-sm"
                title="Rebuild every section from scratch, discarding approvals and edits"
              >
                Regenerate all
              </button>
            )}
            <button onClick={() => handleGenerate(false)} disabled={generating} className="btn btn-primary btn-sm">
              {generating ? "Generating…" : website ? "Regenerate" : "Generate website"}
            </button>
          </div>
        </div>

        {generateError && <p className="mt-2 text-error">{generateError}</p>}

        <div className="mt-4">
          <ProgressBar value={progress.pct} label={`${progress.pct}% · ${progress.done} of ${progress.total} build steps done`} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-fg-subtle">Preview URL</p>
            {website ? (
              <button onClick={() => setTab("preview")} className="mt-0.5 text-sm text-fg hover:underline">
                Open the in-app preview →
              </button>
            ) : (
              <p className="mt-0.5 text-sm text-fg-subtle">No website generated yet</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-fg-subtle">Production URL</p>
            {liveDeployment?.url ? (
              <a
                href={liveDeployment.url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 block truncate text-sm text-fg hover:underline"
              >
                {liveDeployment.url} ↗
              </a>
            ) : (
              <p className="mt-0.5 text-sm text-fg-subtle">Not deployed</p>
            )}
          </div>
        </div>

        {versions.length > 1 && (
          <div className="mt-4 flex items-center gap-2 text-sm">
            <span className="text-fg-muted">Version</span>
            <select
              value={website?.id ?? ""}
              onChange={(e) => handleSelectVersion(e.target.value)}
              className="rounded-md border border-border-strong bg-surface px-2 py-1"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {new Date(v.generated_at).toLocaleString()}
                  {v.anti_slop_score !== null ? ` — score ${v.anti_slop_score}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* 2. Build checklist */}
      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="section-title">Build checklist</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Derived from the project&apos;s real approval, content, QA and deployment state — not a manual list.
        </p>
        <ul className="mt-3 divide-y divide-border">
          {checklist.map((item) => {
            const s = STATUS_MARK[item.status];
            return (
              <li key={item.key}>
                <button
                  onClick={() => setTab(item.tab)}
                  className="flex w-full items-center gap-3 py-2 text-left hover:bg-surface-hover"
                >
                  <span className={`shrink-0 text-sm ${s.cls}`} aria-hidden="true">
                    {s.mark}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`text-sm ${item.status === "done" ? "text-fg-muted" : "text-fg"}`}>
                      {item.label}
                    </span>
                    <span className="ml-2 text-xs text-fg-subtle">{item.detail}</span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-subtle">→</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 3-6. Workspace tabs */}
      <div>
        <div className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                tab === t.id ? "border-fg font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "content" &&
            (website ? (
              <WebsiteView website={website} onChange={handleWebsiteChange} />
            ) : (
              <div className="rounded-md border border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium text-fg">No website generated yet</p>
                <p className="mt-1 text-sm text-fg-muted">
                  Generation assembles pages from the approved sitemap, brief and creative direction. Approve
                  those first, then use “Generate website” above.
                </p>
              </div>
            ))}

          {tab === "preview" && (
            <div className="space-y-4">
              {website && activePreview ? (
                <>
                  {website.pages.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      {website.pages.map((p) => (
                        <button
                          key={p.slug}
                          onClick={() => setPreviewSlug(p.slug)}
                          className={`rounded-md border px-2.5 py-1 text-xs ${
                            p.slug === activePreview.slug
                              ? "border-fg bg-surface-subtle text-fg"
                              : "border-border text-fg-muted hover:text-fg"
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="flex items-center gap-1.5 border-b border-border bg-surface-subtle px-3 py-2 text-xs text-fg-muted">
                      <span className="h-2 w-2 rounded-full bg-border-strong" />
                      <span className="h-2 w-2 rounded-full bg-border-strong" />
                      <span className="h-2 w-2 rounded-full bg-border-strong" />
                      <span className="ml-2 truncate">/{activePreview.slug}</span>
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto bg-white">
                      <PreviewSiteRenderer
                        navigation={website.navigation}
                        sections={activePreview.sections}
                        footer={website.footer}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-fg-muted">
                    Rendered live from the generated section content. This is the real site structure — not a
                    screenshot or mockup.
                  </p>
                </>
              ) : (
                <p className="text-sm text-fg-muted">Generate the website to preview it here.</p>
              )}
              <PreviewLinksPanel projectId={projectId} />
            </div>
          )}

          {tab === "qa" &&
            (website ? (
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="section-title">Technical QA</h2>
                  <button onClick={handleRunQa} disabled={runningQa} className="btn btn-secondary btn-sm">
                    {runningQa ? "Running…" : qaReport ? "Re-run QA" : "Run QA check"}
                  </button>
                </div>
                {qaError && <p className="mt-2 text-error">{qaError}</p>}
                {!qaReport && !runningQa && (
                  <p className="mt-3 text-sm text-fg-muted">
                    No QA check run against this version yet — content and structure checks run now; live
                    performance checks need a deployed URL.
                  </p>
                )}
                {qaReport && (
                  <div className="mt-3">
                    <QaReportView report={qaReport} />
                    <div className="mt-3 flex items-center gap-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          qaReport.human_approved
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-surface-subtle text-fg-muted"
                        }`}
                      >
                        {qaReport.human_approved ? `Signed off by ${qaReport.approved_by_user_name}` : "Not signed off"}
                      </span>
                      {!qaReport.human_approved && (
                        <button
                          onClick={handleApproveQa}
                          disabled={approvingQa || !qaReport.passed || !website.approved}
                          title={
                            !website.approved
                              ? "Approve the website itself first"
                              : !qaReport.passed
                                ? "This report has unresolved critical issues"
                                : undefined
                          }
                          className="btn btn-secondary btn-sm"
                        >
                          {approvingQa ? "Signing off…" : "Sign off QA"}
                        </button>
                      )}
                    </div>
                    {qaApproveError && <p className="mt-2 text-error">{qaApproveError}</p>}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Generate the website first, then run QA.</p>
            ))}

          {tab === "approval" && (
            <div className="space-y-6">
              {website ? (
                <>
                  <div className="rounded-md border border-border p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          website.approved
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-surface-subtle text-fg-muted"
                        }`}
                      >
                        {website.approved ? `Internally approved by ${website.approved_by_user_name}` : "Not internally approved"}
                      </span>
                      {!website.approved && (
                        <button onClick={handleApproveWebsite} disabled={approvingWebsite} className="btn btn-secondary btn-sm">
                          {approvingWebsite ? "Approving…" : "Approve website"}
                        </button>
                      )}
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          website.client_approved
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-surface-subtle text-fg-muted"
                        }`}
                      >
                        {website.client_approved
                          ? `Client approved (recorded by ${website.client_approved_by_user_name})`
                          : "Client approval not recorded"}
                      </span>
                      {website.approved && !website.client_approved && (
                        <button onClick={handleClientApprove} disabled={clientApproving} className="btn btn-secondary btn-sm">
                          {clientApproving ? "Recording…" : "Record client approval"}
                        </button>
                      )}
                    </div>
                    {approveError && <p className="mt-2 text-error">{approveError}</p>}
                    {clientApproveError && <p className="mt-2 text-error">{clientApproveError}</p>}
                  </div>
                  <WebsiteWorkflowPanel website={website} onChange={applyWebsiteApproval} />
                  <WebsiteFeedbackPanel projectId={projectId} websiteId={website.id} />
                </>
              ) : (
                <p className="text-sm text-fg-muted">Generate the website first.</p>
              )}
            </div>
          )}

          {tab === "deployment" && (
            <div className="space-y-6">
              {approvals ? (
                <DeploymentPanel
                  projectId={projectId}
                  approvalStatus={approvals}
                  deployments={deployments}
                  onChanged={() => {
                    loadSupporting();
                    loadVersions(website?.id);
                  }}
                />
              ) : (
                <p className="text-sm text-fg-muted">Loading deployment status…</p>
              )}
              {deliveryStatus && (
                <DeliveryPanel
                  projectId={projectId}
                  deliveryStatus={deliveryStatus}
                  onChanged={() => {
                    loadSupporting();
                    loadVersions(website?.id);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
