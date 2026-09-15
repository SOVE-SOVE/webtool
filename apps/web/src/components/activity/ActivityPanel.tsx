"use client";

import Link from "next/link";
import { useRef } from "react";
import type { PlanningListItem } from "@/lib/api";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";

type Group = "running" | "failed" | "completed";

// A run that finished and needs a human look (e.g. the AI fallback
// kicked in) is still a *finished* run, not a pending one — it must
// bucket as "completed" here or it silently vanishes from the feed
// entirely (confirmed live: three of four real Planning items in this
// workspace sit in `needs_review`, not `completed`, after their audit
// actually finished).
function isFinished(status: string | null): boolean {
  return status === "completed" || status === "needs_review";
}

function classify(item: PlanningListItem): Group | null {
  if (item.status === "analysing" || item.comparable_research_status === "analysing" || item.content_draft_status === "generating") {
    return "running";
  }
  if (item.status === "failed" || item.comparable_research_status === "failed" || item.content_draft_status === "failed") {
    return "failed";
  }
  if (isFinished(item.status) || isFinished(item.comparable_research_status) || isFinished(item.content_draft_status)) {
    return "completed";
  }
  // ready_to_analyse / ready_for_review / null — nothing has run for
  // this item yet, so it's not part of the activity feed at all.
  return null;
}

function statusLine(item: PlanningListItem): string {
  if (item.status === "analysing") return "Analysing website…";
  if (item.comparable_research_status === "analysing") return "Researching comparable sites…";
  if (item.content_draft_status === "generating") return item.content_draft_progress_label ?? "Generating content draft…";
  if (item.status === "failed") return "Website analysis failed";
  if (item.comparable_research_status === "failed") return "Comparable research failed";
  if (item.content_draft_status === "failed") return "Content draft generation failed";
  if (item.status === "needs_review") return "Needs review";
  if (item.comparable_research_status === "needs_review") return "Comparable research needs review";
  if (item.content_draft_status === "needs_review") return "Content draft needs review";
  return "Completed";
}

function sortKey(item: PlanningListItem): number {
  return new Date(item.analysed_at ?? item.created_at).getTime();
}

function Row({ item }: { item: PlanningListItem }) {
  return (
    <Link
      href={`/dashboard/planning/${item.id}`}
      className="block rounded-md px-2 py-1.5 hover:bg-surface-hover"
    >
      <p className="truncate text-sm font-medium text-fg">{item.lead_business_name}</p>
      <p className="truncate text-xs text-fg-muted">{statusLine(item)}</p>
    </Link>
  );
}

/**
 * Read-only, navigational summary of background Planning jobs
 * (analysis / comparable research / content draft) across the current
 * workspace — no Retry action here on purpose: a failed row links to
 * the workspace, where the existing retry actions already live behind
 * the stale/failed banners.
 */
export function ActivityPanel({ items, onClose }: { items: PlanningListItem[]; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: closeButtonRef });

  const running = items.filter((i) => classify(i) === "running");
  const failed = items.filter((i) => classify(i) === "failed");
  const completed = items
    .filter((i) => classify(i) === "completed")
    .sort((a, b) => sortKey(b) - sortKey(a))
    .slice(0, 10);

  const nothingToShow = running.length === 0 && failed.length === 0 && completed.length === 0;

  return (
    <div className="side-panel-overlay" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Background activity"
        className="side-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-base font-semibold text-fg">Background activity</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {nothingToShow && <p className="px-2 py-4 text-sm text-fg-muted">Nothing running right now.</p>}

          {running.length > 0 && (
            <div>
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Running</p>
              <div className="mt-1 space-y-0.5">
                {running.map((item) => (
                  <Row key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {failed.length > 0 && (
            <div>
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Failed</p>
              <div className="mt-1 space-y-0.5">
                {failed.map((item) => (
                  <Row key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div>
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Completed recently</p>
              <div className="mt-1 space-y-0.5">
                {completed.map((item) => (
                  <Row key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
