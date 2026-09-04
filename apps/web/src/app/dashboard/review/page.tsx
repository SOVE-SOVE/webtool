"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  DISCOVERED_WEBSITE_STATUS_LABEL,
  type DiscoveredBusinessReviewItem,
  type OpportunityScoreCategory,
} from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";

const CATEGORY_STYLE: Record<OpportunityScoreCategory, string> = {
  hot: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  warm: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  cold: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  review: "bg-surface-hover text-fg-muted",
};

function Truncated({ text }: { text: string | null }) {
  if (!text) return <span className="text-fg-subtle">—</span>;
  return (
    <span title={text} className="block max-w-[320px] truncate">
      {text}
    </span>
  );
}

/** The single line that tells the operator why this prospect is worth a look. */
function whyReview(item: DiscoveredBusinessReviewItem): string | null {
  return item.recommended_sales_angle || item.quality_summary || item.key_problems[0] || null;
}

export default function ReviewPage() {
  const [items, setItems] = useState<DiscoveredBusinessReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
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

  async function handleApprove(item: DiscoveredBusinessReviewItem) {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api.approveDiscoveredBusiness(item.id);
      setNotice(
        result.outcome === "already_in_crm"
          ? `${item.name} was already in the CRM.`
          : `Added ${item.name} to the CRM as a lead.`,
      );
      load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : `Couldn't add ${item.name} to the CRM — try again.`,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(item: DiscoveredBusinessReviewItem) {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await api.rejectDiscoveredBusiness(item.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reject that.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleBulkApprove() {
    if (selected.size === 0) return;
    setBulkApproving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.bulkApproveDiscoveredBusinesses([...selected]);
      const parts: string[] = [];
      if (result.imported.length) parts.push(`${result.imported.length} added to the CRM`);
      if (result.already_in_crm.length) parts.push(`${result.already_in_crm.length} already in the CRM`);
      if (result.failed.length) parts.push(`${result.failed.length} couldn't be added`);
      setNotice(parts.join(" · ") || "Nothing to approve.");
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
      if (websiteFilter === "has" && i.website_status !== "found") return false;
      if (websiteFilter === "no" && i.website_status !== "none") return false;
      return true;
    });
  }, [items, websiteFilter]);

  const selectableIds = useMemo(
    () =>
      (visibleItems ?? [])
        .filter((i) => i.status !== "imported" && i.status !== "rejected" && i.status !== "archived")
        .map((i) => i.id),
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
        description="Discovered businesses worth a look. Approve one to add it to the CRM as a lead, or reject it."
        actions={
          <button
            onClick={handleBulkApprove}
            disabled={selected.size === 0 || bulkApproving}
            className="btn btn-primary"
          >
            {bulkApproving ? "Adding…" : `Approve & add to CRM (${selected.size})`}
          </button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
          Show rejected &amp; archived
        </label>
      </div>

      {notice && (
        <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!items && !error && (
        <div className="mt-4">
          <TableSkeleton rows={5} cols={6} />
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
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Website</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Why review</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleItems.map((item) => {
                const busy = busyId === item.id;
                const settled =
                  item.status === "imported" || item.status === "rejected" || item.status === "archived";
                return (
                  <tr key={item.id} className={item.status === "archived" ? "opacity-50" : undefined}>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="checkbox"
                        disabled={settled}
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
                          Website found
                        </a>
                      ) : (
                        <span className="text-fg-subtle">
                          {DISCOVERED_WEBSITE_STATUS_LABEL[item.website_status]}
                        </span>
                      )}
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
                      <Truncated text={whyReview(item)} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      {item.status === "imported" ? (
                        item.imported_lead_id ? (
                          <Link
                            href={`/dashboard/leads/${item.imported_lead_id}`}
                            className="text-xs text-fg-muted hover:underline"
                          >
                            View lead →
                          </Link>
                        ) : (
                          <span className="text-xs text-fg-subtle">In the CRM</span>
                        )
                      ) : item.status === "rejected" ? (
                        <span className="text-xs text-fg-subtle">Rejected</span>
                      ) : item.status === "archived" ? (
                        <span className="text-xs text-fg-subtle">Archived</span>
                      ) : (
                        <div className="flex gap-3">
                          <button
                            disabled={busy}
                            onClick={() => handleApprove(item)}
                            className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
                          >
                            {busy ? "Adding…" : "Approve"}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => handleReject(item)}
                            className="text-xs text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
                          >
                            Reject
                          </button>
                        </div>
                      )}
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
