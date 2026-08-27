"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ActivityItem, type AttentionItem, type DashboardOverview } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
    </div>
  );
}

// Colour carries the same ranking the API sorted by, so the top of the
// list reads as "this is on fire" at a glance without reading every row.
const BADGE_CLASS: Record<AttentionItem["kind"], string> = {
  project: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  follow_up: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  meeting: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  task: "bg-surface-subtle text-fg-muted",
  stale_lead: "bg-surface-subtle text-fg-muted",
  // Sales command centre kinds (see /dashboard/sales) — this page's own
  // needs_attention list never emits these, but the type is shared.
  hot_lead: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  stale_proposal: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  new_lead: "bg-surface-subtle text-fg-muted",
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const ACTIVITY_VERB: Record<string, string> = {
  created: "created",
  stage_changed: "moved the stage of",
  assigned: "reassigned",
  completed: "completed",
  reopened: "reopened",
};

export default function OverviewPage() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .dashboardOverview()
      .then((d) => {
        setError(null);
        setData(d);
      })
      .catch(() => setError("Couldn't load dashboard data."));
    api.listActivity().then(setActivity).catch(() => {});
  }

  useEffect(load, []);

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-fg">Overview</h1>
      <p className="mt-1 text-sm text-fg-muted">
        What needs your attention right now to make money or move a project forward.
      </p>

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!data && !error && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-12" />
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          <section className="mt-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-fg">Do this next</h2>
              <span className="text-xs text-fg-muted">
                {data.needs_attention.length === 0
                  ? "All clear"
                  : `${data.needs_attention.length} open — most urgent first`}
              </span>
            </div>
            {data.needs_attention.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">
                Nothing is waiting on you. Add leads, or push an active project forward.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border border border-border">
                {data.needs_attention.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <Link
                      href={item.href}
                      className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-surface-subtle"
                    >
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-fg">{item.action}</span>
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          {item.title} — {item.detail}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[item.kind]}`}
                      >
                        {item.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricTile label="Total leads" value={data.total_leads} />
            <MetricTile label="Qualified leads" value={data.qualified_leads} />
            <MetricTile label="Contacted leads" value={data.contacted_leads} />
            <MetricTile label="Upcoming meetings" value={data.upcoming_meetings} />
            <MetricTile label="Follow-ups due" value={data.follow_ups_due} />
            <MetricTile label="Won projects" value={data.won_projects} />
            <MetricTile label="Active projects" value={data.active_projects} />
            <MetricTile label="Revenue (won)" value={currency.format(data.revenue_cents / 100)} />
            <MetricTile label="Tasks needing attention" value={data.tasks_needing_attention} />
          </div>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-fg">Recent activity</h2>
            <p className="mt-1 text-xs text-fg-muted">What&apos;s happened across the workspace.</p>
            {activity === null || activity.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">Nothing logged yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border border border-border">
                {activity.slice(0, 15).map((item) => (
                  <li key={item.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-fg-muted">
                      <span className="font-medium text-fg">{item.user_name ?? "Someone"}</span>{" "}
                      {ACTIVITY_VERB[item.action] ?? item.action} {item.entity_type}
                      {item.summary ? <span className="text-fg-muted"> — {item.summary}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-fg-subtle">{timeAgo(item.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
