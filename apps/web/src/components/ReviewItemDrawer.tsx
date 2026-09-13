"use client";

import Link from "next/link";
import { DISCOVERED_WEBSITE_STATUS_LABEL, type DiscoveredBusinessReviewItem } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { ReviewStatusBadge, ScoreCategoryBadge } from "@/components/ReviewStatusBadge";
import { timeAgo } from "@/lib/format";

/**
 * The Review Queue's detail/review experience: a side drawer rather than
 * a separate page, so approving/rejecting/opening the next item never
 * loses the queue's scroll position or active filters. Groups
 * information the way the redesign brief asks (Overview / Details /
 * Context / Actions) and is a *summary* of the full research record —
 * `/dashboard/discovered-businesses/[id]` remains the complete research/
 * audit/score history for anyone who wants the full trail.
 */
export function ReviewItemDrawer({
  item,
  busy,
  onClose,
  onApprove,
  onReject,
  onArchive,
  onImport,
  onResearchAgain,
}: {
  item: DiscoveredBusinessReviewItem | null;
  busy: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onArchive: (id: string) => void;
  onImport: (id: string) => void;
  onResearchAgain: (id: string) => void;
}) {
  const confirm = useConfirm();
  if (!item) return null;

  const canDecide = !["approved", "rejected", "archived", "imported"].includes(item.status);
  const canImport = item.status !== "rejected" && item.status !== "archived" && item.status !== "imported";
  const location = [item.suburb, item.state].filter(Boolean).join(", ");

  async function handleReject() {
    const ok = await confirm({
      title: "Reject this business?",
      description: `${item!.name} will be marked rejected and drop out of the active queue.`,
      confirmLabel: "Reject",
      danger: true,
    });
    if (ok) onReject(item!.id);
  }

  async function handleArchive() {
    const ok = await confirm({
      title: "Archive this business?",
      description: `${item!.name} will drop out of the default queue with no way to bring it back except finding it under the Archived tab.`,
      confirmLabel: "Archive",
      danger: true,
    });
    if (ok) onArchive(item!.id);
  }

  async function handleImport() {
    const ok = await confirm({
      title: "Add to CRM?",
      description: `Creates a business and lead record for ${item!.name}.`,
      confirmLabel: "Add to CRM",
    });
    if (ok) onImport(item!.id);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} role="presentation" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-drawer-title"
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="review-drawer-title" className="truncate text-lg font-semibold text-fg">
              {item.name}
            </h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              {[item.industry, location].filter(Boolean).join(" · ") || "No details on record"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ReviewStatusBadge status={item.status} />
          {item.score_category && <ScoreCategoryBadge category={item.score_category} score={item.opportunity_score} />}
        </div>

        {/* Overview */}
        <div className="mt-4 space-y-1 text-sm">
          {item.website_url ? (
            <a
              href={item.website_url}
              target="_blank"
              rel="noreferrer"
              className="break-all text-fg-muted hover:underline"
            >
              {item.website_url}
            </a>
          ) : (
            <p className="text-fg-subtle">{DISCOVERED_WEBSITE_STATUS_LABEL[item.website_status]}</p>
          )}
          <p className="text-xs text-fg-subtle">
            Found via {item.source_provider} · discovered {timeAgo(item.discovered_at)}
          </p>
        </div>

        {/* Context: why this needs a look */}
        <div className="mt-4 rounded-md border border-border bg-surface-subtle p-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Why this needs a look</h3>
          <p className="mt-1 text-fg">
            {item.research_error
              ? `Research failed: ${item.research_error}`
              : item.score_category === "review"
                ? "Scored with limited evidence — worth a manual check before deciding."
                : !item.researched_at
                  ? "Not researched yet. You can decide on discovery details alone, or run research first."
                  : (item.quality_summary ?? "Researched and scored — ready for a decision.")}
          </p>
        </div>

        {/* Details */}
        {(item.quality_summary || item.key_problems.length > 0 || item.recommended_sales_angle || item.confidence !== null) && (
          <div className="mt-4 space-y-2 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Details</h3>
            {item.quality_summary && <p className="text-fg">{item.quality_summary}</p>}
            {item.key_problems.length > 0 && (
              <ul className="list-inside list-disc space-y-0.5 text-fg-muted">
                {item.key_problems.map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
              </ul>
            )}
            {item.recommended_sales_angle && (
              <p className="text-fg-muted">
                <span className="font-medium text-fg">Sales angle:</span> {item.recommended_sales_angle}
              </p>
            )}
            {item.confidence !== null && (
              <p className="text-xs text-fg-subtle">{Math.round(item.confidence * 100)}% confidence in this research</p>
            )}
          </div>
        )}

        {item.status === "imported" && item.imported_lead_id && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <p className="text-emerald-900 dark:text-emerald-300">Already added to the CRM.</p>
            <Link
              href={`/dashboard/leads/${item.imported_lead_id}`}
              className="font-medium text-emerald-800 hover:underline dark:text-emerald-300"
            >
              View lead →
            </Link>
          </div>
        )}

        {item.reviewed_at && (
          <p className="mt-4 text-xs text-fg-subtle">
            Reviewed {new Date(item.reviewed_at).toLocaleDateString()}
            {item.reviewed_by_user_name ? ` by ${item.reviewed_by_user_name}` : ""}
          </p>
        )}

        <Link href={`/dashboard/discovered-businesses/${item.id}`} className="mt-4 text-sm text-fg-muted hover:underline">
          Open full research profile →
        </Link>

        {/* Actions */}
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Actions</h3>
          <div className="flex flex-wrap gap-2">
            {canDecide && (
              <button disabled={busy} onClick={() => onApprove(item.id)} className="btn btn-primary">
                {busy ? "Working…" : "Approve"}
              </button>
            )}
            {canImport && (
              <button disabled={busy} onClick={handleImport} className="btn btn-secondary">
                Add to CRM
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {canDecide && (
              <button
                disabled={busy}
                onClick={handleReject}
                className="text-sm text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
              >
                Reject
              </button>
            )}
            {canDecide && (
              <button
                disabled={busy}
                onClick={handleArchive}
                className="text-sm text-fg-muted hover:underline disabled:opacity-50"
              >
                Archive
              </button>
            )}
            {item.status !== "imported" && (
              <button
                disabled={busy}
                onClick={() => onResearchAgain(item.id)}
                className="text-sm text-fg-muted hover:underline disabled:opacity-50"
              >
                {item.researched_at ? "Research again" : "Run research"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
