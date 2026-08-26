"use client";

import { useState } from "react";
import {
  api,
  WORKFLOW_STATUS_LABELS,
  WORKFLOW_TRANSITIONS,
  type Website,
  type WebsiteWorkflowStatus,
  type WorkflowTransition,
} from "@/lib/api";

const STATUS_STYLES: Record<WebsiteWorkflowStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  internal_review: "bg-blue-100 text-blue-800",
  client_review: "bg-purple-100 text-purple-800",
  changes_requested: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  ready_to_deploy: "bg-teal-100 text-teal-800",
  deployed: "bg-neutral-900 text-white",
};

export function WebsiteWorkflowPanel({ website, onChange }: { website: Website; onChange: (w: Website) => void }) {
  const [history, setHistory] = useState<WorkflowTransition[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadHistory() {
    api.listWorkflowHistory(website.id).then(setHistory).catch(() => {});
  }

  async function handleTransition(to: WebsiteWorkflowStatus) {
    setTransitioning(true);
    setError(null);
    try {
      const updated = await api.transitionWebsiteWorkflow(website.id, { to_status: to });
      onChange(updated);
      if (showHistory) loadHistory();
    } catch {
      setError("Couldn't move this version to that stage.");
    } finally {
      setTransitioning(false);
    }
  }

  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next) loadHistory();
  }

  const nextStates = WORKFLOW_TRANSITIONS[website.workflow_status];

  return (
    <div className="mt-6 rounded-md border border-neutral-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-500">Approval workflow:</span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[website.workflow_status]}`}>
            {WORKFLOW_STATUS_LABELS[website.workflow_status]}
          </span>
        </div>
        <button onClick={toggleHistory} className="text-xs text-neutral-500 hover:underline">
          {showHistory ? "Hide history" : "Show history"}
        </button>
      </div>

      {nextStates.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {nextStates.map((s) => (
            <button
              key={s}
              onClick={() => handleTransition(s)}
              disabled={transitioning}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              Move to {WORKFLOW_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-neutral-500">
          This version has been deployed — regenerate or edit it to start a new draft.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {showHistory && (
        <div className="mt-4 border-t border-neutral-100 pt-3">
          {history === null && <p className="text-sm text-neutral-500">Loading…</p>}
          {history !== null && history.length === 0 && <p className="text-sm text-neutral-500">No transitions yet.</p>}
          <ul className="space-y-1 text-xs text-neutral-600">
            {history?.map((h) => (
              <li key={h.id}>
                {WORKFLOW_STATUS_LABELS[h.from_status]} → {WORKFLOW_STATUS_LABELS[h.to_status]} —{" "}
                {h.actor_user_name ?? h.actor_label ?? "system"} · {new Date(h.created_at).toLocaleString()}
                {h.notes ? ` — "${h.notes}"` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
