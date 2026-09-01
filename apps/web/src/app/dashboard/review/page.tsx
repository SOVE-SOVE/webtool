"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  DISCOVERED_WEBSITE_STATUS_LABEL,
  type DiscoveredBusinessReviewItem,
  type DiscoveredBusinessStatus,
  type OpportunityScoreCategory,
} from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";

const STATUS_LABEL: Record<DiscoveredBusinessStatus, string> = {
  new: "New",
  researched: "Researched",
  audited: "Audited",
  scored: "Scored",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
  imported: "Imported",
};

const CATEGORY_STYLE: Record<OpportunityScoreCategory, string> = {
  hot: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  warm: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  cold: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  review: "bg-surface-hover text-fg-muted",
};

function Truncated({ text, width = "max-w-[220px]" }: { text: string | null; width?: string }) {
  if (!text) return <span className="text-fg-subtle">—</span>;
  return (
    <span title={text} className={`block ${width} truncate`}>
      {text}
    </span>
  );
}

export default function ReviewPage() {
  const [items, setItems] = useState<DiscoveredBusinessReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState<DiscoveredBusinessStatus | "">("");
  const [websiteFilter, setWebsiteFilter] = useState<"" | "has" | "no">("");
  const [bulkApproving, setBulkApproving] = useState(false);

  function load() {
    api
      .listReviewItems({ includeArchived: showArchived })
      .then((rows) => {
        setError(null);
        setItems(rows);
        setSelected((prev) => new Set([...prev].filter((id) => rows.some((r) => r.id === id))));
      })
      .catch(() => setError("Couldn't load the review list."));
  }

  useEffect(load, [showArchived]);

  async function runAction(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleBulkApprove() {
    if (selected.size === 0) return;
    setBulkApproving(true);
    setError(null);
    try {
      await api.bulkApproveDiscoveredBusinesses([...selected]);
      setSelected(new Set());
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Bulk approve failed.");
    } finally {
      setBulkApproving(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleItems = useMemo(() => {
    if (!items) return null;
    return items.filter((i) => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (websiteFilter === "has" && i.website_status !== "found") return false;
      if (websiteFilter === "no" && i.website_status !== "none") return false;
      return true;
    });
  }, [items, statusFilter, websiteFilter]);

  const selectableIds = useMemo(
    () => (visibleItems ?? []).filter((i) => i.status !== "imported").map((i) => i.id),
    [visibleItems],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Review queue"
        description="Every discovered prospect, with research and scoring context. Approving a prospect adds it to the CRM as a lead automatically."
        actions={
          <button
            onClick={handleBulkApprove}
            disabled={selected.size === 0 || bulkApproving}
            className="btn btn-primary"
          >
            {bulkApproving ? "Approving…" : `Bulk approve (${selected.size})`}
          </button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DiscoveredBusinessStatus | "")}
          className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={websiteFilter}
          onChange={(e) => setWebsiteFilter(e.target.value as "" | "has" | "no")}
          className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
          aria-label="Filter by website"
        >
          <option value="">Any website status</option>
          <option value="has">Has website</option>
          <option value="no">No website</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-fg-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!items && !error && (
        <div className="mt-4">
          <TableSkeleton rows={5} cols={5} />
        </div>
      )}

      {visibleItems && visibleItems.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
          Nothing to review yet — run a discovery search first.
        </div>
      )}

      {visibleItems && visibleItems.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border border-border text-left text-sm">
            <thead className="bg-surface-subtle text-xs uppercase text-fg-muted">
              <tr>
                <th className="px-2 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                </th>
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Website</th>
                <th className="px-3 py-2">Audit summary</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Confidence</th>
                <th className="px-3 py-2">Key problems</th>
                <th className="px-3 py-2">Sales angle</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Researched</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleItems.map((item) => {
                const busy = busyId === item.id;
                const settled = ["approved", "rejected", "archived", "imported"].includes(item.status);
                return (
                  <tr key={item.id} className={item.status === "archived" ? "opacity-50" : undefined}>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="checkbox"
                        disabled={item.status === "imported"}
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Link
                        href={`/dashboard/discovered-businesses/${item.id}`}
                        className="font-medium text-fg hover:underline"
                      >
                        {item.name}
                      </Link>
                      {item.industry && <div className="text-xs text-fg-muted">{item.industry}</div>}
                    </td>
                    <td className="px-3 py-2 align-top text-fg-muted">
                      {[item.suburb, item.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {item.website_url ? (
                        <a
                          href={item.website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-fg-muted hover:underline"
                        >
                          <Truncated text={item.website_url} width="max-w-[160px]" />
                        </a>
                      ) : (
                        <span className="text-fg-subtle">{DISCOVERED_WEBSITE_STATUS_LABEL[item.website_status]}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Truncated text={item.quality_summary} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      {item.opportunity_score !== null && item.score_category ? (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${CATEGORY_STYLE[item.score_category]}`}
                        >
                          {item.score_category} · {item.opportunity_score}
                        </span>
                      ) : (
                        <span className="text-fg-subtle">Not scored</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-fg-muted">
                      {item.confidence !== null ? `${Math.round(item.confidence * 100)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Truncated text={item.key_problems.join("; ") || null} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Truncated text={item.recommended_sales_angle} />
                    </td>
                    <td className="px-3 py-2 align-top text-fg-muted">{item.source_provider}</td>
                    <td className="px-3 py-2 align-top text-fg-muted">
                      {item.researched_at ? new Date(item.researched_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-fg-muted">{STATUS_LABEL[item.status]}</td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        {item.status === "imported" ? (
                          item.imported_lead_id && (
                            <Link
                              href={`/dashboard/leads/${item.imported_lead_id}`}
                              className="text-xs text-fg-muted hover:underline"
                            >
                              View lead →
                            </Link>
                          )
                        ) : (
                          <>
                            <button
                              disabled={busy}
                              onClick={() =>
                                runAction(item.id, () => api.runBusinessResearch(item.id))
                              }
                              className="text-xs text-fg-muted hover:underline disabled:opacity-50"
                            >
                              Research again
                            </button>
                            {!settled && (
                              <>
                                <button
                                  disabled={busy}
                                  onClick={() => runAction(item.id, () => api.approveDiscoveredBusiness(item.id))}
                                  className="text-xs text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
                                >
                                  Approve &amp; add to CRM
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() => runAction(item.id, () => api.rejectDiscoveredBusiness(item.id))}
                                  className="text-xs text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
                                >
                                  Reject
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() => runAction(item.id, () => api.archiveDiscoveredBusiness(item.id))}
                                  className="text-xs text-fg-muted hover:underline disabled:opacity-50"
                                >
                                  Archive
                                </button>
                              </>
                            )}
                            {item.status !== "rejected" && item.status !== "archived" && (
                              <button
                                disabled={busy}
                                onClick={() => runAction(item.id, () => api.importDiscoveredBusiness(item.id))}
                                className="text-xs font-medium text-fg hover:underline disabled:opacity-50"
                              >
                                Add to CRM
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
