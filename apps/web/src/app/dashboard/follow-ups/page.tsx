"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, type FollowUp, type FollowUpBuckets, type Lead, type LeadStatus } from "@/lib/api";

// Same "qualified onward" gate as outreach/sales-audit generation on the
// lead detail page — a follow-up only makes sense once a lead has
// cleared initial qualification.
const FOLLOW_UP_ELIGIBLE_STATUSES: LeadStatus[] = [
  "qualified",
  "contacted",
  "replied",
  "meeting",
  "proposal",
  "won",
  "nurture",
];

function FollowUpRow({ item, onResolve }: { item: FollowUp; onResolve: (id: string) => void }) {
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/dashboard/leads/${item.lead_id}`} className="font-medium text-neutral-900 hover:underline">
            {item.business_name}
          </Link>
          <p className="mt-0.5 text-xs text-neutral-500">
            {item.previous_outreach
              ? `Previous: ${item.previous_outreach.channel.replace("_", " ")} (${item.previous_outreach.status.replace("_", " ")}) — ${item.previous_outreach.excerpt}`
              : "No previous outreach"}
          </p>
          <p className="mt-1 text-neutral-800">{item.suggested_next_action}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
            {item.channel.replace("_", " ")}
          </span>
          <span className="text-xs text-neutral-500">{new Date(item.due_date).toLocaleDateString()}</span>
          <button
            onClick={() => onResolve(item.id)}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50"
          >
            Mark done
          </button>
        </div>
      </div>
    </li>
  );
}

function bucketSection(title: string, items: FollowUp[], onResolve: (id: string) => void, emptyLabel: string) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-neutral-900">
        {title} <span className="font-normal text-neutral-500">({items.length})</span>
      </h2>
      <ul className="mt-2 divide-y divide-neutral-200 border border-neutral-200">
        {items.length === 0 && <li className="px-4 py-3 text-sm text-neutral-500">{emptyLabel}</li>}
        {items.map((item) => (
          <FollowUpRow key={item.id} item={item} onResolve={onResolve} />
        ))}
      </ul>
    </section>
  );
}

export default function FollowUpsPage() {
  const [buckets, setBuckets] = useState<FollowUpBuckets | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.listFollowUps().then(setBuckets).catch(() => setError("Couldn't load follow-ups."));
    api.listLeads().then(setLeads).catch(() => {});
  }

  useEffect(load, []);

  async function handleGenerate() {
    if (!selectedLeadId) return;
    setGenerating(true);
    setError(null);
    try {
      await api.generateFollowUp(selectedLeadId);
      setSelectedLeadId("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't generate a follow-up.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleResolve(id: string) {
    await api.resolveFollowUp(id);
    load();
  }

  const eligibleLeads = leads.filter((l) => !l.archived_at && FOLLOW_UP_ELIGIBLE_STATUSES.includes(l.status));

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-neutral-900">Follow-ups</h1>

      <div className="mt-4 flex items-center gap-2">
        <select
          value={selectedLeadId}
          onChange={(e) => setSelectedLeadId(e.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        >
          <option value="">Select a lead…</option>
          {eligibleLeads.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.business_name}
            </option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={!selectedLeadId || generating}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate follow-up"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {buckets && (
        <>
          {bucketSection("Overdue", buckets.overdue, handleResolve, "Nothing overdue.")}
          {bucketSection("Due today", buckets.due_today, handleResolve, "Nothing due today.")}
          {bucketSection("Upcoming", buckets.upcoming, handleResolve, "Nothing upcoming.")}
        </>
      )}
    </div>
  );
}
