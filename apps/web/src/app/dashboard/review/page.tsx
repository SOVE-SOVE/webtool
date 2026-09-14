"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type DiscoveredBusinessReviewItem } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { ReviewStatusBadge, ScoreCategoryBadge } from "@/components/ReviewStatusBadge";
import { ReviewItemDrawer } from "@/components/ReviewItemDrawer";
import { timeAgo } from "@/lib/format";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  countReviewItemsByTab,
  REVIEW_SORT_LABEL,
  REVIEW_TABS,
  reviewItemMatchesQuery,
  reviewItemMatchesTab,
  reviewItemNeedsAttention,
  reviewQueueSummary,
  sortReviewItems,
  type ReviewSortKey,
  type ReviewTab,
} from "@/lib/reviewQueue";

function ReviewQueueRow({
  item,
  selected,
  selectable,
  needsAttention,
  onToggleSelect,
  onOpen,
}: {
  item: DiscoveredBusinessReviewItem;
  selected: boolean;
  selectable: boolean;
  needsAttention: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const location = [item.suburb, item.state].filter(Boolean).join(", ");
  const whatNeedsReview =
    item.research_error ?? item.quality_summary ?? (item.researched_at ? null : "Not researched yet");

  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer flex-col gap-2 px-3 py-3 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex shrink-0 items-center pt-0.5 sm:pt-0" onClick={(e) => e.stopPropagation()}>
        {selectable ? (
          <Checkbox checked={selected} onChange={onToggleSelect} aria-label={`Select ${item.name}`} />
        ) : (
          <span className="block h-4 w-4" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-fg">{item.name}</span>
          {needsAttention && (
            <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">Needs attention</span>
          )}
        </div>
        <p className="truncate text-xs text-fg-muted">
          {[item.industry, location].filter(Boolean).join(" · ") || "No details on record"}
        </p>
        {whatNeedsReview && <p className="mt-1 line-clamp-1 text-sm text-fg-muted">{whatNeedsReview}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <ReviewStatusBadge status={item.status} />
          {item.score_category && <ScoreCategoryBadge category={item.score_category} score={item.opportunity_score} />}
          <span className="text-xs text-fg-subtle">{timeAgo(item.discovered_at)}</span>
        </div>
      </div>

      <div className="shrink-0 self-start sm:self-center" onClick={(e) => e.stopPropagation()}>
        {item.status === "imported" && item.imported_lead_id ? (
          <Link href={`/dashboard/leads/${item.imported_lead_id}`} className="text-sm text-fg-muted hover:underline">
            View lead →
          </Link>
        ) : (
          <button onClick={onOpen} className="btn btn-secondary btn-sm">
            Review
          </button>
        )}
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const [items, setItems] = useState<DiscoveredBusinessReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);

  const [tab, setTab] = useState<ReviewTab>("needs_review");
  const [search, setSearch] = useState("");
  const [websiteFilter, setWebsiteFilter] = useState<"" | "has" | "no">("");
  const [sort, setSort] = useState<ReviewSortKey>("score");
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  function load() {
    api
      .listReviewItems({ includeArchived: true })
      .then((rows) => {
        setError(null);
        setItems(rows);
        setSelected((prev) => new Set([...prev].filter((id) => rows.some((r) => r.id === id))));
      })
      .catch(() => setError("Couldn't load the review queue."));
  }

  useEffect(load, []);

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

  const tabCounts = useMemo(() => (items ? countReviewItemsByTab(items) : null), [items]);
  const summary = useMemo(() => (items ? reviewQueueSummary(items) : null), [items]);

  const tabItems = useMemo(() => {
    if (!items) return null;
    return items.filter((i) => reviewItemMatchesTab(i, tab));
  }, [items, tab]);

  const filtersActive = search.trim() !== "" || websiteFilter !== "";

  const visibleItems = useMemo(() => {
    if (!tabItems) return null;
    const filtered = tabItems.filter((i) => {
      if (websiteFilter === "has" && i.website_status !== "found") return false;
      if (websiteFilter === "no" && i.website_status !== "none") return false;
      return reviewItemMatchesQuery(i, search);
    });
    return sortReviewItems(filtered, sort);
  }, [tabItems, websiteFilter, search, sort]);

  function clearFilters() {
    setSearch("");
    setWebsiteFilter("");
  }

  const selectableIds = useMemo(
    () => (visibleItems ?? []).filter((i) => i.status !== "imported").map((i) => i.id),
    [visibleItems],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  const activeItem = useMemo(() => items?.find((i) => i.id === activeItemId) ?? null, [items, activeItemId]);

  return (
    <div className="p-6">
      <PageHeader
        title="Review queue"
        description="Discovered prospects with research and scoring context — approve, reject, or bring the good ones into the CRM."
      />

      {summary ? (
        <MetricGrid className="mt-4">
          <Metric
            label="Needs review"
            value={summary.pending}
            hint={summary.pending === 0 ? "All caught up" : "Awaiting a decision"}
          />
          <Metric label="Approved" value={summary.approved} />
          <Metric label="Rejected" value={summary.rejected} />
          <Metric
            label="Needs attention"
            value={summary.needsAttention}
            hint="Failed research or thin evidence"
          />
        </MetricGrid>
      ) : (
        !error && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )
      )}

      <div className="mt-5 flex flex-wrap gap-1 border-b border-border">
        {REVIEW_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              tab === t.id ? "border-fg font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-fg-subtle">{tabCounts?.[t.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search business, industry, suburb…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-64"
        />
        <Select
          value={websiteFilter}
          onChange={(e) => setWebsiteFilter(e.target.value as "" | "has" | "no")}
          className="input w-auto"
          aria-label="Filter by website"
        >
          <option value="">Any website status</option>
          <option value="has">Has website</option>
          <option value="no">No website</option>
        </Select>
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as ReviewSortKey)}
          className="input w-auto"
          aria-label="Sort"
        >
          {Object.entries(REVIEW_SORT_LABEL).map(([key, label]) => (
            <option key={key} value={key}>
              Sort: {label}
            </option>
          ))}
        </Select>
        {filtersActive && (
          <button onClick={clearFilters} className="text-xs text-fg-muted hover:text-fg hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border-strong bg-surface-subtle px-3 py-2 text-sm">
          <span className="text-fg">{selected.size} selected</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(new Set())} className="text-fg-muted hover:underline">
              Clear
            </button>
            <button onClick={handleBulkApprove} disabled={bulkApproving} className="btn btn-primary btn-sm">
              {bulkApproving ? "Approving…" : `Approve ${selected.size}`}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!items && !error && (
        <div className="mt-4">
          <TableSkeleton rows={6} cols={5} />
        </div>
      )}

      {items && items.length === 0 && !error && (
        <div className="mt-4">
          <EmptyState
            title="Nothing to review yet"
            description="Run a Discovery search to find businesses, then come back here to approve, reject, or bring the good ones into the CRM."
            action={
              <Link href="/dashboard/discovery" className="btn btn-primary">
                Go to Discovery
              </Link>
            }
          />
        </div>
      )}

      {items && items.length > 0 && visibleItems && visibleItems.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No items in this view"
            description="Try a different tab, or clear the search and filters above."
            action={
              <button
                onClick={() => {
                  clearFilters();
                  setTab("all");
                }}
                className="btn btn-secondary btn-sm"
              >
                Clear filters
              </button>
            }
          />
        </div>
      )}

      {visibleItems && visibleItems.length > 0 && (
        <div className="mt-4 rounded-md border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-surface-subtle px-3 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
            <Checkbox checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
            <span>
              {visibleItems.length} of {tabItems?.length ?? visibleItems.length} shown
            </span>
          </div>
          <div className="divide-y divide-border">
            {visibleItems.map((item) => (
              <ReviewQueueRow
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                selectable={item.status !== "imported"}
                needsAttention={reviewItemNeedsAttention(item)}
                onToggleSelect={() => toggleSelected(item.id)}
                onOpen={() => setActiveItemId(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      <ReviewItemDrawer
        item={activeItem}
        busy={busyId === activeItem?.id}
        onClose={() => setActiveItemId(null)}
        onApprove={(id) => runAction(id, () => api.approveDiscoveredBusiness(id))}
        onReject={(id) => runAction(id, () => api.rejectDiscoveredBusiness(id))}
        onArchive={(id) => runAction(id, () => api.archiveDiscoveredBusiness(id))}
        onImport={(id) => runAction(id, () => api.importDiscoveredBusiness(id))}
        onResearchAgain={(id) => runAction(id, () => api.runBusinessResearch(id))}
      />
    </div>
  );
}
