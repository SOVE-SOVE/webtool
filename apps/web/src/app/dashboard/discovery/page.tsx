"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type DiscoverySearch } from "@/lib/api";

const STATUS_LABEL: Record<DiscoverySearch["status"], string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

function criteriaSummary(search: DiscoverySearch): string {
  const parts = [search.industry, search.business_type, search.location, search.keywords].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No criteria on record";
}

export default function DiscoverySearchesPage() {
  const [searches, setSearches] = useState<DiscoverySearch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listDiscoverySearches()
      .then(setSearches)
      .catch(() => setError("Couldn't load discovery searches."));
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Discovery</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Find businesses that might be a good fit for a website redesign, before they enter the CRM.
          </p>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {searches && searches.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          No discovery searches yet. Running a search (e.g. &ldquo;plumbing businesses on the Gold
          Coast&rdquo;) is the next capability to land here.
        </div>
      )}

      {searches && searches.length > 0 && (
        <table className="mt-4 w-full border border-neutral-200 text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Search</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Results</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {searches.map((search) => (
              <tr key={search.id}>
                <td className="px-3 py-2">
                  <Link
                    href={`/dashboard/discovery/${search.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {search.query_label ?? criteriaSummary(search)}
                  </Link>
                  <div className="text-xs text-neutral-500">{criteriaSummary(search)}</div>
                </td>
                <td className="px-3 py-2 text-neutral-600">{search.provider}</td>
                <td className="px-3 py-2 text-neutral-600">{STATUS_LABEL[search.status]}</td>
                <td className="px-3 py-2 text-neutral-600">{search.result_count}</td>
                <td className="px-3 py-2 text-neutral-600">{new Date(search.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
