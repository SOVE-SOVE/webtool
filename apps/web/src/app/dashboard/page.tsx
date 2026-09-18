"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api,
  type CalendarEvent,
  type DashboardOverview,
  type Lead,
  type PlanningListItem,
  type Project,
  type SalesDashboard,
} from "@/lib/api";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric } from "@/components/ui/Metric";
import { EmptyRow, Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { dateKey, formatAud, formatLongDate, formatTime } from "@/lib/format";
import { leadMatchesTab } from "@/lib/leads";
import { loadOverview } from "@/lib/overview";
import { attentionPriority, attentionTag, computeNextActions, todaysScheduleEvents, type AttentionPriority } from "@/lib/today";

type TodayData = {
  leads: Lead[];
  planning: PlanningListItem[];
  projects: Project[];
  overview: DashboardOverview;
};

/** Loading placeholder for a bordered two-line row list. */
function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="mt-2 h-2.5 w-3/5" />
        </div>
      ))}
    </div>
  );
}

/** Loading placeholder for a row of stat cards. */
function StatsSkeleton({ count }: { count: number }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border-border bg-surface px-4 py-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-6 w-12" />
        </div>
      ))}
    </div>
  );
}

const PRIORITY_BADGE_TONE: Record<AttentionPriority, BadgeTone> = {
  high: "danger",
  medium: "warning",
  low: "muted",
};

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

export default function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [sales, setSales] = useState<SalesDashboard | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);

  function load() {
    Promise.all([api.listLeads(), api.listPlanning(), api.listProjects(), loadOverview()])
      .then(([leads, planning, projects, overview]) => {
        setError(null);
        setData({ leads, planning, projects, overview });
      })
      .catch(() => setError("Couldn't load today's workspace."));

    const today = dateKey();
    api.listCalendarEvents(today, today).then(setEvents).catch(() => {});
    api
      .salesDashboard()
      .then((s) => {
        setSalesError(null);
        setSales(s);
      })
      .catch(() => setSalesError("Couldn't load the revenue summary."));
  }

  useEffect(load, []);

  const nextActions = data
    ? computeNextActions({ leads: data.leads, planning: data.planning, projects: data.projects })
    : null;
  const schedule = events ? todaysScheduleEvents(events) : null;

  const newLeadsCount = data
    ? data.leads.filter((l) => !l.archived_at && leadMatchesTab(l, "new")).length
    : null;
  const planningNeedsReviewCount = data ? data.planning.filter((p) => p.status === "needs_review").length : null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader title="Today" description={`${formatLongDate()} — your work, follow-ups and priorities for today.`} />

      {error && <ErrorState message={error} onRetry={load} compact />}

      {/* Pipeline — where things stand right now, one stat per stage an
          operator actually acts on day to day. */}
      <section>
        <h2 className="section-title">Pipeline</h2>
        {!data ? (
          <StatsSkeleton count={4} />
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Leads in pipeline" value={data.leads.length} href="/dashboard/sales/leads" />
            <Metric label="New leads to review" value={newLeadsCount ?? 0} href="/dashboard/sales/leads?tab=new" />
            <Metric
              label="Planning/build needing review"
              value={planningNeedsReviewCount ?? 0}
              href="/dashboard/build/planning"
            />
            <Metric label="Projects in progress" value={data.overview.active_projects} href="/dashboard/build/projects" />
          </div>
        )}
      </section>

      {/* Revenue — the sales funnel's money figures, same data source and
          stat card as the Sales dashboard's own Potential value / Won
          deals / Revenue won cards. */}
      <section>
        <h2 className="section-title">Revenue</h2>
        {salesError ? (
          <div className="mt-2">
            <ErrorState message={salesError} onRetry={load} compact />
          </div>
        ) : !sales ? (
          <StatsSkeleton count={5} />
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label="Proposals out" value={sales.proposals_count} href="/dashboard/sales/pipeline" />
            <Metric label="Potential value" value={formatAud(sales.estimated_revenue_cents)} hint="open proposals" href="/dashboard/sales/pipeline" />
            <Metric label="Won deals" value={sales.won_deals_count} href="/dashboard/sales/pipeline" />
            <Metric label="Revenue won" value={formatAud(sales.actual_revenue_cents)} href="/dashboard/sales/pipeline" />
            <Metric label="Win rate" value={pct(sales.conversion_rate_pct)} href="/dashboard/sales/pipeline" />
          </div>
        )}
      </section>

      {/* Three equal panels, side by side — today's work, split by kind
          rather than stacked as one long page. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="Today&apos;s priorities"
          right={
            <Link href="/dashboard/sales/leads" className="rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
              See all →
            </Link>
          }
        >
          {!data ? (
            <RowsSkeleton rows={4} />
          ) : data.overview.needs_attention.length === 0 ? (
            <EmptyState
              title="You're all caught up"
              description="Nothing needs your attention right now."
              action={
                <Link href="/dashboard/discovery" className="btn btn-secondary">
                  Open Map Discovery
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.overview.needs_attention.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <Link href={item.href} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
                      <span className="block truncate text-xs text-fg-muted">{item.action}</span>
                    </span>
                    <Badge tone={PRIORITY_BADGE_TONE[attentionPriority(item)]} className="mt-0.5 shrink-0">
                      {attentionTag(item)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Also on your plate"
          right={
            <Link href="/dashboard/build" className="rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
              See all →
            </Link>
          }
        >
          {!nextActions ? (
            <RowsSkeleton rows={3} />
          ) : nextActions.length === 0 ? (
            <EmptyRow>Nothing else waiting on you right now.</EmptyRow>
          ) : (
            <ul className="divide-y divide-border">
              {nextActions.map((action) => (
                <li key={action.id}>
                  <Link href={action.href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover">
                    <span className="text-sm font-medium text-fg">{action.label}</span>
                    <span className="shrink-0 text-fg-muted">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Today&apos;s schedule"
          right={
            <Link href="/dashboard/calendar" className="rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
              See all →
            </Link>
          }
        >
          {!schedule ? (
            <RowsSkeleton rows={2} />
          ) : schedule.length === 0 ? (
            <EmptyRow>Nothing scheduled for today.</EmptyRow>
          ) : (
            <ul className="divide-y divide-border">
              {schedule.map((event) => (
                <li key={`${event.kind}-${event.id}`}>
                  <Link href={event.href} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{event.title}</span>
                      <span className="block truncate text-xs text-fg-muted">{event.detail}</span>
                    </span>
                    <span className="shrink-0 text-xs text-fg-muted">{formatTime(event.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
