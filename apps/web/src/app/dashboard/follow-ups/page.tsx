"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  type FollowUp,
  type FollowUpBuckets,
  type FollowUpCandidate,
  type Lead,
  type LeadStatus,
} from "@/lib/api";

const SNOOZE_OPTIONS: { label: string; days: number }[] = [
  { label: "+1 day", days: 1 },
  { label: "+3 days", days: 3 },
  { label: "+1 week", days: 7 },
];

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

function FollowUpRow({
  item,
  onResolve,
  onSnooze,
}: {
  item: FollowUp;
  onResolve: (id: string) => void;
  onSnooze: (id: string, days: number) => void;
}) {
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
          <div className="flex items-center gap-2">
            <select
              value=""
              onChange={(e) => {
                const days = Number(e.target.value);
                if (days) onSnooze(item.id, days);
              }}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
            >
              <option value="">Snooze…</option>
              {SNOOZE_OPTIONS.map((opt) => (
                <option key={opt.days} value={opt.days}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => onResolve(item.id)}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50"
            >
              Mark done
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function bucketSection(
  title: string,
  items: FollowUp[],
  onResolve: (id: string) => void,
  onSnooze: (id: string, days: number) => void,
  emptyLabel: string,
) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-neutral-900">
        {title} <span className="font-normal text-neutral-500">({items.length})</span>
      </h2>
      <ul className="mt-2 divide-y divide-neutral-200 border border-neutral-200">
        {items.length === 0 && <li className="px-4 py-3 text-sm text-neutral-500">{emptyLabel}</li>}
        {items.map((item) => (
          <FollowUpRow key={item.id} item={item} onResolve={onResolve} onSnooze={onSnooze} />
        ))}
      </ul>
    </section>
  );
}

function NeedsFollowUpRow({
  item,
  onSchedule,
  scheduling,
}: {
  item: FollowUpCandidate;
  onSchedule: (leadId: string) => void;
  scheduling: boolean;
}) {
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/dashboard/leads/${item.lead_id}`} className="font-medium text-neutral-900 hover:underline">
            {item.business_name}
          </Link>
          <p className="mt-0.5 text-xs text-neutral-500">Status: {item.lead_status.replace("_", " ")}</p>
          <p className="mt-1 text-neutral-800">{item.reason}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            Suggest: {item.suggested_channel.replace("_", " ")}
          </span>
          <button
            onClick={() => onSchedule(item.lead_id)}
            disabled={scheduling}
            className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            Schedule
          </button>
        </div>
      </div>
    </li>
  );
}

export default function FollowUpsPage() {
  const [buckets, setBuckets] = useState<FollowUpBuckets | null>(null);
  const [candidates, setCandidates] = useState<FollowUpCandidate[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [schedulingLeadId, setSchedulingLeadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.listFollowUps().then(setBuckets).catch(() => setError("Couldn't load follow-ups."));
    api.listNeedsFollowUp().then(setCandidates).catch(() => {});
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

  async function handleSnooze(id: string, days: number) {
    await api.snoozeFollowUp(id, days);
    load();
  }

  async function handleSchedule(leadId: string) {
    setSchedulingLeadId(leadId);
    setError(null);
    try {
      await api.scheduleFollowUp(leadId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't schedule a follow-up.");
    } finally {
      setSchedulingLeadId(null);
    }
  }

  const eligibleLeads = leads.filter((l) => !l.archived_at && FOLLOW_UP_ELIGIBLE_STATUSES.includes(l.status));

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-neutral-900">Follow-ups</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Your daily action queue — leads that need a touch, snoozed reminders, and nothing gets contacted without you.
      </p>

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

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">
          Needs a follow-up scheduled <span className="font-normal text-neutral-500">({candidates.length})</span>
        </h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Detected automatically from last contact, pipeline stage, and meeting outcomes — nothing is sent until you
          click Schedule.
        </p>
        <ul className="mt-2 divide-y divide-neutral-200 border border-neutral-200">
          {candidates.length === 0 && (
            <li className="px-4 py-3 text-sm text-neutral-500">
              Nothing&apos;s gone quiet — you&apos;re caught up.
            </li>
          )}
          {candidates.map((c) => (
            <NeedsFollowUpRow
              key={c.lead_id}
              item={c}
              onSchedule={handleSchedule}
              scheduling={schedulingLeadId === c.lead_id}
            />
          ))}
        </ul>
      </section>

      {buckets && (
        <>
          {bucketSection("Overdue", buckets.overdue, handleResolve, handleSnooze, "Nothing overdue.")}
          {bucketSection("Due today", buckets.due_today, handleResolve, handleSnooze, "Nothing due today.")}
          {bucketSection("Upcoming", buckets.upcoming, handleResolve, handleSnooze, "Nothing upcoming.")}
        </>
      )}
    </div>
  );
}
