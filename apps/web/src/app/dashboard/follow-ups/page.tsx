"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  type FollowUp,
  type FollowUpBuckets,
  type FollowUpCandidate,
  type Lead,
  type LeadStatus,
} from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Disclosure } from "@/components/ui/Disclosure";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";

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

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** "today" / "3 days overdue" / "in 5 days" — WHEN, in plain words. */
function dueLabel(due: string, now: number = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = new Date(due);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - start.getTime()) / MS_PER_DAY);
  if (diff === 0) return "due today";
  if (diff < 0) return `${-diff} day${diff === -1 ? "" : "s"} overdue`;
  if (diff === 1) return "due tomorrow";
  return `due in ${diff} days`;
}

function FollowUpRow({
  item,
  leadStatus,
  onResolve,
  onSnooze,
}: {
  item: FollowUp;
  leadStatus?: LeadStatus;
  onResolve: (id: string) => void;
  onSnooze: (id: string, days: number) => void;
}) {
  const why =
    item.previous_outreach
      ? `After ${item.previous_outreach.channel.replace("_", " ")} (${item.previous_outreach.status.replace("_", " ")}): ${item.previous_outreach.excerpt}`
      : "No prior outreach on record";
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">{item.business_name}</span>
            {leadStatus && <LeadStatusBadge status={leadStatus} />}
            <span className="text-xs text-fg-muted">
              {dueLabel(item.due_date)} · via {item.channel.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1 text-fg">{item.suggested_next_action}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{why}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <Link href={`/dashboard/leads/${item.lead_id}`} className="btn btn-primary btn-sm">
            Open lead →
          </Link>
          <div className="flex items-center gap-2">
            <select
              value=""
              onChange={(e) => {
                const days = Number(e.target.value);
                if (days) onSnooze(item.id, days);
              }}
              className="rounded-md border border-border-strong px-2 py-1 text-xs"
              aria-label={`Snooze follow-up for ${item.business_name}`}
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
              className="rounded-md border border-border-strong px-2.5 py-1 text-xs hover:bg-surface-subtle"
            >
              Mark done
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function BucketSection({
  title,
  items,
  statusByLead,
  onResolve,
  onSnooze,
  tone,
}: {
  title: string;
  items: FollowUp[];
  statusByLead: Map<string, LeadStatus>;
  onResolve: (id: string) => void;
  onSnooze: (id: string, days: number) => void;
  tone?: "urgent";
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className={`section-title ${tone === "urgent" ? "text-red-700 dark:text-red-400" : ""}`}>
        {title} <span className="font-normal text-fg-muted">({items.length})</span>
      </h2>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border">
        {items.map((item) => (
          <FollowUpRow
            key={item.id}
            item={item}
            leadStatus={statusByLead.get(item.lead_id)}
            onResolve={onResolve}
            onSnooze={onSnooze}
          />
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">{item.business_name}</span>
            <LeadStatusBadge status={item.lead_status} />
            <span className="text-xs text-fg-muted">{item.days_quiet} days quiet</span>
          </div>
          <p className="mt-1 text-fg">{item.reason}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={`/dashboard/leads/${item.lead_id}`} className="text-xs text-fg-muted hover:underline">
            Open lead
          </Link>
          <button
            onClick={() => onSchedule(item.lead_id)}
            disabled={scheduling}
            className="btn btn-secondary btn-sm"
          >
            {scheduling ? "Scheduling…" : `Schedule (${item.suggested_channel.replace("_", " ")})`}
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
    api
      .listFollowUps()
      .then((b) => {
        setError(null);
        setBuckets(b);
      })
      .catch(() => setError("Couldn't load follow-ups."));
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

  const statusByLead = useMemo(() => {
    const map = new Map<string, LeadStatus>();
    for (const l of leads) map.set(l.id, l.status);
    return map;
  }, [leads]);

  const eligibleLeads = leads.filter(
    (l) => !l.archived_at && FOLLOW_UP_ELIGIBLE_STATUSES.includes(l.status),
  );

  const totalDue = buckets
    ? buckets.overdue.length + buckets.due_today.length + buckets.upcoming.length
    : 0;
  const queueEmpty = buckets !== null && totalDue === 0 && candidates.length === 0;

  return (
    <div className="p-6">
      <PageHeader
        title="Follow-ups"
        description="Who needs a touch, and when. Overdue first, then today, then what's coming up. Nothing is contacted until you act."
      />

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {queueEmpty && (
        <div className="mt-6">
          <EmptyState
            title="You're all caught up"
            description="No follow-ups need attention right now. New ones show up here as leads go quiet or you generate them."
          />
        </div>
      )}

      {buckets && !queueEmpty && (
        <>
          <BucketSection
            title="Overdue"
            items={buckets.overdue}
            statusByLead={statusByLead}
            onResolve={handleResolve}
            onSnooze={handleSnooze}
            tone="urgent"
          />
          <BucketSection
            title="Today"
            items={buckets.due_today}
            statusByLead={statusByLead}
            onResolve={handleResolve}
            onSnooze={handleSnooze}
          />
          <BucketSection
            title="Upcoming"
            items={buckets.upcoming}
            statusByLead={statusByLead}
            onResolve={handleResolve}
            onSnooze={handleSnooze}
          />
        </>
      )}

      {candidates.length > 0 && (
        <section className="mt-8">
          <h2 className="section-title">
            Gone quiet — needs a follow-up scheduled{" "}
            <span className="font-normal text-fg-muted">({candidates.length})</span>
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Detected from last contact, pipeline stage, and meeting outcomes. Nothing is sent until you click
            Schedule.
          </p>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
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
      )}

      <div className="mt-8">
        <Disclosure title="Generate a follow-up for a lead" hint="Draft the next touch for any qualified lead">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedLeadId}
              onChange={(e) => setSelectedLeadId(e.target.value)}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
            >
              <option value="">Select a lead…</option>
              {eligibleLeads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.business_name}
                </option>
              ))}
            </select>
            <button onClick={handleGenerate} disabled={!selectedLeadId || generating} className="btn btn-primary">
              {generating ? "Generating…" : "Generate follow-up"}
            </button>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}
