"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type AttentionItem, type SalesDashboard } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function money(cents: number | null): string {
  return cents === null ? "—" : currency.format(cents / 100);
}

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="border border-border p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

// Colour carries the same ranking the API sorted the queue by, so the
// top of the list reads as "this is on fire" at a glance — same
// convention as the Overview page's BADGE_CLASS.
const BADGE_CLASS: Record<AttentionItem["kind"], string> = {
  follow_up: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  meeting: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  hot_lead: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  stale_proposal: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  new_lead: "bg-surface-subtle text-fg-muted",
  task: "bg-surface-subtle text-fg-muted",
  stale_lead: "bg-surface-subtle text-fg-muted",
  project: "bg-surface-subtle text-fg-muted",
};

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
      <Link href={href} className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-surface-subtle">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{primary}</span>
          <span className="block truncate text-xs text-fg-muted">{secondary}</span>
        </span>
        {right && <span className="shrink-0 text-xs text-fg-muted">{right}</span>}
      </Link>
    </li>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
    <div className="p-6">
      <h1 className="text-lg font-semibold text-fg">Sales command centre</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Find → qualify → contact → follow up → book → close — everything that needs to happen today, in one place.
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
                {data.do_this_next.length === 0 ? "All clear" : `${data.do_this_next.length} open — most urgent first`}
              </span>
            </div>
            {data.do_this_next.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">
                Nothing urgent. Go find some new leads, or push a hot one forward.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border border border-border">
                {data.do_this_next.map((item) => (
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
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[item.kind]}`}>
                        {item.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricTile label="New leads" value={data.new_leads_count} />
            <MetricTile label="Hot leads" value={data.hot_leads_count} />
            <MetricTile label="Need follow-up" value={data.needs_follow_up_count} />
            <MetricTile label="Upcoming meetings" value={data.upcoming_meetings_count} />
            <MetricTile label="Proposals out" value={data.proposals_count} />
            <MetricTile label="Won deals" value={data.won_deals_count} />
            <MetricTile label="Lost deals" value={data.lost_deals_count} />
            <MetricTile label="Win rate" value={pct(data.conversion_rate_pct)} hint="of decided deals" />
            <MetricTile label="Estimated revenue" value={money(data.estimated_revenue_cents)} hint="open proposals" />
            <MetricTile label="Actual revenue" value={money(data.actual_revenue_cents)} hint="won deals" />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <Section title="Hot leads" subtitle="High priority or a strongly fixable website — pursue these first." empty={data.hot_leads.length === 0}>
              <ul className="divide-y divide-border border border-border">
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
              <ul className="divide-y divide-border border border-border">
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
              <ul className="divide-y divide-border border border-border">
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
              <ul className="divide-y divide-border border border-border">
                {data.proposals.map((p) => (
                  <Row
                    key={p.lead_id}
                    href={`/dashboard/leads/${p.lead_id}`}
                    primary={p.business_name}
                    secondary={p.tier ?? "No tier on file"}
                    right={money(p.proposed_price_cents)}
                  />
                ))}
              </ul>
            </Section>

            <Section title="Recently won" empty={data.recent_won.length === 0}>
              <ul className="divide-y divide-border border border-border">
                {data.recent_won.map((d) => (
                  <Row
                    key={d.lead_id}
                    href={`/dashboard/leads/${d.lead_id}`}
                    primary={d.business_name}
                    secondary={d.tier ?? "No tier on file"}
                    right={money(d.proposed_price_cents)}
                  />
                ))}
              </ul>
            </Section>

            <Section title="Recently lost" empty={data.recent_lost.length === 0}>
              <ul className="divide-y divide-border border border-border">
                {data.recent_lost.map((d) => (
                  <Row
                    key={d.lead_id}
                    href={`/dashboard/leads/${d.lead_id}`}
                    primary={d.business_name}
                    secondary={d.tier ?? "No tier on file"}
                    right={money(d.proposed_price_cents)}
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
            <ul className="divide-y divide-border border border-border">
              {data.outreach_activity.recent.map((item) => (
                <li key={item.id} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-fg-muted">
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
