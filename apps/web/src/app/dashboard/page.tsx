"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type ActivityItem, type DashboardOverview, type SalesDashboard } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { NavIcon } from "@/components/ui/Icons";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import type { IconName } from "@/lib/nav";
import { formatAud, timeAgo } from "@/lib/format";
import { loadOverview, peekOverview } from "@/lib/overview";

const ACTIVITY_VERB: Record<string, string> = {
  created: "created",
  stage_changed: "moved the stage of",
  assigned: "reassigned",
  completed: "completed",
  reopened: "reopened",
  status_changed: "changed the status of",
  project_delivered: "delivered",
};

// Existing routes only — nothing here creates a new flow. `?new=1` is
// read by the Leads and Projects pages to open their create form.
const QUICK_ACTIONS: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard/leads?new=1", label: "Add lead", icon: "leads" },
  { href: "/dashboard/discovery", label: "Find leads", icon: "discovery" },
  { href: "/dashboard/review", label: "Run website audit", icon: "review" },
  { href: "/dashboard/projects?new=1", label: "Create project", icon: "projects" },
  { href: "/dashboard/follow-ups", label: "View follow-ups", icon: "followups" },
];

function ListCard({
  title,
  href,
  linkLabel,
  empty,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="section-title">{title}</h2>
        {href && (
          <Link href={href} className="text-xs text-fg-muted hover:text-fg">
            {linkLabel ?? "View all"} →
          </Link>
        )}
      </div>
      {empty ? (
        <p className="mt-2 text-sm text-fg-muted">Nothing here right now.</p>
      ) : (
        <div className="mt-2 max-h-72 overflow-y-auto overscroll-contain rounded-md border border-border">
          {children}
        </div>
      )}
    </section>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<DashboardOverview | null>(peekOverview());
  const [sales, setSales] = useState<SalesDashboard | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    loadOverview({ force: true })
      .then((d) => {
        setError(null);
        setData(d);
      })
      .catch(() => setError("Couldn't load dashboard data."));
    api.salesDashboard().then(setSales).catch(() => {});
    api.listActivity().then(setActivity).catch(() => {});
  }

  useEffect(load, []);

  const metricsReady = data !== null;
  // The API always includes these, but a central page shouldn't blank
  // itself over a malformed payload — fall back to an empty list.
  const hotLeads = sales ? sales.hot_leads ?? [] : null;
  const recentWon = sales ? sales.recent_won ?? [] : null;

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <PageHeader
        title="Overview"
        description="Your command centre — what to know and what to do right now."
        actions={
          <>
            <Link href="/dashboard/leads?new=1" className="btn btn-primary">
              Add lead
            </Link>
            <Link href="/dashboard/discovery" className="btn btn-secondary">
              Find leads
            </Link>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={load} compact />}

      {/* 1. Summary — top */}
      {!metricsReady && !error ? (
        <MetricGrid>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-md border border-border bg-surface px-4 py-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-12" />
            </div>
          ))}
        </MetricGrid>
      ) : (
        data && (
          <MetricGrid>
            <Metric label="Active leads" value={data.total_leads} href="/dashboard/leads" />
            <Metric label="Qualified" value={data.qualified_leads} href="/dashboard/leads" />
            <Metric label="Contacted" value={data.contacted_leads} href="/dashboard/leads" />
            <Metric
              label="Hot leads"
              value={sales ? sales.hot_leads_count : "—"}
              href="/dashboard/leads"
            />
            <Metric label="Follow-ups due" value={data.follow_ups_due} href="/dashboard/follow-ups" />
            <Metric label="Upcoming meetings" value={data.upcoming_meetings} href="/dashboard/calendar" />
            <Metric label="Active projects" value={data.active_projects} href="/dashboard/projects" />
            <Metric label="Won deals" value={data.won_projects} href="/dashboard/sales" />
            <Metric
              label="Pipeline value"
              value={sales ? formatAud(sales.estimated_revenue_cents) : "—"}
              hint="open proposals"
              href="/dashboard/sales"
            />
            <Metric
              label="Revenue won"
              value={formatAud(data.revenue_cents)}
              hint="closed deals"
              href="/dashboard/sales"
            />
          </MetricGrid>
        )
      )}

      {/* 2. Quick actions */}
      <section>
        <h2 className="section-title">Quick actions</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.label}
              href={a.href}
              className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg hover:bg-surface-hover"
            >
              <NavIcon name={a.icon} className="h-4 w-4 text-fg-muted" />
              {a.label}
            </Link>
          ))}
        </div>
      </section>

      {/* 3. What's happening */}
      <div className="grid gap-8 lg:grid-cols-2">
        <ListCard
          title="Hot leads"
          href="/dashboard/leads"
          empty={hotLeads !== null && hotLeads.length === 0}
        >
          {hotLeads === null ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-4 py-3">
                  <Skeleton className="h-3 w-2/5" />
                </div>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {hotLeads.map((lead) => (
                <li key={lead.id}>
                  <Link
                    href={`/dashboard/leads/${lead.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{lead.business_name}</span>
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
          )}
        </ListCard>

        <ListCard
          title="Recent wins"
          href="/dashboard/sales"
          empty={recentWon !== null && recentWon.length === 0}
        >
          {recentWon === null ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-4 py-3">
                  <Skeleton className="h-3 w-2/5" />
                </div>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentWon.map((deal) => (
                <li key={deal.lead_id}>
                  <Link
                    href={`/dashboard/leads/${deal.lead_id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{deal.business_name}</span>
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
          )}
        </ListCard>
      </div>

      <ListCard title="Recent activity" empty={activity !== null && activity.length === 0}>
        {activity === null ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-2.5">
                <Skeleton className="h-3 w-3/5" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activity.slice(0, 12).map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 text-sm text-fg-muted">
                  <span className="font-medium text-fg">{item.user_name ?? "Someone"}</span>{" "}
                  {ACTIVITY_VERB[item.action] ?? item.action} {item.entity_type}
                  {item.summary ? <span> — {item.summary}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-fg-subtle">{timeAgo(item.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </ListCard>
    </div>
  );
}
