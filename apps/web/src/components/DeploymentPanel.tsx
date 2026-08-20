"use client";

import { useState } from "react";
import { api, type Deployment, type ProjectApprovalStatus } from "@/lib/api";

const STATUS_STYLE: Record<Deployment["status"], string> = {
  pending: "border-neutral-200 bg-neutral-50 text-neutral-600",
  running: "border-amber-200 bg-amber-50 text-amber-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-red-200 bg-red-50 text-red-800",
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

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <div className="flex items-center gap-3">
        <button
          onClick={prepare}
          disabled={!approvalStatus.can_deploy || preparing || !!outstanding}
          title={approvalStatus.can_deploy ? undefined : `Missing: ${approvalStatus.missing_for_deployment.join(", ")}`}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {preparing ? "Preparing…" : "Prepare deployment"}
        </button>
        {actionError && <p className="text-sm text-red-600">{actionError}</p>}
      </div>

      {deployments.length > 0 && (
        <ul className="mt-3 space-y-2">
          {deployments.map((d) => (
            <li key={d.id} className={`rounded-md border px-3 py-2 text-xs ${STATUS_STYLE[d.status]}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-white/60 px-1.5 py-0.5 font-medium uppercase tracking-wide">
                    {d.status}
                  </span>
                  <span>
                    {d.environment} · via {d.target}
                    {d.rollback_of_deployment_id && " · rollback"}
                  </span>
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noreferrer" className="underline">
                      {d.url}
                    </a>
                  )}
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
              {d.error_message && <p className="mt-1 text-red-700">{d.error_message}</p>}
              {d.notes && <p className="mt-1 text-neutral-500">{d.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
