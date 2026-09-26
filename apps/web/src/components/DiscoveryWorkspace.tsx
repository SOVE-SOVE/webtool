"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  INSTAGRAM_WEBSITE_STATUS_LABEL,
  INSTAGRAM_WEBSITE_STATUSES,
  MAX_SUBURBS_PER_SEARCH,
  type DiscoveredBusiness,
  type DiscoverySearch,
  type InstagramImportResult,
} from "@/lib/api";
import {
  ACTIVE_RECENTLY_DAYS,
  filterDiscoveredBusinesses,
  hasCoordinates,
  sortDiscoveredBusinesses,
  type DiscoveredBusinessFilters,
  type DiscoverySort,
} from "@/lib/filters";
import { diffNewIds } from "@/lib/discovery-diff";
import { ErrorState } from "@/components/ui/ErrorState";
import { InstagramImportModal } from "@/components/InstagramImportModal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CommandBar } from "@/components/ui/CommandBar";
import { CompactSelect, SortSelect } from "@/components/ui/CompactSelect";
import { FilterChips, type FilterChip } from "@/components/ui/FilterChips";
import { FilterField, FilterPopover, FilterToggle } from "@/components/ui/FilterPopover";
import { SearchInput } from "@/components/ui/SearchInput";
import { invalidateNavCounts, loadNavCounts } from "@/lib/navCounts";
import { DiscoveryResultsPanel, type DiscoveryResultsPanelItem } from "@/components/discovery/DiscoveryResultsPanel";

// Leaflet touches `window` on import — client-only, no SSR.
const DiscoveryMap = dynamic(() => import("@/components/DiscoveryMap"), { ssr: false });

const NO_FILTERS: DiscoveredBusinessFilters = {
  search: "",
  website: "",
  mappedOnly: false,
  instagramStatus: "",
  contactableOnly: false,
  activeRecentlyOnly: false,
  minFollowers: null,
  showImported: false,
};

function criteriaSummary(search: DiscoverySearch): string {
  const parts = [search.industry, search.business_type, search.location, search.keywords].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No criteria on record";
}

function searchLabel(search: DiscoverySearch): string {
  return search.query_label ?? criteriaSummary(search);
}

/**
 * The Map Discovery tab's content: search controls, the map, and the
 * discovered-business results with their website status and review/add
 * actions — all on one screen. `/dashboard/discovery/map` renders it
 * against the most recent search; `/dashboard/discovery/map/[id]`
 * renders the same thing deep-linked to one specific search (so old
 * links and the business detail page's "back" link keep working).
 *
 * Rendered by `DiscoveryLayout`, which owns the shared "Discovery"
 * header/tab-strip — this component has no header of its own.
 * `mapVisible` tells the map when its (permanently-mounted, just CSS-
 * `hidden` while on the Review Queue tab) container becomes visible
 * again, so it can fix up its Leaflet size cache. `onQueueChanged`
 * notifies the layout after a successful queue add/remove so the
 * Review Queue tab (also always mounted) refetches and its tab-badge
 * count stays current.
 */
