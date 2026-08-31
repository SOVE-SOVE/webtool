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
import { filterDiscoveredBusinesses, hasCoordinates, type DiscoveredBusinessFilters } from "@/lib/filters";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeleton";

// Leaflet touches `window` on import — client-only, no SSR.
const DiscoveryMap = dynamic(() => import("@/components/DiscoveryMap"), { ssr: false });

const NO_FILTERS: DiscoveredBusinessFilters = { search: "", website: "", mappedOnly: false };

export default function DiscoverySearchDetailPage() {
  const params = useParams<{ id: string }>();
  const [search, setSearch] = useState<DiscoverySearch | null>(null);
  const [results, setResults] = useState<DiscoveredBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<DiscoveredBusinessFilters>(NO_FILTERS);
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

  const visible = useMemo(
    () => (results ? filterDiscoveredBusinesses(results, filters) : []),
    [results, filters],
  );

  // A selection only counts while its row is actually on screen — if a
  // filter hides it, the map and table simply show nothing selected
  // (no state to reset).
  const activeId = selectedId && visible.some((b) => b.id === selectedId) ? selectedId : null;

  // Map marker click -> bring the matching row into view.
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

  const total = results?.length ?? 0;
  const mappedCount = visible.filter(hasCoordinates).length;

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
          <TableSkeleton rows={4} cols={5} />
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
              placeholder="Filter by name, industry, address…"
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
            <table className="mt-4 w-full border border-border text-left text-sm">
              <thead className="bg-surface-subtle text-xs uppercase text-fg-muted">
                <tr>
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Website</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((business) => {
                  const onMap = hasCoordinates(business);
                  const selected = business.id === activeId;
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
                        (onMap ? "cursor-pointer" : "")
                      }
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
                            <span className="text-fg-subtle" title="Shown on the map" aria-hidden>
                              &#9679;
                            </span>
                          )}
                        </span>
                        {business.industry && <div className="text-xs text-fg-muted">{business.industry}</div>}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">
                        {business.address ||
                          [business.suburb, business.state].filter(Boolean).join(", ") ||
                          "—"}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">
                        {business.website_url ? (
                          <a
                            href={business.website_url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {business.website_url}
                          </a>
                        ) : (
                          <span className="text-fg-subtle">
                            {DISCOVERED_WEBSITE_STATUS_LABEL[business.website_status]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{business.status}</td>
                      <td className="px-3 py-2 text-fg-muted">{business.opportunity_score ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="mt-3 flex items-center justify-between text-sm text-fg-muted">
            <span>
              Showing {visible.length} of {total} {total === 1 ? "result" : "results"}
              {mappedCount > 0 && <> · {mappedCount} on the map</>}
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
