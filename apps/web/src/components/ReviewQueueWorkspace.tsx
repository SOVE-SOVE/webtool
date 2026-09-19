"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type ReviewQueuePage } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { CommandBar } from "@/components/ui/CommandBar";
import { CompactSelect, SortSelect } from "@/components/ui/CompactSelect";
import { FilterChips, type FilterChip } from "@/components/ui/FilterChips";
import { FilterField, FilterPopover } from "@/components/ui/FilterPopover";
import { SearchInput } from "@/components/ui/SearchInput";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { useToast } from "@/components/ui/ToastProvider";
import { ReviewQueueHeader, ReviewQueueRow, ReviewQueueRowSkeleton } from "@/components/review/ReviewQueueRow";
import type { DiscoveredBusinessReviewItem } from "@/lib/api";
import { invalidateNavCounts, loadNavCounts } from "@/lib/navCounts";
import { withParam } from "@/lib/url";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import {
  hasActiveReviewFilters,
  pageRange,
  parseReviewQuery,
  quickFilterFor,
  REVIEW_QUICK_FILTERS,
  REVIEW_PAGE_SIZE,
  REVIEW_SORT_LABEL,
  REVIEW_TABS,
  saveReviewOrder,
  type ReviewFilters,
} from "@/lib/reviewQueue";

