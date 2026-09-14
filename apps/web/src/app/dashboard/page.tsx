"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api,
  type ActivityItem,
  type CalendarEvent,
  type DashboardOverview,
  type Lead,
  type PlanningListItem,
  type Project,
} from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric } from "@/components/ui/Metric";
import { EmptyRow, ItemRow, Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { dateKey, formatLongDate, formatTime, timeAgo } from "@/lib/format";
import { loadOverview } from "@/lib/overview";
import {
  activityHref,
  attentionPriority,
  attentionTag,
  computeNextActions,
  computePipelineStages,
  todaysScheduleEvents,
} from "@/lib/today";

const RECENT_ACTIVITY_LIMIT = 8;

type TodayData = {
  leads: Lead[];
  planning: PlanningListItem[];
  reviewQueueCount: number;
  projects: Project[];
  activity: ActivityItem[];
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

const PRIORITY_TONE = { high: "danger", medium: "warn", low: "muted" } as const;

export default function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);

  function load() {
    Promise.all([
      api.listLeads(),
      api.listPlanning(),
      api.listReviewItems(),
      api.listProjects(),
      api.listActivity(),
      loadOverview(),
    ])
      .then(([leads, planning, reviewItems, projects, activity, overview]) => {
        setError(null);
        setData({
          leads,
          planning,
          reviewQueueCount: reviewItems.filter(
            (item) => item.status !== "imported" && item.status !== "rejected" && item.status !== "archived",
          ).length,
          projects,
          activity,
          overview,
        });
      })
      .catch(() => setError("Couldn't load today's workspace."));

    const today = dateKey();
    api.listCalendarEvents(today, today).then(setEvents).catch(() => {});
  }

  useEffect(load, []);

  const nextActions = data
    ? computeNextActions({ leads: data.leads, planning: data.planning, projects: data.projects })
    : null;
  const pipeline = data
    ? computePipelineStages({
        reviewQueueCount: data.reviewQueueCount,
        leadsCount: data.leads.length,
        planningCount: data.planning.length,
        projects: data.projects,
      })
    : null;
  const schedule = events ? todaysScheduleEvents(events) : null;

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <PageHeader title="Today" description={`${formatLongDate()} — your work, follow-ups and priorities for today.`} />

      {error && <ErrorState message={error} onRetry={load} compact />}

      {/* 1. Today's priorities — the same server-ranked "what needs
          attention" queue the rest of the app shows in the DoThisNext
          tray (see dashboard/layout.tsx), given the hero treatment here
          instead of a compact strip, since answering "what do I do
          today" is this page's one job. */}
      <section>
        <h2 className="section-title">Today&apos;s priorities</h2>
        {!data ? (
          <div className="mt-2 rounded-md border border-border">
            <RowsSkeleton rows={4} />
          </div>
        ) : data.overview.needs_attention.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              title="You're all caught up"
              description="Nothing needs your attention right now. Good time to open Map Discovery and find the next lead."
              action={
                <Link href="/dashboard/discovery" className="btn btn-secondary">
                  Open Map Discovery
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-2 max-h-96 overflow-y-auto overscroll-contain rounded-md border border-border">
            <ul className="divide-y divide-border">
              {data.overview.needs_attention.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <ItemRow
                    href={item.href}
                    primary={item.title}
                    secondary={item.action}
                    right={attentionTag(item)}
                    rightTone={PRIORITY_TONE[attentionPriority(item)]}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 2. Today's schedule — today's meetings and due tasks, chronological.
          Deliberately just a list, not a calendar — see /dashboard/calendar
          for that. */}
      <section>
        <h2 className="section-title">Today&apos;s schedule</h2>
        {!schedule ? (
          <div className="mt-2 rounded-md border border-border">
            <RowsSkeleton rows={2} />
          </div>
        ) : schedule.length === 0 ? (
          <div className="mt-2 rounded-md border border-border">
            <EmptyRow>Nothing scheduled for today.</EmptyRow>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {schedule.map((event) => (
              <li key={`${event.kind}-${event.id}`}>
                <Link
                  href={event.href}
                  className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                >
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
      </section>

      {/* 3. Also on your plate — aggregate pipeline nudges (new leads to
          triage, Planning audits ready to review, etc.) that aren't tied
          to a specific day, so they sit below the time-bound sections
          above. Hidden entirely once loaded and empty — Priorities' own
          empty state already covers "you're caught up". */}
      {(nextActions === null || nextActions.length > 0) && (
        <section>
          <h2 className="section-title">Also on your plate</h2>
          {!nextActions ? (
            <div className="mt-2 rounded-md border border-border">
              <RowsSkeleton rows={2} />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {nextActions.map((action) => (
                <li key={action.id}>
                  <Link
                    href={action.href}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover"
                  >
                    <span className="text-sm font-medium text-fg">{action.label}</span>
                    <span className="shrink-0 text-fg-muted">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 4. Pipeline — a plain, non-decorative view of real counts at each stage. */}
      <section>
        <h2 className="section-title">Pipeline</h2>
        {!pipeline ? (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-md border border-border bg-surface px-4 py-3">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="mt-2 h-6 w-8" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {pipeline.map((stage) => (
              <Metric
                key={stage.id}
                label={stage.label}
                value={stage.count}
                hint={stage.empty ? `${stage.empty.label} →` : undefined}
                href={stage.empty ? stage.empty.href : stage.href}
              />
            ))}
          </div>
        )}
      </section>

      {/* 5. Recent activity — the workspace-wide activity log, reused as-is. */}
      <Panel title="Recent activity" bodyClassName="max-h-72">
        {!data ? (
          <RowsSkeleton rows={4} />
        ) : data.activity.length === 0 ? (
          <EmptyRow>Nothing has happened yet.</EmptyRow>
        ) : (
          <ul className="divide-y divide-border">
            {data.activity.slice(0, RECENT_ACTIVITY_LIMIT).map((item) => (
              <li key={item.id}>
                <Link
                  href={activityHref(item)}
                  className="flex items-start justify-between gap-4 px-4 py-2.5 hover:bg-surface-hover"
                >
                  <span className="min-w-0 text-sm text-fg">{item.summary ?? item.action}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">{timeAgo(item.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
