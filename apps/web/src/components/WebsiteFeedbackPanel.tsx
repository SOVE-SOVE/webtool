"use client";

import { useEffect, useState } from "react";
import { api, type FeedbackStatus, type FeedbackType, type WebsiteFeedback } from "@/lib/api";

const TYPE_LABELS: Record<FeedbackType, string> = {
  comment: "Comment",
  change_request: "Change request",
  approval: "Approval",
  rejection: "Rejection",
  general: "General",
};

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  acknowledged: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  dismissed: "bg-surface-subtle text-fg-muted",
};

// Feedback that carries a decision on the whole version — surfaced
// distinctly since it's read differently from a comment/change request.
const TYPE_STYLES: Partial<Record<FeedbackType, string>> = {
  approval: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
  rejection: "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10",
};

export function WebsiteFeedbackPanel({ projectId, websiteId }: { projectId: string; websiteId?: string }) {
  const [items, setItems] = useState<WebsiteFeedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .listWebsiteFeedback(projectId, websiteId)
      .then(setItems)
      .catch(() => setError("Couldn't load feedback."));
  }

  useEffect(load, [projectId, websiteId]);

  async function updateStatus(id: string, status: FeedbackStatus) {
    try {
      await api.updateWebsiteFeedbackStatus(id, { status });
      load();
    } catch {
      setError("Couldn't update that feedback item.");
    }
  }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <h2 className="text-sm font-semibold text-fg">Client feedback</h2>
      {error && <p className="mt-2 text-error">{error}</p>}

      <div className="mt-4 space-y-3">
        {items === null && <p className="text-sm text-fg-muted">Loading…</p>}
        {items !== null && items.length === 0 && (
          <p className="text-sm text-fg-muted">No feedback yet — share a preview link to start collecting it.</p>
        )}
        {items?.map((item) => (
          <div
            key={item.id}
            className={`rounded-md border p-3 text-sm ${TYPE_STYLES[item.feedback_type] ?? "border-border"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-fg">{TYPE_LABELS[item.feedback_type]}</span>
                {item.page_slug !== null && (
                  <span className="text-xs text-fg-muted">on {item.page_slug === "" ? "Home" : item.page_slug}</span>
                )}
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status]}`}>{item.status}</span>
              </div>
              <span className="text-xs text-fg-subtle">{new Date(item.created_at).toLocaleString()}</span>
            </div>

            <p className="mt-2 text-fg">{item.message}</p>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-fg-muted">
                {item.client_name ?? "Anonymous"}
                {item.client_email ? ` · ${item.client_email}` : ""}
              </p>
              {item.status !== "resolved" && item.status !== "dismissed" && (
                <div className="flex gap-2">
                  {item.status === "open" && (
                    <button
                      onClick={() => updateStatus(item.id, "acknowledged")}
                      className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-hover"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    onClick={() => updateStatus(item.id, "resolved")}
                    className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-hover"
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() => updateStatus(item.id, "dismissed")}
                    className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-hover"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {item.resolved_by_user_name && (
                <p className="text-xs text-fg-muted">by {item.resolved_by_user_name}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
