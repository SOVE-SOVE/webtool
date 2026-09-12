"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type ActivityItem, type Lead, type PlanningListItem, type Project } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { timeAgo } from "@/lib/format";
import { activityHref, computeNextActions, computePipelineStages } from "@/lib/today";

const RECENT_ACTIVITY_LIMIT = 8;

type TodayData = {
  leads: Lead[];
  planning: PlanningListItem[];
  reviewQueueCount: number;
  projects: Project[];
  activity: ActivityItem[];
};

function NextActionsSkeleton() {
  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="px-4 py-3">
          <Skeleton className="h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

function PipelineSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-md border border-border bg-surface px-3 py-3">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="mt-2 h-6 w-8" />
        </div>
      ))}
    </div>
  );
}

export default function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    Promise.all([
      api.listLeads(),
      api.listPlanning(),
      api.listReviewItems(),
      api.listProjects(),
      api.listActivity(),
    ])
      .then(([leads, planning, reviewItems, projects, activity]) => {
        setError(null);
        setData({
          leads,
          planning,
          reviewQueueCount: reviewItems.filter(
            (item) => item.status !== "imported" && item.status !== "rejected" && item.status !== "archived",
          ).length,
          projects,
          activity,
        });
      })
      .catch(() => setError("Couldn't load today's workspace."));
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

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <PageHeader title="Today" description="What to do next, and where the work stands." />

      {error && <ErrorState message={error} onRetry={load} compact />}

      {/* 1. Next Actions — the actual to-do list, ranked by where each item sits in the workflow. */}
      <section>
        <h2 className="section-title">Next actions</h2>
        {!nextActions ? (
          <div className="mt-2">
            <NextActionsSkeleton />
          </div>
        ) : nextActions.length === 0 ? (
          <div className="mt-2 rounded-md border border-border px-4 py-6">
            <p className="text-sm text-fg">Nothing needs your attention right now.</p>
            <p className="mt-1 text-sm text-fg-muted">
              Good time to{" "}
              <Link href="/dashboard/discovery" className="font-medium text-fg hover:underline">
                open Map Discovery
              </Link>{" "}
              and find the next lead.
            </p>
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

      {/* 2. Pipeline — a plain, non-decorative view of real counts at each stage. */}
      <section>
        <h2 className="section-title">Pipeline</h2>
        {!pipeline ? (
          <div className="mt-2">
            <PipelineSkeleton />
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {pipeline.map((stage, i) => (
              <div key={stage.id} className="relative">
                <Link
                  href={stage.href}
                  className="block rounded-md border border-border bg-surface px-3 py-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  <p className="text-xs text-fg-muted">{stage.label}</p>
                  {stage.empty ? (
                    <p className="mt-1.5 text-xs font-medium text-fg-subtle">{stage.empty.label} →</p>
                  ) : (
                    <p className="mt-0.5 text-2xl font-semibold tabular-nums text-fg">{stage.count}</p>
                  )}
                </Link>
                {i < pipeline.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-fg-subtle sm:block"
                  >
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. Recent Activity — the workspace-wide activity log, reused as-is. */}
      <section>
        <h2 className="section-title">Recent activity</h2>
        {!data ? (
          <div className="mt-2 divide-y divide-border rounded-md border border-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-3 w-3/5" />
              </div>
            ))}
          </div>
        ) : data.activity.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">Nothing has happened yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
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
      </section>
    </div>
  );
}