export function DiscoveryWorkspace({
  initialSearchId,
  mapVisible = true,
  onQueueChanged,
  importOpen = false,
  onImportOpenChange,
}: {
  initialSearchId?: string;
  mapVisible?: boolean;
  onQueueChanged?: () => void;
  /** Whether the Instagram import modal is open. Owned by
   * DiscoveryLayout, whose floating header layer holds the button that
   * opens it. */
  importOpen?: boolean;
  onImportOpenChange?: (open: boolean) => void;
}) {
  const [searches, setSearches] = useState<DiscoverySearch[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialSearchId ?? null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [search, setSearch] = useState<DiscoverySearch | null>(null);
  const [results, setResults] = useState<DiscoveredBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queuingId, setQueuingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<DiscoveredBusinessFilters>(NO_FILTERS);
  const [sort, setSort] = useState<DiscoverySort>("discovered");
  // The results panel's own collapse state — deliberately not reset by
  // background refreshes (the website-check poll below only ever calls
  // `applyResults`, never this), only by a genuine change of search
  // context (see `selectSearch`), so a deliberate collapse survives a
  // poll landing behind it.
  const [panelOpen, setPanelOpen] = useState(true);

  // Tracks which result ids have already been shown, so a poll/filter/
  // sort/re-render never replays the "new result" fade-in — only rows
  // that genuinely weren't there before get it, and only briefly. Reset
  // whenever results land for a different search than last time, so a
  // freshly-switched-to search's first population reads as "new" too.
  const knownIdsRef = useRef<Set<string>>(new Set());
  const knownForSearchRef = useRef<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const newIdsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyResults = useCallback((rows: DiscoveredBusiness[], searchId: string) => {
    if (knownForSearchRef.current !== searchId) {
      knownForSearchRef.current = searchId;
      knownIdsRef.current = new Set();
    }
    const fresh = diffNewIds(knownIdsRef.current, rows);
    knownIdsRef.current = new Set(rows.map((r) => r.id));
    setResults(rows);
    if (fresh.size > 0) {
      setNewIds(fresh);
      if (newIdsTimeout.current) clearTimeout(newIdsTimeout.current);
      newIdsTimeout.current = setTimeout(() => setNewIds(new Set()), 900);
    }
  }, []);

  useEffect(() => () => {
    if (newIdsTimeout.current) clearTimeout(newIdsTimeout.current);
  }, []);

  // Search form — identical fields/layout for every provider (see
  // docs/05_DECISIONS.md: an earlier version swapped the Location field
  // for a dedicated suburbs textarea when Instagram Search was picked,
  // which changed the form's shape between providers and was reverted).
  // instagram_search takes multiple suburbs as a comma-separated list
  // in this same `location` field — parsed server-side, same field
  // every other provider already uses as free text.
  const [provider, setProvider] = useState<"" | "instagram_search">("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [keywords, setKeywords] = useState("");
  // Presentational only: whether the Business type / Keywords inputs are
  // shown. Their values live in the state above either way.
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const moreOptionsSet = [businessType, keywords].filter((v) => v.trim() !== "").length;
  const [hasWebsite, setHasWebsite] = useState<"" | "true" | "false">("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isInstagramSearch = provider === "instagram_search";
  const parsedSuburbs = useMemo(
    () =>
      location
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [location],
  );

  const loadSearches = useCallback(() => {
    return api
      .listDiscoverySearches()
      .then((rows) => {
        setListError(null);
        setSearches(rows);
        return rows;
      })
      .catch(() => {
        setListError("Couldn't load your discovery searches.");
        return [] as DiscoverySearch[];
      });
  }, []);

  const loadResults = useCallback((id: string) => {
    api
      .getDiscoverySearch(id)
      .then((s) => {
        setError(null);
        setSearch(s);
        setLoadedId(id);
      })
      .catch(() => setError("Couldn't load this search."));
    api
      .listDiscoveredBusinesses(id)
      .then((rows) => {
        applyResults(rows, id);
        setLoadedId(id);
      })
      .catch(() => setError("Couldn't load discovered businesses."));
  }, [applyResults]);

  function selectSearch(id: string | null) {
    setActiveId(id);
    setFilters(NO_FILTERS);
    setSelectedId(null);
    // A genuinely new search context (run or imported) opens the
    // results panel — even if the operator
    // had collapsed it for a previous search. A background poll never
    // calls this, so it never fights a deliberate collapse.
    setPanelOpen(true);
  }

  // Initial load: searches list, then pick the active search (the
  // deep-linked one if given, otherwise the most recent).
  useEffect(() => {
    let alive = true;
    loadSearches().then((rows) => {
      if (!alive) return;
      const next = initialSearchId ?? rows[0]?.id ?? null;
      setActiveId(next);
    });
    return () => {
      alive = false;
    };
  }, [loadSearches, initialSearchId]);

  // Load (and keep the URL in step with) whichever search is active.
  // Also remembered in sessionStorage (DiscoverySwitch's own
  // `wdos-list-return:discovery-map` read) so navigating to Review
  // Queue and back returns to this exact search, not the bare
  // /dashboard/discovery/map route — this component never unmounts on
  // that round trip (see DiscoveryLayout), so its own React state
  // already has the answer; this only keeps the *URL* honest for
  // Back/Forward, bookmarks, and a fresh tab.
  //
  // The `history.replaceState` call is gated on `mapVisible` — this
  // component stays mounted (just hidden) while the Review Queue tab is
  // active, and Next.js's App Router patches the History API to sync
  // its own router state on every pushState/replaceState call. Without
  // this guard, this effect's initial-mount run (activeId going from
  // null to the most recent search) would silently overwrite the URL —
  // and Next's router-derived active tab — from underneath Review
  // Queue, bouncing a direct visit to /dashboard/discovery/review back
  // to Map Discovery. The sessionStorage write stays unconditional: it
  // only records state for later restoration, so it's harmless (and
  // desired) to update even while this tab isn't the visible one.
  useEffect(() => {
    if (!activeId) return;
    loadResults(activeId);
    const path = `/dashboard/discovery/map/${activeId}`;
    if (typeof window !== "undefined") {
      if (mapVisible && window.location.pathname !== path) window.history.replaceState(null, "", path);
      sessionStorage.setItem("wdos-list-return:discovery-map", path);
    }
  }, [activeId, loadResults, mapVisible]);

  // Only trust `results`/`search` once they belong to the active search —
  // between switching and the fetch landing, the previous search's rows
  // are still in state.
  const ready = activeId !== null && loadedId === activeId;
  const activeResults = ready ? results : null;
  const activeSearch = ready ? search : null;

  // Search-panel collapse — purely presentational. Defaults to open only
  // when there's no search to show (the list has loaded and none is
  // active, so the operator's first job is to run one); collapsed once a
  // search is active — including while its results are still loading, so
  // a returning visitor never sees the panel flash open. A manual toggle
  // overrides that default until the active search changes (a new run or
  // a different pick), which re-applies it. Adjusted during render — the
  // same reset-on-change pattern DashboardLayout uses.
  const [filtersOpenOverride, setFiltersOpenOverride] = useState<boolean | null>(null);
  const [overrideForId, setOverrideForId] = useState(activeId);
  if (activeId !== overrideForId) {
    setOverrideForId(activeId);
    setFiltersOpenOverride(null);
  }
  const filtersOpen = filtersOpenOverride ?? (searches !== null && activeId === null);
  const filterSummary = activeSearch
    ? searchLabel(activeSearch)
    : activeId
      ? "Loading search…"
      : searches === null
        ? "Loading…"
        : "No search yet";
  const filterSummarySub = activeSearch
    ? `${activeSearch.result_count} result${activeSearch.result_count === 1 ? "" : "s"}`
    : null;

  const visible = useMemo(() => {
    if (!activeResults) return [];
    return sortDiscoveredBusinesses(filterDiscoveredBusinesses(activeResults, filters), sort);
  }, [activeResults, filters, sort]);

  const hasInstagramResults = activeResults?.some((b) => b.instagram_handle) ?? false;

  // The criteria in the Filters popover, as removable chips (search has
  // its own clear button, so it isn't one).
  const filterChips: FilterChip[] = [];
  if (filters.website) {
    filterChips.push({
      id: "website",
      label: "Website",
      value: filters.website === "has" ? "Has website" : "No website",
      onRemove: () => setFilters((f) => ({ ...f, website: "" })),
    });
  }
  if (filters.mappedOnly) {
    filterChips.push({ id: "mapped", label: "Map", value: "On map only", onRemove: () => setFilters((f) => ({ ...f, mappedOnly: false })) });
  }
  if (filters.showImported) {
    filterChips.push({ id: "imported", label: "Imported", value: "Included", onRemove: () => setFilters((f) => ({ ...f, showImported: false })) });
  }
  if (filters.instagramStatus) {
    filterChips.push({
      id: "ig-status",
      label: "Instagram",
      value: INSTAGRAM_WEBSITE_STATUS_LABEL[filters.instagramStatus],
      onRemove: () => setFilters((f) => ({ ...f, instagramStatus: "" })),
    });
  }
  if (filters.contactableOnly) {
    filterChips.push({ id: "contactable", label: "Contact", value: "Contactable only", onRemove: () => setFilters((f) => ({ ...f, contactableOnly: false })) });
  }
  if (filters.activeRecentlyOnly) {
    filterChips.push({
      id: "active",
      label: "Activity",
      value: `Last ${ACTIVE_RECENTLY_DAYS} days`,
      onRemove: () => setFilters((f) => ({ ...f, activeRecentlyOnly: false })),
    });
  }
  if (filters.minFollowers !== null) {
    filterChips.push({
      id: "followers",
      label: "Followers",
      value: `${filters.minFollowers.toLocaleString()}+`,
      onRemove: () => setFilters((f) => ({ ...f, minFollowers: null })),
    });
  }

  function clearResultFilters() {
    setFilters(NO_FILTERS);
  }

  const activeSelectionId =
    selectedId && visible.some((b) => b.id === selectedId) ? selectedId : null;

  // Background website-check progress for this search — only
  // instagram_search candidates ever get an automatic check (see
  // instagramCheckDisplayState), and a duplicate-of-existing-business
  // row never gets one enqueued at all (modules/discovery/service.py's
  // _enqueue_research), so both are excluded from the denominator.
  const websiteCheckProgress = useMemo(() => {
    if (!activeResults) return null;
    const checkable = activeResults.filter(
      (b) => b.instagram_handle && b.source_provider === "instagram_search" && !b.duplicate_of_discovered_business_id,
    );
    if (checkable.length === 0) return null;
    const completed = checkable.filter((b) => b.instagram_website_checked_at !== null).length;
    return { completed, total: checkable.length };
  }, [activeResults]);
  const pendingWebsiteChecks = websiteCheckProgress ? websiteCheckProgress.total - websiteCheckProgress.completed : 0;

  // Poll while any check is outstanding, so the operator sees statuses
  // resolve without a manual refresh — "do not block the initial
  // results from appearing while checks run" means the checks finish
  // asynchronously, so something has to notice when they do. Capped at
  // a bounded number of polls: if the background job poller isn't
  // running at all, this stops trying rather than polling forever.
  const pollCountRef = useRef(0);
  useEffect(() => {
    pollCountRef.current = 0;
  }, [activeId]);
  useEffect(() => {
    if (!activeId || pendingWebsiteChecks <= 0) return;
    const MAX_POLLS = 40; // ~2.5 minutes at 4s apart
    const timer = setInterval(() => {
      pollCountRef.current += 1;
      if (pollCountRef.current > MAX_POLLS) {
        clearInterval(timer);
        return;
      }
      api
        .listDiscoveredBusinesses(activeId)
        .then((rows) => applyResults(rows, activeId))
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [activeId, pendingWebsiteChecks, applyResults]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (isInstagramSearch && parsedSuburbs.length === 0) {
      setFormError("Enter at least one suburb or city in the location field for Instagram Search Discovery.");
      return;
    }
    if (isInstagramSearch && parsedSuburbs.length > MAX_SUBURBS_PER_SEARCH) {
      setFormError(`Instagram Search Discovery supports at most ${MAX_SUBURBS_PER_SEARCH} suburbs per run.`);
      return;
    }
    setSaving(true);
    try {
      const created = await api.createDiscoverySearch({
        provider: provider || undefined,
        industry: industry || undefined,
        location: location || undefined,
        business_type: businessType || undefined,
        keywords: keywords || undefined,
        has_website: hasWebsite === "" ? undefined : hasWebsite === "true",
        query_label: [industry, location].filter(Boolean).join(" — ") || undefined,
      });
      setIndustry("");
      setLocation("");
      setBusinessType("");
      setKeywords("");
      setHasWebsite("");
      await loadSearches();
      selectSearch(created.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't run this search.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadMore() {
    if (!activeId) return;
    setLoadingMore(true);
    setError(null);
    try {
      const updated = await api.loadMoreDiscoverySearch(activeId);
      setSearch(updated);
      applyResults(await api.listDiscoveredBusinesses(activeId), activeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load more results.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleImported(result: InstagramImportResult) {
    // Deliberately doesn't close the modal — it stays open showing the
    // "Added N candidates" summary until the operator clicks Done
    // (InstagramImportModal's onClose), so that summary is never skipped.
    await loadSearches();
    selectSearch(result.search.id);
  }

  // Queue businesses without navigating away — the row/popup action
  // just updates this business's own row in place. Idempotent on the
  // backend (see api.addToReviewQueue), so a double-click or a slow
  // retry can never queue the same business twice.
  async function handleQueue(business: DiscoveredBusiness) {
    setQueuingId(business.id);
    setError(null);
    try {
      const updated = await api.addToReviewQueue(business.id);
      setResults((rows) => (rows ? rows.map((r) => (r.id === updated.id ? updated : r)) : rows));
      onQueueChanged?.();
      invalidateNavCounts();
      loadNavCounts({ force: true }).catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't add ${business.name} to the review queue.`);
    } finally {
      setQueuingId(null);
    }
  }

  async function handleUnqueue(business: DiscoveredBusiness) {
    setQueuingId(business.id);
    setError(null);
    try {
      const updated = await api.removeFromReviewQueue(business.id);
      setResults((rows) => (rows ? rows.map((r) => (r.id === updated.id ? updated : r)) : rows));
      onQueueChanged?.();
      invalidateNavCounts();
      loadNavCounts({ force: true }).catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't remove ${business.name} from the review queue.`);
    } finally {
      setQueuingId(null);
    }
  }

  const total = activeResults?.length ?? 0;
  const mappedCount = visible.filter(hasCoordinates).length;
  const noWebsiteCount = visible.filter((b) => b.website_status === "none").length;

  // What the results panel's body shows — mirrors the state machine the
  // old in-page sections used (loading searches, loading this search's
  // results, no searches yet, no results, filtered down to none, or the
  // list itself), collapsed into the panel's one content slot. A
  // specific active search's own state always wins over the broader
  // "still loading the searches list" skeleton, since a deep link
  // (`/dashboard/discovery/map/{id}`) can resolve its own fetch before
  // that list fetch finishes.
  let panelLoading = false;
  let panelEmptyMessage: string | null = null;
  let panelItems: DiscoveryResultsPanelItem[] | null = null;
  let showCommandBar = false;
  if (activeId && !activeResults && !error) {
    panelLoading = true;
  } else if (activeResults && activeResults.length > 0) {
    showCommandBar = true;
    if (visible.length === 0) {
      panelEmptyMessage = "No results match these filters.";
    } else {
      panelItems = visible.map((business, index) => ({
        business,
        isNew: newIds.has(business.id),
        animationDelayMs: Math.min(index * 20, 200),
      }));
    }
  } else if (activeResults && activeResults.length === 0) {
    panelEmptyMessage = "No results for this search.";
  } else if (!searches && !listError) {
    panelLoading = true;
  } else if (searches && searches.length === 0 && !listError) {
    panelEmptyMessage = 'No discovery searches yet. Try "plumbing" in "Gold Coast" above.';
  }

  return (
    <>
      {/* Full-viewport base layer (fixed; see DiscoveryMap). Always
          mounted — not only once a search has results — so the page
          opens on the map. */}
      <DiscoveryMap
        businesses={visible}
        selectedId={activeSelectionId}
        onSelect={setSelectedId}
        mapVisible={mapVisible}
        onQueue={(id) => {
          const business = visible.find((b) => b.id === id);
          if (business) handleQueue(business);
        }}
        onUnqueue={(id) => {
          const business = visible.find((b) => b.id === id);
          if (business) handleUnqueue(business);
        }}
        queuingId={queuingId}
      />
      {/* The intro copy and the "Import from Instagram" button now live in
          DiscoveryLayout's floating header layer. */}

      {/* Left-hand floating column: search controls, then the results
          panel below them. `pointer-events-none` on the shell with each
          child opting back in (`pointer-events-auto`) — same convention
          as DiscoveryLayout's header layer — so any gap between them,
          or the empty space below a collapsed results panel, still lets
          clicks/drags reach the map underneath instead of just sitting
          on top of it. `top`/`bottom` bound the column exactly between
          the header layer above and the mobile bottom nav (or the
          viewport edge at `lg`) below, so the column can never grow
          into either. Width switches at
          `sm` (the search form's old breakpoint); the bottom clearance
          switches at `lg`, where the mobile bottom nav disappears (see
          dashboard/layout.tsx). `lg:left` is the shared `--sidebar-w`
          variable plus this column's own 0.75rem gutter, so it stays
          flush with the sidebar's real edge (collapsed or expanded)
          instead of a hard-coded width that can drift out of sync. */}
      <div className="pointer-events-none fixed left-3 right-14 top-[calc(3rem+var(--discovery-layer-h,7rem))] bottom-[calc(3.5rem+1.75rem)] z-20 flex flex-col gap-3 sm:right-auto sm:w-[400px] lg:left-[calc(var(--sidebar-w)+0.75rem)] lg:top-[calc(2.75rem+var(--discovery-layer-h,7rem))] lg:bottom-3">
      {/* Search controls — always visible: this is where discovery starts.
          The five criteria fields stack in one column, then a divider
          sets the website-status refinement + the primary Run search
          action apart as their own block, then a second divider sets
          the quiet helper copy apart from both. Shrinks (and scrolls
          internally) when the column is short — high browser zoom, a
          landscape phone — so it can never push the results panel out
          of the column; the panel keeps at least its toggle row. */}
      <form
        onSubmit={handleCreate}
        className="pointer-events-auto overflow-y-auto map-glass px-4 py-3"
      >
        <button
          type="button"
          onClick={() => setFiltersOpenOverride(!filtersOpen)}
          aria-expanded={filtersOpen}
          aria-controls="discovery-filter-fields"
          className="flex w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <span className="min-w-0 flex-1">
            {filtersOpen ? (
              <span className="text-sm font-medium text-fg">Search</span>
            ) : (
              <>
                <span className="block truncate text-sm font-medium text-fg">{filterSummary}</span>
                {filterSummarySub && (
                  <span className="block truncate text-xs text-fg-muted">{filterSummarySub}</span>
                )}
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
            {filtersOpen ? "Collapse" : "Edit"}
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className={`h-4 w-4 transition-transform duration-fast ease-standard motion-reduce:transition-none ${filtersOpen ? "rotate-180" : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        </button>
        <div id="discovery-filter-fields" hidden={!filtersOpen} className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3">
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "" | "instagram_search")}
              className="input"
              aria-label="Discovery source"
            >
              <option value="">Web search (default)</option>
              <option value="instagram_search">Instagram Search Discovery</option>
            </Select>
            <Input
              placeholder={isInstagramSearch ? "Niche (e.g. Nail Salon)" : "Industry (e.g. Plumbing)"}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="input"
            />
            <Input
              placeholder={isInstagramSearch ? "Surfers Paradise, Broadbeach" : "Location (e.g. Gold Coast)"}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="input"
            />
            {/* Business type + Keywords are tucked behind this toggle. They
                stay mounted (just `hidden`) and bound to the same state,
                so anything typed there still goes into the search request. */}
            <button
              type="button"
              onClick={() => setMoreOptionsOpen((o) => !o)}
              aria-expanded={moreOptionsOpen}
              aria-controls="discovery-more-options"
              className="flex items-center gap-1 self-start rounded text-xs font-medium text-fg-muted transition-colors duration-fast ease-standard hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                className={`h-4 w-4 transition-transform duration-fast ease-standard motion-reduce:transition-none ${moreOptionsOpen ? "rotate-180" : ""}`}
              >
                <path
                  fillRule="evenodd"
                  d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
              More options
              {!moreOptionsOpen && moreOptionsSet > 0 && (
                <span className="font-normal text-fg-subtle">· {moreOptionsSet} set</span>
              )}
            </button>
            <div id="discovery-more-options" hidden={!moreOptionsOpen} className="grid grid-cols-1 gap-3">
              <Input
                placeholder="Business type"
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="input"
              />
              <Input
                placeholder="Keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                className="input"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <Select
              value={hasWebsite}
              onChange={(e) => setHasWebsite(e.target.value as "" | "true" | "false")}
              className="input w-full"
              aria-label="Website filter"
            >
              <option value="">Any website status</option>
              <option value="true">Has a website</option>
              <option value="false">No website</option>
            </Select>
            <button type="submit" disabled={saving} className="btn btn-primary w-full">
              {saving ? "Searching…" : "Run search"}
            </button>
          </div>

          <div className="space-y-1 border-t border-border pt-3 text-xs text-fg-subtle">
            {isInstagramSearch && (
              <p>For multiple suburbs, separate each with commas (up to {MAX_SUBURBS_PER_SEARCH}).</p>
            )}
            {/* Wording follows what's on screen: with More options closed
                only Industry/Location are visible; opened, all four are. */}
            <p>
              {isInstagramSearch
                ? `${moreOptionsOpen ? "A niche (industry, business type, or keywords) plus a location is required." : "An industry (niche) and a location are required — business type and keywords are under More options."} Finds publicly-indexed Instagram profiles — never scrapes Instagram, and a search miss is never treated as "no website".`
                : `${moreOptionsOpen ? "At least one of industry, location, business type, or keywords is required." : "Enter an industry or a location — business type and keywords are under More options."} New results are researched, audited and scored automatically.`}
            </p>
            {formError && <p className="text-error">{formError}</p>}
          </div>
        </div>
      </form>

      <DiscoveryResultsPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        resultCount={ready ? total : null}
        switcher={
          searches && searches.length > 0 ? (
            // Switch which past search this workspace is showing.
            <CompactSelect
              aria-label="Switch search"
              value={activeId ?? ""}
              onValueChange={(id) => selectSearch(id || null)}
              placeholder="Choose a search"
              className="w-full font-medium"
              options={searches.map((s) => ({
                value: s.id,
                label: `${searchLabel(s)} · ${s.result_count} result${s.result_count === 1 ? "" : "s"} · ${new Date(s.created_at).toLocaleDateString()}`,
              }))}
            />
          ) : undefined
        }
        banner={
          (listError || error) ? (
            <div className="space-y-2">
              {listError && <ErrorState message={listError} onRetry={loadSearches} compact />}
              {error && <ErrorState message={error} onRetry={() => activeId && loadResults(activeId)} compact />}
            </div>
          ) : undefined
        }
        statusInfo={
          activeSearch ? (
            <div>
              <p className="text-xs text-fg-muted">
                {criteriaSummary(activeSearch)}
                {activeSearch.status === "failed" && activeSearch.error_message
                  ? ` — ${activeSearch.error_message}`
                  : ""}
              </p>
              {activeSearch.provider === "instagram_search" && (
                <div className="mt-1.5 rounded-md border border-[var(--glass-hairline)] bg-[var(--glass-fill)] px-2.5 py-1.5 text-xs text-fg-muted">
                  <p>
                    Checked {activeSearch.raw_results_checked} raw result
                    {activeSearch.raw_results_checked === 1 ? "" : "s"} → {activeSearch.result_count} valid
                    candidate{activeSearch.result_count === 1 ? "" : "s"} imported
                  </p>
                  <p className="mt-0.5">
                    {activeSearch.queries_used} live search{activeSearch.queries_used === 1 ? "" : "es"} used
                    {activeSearch.cache_hits > 0 && (
                      <> · {activeSearch.cache_hits} served from the 24h cache</>
                    )}
                  </p>
                  {activeSearch.suburbs && activeSearch.suburbs.length > 0 && (
                    <p className="mt-0.5">
                      {activeSearch.has_more
                        ? `Suburb ${Math.min(activeSearch.next_suburb_index + 1, activeSearch.suburbs.length)} of ${activeSearch.suburbs.length}`
                        : `All ${activeSearch.suburbs.length} suburb${activeSearch.suburbs.length === 1 ? "" : "s"} checked`}
                      {" · "}
                      {activeSearch.suburbs.join(", ")}
                    </p>
                  )}
                  {websiteCheckProgress && (
                    <p className="mt-0.5">
                      {pendingWebsiteChecks > 0
                        ? `Checking websites: ${websiteCheckProgress.completed} of ${websiteCheckProgress.total}`
                        : `Website checks complete: ${websiteCheckProgress.total} of ${websiteCheckProgress.total}`}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : undefined
        }
        commandBar={
          showCommandBar ? (
            // Search + Filters + Sort, active filters as chips. The
            // Instagram-only criteria appear in the popover only once
            // there's at least one Instagram-sourced result to filter,
            // so an ordinary Places/Brave search doesn't offer controls
            // that could never match anything.
            <CommandBar
              search={
                <SearchInput
                  value={filters.search}
                  onValueChange={(search) => setFilters((f) => ({ ...f, search }))}
                  placeholder="Filter by name, category, address…"
                  aria-label="Filter results by name, category or address"
                />
              }
              filters={
                <FilterPopover activeCount={filterChips.length} onClearAll={clearResultFilters}>
                  <FilterField label="Website">
                    <CompactSelect
                      aria-label="Filter by website"
                      value={filters.website}
                      onValueChange={(website) => setFilters((f) => ({ ...f, website }))}
                      options={[
                        { value: "", label: "Any website status" },
                        { value: "has", label: "Has website" },
                        { value: "no", label: "No website" },
                      ]}
                    />
                  </FilterField>
                  <FilterToggle
                    label="On map only"
                    checked={filters.mappedOnly}
                    onChange={(mappedOnly) => setFilters((f) => ({ ...f, mappedOnly }))}
                  />
                  <FilterToggle
                    label="Already imported"
                    checked={filters.showImported}
                    onChange={(showImported) => setFilters((f) => ({ ...f, showImported }))}
                  />
                  {hasInstagramResults && (
                    <div className="space-y-3 border-t border-border pt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Instagram</p>
                      <FilterField label="Website status">
                        <CompactSelect
                          aria-label="Filter by Instagram website status"
                          value={filters.instagramStatus}
                          onValueChange={(instagramStatus) => setFilters((f) => ({ ...f, instagramStatus }))}
                          options={[
                            { value: "", label: "Any Instagram status" },
                            ...INSTAGRAM_WEBSITE_STATUSES.map((status) => ({
                              value: status,
                              label: INSTAGRAM_WEBSITE_STATUS_LABEL[status],
                            })),
                          ]}
                        />
                      </FilterField>
                      <FilterToggle
                        label="Contactable only"
                        checked={filters.contactableOnly}
                        onChange={(contactableOnly) => setFilters((f) => ({ ...f, contactableOnly }))}
                      />
                      <FilterToggle
                        label={`Active in last ${ACTIVE_RECENTLY_DAYS} days`}
                        checked={filters.activeRecentlyOnly}
                        onChange={(activeRecentlyOnly) => setFilters((f) => ({ ...f, activeRecentlyOnly }))}
                      />
                      <FilterField label="Minimum followers">
                        <Input
                          type="number"
                          min={0}
                          value={filters.minFollowers ?? ""}
                          onChange={(e) =>
                            setFilters((f) => ({
                              ...f,
                              minFollowers: e.target.value === "" ? null : Number(e.target.value),
                            }))
                          }
                          placeholder="Min followers"
                          className="control"
                          aria-label="Minimum follower count"
                        />
                      </FilterField>
                    </div>
                  )}
                </FilterPopover>
              }
              sort={
                <SortSelect
                  aria-label="Sort results"
                  value={sort}
                  onValueChange={setSort}
                  options={[
                    { value: "discovered", label: "Relevance" },
                    { value: "no-website", label: "No website first" },
                    { value: "score", label: "Best score first" },
                  ]}
                />
              }
              chips={filterChips.length > 0 ? <FilterChips chips={filterChips} onClearAll={clearResultFilters} /> : undefined}
            />
          ) : undefined
        }
        loading={panelLoading}
        emptyMessage={panelEmptyMessage}
        items={panelItems}
        selectedId={activeSelectionId}
        onSelect={(id) => setSelectedId(id === activeSelectionId ? null : id)}
        queuingId={queuingId}
        onQueue={handleQueue}
        onUnqueue={handleUnqueue}
        footer={
          activeResults && activeResults.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
              <span>
                Showing {visible.length} of {total} {total === 1 ? "result" : "results"}
                {mappedCount > 0 && <> · {mappedCount} on the map</>}
                {noWebsiteCount > 0 && <> · {noWebsiteCount} with no website</>}
              </span>
              {activeSearch?.has_more ? (
                <button onClick={handleLoadMore} disabled={loadingMore} className="btn btn-secondary btn-sm">
                  {loadingMore ? "Loading…" : "Load more results"}
                </button>
              ) : (
                <span className="text-fg-subtle">All results loaded</span>
              )}
            </div>
          ) : undefined
        }
      />
      </div>

      {importOpen && (
        <InstagramImportModal onClose={() => onImportOpenChange?.(false)} onImported={handleImported} />
      )}
    </>
  );
}
