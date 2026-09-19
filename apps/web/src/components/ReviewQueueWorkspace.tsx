"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api, ApiError, type DiscoveredBusinessReviewItem } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { ReviewStatusBadge, ScoreCategoryBadge } from "@/components/ReviewStatusBadge";
import { timeAgo } from "@/lib/format";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { TabBar } from "@/components/ui/Tabs";
import { invalidateNavCounts, loadNavCounts } from "@/lib/navCounts";
import { withParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import {
  countReviewItemsByTab,
  isReviewTab,
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

const REVIEW_SORTS = Object.keys(REVIEW_SORT_LABEL) as ReviewSortKey[];
function isReviewSort(value: string | null): value is ReviewSortKey {
  return value !== null && (REVIEW_SORTS as string[]).includes(value);
}

function ReviewQueueRow({
  item,
  href,
  selected,
  selectable,
  needsAttention,
  onToggleSelect,
  onOpen,
}: {
  item: DiscoveredBusinessReviewItem;
  href: string;
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
          <Link href={href} className="btn btn-secondary btn-sm">
            Review
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * The Review Queue tab's content — moved out of the old standalone
 * `/dashboard/review` page (now a redirect), minus its own
 * `<PageHeader>` (the parent `DiscoveryLayout` renders one shared
 * header for both Discovery tabs). Bulk-approve, filters/sort/tabs, and
 * every list-level behaviour is unchanged; per-business review moved to
 * a dedicated full page (`/dashboard/discovered-businesses/{id}`) —
 * see that page for approve/reject/archive/Add-to-Leads, which used to
 * live in the now-deleted `ReviewItemDrawer`.
 *
 * Filters/tab/sort/search are URL-synced (same read-effect +
 * `useDebouncedUrlSync` convention as Leads/Planning/Projects) and
 * scroll position is restored by URL — necessary now that "Review"
 * navigates to a real different route: unlike switching Discovery's own
 * Map/Review tabs (which stay mounted, see `DiscoveryLayout`), going to
 * the detail page and back fully unmounts this component, so state that
 * used to survive "for free" by staying mounted now has to survive a
 * real remount instead.
 *
 * `refreshToken` re-fetches when Map Discovery queues/unqueues a
 * business elsewhere (both views stay mounted simultaneously — see
 * `DiscoveryLayout`), and `onActionableCountChange` lifts the "needs a
 * decision" count up to `DiscoverySwitch`'s tab-label badge, computed
 * from the exact same `items` this view already loads — no second
 * fetch.
 */
function ReviewQueueWorkspaceInner({
  refreshToken,
  onActionableCountChange,
}: {
  refreshToken?: number;
  onActionableCountChange?: (count: number) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<DiscoveredBusinessReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);

  const [tab, setTab] = useState<ReviewTab>("needs_review");
  // Seeded once from the URL, then only ever written back to it
  // one-directionally via useDebouncedUrlSync — same convention as
  // Leads' own free-text search field, for the same reason (a slow/
  // out-of-order `replace` must never "correct" the field mid-keystroke).
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [websiteFilter, setWebsiteFilter] = useState<"" | "has" | "no">("");
  const [sort, setSort] = useState<ReviewSortKey>("score");

  useDebouncedUrlSync("search", search);

  function updateParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value)}`, { scroll: false });
  }

  // Read the rest of the filters back from the URL on every change —
  // covers the initial load, a direct link, and browser Back/Forward.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const t = searchParams.get("tab");
    setTab(isReviewTab(t) ? t : "needs_review");
    const w = searchParams.get("website");
    setWebsiteFilter(w === "has" || w === "no" ? w : "");
    const s = searchParams.get("sort");
    setSort(isReviewSort(s) ? s : "score");
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Lets the detail page's "Back to Review Queue" link return to this
  // exact list state (tab/filters/sort/search/scroll) instead of a bare
  // URL — same convention as every other list→detail pair in this app.
  useEffect(() => {
    sessionStorage.setItem("wdos-list-return:discovery-review", `${pathname}?${searchParams.toString()}`);
  }, [pathname, searchParams]);

  useScrollRestoration(items !== null);

  function load() {
    api
      .listReviewItems({ includeArchived: true, queuedOnly: true })
      .then((rows) => {
        setError(null);
        setItems(rows);
        setSelected((prev) => new Set([...prev].filter((id) => rows.some((r) => r.id === id))));
      })
      .catch(() => setError("Couldn't load the review queue."));
  }

  useEffect(load, []);
  // A business was queued/unqueued from Map Discovery — refetch so it
  // appears/disappears here without the operator switching tabs twice.
  useEffect(() => {
    if (refreshToken !== undefined) load();
  }, [refreshToken]);

  // (Returning from the full review page after approve/reject/import
  // needs no special refetch here: navigating to `/dashboard/
  // discovered-businesses/{id}` is a real route change out of the
  // Discovery segment, so this component fully unmounts and its
  // `useEffect(load, [])` above runs fresh on the way back.)

  // Lift the "still needs a decision" count up for the tab-label badge —
  // same shape as the sidebar's own reviewQueue count (lib/navCounts.ts),
  // derived here from the list this view already has loaded.
  useEffect(() => {
    if (items) onActionableCountChange?.(reviewQueueSummary(items).pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function handleBulkApprove() {
    if (selected.size === 0) return;
    setBulkApproving(true);
    setError(null);
    try {
      await api.bulkApproveDiscoveredBusinesses([...selected]);
      setSelected(new Set());
      load();
      invalidateNavCounts();
      loadNavCounts({ force: true }).catch(() => {});
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
    updateParam("website", null);
  }

  const selectableIds = useMemo(
    () => (visibleItems ?? []).filter((i) => i.status !== "imported").map((i) => i.id),
    [visibleItems],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  return (
    <div>
      {summary ? (
        <MetricGrid>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )
      )}

      <TabBar
        className="mt-5"
        tabs={REVIEW_TABS.map((t) => ({ id: t.id, label: t.label, count: tabCounts?.[t.id] ?? 0 }))}
        active={tab}
        onChange={(id) => updateParam("tab", id === "needs_review" ? null : id)}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search business, industry, suburb…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-64"
        />
        <Select
          value={websiteFilter}
          onChange={(e) => updateParam("website", e.target.value || null)}
          className="input w-auto"
          aria-label="Filter by website"
        >
          <option value="">Any website status</option>
          <option value="has">Has website</option>
          <option value="no">No website</option>
        </Select>
        <Select
          value={sort}
          onChange={(e) => updateParam("sort", e.target.value === "score" ? null : e.target.value)}
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
            title="Nothing in the review queue yet"
            description="Run a Map Discovery search, then use its 'Add to Review Queue' action to bring candidates here to approve, reject, or bring the good ones into the CRM."
            action={
              <Link href="/dashboard/discovery/map" className="btn btn-primary">
                Go to Map Discovery
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
                  updateParam("tab", "all");
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
            {visibleItems.map((item) => {
              const href = `/dashboard/discovered-businesses/${item.id}`;
              return (
                <ReviewQueueRow
                  key={item.id}
                  item={item}
                  href={href}
                  selected={selected.has(item.id)}
                  selectable={item.status !== "imported"}
                  needsAttention={reviewItemNeedsAttention(item)}
                  onToggleSelect={() => toggleSelected(item.id)}
                  onOpen={() => router.push(href)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** `ReviewQueueWorkspaceInner` reads `useSearchParams()` for its
 * URL-synced filters, which Next.js requires a Suspense boundary for —
 * wrapped here so callers (`DiscoveryLayout`) don't need to know that. */
export function ReviewQueueWorkspace(props: {
  refreshToken?: number;
  onActionableCountChange?: (count: number) => void;
}) {
  return (
    <Suspense fallback={null}>
      <ReviewQueueWorkspaceInner {...props} />
    </Suspense>
  );
}
