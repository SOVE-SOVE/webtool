"use client";

import { useState } from "react";
import { api, type Deployment, type ProjectApprovalStatus } from "@/lib/api";

const STATUS_STYLE: Record<Deployment["status"], string> = {
  pending: "border-border bg-surface-subtle text-fg-muted",
  running: "border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  failed: "border-red-200 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
};

export function DeploymentPanel({
  projectId,
  approvalStatus,
  deployments,
  onChanged,
}: {
  projectId: string;
  approvalStatus: ProjectApprovalStatus;
  deployments: Deployment[];
  onChanged: () => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const outstanding = deployments.find((d) => d.status === "pending" || d.status === "running");

  async function prepare() {
    setPreparing(true);
    setActionError(null);
    try {
      await api.createDeployment(projectId);
      onChanged();
    } catch {
      setActionError("Couldn't prepare a deployment — a required approval or pre-deploy check is still missing.");
    } finally {
      setPreparing(false);
    }
  }

  async function execute(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await api.executeDeployment(id);
      onChanged();
    } catch {
      setActionError("Deployment execution failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function rollback(targetDeploymentId: string) {
    setBusyId(targetDeploymentId);
    setActionError(null);
    try {
      await api.rollbackDeployment(projectId, { target_deployment_id: targetDeploymentId });
      onChanged();
    } catch {
      setActionError("Couldn't roll back to that version — its own approvals may no longer be intact.");
    } finally {
      setBusyId(null);
    }
  }

  async function checkStatus(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await api.checkDeploymentStatus(id);
      onChanged();
    } catch {
      setActionError("Couldn't check the deployment's status.");
    } finally {
      setBusyId(null);
    }
  }

  async function verify(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await api.verifyDeployment(id);
      onChanged();
    } catch {
      setActionError("Verification failed — the deployed URL didn't load cleanly.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center gap-3">
        <button
          onClick={prepare}
          disabled={!approvalStatus.can_deploy || preparing || !!outstanding}
          title={approvalStatus.can_deploy ? undefined : `Missing: ${approvalStatus.missing_for_deployment.join(", ")}`}
          className="btn btn-primary"
        >
          {preparing ? "Preparing…" : "Prepare deployment"}
        </button>
        {actionError && <p className="text-error">{actionError}</p>}
      </div>

      {deployments.length > 0 && (
        <ul className="mt-3 space-y-2">
          {deployments.map((d) => (
            <li key={d.id} className={`rounded-md border px-3 py-2 text-xs ${STATUS_STYLE[d.status]}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-surface/60 px-1.5 py-0.5 font-medium uppercase tracking-wide">
                    {d.status}
                  </span>
                  {d.status === "success" && (
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium uppercase tracking-wide ${
                        d.verified_at ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                      }`}
                    >
                      {d.verified_at ? "Verified" : "Unverified"}
                    </span>
                  )}
                  <span>
                    {d.environment} · via {d.target}
                    {d.rollback_of_deployment_id && " · rollback"}
                  </span>
                  {/* A mock deployment's URL is not a reachable site (see
                      integrations/deployment.py) — rendering it as a normal
                      link would read as "your site is live, click here". */}
                  {d.url &&
                    (d.target === "mock" ? (
                      <span className="font-mono">{d.url}</span>
                    ) : (
                      <a href={d.url} target="_blank" rel="noreferrer" className="underline">
                        {d.url}
                      </a>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                  {(d.status === "pending" || d.status === "failed") && (
                    <button
                      onClick={() => execute(d.id)}
                      disabled={busyId === d.id}
                      className="rounded border border-current px-2 py-0.5 font-medium hover:opacity-75 disabled:opacity-50"
                    >
                      {busyId === d.id ? "Running…" : d.status === "failed" ? "Retry" : "Execute"}
                    </button>
                  )}
                  {d.status === "running" && (
                    <button
                      onClick={() => checkStatus(d.id)}
                      disabled={busyId === d.id}
                      className="rounded border border-current px-2 py-0.5 font-medium hover:opacity-75 disabled:opacity-50"
                    >
                      {busyId === d.id ? "Checking…" : "Check status"}
                    </button>
                  )}
                  {d.status === "success" && !d.verified_at && (
                    <button
                      onClick={() => verify(d.id)}
                      disabled={busyId === d.id}
                      className="rounded border border-current px-2 py-0.5 font-medium hover:opacity-75 disabled:opacity-50"
                    >
                      {busyId === d.id ? "Verifying…" : "Verify"}
                    </button>
                  )}
                  {d.status === "success" && d.id !== deployments.find((x) => x.status === "success")?.id && (
                    <button
                      onClick={() => rollback(d.id)}
                      disabled={busyId === d.id}
                      className="rounded border border-current px-2 py-0.5 font-medium hover:opacity-75 disabled:opacity-50"
                    >
                      {busyId === d.id ? "Rolling back…" : "Roll back to this version"}
                    </button>
                  )}
                </div>
              </div>
              {/* The provider's own account of what it did. The mock one
                  says outright that nothing was published; showing a green
                  "SUCCESS" without it reads as a real launch. */}
              {typeof d.result?.note === "string" && <p className="mt-1 font-medium">{d.result.note}</p>}
              {d.verified_at && (
                <p className="mt-1 text-emerald-700 dark:text-emerald-400">
                  Verified{d.verified_by_user_name ? ` by ${d.verified_by_user_name}` : ""} on{" "}
                  {new Date(d.verified_at).toLocaleString()}
                </p>
              )}
              {d.error_message && <p className="mt-1 text-red-700 dark:text-red-400">{d.error_message}</p>}
              {d.notes && <p className="mt-1 text-fg-muted">{d.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
