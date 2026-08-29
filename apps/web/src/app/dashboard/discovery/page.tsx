"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, type DiscoverySearch } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";

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
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [keywords, setKeywords] = useState("");
  const [hasWebsite, setHasWebsite] = useState<"" | "true" | "false">("");

  function load() {
    api
      .listDiscoverySearches()
      .then((rows) => {
        setError(null);
        setSearches(rows);
      })
      .catch(() => setError("Couldn't load discovery searches."));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await api.createDiscoverySearch({
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
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't run this search.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Discovery"
        description="Find businesses that might be a good fit for a website redesign, before they enter the CRM."
        actions={
          <button onClick={() => setShowForm((v) => !v)} className="btn btn-primary">
            {showForm ? "Cancel" : "New search"}
          </button>
        }
      />

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 grid max-w-2xl grid-cols-1 sm:grid-cols-2 gap-3 border border-border p-4">
          <p className="col-span-2 text-xs text-fg-muted">
            e.g. industry &ldquo;Plumbing&rdquo; + location &ldquo;Gold Coast&rdquo; finds plumbing businesses on
            the Gold Coast. At least one of industry, location, business type, or keywords is required.
          </p>
          <input
            placeholder="Industry (e.g. Plumbing)"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Location (e.g. Gold Coast)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Business type"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <select
            value={hasWebsite}
            onChange={(e) => setHasWebsite(e.target.value as "" | "true" | "false")}
            className="col-span-2 rounded-md border border-border-strong px-3 py-1.5 text-sm"
          >
            <option value="">Website: don&apos;t care</option>
            <option value="true">Only businesses with a website</option>
            <option value="false">Only businesses without a website</option>
          </select>
          {formError && <p className="col-span-2 text-error">{formError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="col-span-2 btn btn-primary"
          >
            {saving ? "Searching…" : "Run search"}
          </button>
        </form>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!searches && !error && (
        <div className="mt-4">
          <TableSkeleton rows={4} cols={4} />
        </div>
      )}

      {searches && searches.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
          No discovery searches yet. Try &ldquo;plumbing businesses on the Gold Coast&rdquo; above.
        </div>
      )}

      {searches && searches.length > 0 && (
        <table className="mt-4 w-full border border-border text-left text-sm">
          <thead className="bg-surface-subtle text-xs uppercase text-fg-muted">
            <tr>
              <th className="px-3 py-2">Search</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Results</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {searches.map((search) => (
              <tr key={search.id}>
                <td className="px-3 py-2">
                  <Link
                    href={`/dashboard/discovery/${search.id}`}
                    className="font-medium text-fg hover:underline"
                  >
                    {search.query_label ?? criteriaSummary(search)}
                  </Link>
                  <div className="text-xs text-fg-muted">{criteriaSummary(search)}</div>
                  {search.error_message && <div className="text-xs text-red-600 dark:text-red-400">{search.error_message}</div>}
                </td>
                <td className="px-3 py-2 text-fg-muted">{search.provider}</td>
                <td className="px-3 py-2 text-fg-muted">{STATUS_LABEL[search.status]}</td>
                <td className="px-3 py-2 text-fg-muted">{search.result_count}</td>
                <td className="px-3 py-2 text-fg-muted">{new Date(search.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