const LAST_OPEN_KEY = "wdos-review-last-open";

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
  const confirm = useConfirm();
  const toast = useToast();

  // The URL is the single source of truth for tab/filters/sort/search/page
  // — derived, never copied into state, so Back/Forward and the review
  // page's "Back to Review Queue" always land on exactly this view.
  const query = useMemo(() => parseReviewQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const { tab, website: websiteFilter, analysis: analysisFilter, score: scoreFilter, sort, page: requestedPage } = query;
  const queryString = searchParams.toString();

  const [data, setData] = useState<ReviewQueuePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Seeded once from the URL, then only written back to it (debounced,
  // and resetting to page 1) — a slow `replace` must never "correct" the
  // field mid-keystroke.
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const listTopRef = useRef<HTMLDivElement>(null);
  // Latest-request marker so a superseded response is ignored.
  const requestSeq = useRef(0);

  function navigate(params: URLSearchParams) {
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  /** Change a criterion: always returns to page 1. */
  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(withParam(searchParams, key, value));
    next.delete("page");
    navigate(next);
  }

  useEffect(() => {
    if (search === (searchParams.get("search") ?? "")) return;
    const id = setTimeout(() => updateParam("search", search.trim() === "" ? null : search), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // A new result set invalidates page-specific state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSelected(new Set());
  }, [queryString]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Lets the detail page's "Back to Review Queue" link return to this
  // exact list state (tab/filters/sort/search/page/scroll) instead of a
  // bare URL — same convention as every other list→detail pair here.
  useEffect(() => {
    sessionStorage.setItem("wdos-list-return:discovery-review", `${pathname}?${queryString}`);
  }, [pathname, queryString]);

  useScrollRestoration(data !== null);

  // Fetches exactly one page. Old rows stay on screen until the new page
  // arrives (no blank flash or height jump), and a stale response from a
  // superseded request is ignored.
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const res = await api.listReviewQueuePage({
        page: query.page,
        pageSize: REVIEW_PAGE_SIZE,
        tab: query.tab,
        search: query.search,
        website: query.website,
        analysis: query.analysis,
        score: query.score,
        sort: query.sort,
      });
      if (seq !== requestSeq.current) return;
      setError(null);
      setData(res);
      setSelected((prev) => new Set([...prev].filter((id) => res.items.some((r) => r.id === id))));
      // The server clamps a page past the end (e.g. after the last row of
      // the last page was removed) — follow it so the URL stays valid.
      if (res.page !== query.page) {
        const next = new URLSearchParams(queryString);
        if (res.page <= 1) next.delete("page");
        else next.set("page", String(res.page));
        navigate(next);
      }
    } catch {
      if (seq === requestSeq.current) setError("Couldn't load the review queue.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */
  // A business was queued/unqueued from Map Discovery — refetch so it
  // appears/disappears here without the operator switching tabs twice.
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (refreshToken !== undefined) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // Lift the "still needs a decision" count up for the tab-label badge.
  const needsReviewCount = data?.tab_counts.needs_review;
  useEffect(() => {
    if (needsReviewCount !== undefined) onActionableCountChange?.(needsReviewCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsReviewCount]);

  const rows = useMemo(() => data?.items ?? [], [data]);

  // Share the current page's position with the review page so its
  // Previous/Next follow this exact order.
  useEffect(() => {
    if (!data) return;
    saveReviewOrder({
      ids: data.items.map((i) => i.id),
      page: data.page,
      pageSize: data.page_size,
      total: data.total,
      totalPages: data.total_pages,
      query: queryString,
    });
  }, [data, queryString]);

  function refreshCounts() {
    invalidateNavCounts();
    loadNavCounts({ force: true }).catch(() => {});
  }

  async function handleBulkApprove() {
    if (selected.size === 0) return;
    setBulkApproving(true);
    setActionError(null);
    try {
      await api.bulkApproveDiscoveredBusinesses([...selected]);
      setSelected(new Set());
      await load();
      refreshCounts();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Bulk approve failed.");
    } finally {
      setBulkApproving(false);
    }
  }

  // Un-queues only: the discovered-business record, its research and any
  // approval stay exactly as they are (DELETE …/queue just clears
  // `review_queued_at`), and it can be re-added from Map Discovery.
  async function removeFromQueue(ids: string[]) {
    const targets = rows.filter((i) => ids.includes(i.id) && i.status !== "imported");
    if (targets.length === 0) return;
    const ok = await confirm({
      title: targets.length === 1 ? "Remove from Review Queue?" : `Remove ${targets.length} businesses from the Review Queue?`,
      description:
        (targets.length === 1 ? `${targets[0].name} will leave` : "They will leave") +
        " the queue. The discovered-business record and its research are kept, and you can add it back from Map Discovery.",
      confirmLabel: "Remove from queue",
      danger: true,
    });
    if (!ok) return;
    setRemoving(true);
    setActionError(null);
    const results = await Promise.allSettled(targets.map((r) => api.removeFromReviewQueue(r.id)));
    const failed = targets.filter((_, i) => results[i].status === "rejected");
    setSelected(new Set(failed.map((r) => r.id)));
    // Refetch the current page: rows from the next page slide up to fill
    // it, and the server steps back a page if this one is now empty.
    await load();
    refreshCounts();
    setRemoving(false);
    if (failed.length > 0) {
      setActionError(`Couldn't remove ${failed.map((f) => f.name).join(", ")} from the queue.`);
    } else {
      toast(targets.length === 1 ? "Removed from the Review Queue" : `Removed ${targets.length} from the Review Queue`);
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

  const filters: ReviewFilters = useMemo(
    () => ({ search: query.search, website: websiteFilter, analysis: analysisFilter, score: scoreFilter }),
    [query.search, websiteFilter, analysisFilter, scoreFilter],
  );
  const filtersActive = hasActiveReviewFilters(filters) || search.trim() !== "";

  function clearFilters() {
    setSearch("");
    const next = new URLSearchParams(searchParams.toString());
    for (const k of ["search", "website", "analysis", "score", "page"]) next.delete(k);
    navigate(next);
  }

  // Everything inside the Filters popover (and its chips): the criteria
  // plus the review state. Search and the All/Ready/Needs attention quick
  // filters live outside it and are left alone.
  function clearPopoverFilters() {
    const next = new URLSearchParams(searchParams.toString());
    for (const k of ["website", "score", "tab", "page"]) next.delete(k);
    if (next.get("analysis") === "not_run") next.delete("analysis");
    navigate(next);
  }

  function goToPage(target: number) {
    if (!data || target < 1 || target > data.total_pages || target === data.page) return;
    const next = new URLSearchParams(searchParams.toString());
    if (target === 1) next.delete("page");
    else next.set("page", String(target));
    // A fresh page opens at its top, not at a scroll offset remembered
    // from an earlier visit to the same URL.
    try {
      const qs = next.toString();
      sessionStorage.removeItem(`wdos-scroll:${pathname}?${qs}`);
    } catch {
      /* ignore */
    }
    navigate(next);
    // Bring the start of the list into view only if it has scrolled away.
    const top = listTopRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" });
  }

  const selectableIds = useMemo(() => rows.filter((i) => i.status !== "imported").map((i) => i.id), [rows]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  // Put keyboard focus back on the row the operator just came from.
  const ready = data !== null;
  useEffect(() => {
    if (!ready) return;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(LAST_OPEN_KEY);
      sessionStorage.removeItem(LAST_OPEN_KEY);
    } catch {
      /* ignore */
    }
    if (!id) return;
    document
      .querySelector<HTMLElement>(`[data-review-id="${CSS.escape(id)}"] a[href^="/dashboard/discovered-businesses/"]`)
      ?.focus({ preventScroll: true });
  }, [ready]);

  function openReview(id: string) {
    try {
      sessionStorage.setItem(LAST_OPEN_KEY, id);
    } catch {
      /* ignore */
    }
    router.push(`/dashboard/discovered-businesses/${id}`);
  }

  const total = data?.total ?? 0;
  const page = data?.page ?? requestedPage;
  const totalPages = data?.total_pages ?? 1;
  const range = pageRange(page, REVIEW_PAGE_SIZE, rows.length);
  const tabCounts = data?.tab_counts;
  const queueEmpty = data !== null && (tabCounts ? Object.entries(tabCounts).every(([k, n]) => k === "archived" || n === 0) : false) && !filtersActive && tab === "needs_review" && (tabCounts?.archived ?? 0) === 0;
  const tabLabel = REVIEW_TABS.find((t) => t.id === tab)?.label ?? "";
  const activeQuick = quickFilterFor(analysisFilter);

  const tabOptions = REVIEW_TABS.map((t) => ({
    value: t.id,
    label: `${t.label}${tabCounts ? ` (${tabCounts[t.id] ?? 0})` : ""}`,
  }));
  const websiteOptions = [
    { value: "", label: "Any website" },
    { value: "has", label: "Website listed" },
    { value: "no", label: "No website found" },
    { value: "check", label: "Needs checking" },
  ];
  const checkOptions = [
    { value: "", label: "Any check status" },
    { value: "done", label: "Ready to review" },
    { value: "not_run", label: "Not checked" },
    { value: "failed", label: "Check unavailable" },
  ];
  const scoreOptions = [
    { value: "", label: "Any score" },
    { value: "hot", label: "Hot" },
    { value: "warm", label: "Warm" },
    { value: "cold", label: "Cold" },
    { value: "review", label: "Needs review (low evidence)" },
    { value: "unscored", label: "Not assessed" },
  ];
  const sortOptions = Object.entries(REVIEW_SORT_LABEL).map(([value, label]) => ({ value, label }));
  const labelOf = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

  // One chip per active criterion inside the popover. The quick filters
  // (Ready / Needs attention) already show their state, so they get no chip.
  const chips: FilterChip[] = [];
  if (tab !== "needs_review")
    chips.push({ id: "tab", label: "Review state", value: REVIEW_TABS.find((t) => t.id === tab)?.label ?? tab, onRemove: () => updateParam("tab", null) });
  if (websiteFilter)
    chips.push({ id: "website", label: "Website", value: labelOf(websiteOptions, websiteFilter), onRemove: () => updateParam("website", null) });
  if (analysisFilter === "not_run")
    chips.push({ id: "analysis", label: "Check", value: labelOf(checkOptions, analysisFilter), onRemove: () => updateParam("analysis", null) });
  if (scoreFilter)
    chips.push({ id: "score", label: "Score", value: labelOf(scoreOptions, scoreFilter), onRemove: () => updateParam("score", null) });

  return (
    <div>
      <CommandBar
        search={
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search businesses…"
            aria-label="Search by business name, category or suburb"
          />
        }
        filters={
          <>
            <div role="group" aria-label="Quick filter" className="flex items-center gap-1">
              {REVIEW_QUICK_FILTERS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  aria-pressed={activeQuick === q.id}
                  onClick={() => updateParam("analysis", q.analysis || null)}
                  className={`btn btn-sm min-h-8 ${activeQuick === q.id ? "btn-secondary" : "btn-ghost"}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <FilterPopover activeCount={chips.length} onClearAll={clearPopoverFilters}>
              <FilterField label="Review state">
                <CompactSelect value={tab} onValueChange={(v) => updateParam("tab", v === "needs_review" ? null : v)} options={tabOptions} />
              </FilterField>
              <FilterField label="Website">
                <CompactSelect value={websiteFilter} onValueChange={(v) => updateParam("website", v || null)} options={websiteOptions} />
              </FilterField>
              <FilterField label="Check status">
                <CompactSelect value={analysisFilter} onValueChange={(v) => updateParam("analysis", v || null)} options={checkOptions} />
              </FilterField>
              <FilterField label="Opportunity score">
                <CompactSelect value={scoreFilter} onValueChange={(v) => updateParam("score", v || null)} options={scoreOptions} />
              </FilterField>
            </FilterPopover>
          </>
        }
        sort={
          <SortSelect value={sort} onValueChange={(v) => updateParam("sort", v === "score" ? null : v)} options={sortOptions} />
        }
        chips={chips.length > 0 ? <FilterChips chips={chips} onClearAll={clearPopoverFilters} /> : undefined}
      />

      {/* No count here: the range under the list ("1–10 of 506") is the one place it appears. */}
      <div
        ref={listTopRef}
        className={`flex scroll-mt-16 flex-wrap items-center justify-end gap-2 text-xs text-fg-muted ${
          selected.size > 0 ? "mt-2 min-h-8" : ""
        }`}
      >
        {selected.size > 0 ? (
          <div className="flex items-center gap-3">
            <span className="font-medium text-fg">{selected.size} selected</span>
            <button type="button" onClick={() => setSelected(new Set())} className="hover:text-fg hover:underline">
              Clear
            </button>
            <button
              type="button"
              onClick={() => void removeFromQueue([...selected])}
              disabled={removing}
              className="btn btn-secondary btn-sm min-h-8"
            >
              {removing ? "Removing…" : "Remove from queue"}
            </button>
            <button
              type="button"
              onClick={handleBulkApprove}
              disabled={bulkApproving}
              className="btn btn-primary btn-sm min-h-8"
            >
              {bulkApproving ? "Approving…" : `Approve ${selected.size}`}
            </button>
          </div>
        ) : null}
      </div>

      {error && (
        <div className="mt-3">
          <ErrorState message={error} onRetry={() => void load()} compact />
        </div>
      )}
      {actionError && (
        <div className="mt-3">
          <ErrorState message={actionError} onRetry={() => setActionError(null)} compact />
        </div>
      )}

      {data === null && !error && (
        <div className="mt-2 divide-y divide-border rounded-md border border-border" role="status" aria-label="Loading review queue">
          <div className="h-7 bg-surface-subtle" />
          {Array.from({ length: REVIEW_PAGE_SIZE }).map((_, i) => (
            <ReviewQueueRowSkeleton key={i} />
          ))}
        </div>
      )}

      {data && total === 0 && (
        <div className="mt-2">
          {queueEmpty ? (
            <EmptyState
              title="Nothing in the review queue yet"
              description="Run a Map Discovery search, then use its 'Add to Review Queue' action to bring candidates here to approve, reject, or bring the good ones into the CRM."
              action={
                <Link href="/dashboard/discovery/map" className="btn btn-primary">
                  Go to Map Discovery
                </Link>
              }
            />
          ) : (
            <EmptyState
              title={filtersActive ? "No businesses match these filters" : `Nothing in ${tabLabel}`}
              description={
                filtersActive
                  ? "Try a broader search, or clear the filters."
                  : "Pick a different review state above to see other businesses."
              }
              action={
                filtersActive ? (
                  <button onClick={clearFilters} className="btn btn-secondary btn-sm">
                    Clear filters
                  </button>
                ) : (
                  <button onClick={() => updateParam("tab", "all")} className="btn btn-secondary btn-sm">
                    Show all
                  </button>
                )
              }
            />
          )}
        </div>
      )}

      {data && total > 0 && (
        <div className="mt-2 rounded-md border border-border">
          <ReviewQueueHeader
            allSelected={allSelected}
            someSelected={selected.size > 0}
            onToggleAll={toggleSelectAll}
            disabled={selectableIds.length === 0}
          />
          {/* Reserves ten rows of height so a short last page or a page
              change doesn't make the controls below jump; dimmed (not
              emptied) while the next page loads. */}
          <div
            aria-busy={loading}
            className={`min-h-[32.5rem] divide-y divide-border transition-opacity motion-reduce:transition-none ${loading ? "opacity-60" : ""}`}
          >
            {rows.map((item) => (
              <div key={item.id} data-review-id={item.id}>
                <ReviewQueueRow
                  item={item}
                  href={`/dashboard/discovered-businesses/${item.id}`}
                  selected={selected.has(item.id)}
                  removing={removing}
                  onRemove={() => void removeFromQueue([item.id])}
                  onToggleSelect={() => toggleSelected(item.id)}
                  onOpen={() => openReview(item.id)}
                />
              </div>
            ))}
          </div>
          <nav
            aria-label="Review queue pagination"
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-subtle px-3 py-2 text-xs text-fg-muted"
          >
            <p aria-live="polite">
              {range ? `Showing ${range.from}–${range.to} of ${total}` : `0 of ${total}`}
              <span className="text-fg-subtle"> · Page {page} of {totalPages}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={loading || page <= 1}
                className="btn btn-secondary btn-sm min-h-8"
              >
                &larr; Previous
              </button>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={loading || page >= totalPages}
                className="btn btn-secondary btn-sm min-h-8"
              >
                Next &rarr;
              </button>
            </div>
          </nav>
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
