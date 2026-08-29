"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type SalesDashboard } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatAud, timeAgo } from "@/lib/format";

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

function Section({
  title,
  subtitle,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>}
      {empty ? <p className="mt-2 text-sm text-fg-muted">Nothing here right now.</p> : <div className="mt-2">{children}</div>}
    </section>
  );
}

function Row({ href, primary, secondary, right }: { href: string; primary: string; secondary: string; right?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-surface-hover">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{primary}</span>
          <span className="block truncate text-xs text-fg-muted">{secondary}</span>
        </span>
        {right && <span className="shrink-0 text-xs text-fg-muted">{right}</span>}
      </Link>
    </li>
  );
}

export default function SalesCommandCentrePage() {
  const [data, setData] = useState<SalesDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .salesDashboard()
      .then((d) => {
        setError(null);
        setData(d);
      })
      .catch(() => setError("Couldn't load the sales dashboard."));
  }

  useEffect(load, []);

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <PageHeader
        title="Sales"
        description="Find → qualify → contact → follow up → book → close — everything that needs to happen today, in one place."
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
            <Metric label="New leads" value={data.new_leads_count} />
            <Metric label="Hot leads" value={data.hot_leads_count} />
            <Metric label="Need follow-up" value={data.needs_follow_up_count} />
            <Metric label="Upcoming meetings" value={data.upcoming_meetings_count} />
            <Metric label="Proposals out" value={data.proposals_count} />
            <Metric label="Won deals" value={data.won_deals_count} />
            <Metric label="Lost deals" value={data.lost_deals_count} />
            <Metric label="Win rate" value={pct(data.conversion_rate_pct)} hint="of decided deals" />
            <Metric label="Estimated revenue" value={formatAud(data.estimated_revenue_cents)} hint="open proposals" />
            <Metric label="Actual revenue" value={formatAud(data.actual_revenue_cents)} hint="won deals" />
          </MetricGrid>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <Section title="Hot leads" subtitle="High priority or a strongly fixable website — pursue these first." empty={data.hot_leads.length === 0}>
              <ul className="divide-y divide-border rounded-md border border-border">
                {data.hot_leads.map((lead) => (
                  <Row
                    key={lead.id}
                    href={`/dashboard/leads/${lead.id}`}
                    primary={lead.business_name}
                    secondary={`${lead.status} · ${lead.priority} priority${lead.score !== null ? ` · score ${lead.score}` : ""}`}
                    right={lead.assigned_user_name ?? "Unassigned"}
                  />
                ))}
              </ul>
            </Section>

            <Section title="Needs follow-up" subtitle="Due today or overdue." empty={data.needs_follow_up.length === 0}>
              <ul className="divide-y divide-border rounded-md border border-border">
                {data.needs_follow_up.map((f) => (
                  <Row
                    key={f.lead_id}
                    href={`/dashboard/leads/${f.lead_id}`}
                    primary={f.business_name}
                    secondary={f.suggested_next_action}
                    right={f.overdue ? "Overdue" : "Due today"}
                  />
                ))}
              </ul>
            </Section>

            <Section title="Upcoming meetings" subtitle="Sales calls on the books." empty={data.upcoming_meetings.length === 0}>
              <ul className="divide-y divide-border rounded-md border border-border">
                {data.upcoming_meetings.map((m) => (
                  <Row
                    key={m.id}
                    href="/dashboard/calendar"
                    primary={m.business_name}
                    secondary={m.title}
                    right={new Date(m.scheduled_at).toLocaleString("en-AU", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  />
                ))}
              </ul>
            </Section>

            <Section title="Proposals out" subtitle="Waiting on a decision." empty={data.proposals.length === 0}>
              <ul className="divide-y divide-border rounded-md border border-border">
                {data.proposals.map((p) => (
                  <Row
                    key={p.lead_id}
                    href={`/dashboard/leads/${p.lead_id}`}
                    primary={p.business_name}
                    secondary={p.tier ?? "No tier on file"}
                    right={formatAud(p.proposed_price_cents)}
                  />
                ))}
              </ul>
            </Section>

            <Section title="Recently won" empty={data.recent_won.length === 0}>
              <ul className="divide-y divide-border rounded-md border border-border">
                {data.recent_won.map((d) => (
                  <Row
                    key={d.lead_id}
                    href={`/dashboard/leads/${d.lead_id}`}
                    primary={d.business_name}
                    secondary={d.tier ?? "No tier on file"}
                    right={formatAud(d.proposed_price_cents)}
                  />
                ))}
              </ul>
            </Section>

            <Section title="Recently lost" empty={data.recent_lost.length === 0}>
              <ul className="divide-y divide-border rounded-md border border-border">
                {data.recent_lost.map((d) => (
                  <Row
                    key={d.lead_id}
                    href={`/dashboard/leads/${d.lead_id}`}
                    primary={d.business_name}
                    secondary={d.tier ?? "No tier on file"}
                    right={formatAud(d.proposed_price_cents)}
                  />
                ))}
              </ul>
            </Section>
          </div>

          <Section
            title="Outreach activity"
            subtitle={`${data.outreach_activity.sent_last_7_days} sent / ${data.outreach_activity.replied_last_7_days} replied in the last 7 days${
              data.outreach_activity.reply_rate_pct !== null ? ` — ${pct(data.outreach_activity.reply_rate_pct)} reply rate` : ""
            }`}
            empty={data.outreach_activity.recent.length === 0}
          >
            <ul className="divide-y divide-border rounded-md border border-border">
              {data.outreach_activity.recent.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 text-sm text-fg-muted">
                    <span className="font-medium text-fg">{item.business_name}</span>{" "}
                    {item.kind === "sent" ? "— outreach sent" : "— they replied"}
                    {item.summary ? <span className="text-fg-muted"> — {item.summary}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-fg-subtle">{timeAgo(item.occurred_at)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
