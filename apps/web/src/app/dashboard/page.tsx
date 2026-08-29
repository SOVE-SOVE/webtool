"use client";

import { useEffect, useState } from "react";
import { api, type ActivityItem, type DashboardOverview } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatAud, timeAgo } from "@/lib/format";

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
    <div className="space-y-8 p-4 sm:p-6">
      <PageHeader
        title="Overview"
        description="What needs your attention right now to make money or move a project forward."
      />

      {error && <ErrorState message={error} onRetry={load} compact />}

      {!data && !error && (
        <MetricGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-md border border-border bg-surface p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-12" />
            </div>
          ))}
        </MetricGrid>
      )}

      {data && (
        <>
          <MetricGrid>
            <Metric label="Total leads" value={data.total_leads} href="/dashboard/leads" />
            <Metric label="Qualified leads" value={data.qualified_leads} href="/dashboard/leads" />
            <Metric label="Contacted leads" value={data.contacted_leads} href="/dashboard/leads" />
            <Metric label="Upcoming meetings" value={data.upcoming_meetings} href="/dashboard/calendar" />
            <Metric label="Follow-ups due" value={data.follow_ups_due} href="/dashboard/follow-ups" />
            <Metric label="Won projects" value={data.won_projects} href="/dashboard/projects" />
            <Metric label="Active projects" value={data.active_projects} href="/dashboard/projects" />
            <Metric label="Revenue (won)" value={formatAud(data.revenue_cents)} />
            <Metric
              label="Tasks needing attention"
              value={data.tasks_needing_attention}
              href="/dashboard/tasks"
            />
          </MetricGrid>

          <section>
            <h2 className="section-title">Recent activity</h2>
            <p className="mt-1 text-xs text-fg-muted">What&apos;s happened across the workspace.</p>
            {activity === null || activity.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">Nothing logged yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {activity.slice(0, 15).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 text-sm text-fg-muted">
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
