"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  api,
  ApiError,
  DISCOVERED_WEBSITE_STATUS_LABEL,
  type DiscoveredBusiness,
  type DiscoverySearch,
} from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeleton";

export default function DiscoverySearchDetailPage() {
  const params = useParams<{ id: string }>();
  const [search, setSearch] = useState<DiscoverySearch | null>(null);
  const [results, setResults] = useState<DiscoveredBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

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
            {results.map((business) => (
              <tr key={business.id}>
                <td className="px-3 py-2">
                  <Link
                    href={`/dashboard/discovered-businesses/${business.id}`}
                    className="font-medium text-fg hover:underline"
                  >
                    {business.name}
                  </Link>
                  {business.industry && <div className="text-xs text-fg-muted">{business.industry}</div>}
                </td>
                <td className="px-3 py-2 text-fg-muted">
                  {[business.suburb, business.state].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-3 py-2 text-fg-muted">
                  {business.website_url ? (
                    <a href={business.website_url} target="_blank" rel="noreferrer" className="hover:underline">
                      {business.website_url}
                    </a>
                  ) : (
                    <span className="text-fg-subtle">{DISCOVERED_WEBSITE_STATUS_LABEL[business.website_status]}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-fg-muted">{business.status}</td>
                <td className="px-3 py-2 text-fg-muted">{business.opportunity_score ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {results && results.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-fg-muted">
          <span>
            Showing {results.length} {results.length === 1 ? "result" : "results"}
          </span>
          {search?.has_more ? (
            <button onClick={handleLoadMore} disabled={loadingMore} className="btn btn-secondary">
              {loadingMore ? "Loading…" : "Load more results"}
            </button>
          ) : (
            <span className="text-fg-subtle">All results loaded</span>
          )}
        </div>
      )}
    </div>
  );
}
