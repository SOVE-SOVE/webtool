"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  DISCOVERED_WEBSITE_STATUS_LABEL,
  INSTAGRAM_CHECK_STATE_LABEL,
  INSTAGRAM_WEBSITE_STATUS_LABEL,
  INSTAGRAM_WEBSITE_STATUSES,
  MAX_SUBURBS_PER_SEARCH,
  instagramCheckDisplayState,
  type DiscoveredBusiness,
  type DiscoverySearch,
  type InstagramCheckState,
  type InstagramImportResult,
} from "@/lib/api";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
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
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { InstagramImportModal } from "@/components/InstagramImportModal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { invalidateNavCounts, loadNavCounts } from "@/lib/navCounts";

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

// "none" (no website) gets the standout tone — the strongest sales
// opportunity, not a problem to flag.
const WEBSITE_BADGE: Record<DiscoveredBusiness["website_status"], BadgeTone> = {
  found: "muted",
  none: "highlight",
  unknown: "muted",
};

// Shared badge tone for INSTAGRAM_CHECK_STATE_LABEL.
const INSTAGRAM_CHECK_STATE_BADGE: Record<InstagramCheckState, BadgeTone> = {
  website_found: "success",
  no_website_found: "highlight",
  link_in_bio_only: "info",
  check_pending: "warning",
  needs_review: "muted",
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
}: {
  initialSearchId?: string;
  mapVisible?: boolean;
  onQueueChanged?: () => void;
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
  const [showImportModal, setShowImportModal] = useState(false);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

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
  useEffect(() => {
    if (!activeId) return;
    loadResults(activeId);
    const path = `/dashboard/discovery/map/${activeId}`;
    if (typeof window !== "undefined") {
      if (window.location.pathname !== path) window.history.replaceState(null, "", path);
      sessionStorage.setItem("wdos-list-return:discovery-map", path);
    }
  }, [activeId, loadResults]);

  // Only trust `results`/`search` once they belong to the active search —
  // between switching and the fetch landing, the previous search's rows
  // are still in state.
  const ready = activeId !== null && loadedId === activeId;
  const activeResults = ready ? results : null;
  const activeSearch = ready ? search : null;

  const visible = useMemo(() => {
    if (!activeResults) return [];
    return sortDiscoveredBusinesses(filterDiscoveredBusinesses(activeResults, filters), sort);
  }, [activeResults, filters, sort]);

  const activeSelectionId =
    selectedId && visible.some((b) => b.id === selectedId) ? selectedId : null;

  useEffect(() => {
    if (activeSelectionId)
      rowRefs.current.get(activeSelectionId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSelectionId]);

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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">
          Find businesses that might be a good fit for a website redesign, then queue and review the best ones
          before bringing them into the CRM.
        </p>
        <button onClick={() => setShowImportModal(true)} className="btn btn-secondary btn-sm">
          Import from Instagram
        </button>
      </div>

      {activeResults && activeResults.length > 0 && (
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
      )}

      {/* Search controls — always visible: this is where discovery starts.
          One panel, one visual unit: the five criteria fields share a grid
          so they read as a single search bar rather than loose floating
          boxes, then a divider sets the website-status refinement + the
          primary Run search action apart as their own row, then a second
          divider sets the quiet helper copy apart from both. */}
      <form onSubmit={handleCreate} className="panel mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <Select
            value={hasWebsite}
            onChange={(e) => setHasWebsite(e.target.value as "" | "true" | "false")}
            className="input w-auto"
            aria-label="Website filter"
          >
            <option value="">Any website status</option>
            <option value="true">Has a website</option>
            <option value="false">No website</option>
          </Select>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Searching…" : "Run search"}
          </button>
        </div>

        <div className="space-y-1 border-t border-border pt-3 text-xs text-fg-subtle">
          {isInstagramSearch && (
            <p>For multiple suburbs, separate each with commas (up to {MAX_SUBURBS_PER_SEARCH}).</p>
          )}
          <p>
            {isInstagramSearch
              ? "A niche (industry, business type, or keywords) plus a location is required. Finds publicly-indexed Instagram profiles — never scrapes Instagram, and a search miss is never treated as \"no website\"."
              : "At least one of industry, location, business type, or keywords is required. New results are researched, audited and scored automatically."}
          </p>
          {formError && <p className="text-error">{formError}</p>}
        </div>
      </form>

      {/* Recent searches — switch which one this workspace is showing. */}
      {searches && searches.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="discovery-search-picker" className="text-fg-muted">
            Showing
          </label>
          <Select
            id="discovery-search-picker"
            value={activeId ?? ""}
            onChange={(e) => selectSearch(e.target.value || null)}
            className="max-w-md rounded-md border border-border-strong px-2 py-1.5 text-sm"
          >
            {searches.map((s) => (
              <option key={s.id} value={s.id}>
                {searchLabel(s)} · {s.result_count} result{s.result_count === 1 ? "" : "s"} ·{" "}
                {new Date(s.created_at).toLocaleDateString()}
              </option>
            ))}
          </Select>
          <Link href="/dashboard/discovery/review" className="text-fg-muted hover:text-fg hover:underline">
            Review queue →
          </Link>
        </div>
      )}
      {listError && (
        <div className="mt-3">
          <ErrorState message={listError} onRetry={loadSearches} compact />
        </div>
      )}

      {activeSearch && (
        <div className="mt-4">
          <h2 className="text-base font-semibold text-fg">{searchLabel(activeSearch)}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {criteriaSummary(activeSearch)}
            {activeSearch.status === "failed" && activeSearch.error_message
              ? ` — ${activeSearch.error_message}`
              : ""}
          </p>
          {activeSearch.provider === "instagram_search" && (
            <div className="mt-1 rounded-md border border-border bg-surface-subtle px-2.5 py-1.5 text-xs text-fg-muted">
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
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={() => activeId && loadResults(activeId)} compact />
        </div>
      )}

      {!searches && !listError && (
        <div className="mt-4">
          <TableSkeleton rows={4} cols={6} />
        </div>
      )}

      {searches && searches.length === 0 && !listError && (
        <div className="mt-6 rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
          No discovery searches yet. Try &ldquo;plumbing&rdquo; in &ldquo;Gold Coast&rdquo; above.
        </div>
      )}

      {activeId && !activeResults && !error && (
        <div className="mt-4 space-y-4">
          <Skeleton className="h-72 w-full sm:h-80" />
          <TableSkeleton rows={4} cols={6} />
        </div>
      )}

      {activeResults && activeResults.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
          No results for this search.
        </div>
      )}

      {activeResults && activeResults.length > 0 && (
        <>
          {/* Subordinate to the search panel above: no card chrome, tighter
              gap, and muted text — a refinement bar over the results, not
              a second panel competing with the search itself. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <Input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Filter by name, category, address…"
              className="input w-56"
            />
            <Select
              value={filters.website}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  website: e.target.value as DiscoveredBusinessFilters["website"],
                }))
              }
              className="input w-auto"
              aria-label="Filter by website"
            >
              <option value="">Any website status</option>
              <option value="has">Has website</option>
              <option value="no">No website</option>
            </Select>
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as DiscoverySort)}
              className="input w-auto"
              aria-label="Sort results"
            >
              <option value="discovered">Sort: relevance</option>
              <option value="no-website">Sort: no website first</option>
              <option value="score">Sort: best score first</option>
            </Select>
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={filters.mappedOnly}
                onChange={(e) => setFilters((f) => ({ ...f, mappedOnly: e.target.checked }))}
              />
              On map only
            </label>
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={filters.showImported}
                onChange={(e) => setFilters((f) => ({ ...f, showImported: e.target.checked }))}
              />
              Already imported
            </label>
          </div>

          {/* Instagram-only filters — shown only once there's at least one
              Instagram-sourced result to filter, so an ordinary Places/Brave
              search doesn't clutter its filter row with controls that would
              never match anything. */}
          {activeResults.some((b) => b.instagram_handle) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <Select
                value={filters.instagramStatus}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    instagramStatus: e.target.value as DiscoveredBusinessFilters["instagramStatus"],
                  }))
                }
                className="input w-auto"
                aria-label="Filter by Instagram website status"
              >
                <option value="">Any Instagram status</option>
                {INSTAGRAM_WEBSITE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {INSTAGRAM_WEBSITE_STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5">
                <Checkbox
                  checked={filters.contactableOnly}
                  onChange={(e) => setFilters((f) => ({ ...f, contactableOnly: e.target.checked }))}
                />
                Contactable only
              </label>
              <label className="flex items-center gap-1.5">
                <Checkbox
                  checked={filters.activeRecentlyOnly}
                  onChange={(e) => setFilters((f) => ({ ...f, activeRecentlyOnly: e.target.checked }))}
                />
                Active in last {ACTIVE_RECENTLY_DAYS} days
              </label>
              <Input
                type="number"
                min={0}
                value={filters.minFollowers ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, minFollowers: e.target.value === "" ? null : Number(e.target.value) }))
                }
                placeholder="Min followers"
                className="input w-32"
                aria-label="Minimum follower count"
              />
            </div>
          )}

          {visible.length === 0 ? (
            <div className="mt-4 rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
              No results match these filters.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border border-border text-left text-sm">
                <thead className="bg-surface-subtle text-xs uppercase text-fg-muted">
                  <tr>
                    <th className="px-3 py-2">Business</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Website</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((business, index) => {
                    const onMap = hasCoordinates(business);
                    const selected = business.id === activeSelectionId;
                    const location =
                      business.address ||
                      [business.suburb, business.state].filter(Boolean).join(", ") ||
                      "—";
                    const igState = instagramCheckDisplayState(business);
                    const isNew = newIds.has(business.id);
                    return (
                      <tr
                        key={business.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(business.id, el);
                          else rowRefs.current.delete(business.id);
                        }}
                        onClick={onMap ? () => setSelectedId(selected ? null : business.id) : undefined}
                        className={
                          (selected ? "bg-surface-subtle " : "") +
                          (onMap ? "cursor-pointer " : "") +
                          (isNew ? "animate-fade-in" : "")
                        }
                        style={isNew ? { animationDelay: `${Math.min(index * 20, 200)}ms`, animationFillMode: "backwards" } : undefined}
                      >
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1.5">
                            <Link
                              href={`/dashboard/discovered-businesses/${business.id}`}
                              className="font-medium text-fg hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {business.name}
                            </Link>
                            {onMap && (
                              <span className="text-fg-subtle" title="On the map" aria-hidden>
                                &#9679;
                              </span>
                            )}
                          </span>
                          {(business.business_category || business.industry) && (
                            <div className="text-xs text-fg-muted">
                              {business.business_category || business.industry}
                            </div>
                          )}
                          {business.instagram_handle && (
                            <a
                              href={business.instagram_profile_url ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-fg-subtle hover:underline"
                            >
                              @{business.instagram_handle}
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-2 text-fg-muted">
                          <span className="block max-w-[220px] truncate" title={location}>
                            {location}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-fg-muted">
                          {business.phone ? (
                            <a
                              href={`tel:${business.phone}`}
                              className="hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {business.phone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={igState ? INSTAGRAM_CHECK_STATE_BADGE[igState] : WEBSITE_BADGE[business.website_status]}>
                            {igState ? INSTAGRAM_CHECK_STATE_LABEL[igState] : DISCOVERED_WEBSITE_STATUS_LABEL[business.website_status]}
                          </Badge>
                          {business.website_status === "found" && business.website_url && (
                            <a
                              href={business.website_url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-1 text-xs text-fg-subtle hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              open
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-2 text-fg-muted">{business.opportunity_score ?? "—"}</td>
                        <td className="px-3 py-2">
                          {business.status === "imported" && business.imported_lead_id ? (
                            <Link
                              href={`/dashboard/leads/${business.imported_lead_id}`}
                              className="text-xs text-fg-muted hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View lead &rarr;
                            </Link>
                          ) : business.review_queued_at ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-fg-muted">In Review Queue</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUnqueue(business);
                                }}
                                disabled={queuingId === business.id}
                                className="text-xs text-fg-subtle hover:underline disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQueue(business);
                              }}
                              disabled={queuingId === business.id}
                              className="text-xs font-medium text-fg hover:underline disabled:opacity-50"
                            >
                              {queuingId === business.id ? "Adding…" : "Add to Review Queue"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
            <span>
              Showing {visible.length} of {total} {total === 1 ? "result" : "results"}
              {mappedCount > 0 && <> · {mappedCount} on the map</>}
              {noWebsiteCount > 0 && <> · {noWebsiteCount} with no website</>}
            </span>
            {activeSearch?.has_more ? (
              <button onClick={handleLoadMore} disabled={loadingMore} className="btn btn-secondary">
                {loadingMore ? "Loading…" : "Load more results"}
              </button>
            ) : (
              <span className="text-fg-subtle">All results loaded</span>
            )}
          </div>
        </>
      )}

      {showImportModal && (
        <InstagramImportModal onClose={() => setShowImportModal(false)} onImported={handleImported} />
      )}
    </div>
  );
}
