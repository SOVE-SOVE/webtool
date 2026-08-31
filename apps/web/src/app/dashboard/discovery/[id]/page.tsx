"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
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
import { TableSkeleton } from "@/components/ui/Skeleton";

// Leaflet touches `window` on import — client-only, no SSR.
const DiscoveryMap = dynamic(() => import("@/components/DiscoveryMap"), { ssr: false });

const NO_FILTERS: DiscoveredBusinessFilters = { search: "", website: "", mappedOnly: false };

const WEBSITE_BADGE: Record<DiscoveredBusiness["website_status"], string> = {
  found: "bg-surface-subtle text-fg-muted",
  none: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  unknown: "bg-surface-subtle text-fg-subtle",
};

const IMPORTABLE = new Set<DiscoveredBusiness["status"]>([
  "new",
  "researched",
  "audited",
  "scored",
  "approved",
]);

export default function DiscoverySearchDetailPage() {
  const params = useParams<{ id: string }>();
  const [search, setSearch] = useState<DiscoverySearch | null>(null);
  const [results, setResults] = useState<DiscoveredBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<DiscoveredBusinessFilters>(NO_FILTERS);
  const [sort, setSort] = useState<DiscoverySort>("discovered");
  const [importingId, setImportingId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  function load() {
    if (!params.id) return;
    api
      .getDiscoverySearch(params.id)
      .then((s) => {
        setError(null);
        setSearch(s);
      })
      .catch(() => setError("Couldn't load this search."));
    api
      .listDiscoveredBusinesses(params.id)
      .then(setResults)
      .catch(() => setError("Couldn't load discovered businesses."));
  }

  useEffect(load, [params.id]);

  const visible = useMemo(() => {
    if (!results) return [];
    return sortDiscoveredBusinesses(filterDiscoveredBusinesses(results, filters), sort);
  }, [results, filters, sort]);

  // A selection only counts while its row is actually on screen.
  const activeId = selectedId && visible.some((b) => b.id === selectedId) ? selectedId : null;

  useEffect(() => {
    if (activeId) rowRefs.current.get(activeId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  async function handleLoadMore() {
    if (!params.id) return;
    setLoadingMore(true);
    setError(null);
    try {
      const updated = await api.loadMoreDiscoverySearch(params.id);
      setSearch(updated);
      const rows = await api.listDiscoveredBusinesses(params.id);
      setResults(rows);
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

  const total = results?.length ?? 0;
  const mappedCount = visible.filter(hasCoordinates).length;
  const noWebsiteCount = visible.filter((b) => b.website_status === "none").length;

  return (
    <div className="p-6">
      <Link href="/dashboard/discovery" className="text-sm text-fg-muted hover:underline">
        &larr; Discovery
      </Link>

      {search && (
        <div className="mt-2">
          <h1 className="text-lg font-semibold text-fg">{search.query_label ?? "Discovery search"}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {[search.industry, search.business_type, search.location, search.keywords].filter(Boolean).join(" · ") ||
              "No criteria on record"}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!results && !error && (
        <div className="mt-4">
          <TableSkeleton rows={4} cols={6} />
        </div>
      )}

      {results && results.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
          No results yet for this search.
        </div>
      )}

      {results && results.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Filter by name, category, address…"
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
            />
            <select
              value={filters.website}
              onChange={(e) =>
                setFilters((f) => ({ ...f, website: e.target.value as DiscoveredBusinessFilters["website"] }))
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

          <DiscoveryMap businesses={visible} selectedId={activeId} onSelect={setSelectedId} />

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
                    const selected = business.id === activeId;
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
            {search?.has_more ? (
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
