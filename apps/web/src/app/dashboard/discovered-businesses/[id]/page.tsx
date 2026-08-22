"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError, type BusinessResearchResult, type DiscoveredBusiness } from "@/lib/api";

function Fact({ label, value }: { label: string; value: string | boolean | null }) {
  return (
    <div className="flex justify-between border-b border-neutral-100 py-1.5 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-900">
        {value === null ? "Unknown" : typeof value === "boolean" ? (value ? "Yes" : "No") : value}
      </span>
    </div>
  );
}

function ListSection({ title, items, tone }: { title: string; items: string[]; tone: "confirmed" | "inferred" | "unavailable" }) {
  if (items.length === 0) return null;
  const toneClass =
    tone === "confirmed" ? "text-neutral-700" : tone === "inferred" ? "text-amber-700" : "text-neutral-400";
  return (
    <div className="mt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      <ul className={`mt-1 list-inside list-disc space-y-0.5 text-sm ${toneClass}`}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function DiscoveredBusinessDetailPage() {
  const params = useParams<{ id: string }>();
  const [business, setBusiness] = useState<DiscoveredBusiness | null>(null);
  const [research, setResearch] = useState<BusinessResearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);

  function load() {
    if (!params.id) return;
    api.getDiscoveredBusiness(params.id).then(setBusiness).catch(() => setError("Couldn't load this business."));
    api
      .listBusinessResearch(params.id)
      .then(setResearch)
      .catch(() => setError("Couldn't load research for this business."));
  }

  useEffect(load, [params.id]);

  async function handleResearch() {
    if (!params.id) return;
    setResearching(true);
    setError(null);
    try {
      await api.runBusinessResearch(params.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't research this business.");
    } finally {
      setResearching(false);
    }
  }

  const latest = research && research.length > 0 ? research[0] : null;

  return (
    <div className="p-6">
      {business && (
        <Link href={`/dashboard/discovery/${business.discovery_search_id}`} className="text-sm text-neutral-500 hover:underline">
          &larr; Back to search results
        </Link>
      )}

      {business && (
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{business.name}</h1>
            <p className="mt-1 text-sm text-neutral-500">
              {[business.industry, [business.suburb, business.state].filter(Boolean).join(", ")]
                .filter(Boolean)
                .join(" · ") || "No details on record"}
            </p>
            {business.website_url ? (
              <a
                href={business.website_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-neutral-600 hover:underline"
              >
                {business.website_url}
              </a>
            ) : (
              <p className="text-sm text-neutral-400">No website on record</p>
            )}
          </div>
          <div className="text-right">
            <span className="inline-block rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
              {business.status}
            </span>
            <div className="mt-2">
              <button
                onClick={handleResearch}
                disabled={researching}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {researching ? "Researching…" : latest ? "Research again" : "Run research"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {research && research.length === 0 && !error && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          No research yet for this business.
        </div>
      )}

      {latest && (
        <div className="mt-6 max-w-2xl border border-neutral-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Website research</h2>
            <span className="text-xs text-neutral-400">
              {new Date(latest.researched_at).toLocaleString()}
            </span>
          </div>

          {latest.research_error ? (
            <p className="mt-2 text-sm text-red-600">Could not load website: {latest.research_error}</p>
          ) : (
            <div className="mt-2">
              <Fact label="Reachable" value={latest.website_reachable} />
              <Fact label="HTTPS" value={latest.https} />
              <Fact label="Page title" value={latest.page_title} />
              <Fact label="Mobile viewport tag" value={latest.mobile_viewport_present} />
              <Fact label="Contact path found" value={latest.contact_cta_present} />
              <Fact label="Estimated age" value={latest.estimated_site_age} />
              <Fact label="Appears template/placeholder" value={latest.appears_template_or_placeholder} />
            </div>
          )}

          <ListSection title="Confirmed" items={latest.confirmed_facts} tone="confirmed" />
          <ListSection title="Inferred" items={latest.inferred_facts} tone="inferred" />
          <ListSection title="Technical issues" items={latest.technical_issues} tone="inferred" />
          <ListSection title="Social presence" items={latest.social_presence} tone="confirmed" />
          <ListSection title="Unavailable" items={latest.unavailable_fields} tone="unavailable" />
        </div>
      )}
    </div>
  );
}
