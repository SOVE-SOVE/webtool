"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useOnTodayDataChanged } from "@/lib/todaySync";
import {
  api,
  type CalendarEvent,
  type DashboardOverview,
  type Lead,
  type Meeting,
  type PlanningListItem,
  type Project,
  type SalesDashboard,
  type Task,
} from "@/lib/api";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric } from "@/components/ui/Metric";
import { EmptyRow, Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { TaskScheduleCalendar } from "@/components/TaskScheduleCalendar";
import { dateKey, formatAud, formatLongDate, formatTime } from "@/lib/format";
import { leadMatchesTab } from "@/lib/leads";
import { loadOverview } from "@/lib/overview";
import { attentionPriority, attentionTag, computeNextActions, todaysScheduleEvents, type AttentionPriority } from "@/lib/today";
import { todayScheduleFeeds } from "@/lib/todaySchedule";

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

/**
 * The Today workspace's Overview tab — this is exactly what
 * `dashboard/page.tsx` rendered before the Today/Tasks/Calendar merge,
 * extracted unchanged (including its own date-line description, which
 * moved here from the removed shared `<PageHeader description>` since
 * it's Overview-specific, not something Tasks/Calendar should also
 * show). See `useTodayTab.ts` / `dashboard/page.tsx` for the shell.
 */
export function TodayOverviewTab() {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [sales, setSales] = useState<SalesDashboard | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);
  // The compact month calendar's two sources. Loaded separately from the
  // rest of the page so a slow or failed calendar never blocks Today.
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [calendarError, setCalendarError] = useState(false);

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
      .listTasks()
      .then((t) => {
        setCalendarError(false);
        setTasks(t);
      })
      .catch(() => setCalendarError(true));
    api
      .listMeetings()
      .then((m) => {
        setCalendarError(false);
        setMeetings(m);
      })
      .catch(() => setCalendarError(true));
    api
      .salesDashboard()
      .then((s) => {
        setSalesError(null);
        setSales(s);
      })
      .catch(() => setSalesError("Couldn't load the revenue summary."));
  }

  useEffect(load, []);
  useOnTodayDataChanged("overview", load);

  const nextActions = data
    ? computeNextActions({ leads: data.leads, planning: data.planning, projects: data.projects })
    : null;
  const schedule = events ? todaysScheduleEvents(events) : null;
  const calendarFeeds = useMemo(
    () => (data && tasks && meetings ? todayScheduleFeeds({ tasks, meetings, projects: data.projects }) : null),
    [data, tasks, meetings],
  );

  const newLeadsCount = data
    ? data.leads.filter((l) => !l.archived_at && leadMatchesTab(l, "new")).length
    : null;
  const planningNeedsReviewCount = data ? data.planning.filter((p) => p.status === "needs_review").length : null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-muted">{formatLongDate()} — your work, follow-ups and priorities for today.</p>

      {error && <ErrorState message={error} onRetry={load} compact />}

      {/* Overview row: the primary Pipeline + Revenue figures on the left,
          and the compact month calendar as a secondary column on the right
          (stacked below them on narrow screens). The full Calendar page stays
          the place for detail — this is an at-a-glance month view. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="min-w-0 space-y-6">
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
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5">
                <Metric label="Proposals out" value={sales.proposals_count} href="/dashboard/sales/pipeline" />
                <Metric label="Potential value" value={formatAud(sales.estimated_revenue_cents)} hint="open proposals" href="/dashboard/sales/pipeline" />
                <Metric label="Won deals" value={sales.won_deals_count} href="/dashboard/sales/pipeline" />
                <Metric label="Revenue won" value={formatAud(sales.actual_revenue_cents)} href="/dashboard/sales/pipeline" />
                <Metric label="Win rate" value={pct(sales.conversion_rate_pct)} href="/dashboard/sales/pipeline" />
              </div>
            )}
          </section>
        </div>

        <section className="card min-w-0" aria-labelledby="today-calendar-heading">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5">
            <h2 id="today-calendar-heading" className="text-sm font-semibold text-fg">
              Calendar
            </h2>
            <Link
              href="/dashboard?tab=calendar"
              className="rounded text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Full calendar →
            </Link>
          </div>
          <div className="p-3">
            {calendarFeeds ? (
              <TaskScheduleCalendar taskEvents={calendarFeeds.taskEvents} clientEvents={calendarFeeds.clientEvents} />
            ) : calendarError ? (
              <p className="text-xs text-fg-muted" role="status">
                Couldn&apos;t load the calendar.{" "}
                <button type="button" onClick={load} className="rounded underline hover:text-fg">
                  Retry
                </button>
              </p>
            ) : (
              <Skeleton className="h-52 w-full" />
            )}
          </div>
        </section>
      </div>

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
            <Link href="/dashboard?tab=calendar" className="rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
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
