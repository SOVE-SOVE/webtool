"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  DISCOVERED_WEBSITE_STATUS_LABEL,
  type DiscoveredBusiness,
  type DiscoverySearch,
} from "@/lib/api";
import {
  filterDiscoveredBusinesses,
  hasCoordinates,
  sortDiscoveredBusinesses,
  type DiscoveredBusinessFilters,
  type DiscoverySort,
} from "@/lib/filters";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";

// Leaflet touches `window` on import — client-only, no SSR.
const DiscoveryMap = dynamic(() => import("@/components/DiscoveryMap"), { ssr: false });

const NO_FILTERS: DiscoveredBusinessFilters = { search: "", website: "", mappedOnly: false };

const WEBSITE_BADGE: Record<DiscoveredBusiness["website_status"], string> = {
  found: "bg-surface-subtle text-fg-muted",
  none: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  unknown: "bg-surface-subtle text-fg-subtle",
};

// Discovered businesses the operator can still bring into the CRM. A
// rejected/archived/imported row shows its status instead of an action.
const IMPORTABLE = new Set<DiscoveredBusiness["status"]>([
  "new",
  "researched",
  "audited",
  "scored",
  "approved",
]);

function criteriaSummary(search: DiscoverySearch): string {
  const parts = [search.industry, search.business_type, search.location, search.keywords].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No criteria on record";
}

function searchLabel(search: DiscoverySearch): string {
  return search.query_label ?? criteriaSummary(search);
}

/**
 * The single Lead Discovery workspace: search controls, the map, and the
 * discovered-business results with their website status and review/add
 * actions — all on one screen. `/dashboard/discovery` renders it against
 * the most recent search; `/dashboard/discovery/[id]` renders the same
 * thing deep-linked to one specific search (so old links and the
 * business detail page's "back" link keep working).
 */
export function DiscoveryWorkspace({ initialSearchId }: { initialSearchId?: string }) {
  const [searches, setSearches] = useState<DiscoverySearch[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialSearchId ?? null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [search, setSearch] = useState<DiscoverySearch | null>(null);
  const [results, setResults] = useState<DiscoveredBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<DiscoveredBusinessFilters>(NO_FILTERS);
  const [sort, setSort] = useState<DiscoverySort>("discovered");
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  // Search form
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [keywords, setKeywords] = useState("");
  const [hasWebsite, setHasWebsite] = useState<"" | "true" | "false">("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
        setResults(rows);
        setLoadedId(id);
      })
      .catch(() => setError("Couldn't load discovered businesses."));
  }, []);

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
  useEffect(() => {
    if (!activeId) return;
    loadResults(activeId);
    if (
      typeof window !== "undefined" &&
      window.location.pathname !== `/dashboard/discovery/${activeId}`
    ) {
      window.history.replaceState(null, "", `/dashboard/discovery/${activeId}`);
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const created = await api.createDiscoverySearch({
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
      setResults(await api.listDiscoveredBusinesses(activeId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load more results.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleAddLead(business: DiscoveredBusiness) {
    setImportingId(business.id);
    setError(null);
    try {
      const updated = await api.importDiscoveredBusiness(business.id);
      setResults((rows) => (rows ? rows.map((r) => (r.id === updated.id ? updated : r)) : rows));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't add ${business.name} as a lead.`);
    } finally {
      setImportingId(null);
    }
  }

  const total = activeResults?.length ?? 0;
  const mappedCount = visible.filter(hasCoordinates).length;
  const noWebsiteCount = visible.filter((b) => b.website_status === "none").length;
  const inputCls = "rounded-md border border-border-strong px-3 py-1.5 text-sm";

  return (
    <div className="p-6">
      <PageHeader
        title="Discovery"
        description="Find businesses that might be a good fit for a website redesign, then review and bring the best ones into the CRM."
      />

      {/* Search controls — always visible: this is where discovery starts. */}
      <form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-end gap-2 border border-border p-4">
        <input
          placeholder="Industry (e.g. Plumbing)"
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className={`${inputCls} w-44`}
        />
        <input
          placeholder="Location (e.g. Gold Coast)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className={`${inputCls} w-44`}
        />
        <input
          placeholder="Business type"
          value={businessType}
          onChange={(e) => setBusinessType(e.target.value)}
          className={`${inputCls} w-40`}
        />
        <input
          placeholder="Keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className={`${inputCls} w-40`}
        />
        <select
          value={hasWebsite}
          onChange={(e) => setHasWebsite(e.target.value as "" | "true" | "false")}
          className={inputCls}
          aria-label="Website filter"
        >
          <option value="">Any website status</option>
          <option value="true">Has a website</option>
          <option value="false">No website</option>
        </select>
        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? "Searching…" : "Run search"}
        </button>
        <p className="w-full text-xs text-fg-muted">
          At least one of industry, location, business type, or keywords is required. New results are
          researched, audited and scored automatically.
        </p>
        {formError && <p className="w-full text-error">{formError}</p>}
      </form>

      {/* Recent searches — switch which one this workspace is showing. */}
      {searches && searches.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="discovery-search-picker" className="text-fg-muted">
            Showing
          </label>
          <select
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
          </select>
          <Link href="/dashboard/review" className="text-fg-muted hover:text-fg hover:underline">
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
        <div className="mt-4">
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Filter by name, category, address…"
              className={inputCls}
            />
            <select
              value={filters.website}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  website: e.target.value as DiscoveredBusinessFilters["website"],
                }))
              }
              className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
              aria-label="Filter by website"
            >
              <option value="">Any website status</option>
              <option value="has">Has website</option>
              <option value="no">No website</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as DiscoverySort)}
              className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
              aria-label="Sort results"
            >
              <option value="discovered">Sort: relevance</option>
              <option value="no-website">Sort: no website first</option>
              <option value="score">Sort: best score first</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={filters.mappedOnly}
                onChange={(e) => setFilters((f) => ({ ...f, mappedOnly: e.target.checked }))}
              />
              On map only
            </label>
          </div>

          <DiscoveryMap businesses={visible} selectedId={activeSelectionId} onSelect={setSelectedId} />

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
                    <th className="px-3 py-2">Lead</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((business) => {
                    const onMap = hasCoordinates(business);
                    const selected = business.id === activeSelectionId;
                    const location =
                      business.address ||
                      [business.suburb, business.state].filter(Boolean).join(", ") ||
                      "—";
                    return (
                      <tr
                        key={business.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(business.id, el);
                          else rowRefs.current.delete(business.id);
                        }}
                        onClick={onMap ? () => setSelectedId(selected ? null : business.id) : undefined}
                        className={(selected ? "bg-surface-subtle " : "") + (onMap ? "cursor-pointer" : "")}
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
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${WEBSITE_BADGE[business.website_status]}`}
                          >
                            {DISCOVERED_WEBSITE_STATUS_LABEL[business.website_status]}
                          </span>
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
                          ) : IMPORTABLE.has(business.status) ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddLead(business);
                              }}
                              disabled={importingId === business.id}
                              className="text-xs font-medium text-fg hover:underline disabled:opacity-50"
                            >
                              {importingId === business.id ? "Adding…" : "Add lead"}
                            </button>
                          ) : (
                            <span className="text-xs text-fg-subtle">{business.status}</span>
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
    </div>
  );
}
