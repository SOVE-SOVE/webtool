"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type DiscoveredBusiness, type DiscoverySearch } from "@/lib/api";

export default function DiscoverySearchDetailPage() {
  const params = useParams<{ id: string }>();
  const [search, setSearch] = useState<DiscoverySearch | null>(null);
  const [results, setResults] = useState<DiscoveredBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    api.getDiscoverySearch(params.id).then(setSearch).catch(() => setError("Couldn't load this search."));
    api
      .listDiscoveredBusinesses(params.id)
      .then(setResults)
      .catch(() => setError("Couldn't load discovered businesses."));
  }, [params.id]);

  if (!search && !results && !error) {
    return <div className="p-6 text-sm text-neutral-500">Loading…</div>;
  }

  return (
    <div className="p-6">
      <Link href="/dashboard/discovery" className="text-sm text-neutral-500 hover:underline">
        &larr; Discovery
      </Link>

      {search && (
        <div className="mt-2">
          <h1 className="text-lg font-semibold text-neutral-900">{search.query_label ?? "Discovery search"}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {[search.industry, search.business_type, search.location, search.keywords].filter(Boolean).join(" · ") ||
              "No criteria on record"}
          </p>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {results && results.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          No results yet for this search.
        </div>
      )}

      {results && results.length > 0 && (
        <table className="mt-4 w-full border border-neutral-200 text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Website</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {results.map((business) => (
              <tr key={business.id}>
                <td className="px-3 py-2">
                  <Link
                    href={`/dashboard/discovered-businesses/${business.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {business.name}
                  </Link>
                  {business.industry && <div className="text-xs text-neutral-500">{business.industry}</div>}
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  {[business.suburb, business.state].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  {business.website_url ? (
                    <a href={business.website_url} target="_blank" rel="noreferrer" className="hover:underline">
                      {business.website_url}
                    </a>
                  ) : (
                    "No website found"
                  )}
                </td>
                <td className="px-3 py-2 text-neutral-600">{business.status}</td>
                <td className="px-3 py-2 text-neutral-600">{business.opportunity_score ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
