"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api,
  type DashboardOverview,
  type FollowUpBuckets,
  type SalesDashboard,
} from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatAud, timeAgo } from "@/lib/format";
import { loadOverview, peekOverview } from "@/lib/overview";

/** A labelled dashboard module: a heading plus a row of metric tiles. */
function Module({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="section-title">{title}</h2>
        {href && (
          <Link href={href} className="text-xs text-fg-muted hover:text-fg">
            {linkLabel ?? "Open"} →
          </Link>
        )}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ListCard({
  title,
  href,
  empty,
  loading,
  children,
}: {
  title: string;
  href: string;
  empty: boolean;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="section-title">{title}</h2>
        <Link href={href} className="text-xs text-fg-muted hover:text-fg">
          View all →
        </Link>
      </div>
      {loading ? (
        <div className="mt-2 divide-y divide-border rounded-md border border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-3 w-2/5" />
            </div>
          ))}
        </div>
      ) : empty ? (
        <p className="mt-2 text-sm text-fg-muted">Nothing here right now.</p>
      ) : (
        <div className="mt-2 max-h-72 overflow-y-auto overscroll-contain rounded-md border border-border">
          {children}
        </div>
      )}
    </section>
  );
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <MetricGrid>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border-border bg-surface px-4 py-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-6 w-12" />
        </div>
      ))}
    </MetricGrid>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<DashboardOverview | null>(peekOverview());
  const [sales, setSales] = useState<SalesDashboard | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpBuckets | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    loadOverview({ force: true })
      .then((d) => {
        setError(null);
        setData(d);
      })
      .catch(() => setError("Couldn't load dashboard data."));
    api.salesDashboard().then(setSales).catch(() => {});
    api.listFollowUps().then(setFollowUps).catch(() => {});
  }

  useEffect(load, []);

  const hotLeads = sales?.hot_leads ?? null;
  const recentWon = sales?.recent_won ?? null;
  const n = (v: number | null | undefined) => (v == null ? "—" : v);

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <PageHeader
        title="Overview"
        description="What's happening across the business right now."
      />

      {error && <ErrorState message={error} onRetry={load} compact />}

      <Module title="Leads" href="/dashboard/leads">
        {!data ? (
          <SkeletonGrid count={4} />
        ) : (
          <MetricGrid>
            <Metric label="Active leads" value={data.total_leads} href="/dashboard/leads" />
            <Metric label="New" value={n(sales?.new_leads_count)} href="/dashboard/leads?tab=new" />
            <Metric label="Qualified" value={data.qualified_leads} href="/dashboard/leads" />
            <Metric label="Contacted" value={data.contacted_leads} href="/dashboard/leads" />
          </MetricGrid>
        )}
      </Module>

      <Module title="Sales" href="/dashboard/sales">
        {!data ? (
          <SkeletonGrid count={4} />
        ) : (
          <MetricGrid>
            <Metric label="Hot leads" value={n(sales?.hot_leads_count)} href="/dashboard/sales" />
            <Metric
              label="In sales process"
              value={n(sales?.proposals_count)}
              hint="open proposals"
              href="/dashboard/sales"
            />
            <Metric
              label="Upcoming meetings"
              value={data.upcoming_meetings}
              href="/dashboard/calendar"
            />
            <Metric label="Won deals" value={data.won_projects} href="/dashboard/sales" />
          </MetricGrid>
        )}
      </Module>

      <Module title="Projects" href="/dashboard/projects">
        {!data ? (
          <SkeletonGrid count={3} />
        ) : (
          <MetricGrid>
            <Metric label="Active projects" value={data.active_projects} href="/dashboard/projects" />
            <Metric label="Being built" value={data.websites.building} href="/dashboard/projects" />
            <Metric label="In review / QA" value={data.websites.in_review} href="/dashboard/projects" />
          </MetricGrid>
        )}
      </Module>

      <Module title="Websites" href="/dashboard/projects">
        {!data ? (
          <SkeletonGrid count={3} />
        ) : (
          <MetricGrid>
            <Metric
              label="Ready to launch"
              value={data.websites.ready_to_launch}
              href="/dashboard/projects"
            />
            <Metric label="Deployed" value={data.websites.deployed} href="/dashboard/projects" />
            <Metric
              label="In maintenance"
              value={data.websites.maintenance}
              href="/dashboard/projects"
            />
          </MetricGrid>
        )}
      </Module>

      <Module title="Follow-ups" href="/dashboard/follow-ups">
        {!followUps ? (
          <SkeletonGrid count={3} />
        ) : (
          <MetricGrid>
            <Metric
              label="Overdue"
              value={followUps.overdue.length}
              href="/dashboard/follow-ups"
            />
            <Metric
              label="Due today"
              value={followUps.due_today.length}
              href="/dashboard/follow-ups"
            />
            <Metric
              label="Upcoming"
              value={followUps.upcoming.length}
              href="/dashboard/follow-ups"
            />
          </MetricGrid>
        )}
      </Module>

      <Module title="Revenue" href="/dashboard/sales">
        {!data ? (
          <SkeletonGrid count={2} />
        ) : (
          <MetricGrid>
            <Metric
              label="Revenue won"
              value={formatAud(data.revenue_cents)}
              hint="closed deals"
              href="/dashboard/sales"
            />
            <Metric
              label="Open pipeline"
              value={sales ? formatAud(sales.estimated_revenue_cents) : "—"}
              hint="open proposals"
              href="/dashboard/sales"
            />
          </MetricGrid>
        )}
      </Module>

      <div className="grid gap-8 lg:grid-cols-2">
        <ListCard
          title="Hot leads"
          href="/dashboard/leads"
          loading={hotLeads === null}
          empty={hotLeads !== null && hotLeads.length === 0}
        >
          <ul className="divide-y divide-border">
            {(hotLeads ?? []).map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">
                      {lead.business_name}
                    </span>
                    <span className="block truncate text-xs text-fg-muted">
                      {lead.status.replace("_", " ")} · {lead.priority} priority
                      {lead.score !== null ? ` · score ${lead.score}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    {lead.assigned_user_name ?? "Unassigned"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </ListCard>

        <ListCard
          title="Recent wins"
          href="/dashboard/sales"
          loading={recentWon === null}
          empty={recentWon !== null && recentWon.length === 0}
        >
          <ul className="divide-y divide-border">
            {(recentWon ?? []).map((deal) => (
              <li key={deal.lead_id}>
                <Link
                  href={`/dashboard/leads/${deal.lead_id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">
                      {deal.business_name}
                    </span>
                    <span className="block truncate text-xs text-fg-muted">
                      {deal.tier ?? "No tier on file"}
                      {deal.closed_at ? ` · ${timeAgo(deal.closed_at)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-fg">
                    {formatAud(deal.proposed_price_cents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </ListCard>
      </div>
    </div>
  );
}
