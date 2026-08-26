"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type QaReport, type Website, type WebsiteSummary } from "@/lib/api";
import { WebsiteView } from "@/components/WebsiteView";
import { QaReportView } from "@/components/QaReportView";
import { PreviewLinksPanel } from "@/components/PreviewLinksPanel";

export default function ProjectWebsitePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [versions, setVersions] = useState<WebsiteSummary[] | null>(null);
  const [website, setWebsite] = useState<Website | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [qaReport, setQaReport] = useState<QaReport | null>(null);
  const [runningQa, setRunningQa] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [approvingQa, setApprovingQa] = useState(false);
  const [qaApproveError, setQaApproveError] = useState<string | null>(null);

  const [approvingWebsite, setApprovingWebsite] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [clientApproving, setClientApproving] = useState(false);
  const [clientApproveError, setClientApproveError] = useState<string | null>(null);

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

  function loadVersions(selectId?: string) {
    api
      .listWebsites(projectId)
      .then((list) => {
        setVersions(list);
        const target = selectId ?? list[0]?.id;
        if (target) {
          api.getWebsite(target).then((w) => {
            setWebsite(w);
            loadLatestQaReport(w.id);
          }).catch(() => {});
        } else {
          setWebsite(null);
          setQaReport(null);
        }
      })
      .catch(() => setLoadError("Couldn't load this project's websites."));
  }

  useEffect(() => loadVersions(), [projectId]);

  async function handleRunQa() {
    if (!website) return;
    setRunningQa(true);
    setQaError(null);
    try {
      setQaReport(await api.generateQaReport(website.id));
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
    } catch {
      setQaApproveError("Couldn't approve this QA report — it may still have unresolved critical issues.");
    } finally {
      setApprovingQa(false);
    }
  }

  // Unlike handleWebsiteChange (used for section edits/regenerates),
  // approving the whole version is a sign-off action, not a content
  // change — it must not clear the QA report that's already displayed.
  function applyWebsiteApproval(updated: Website) {
    setWebsite(updated);
    api.listWebsites(projectId).then(setVersions).catch(() => {});
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

  async function handleGenerate(forceRegenerateAll: boolean) {
    setGenerating(true);
    setGenerateError(null);
    try {
      const generated = await api.generateWebsite(projectId, { force_regenerate_all: forceRegenerateAll });
      setWebsite(generated);
      loadVersions(generated.id);
    } catch {
      setGenerateError(
        "Couldn't generate a website — make sure this project has an approved sitemap with pages first.",
      );
    } finally {
      setGenerating(false);
    }
  }

  function handleSelectVersion(id: string) {
    api.getWebsite(id).then((w) => {
      setWebsite(w);
      loadLatestQaReport(w.id);
    }).catch(() => {});
  }

  // Approving/editing a section mutates the current version in place
  // (no new row), but regenerating a section always creates a new one
  // — refresh the version list too so a just-created version shows up
  // and stays selected, instead of the dropdown quietly going stale.
  function handleWebsiteChange(updated: Website) {
    setWebsite(updated);
    // The content just changed (edit/approve/regenerate) — any existing
    // QA report was run against the version before this change, so
    // clear it rather than keep showing a pass/fail badge that no
    // longer describes what's on screen.
    setQaReport(null);
    api
      .listWebsites(projectId)
      .then(setVersions)
      .catch(() => {});
  }

  if (loadError) return <div className="p-6 text-sm text-red-600">{loadError}</div>;
  if (versions === null) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href={`/dashboard/projects/${projectId}`} className="text-sm text-neutral-500 hover:underline">
        ← Back to project
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Website</h1>
        <div className="flex items-center gap-2">
          {website && (
            <button
              onClick={() => handleGenerate(true)}
              disabled={generating}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
              title="Rebuild every section from scratch, discarding approvals and edits"
            >
              Regenerate all
            </button>
          )}
          <button
            onClick={() => handleGenerate(false)}
            disabled={generating}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {generating ? "Generating…" : website ? "Regenerate" : "Generate website"}
          </button>
        </div>
      </div>

      {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}

      {versions.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-neutral-500">Version:</span>
          <select
            value={website?.id ?? ""}
            onChange={(e) => handleSelectVersion(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {new Date(v.generated_at).toLocaleString()}
                {v.anti_slop_score !== null ? ` — score ${v.anti_slop_score}` : ""}
                {v.generated_by_user_name ? ` — ${v.generated_by_user_name}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {!website && (
        <p className="mt-6 text-sm text-neutral-500">
          No website generated yet. This needs an approved sitemap with pages first.
        </p>
      )}

      {website && (
        <div className="mt-6 rounded-md border border-neutral-200 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                website.approved ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {website.approved ? `Approved by ${website.approved_by_user_name}` : "Not approved"}
            </span>
            {!website.approved && (
              <button
                onClick={handleApproveWebsite}
                disabled={approvingWebsite}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                {approvingWebsite ? "Approving…" : "Approve website"}
              </button>
            )}
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                website.client_approved ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {website.client_approved ? `Client approved (recorded by ${website.client_approved_by_user_name})` : "Client review not recorded"}
            </span>
            {website.approved && !website.client_approved && (
              <button
                onClick={handleClientApprove}
                disabled={clientApproving}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
                title="Record that the client has reviewed and approved this version"
              >
                {clientApproving ? "Recording…" : "Record client approval"}
              </button>
            )}
          </div>
          {approveError && <p className="mt-2 text-sm text-red-600">{approveError}</p>}
          {clientApproveError && <p className="mt-2 text-sm text-red-600">{clientApproveError}</p>}
        </div>
      )}

      {website && (
        <div className="mt-6">
          <WebsiteView website={website} onChange={handleWebsiteChange} />
        </div>
      )}

      {website && (
        <div className="mt-8 border-t border-neutral-200 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Technical QA</h2>
            <button
              onClick={handleRunQa}
              disabled={runningQa}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {runningQa ? "Running…" : qaReport ? "Re-run QA check" : "Run QA check"}
            </button>
          </div>
          {qaError && <p className="mt-2 text-sm text-red-600">{qaError}</p>}
          {!qaReport && !runningQa && (
            <p className="mt-3 text-sm text-neutral-500">
              No QA check run against this version yet — content and structure checks only until a live preview
              URL exists (roadmap M6 deployment).
            </p>
          )}
          {qaReport && (
            <div className="mt-3">
              <QaReportView report={qaReport} />
              <div className="mt-3 flex items-center gap-3">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    qaReport.human_approved ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  {qaReport.human_approved ? `QA approved by ${qaReport.approved_by_user_name}` : "QA not approved"}
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
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {approvingQa ? "Approving…" : "Approve QA"}
                  </button>
                )}
              </div>
              {qaApproveError && <p className="mt-2 text-sm text-red-600">{qaApproveError}</p>}
            </div>
          )}
        </div>
      )}

      <PreviewLinksPanel projectId={projectId} />
    </div>
  );
}
