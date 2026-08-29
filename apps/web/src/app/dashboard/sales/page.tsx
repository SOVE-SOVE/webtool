"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type FollowUpBuckets, type SalesDashboard } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric } from "@/components/ui/Metric";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatAud, timeAgo } from "@/lib/format";

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

/** A compact module: title + optional right slot, then a fixed-height,
 *  internally-scrolling body so no single list stretches the page. */
function Panel({
  title,
  subtitle,
  right,
  children,
  bodyClassName = "max-h-80",
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-md border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {subtitle && <p className="truncate text-xs text-fg-muted">{subtitle}</p>}
        </div>
        {right && <div className="shrink-0 text-xs text-fg-muted">{right}</div>}
      </div>
      <div className={`overflow-y-auto overscroll-contain ${bodyClassName}`}>{children}</div>
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-fg-muted">{children}</p>;
}

function LeadRow({
  href,
  primary,
  secondary,
  right,
  rightTone,
}: {
  href: string;
  primary: string;
  secondary: string;
  right?: string;
  rightTone?: "danger" | "warn" | "muted";
}) {
  const toneCls =
    rightTone === "danger"
      ? "text-red-700 dark:text-red-400"
      : rightTone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "text-fg-muted";
  return (
    <Link href={href} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-fg">{primary}</span>
        <span className="block truncate text-xs text-fg-muted">{secondary}</span>
      </span>
      {right && <span className={`shrink-0 text-xs ${toneCls}`}>{right}</span>}
    </Link>
  );
}

const ACTIVITY_TABS = ["outreach", "proposals", "closed", "meetings"] as const;
type ActivityTab = (typeof ACTIVITY_TABS)[number];
const ACTIVITY_TAB_LABEL: Record<ActivityTab, string> = {
  outreach: "Outreach",
  proposals: "Proposals",
  closed: "Closed",
  meetings: "Meetings",
};

export default function SalesPage() {
  const [data, setData] = useState<SalesDashboard | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpBuckets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activityTab, setActivityTab] = useState<ActivityTab>("outreach");

  function load() {
    api
      .salesDashboard()
      .then((d) => {
        setError(null);
        setData(d);
      })
      .catch(() => setError("Couldn't load the sales dashboard."));
    api.listFollowUps().then(setFollowUps).catch(() => {});
  }

  useEffect(load, []);

  const meetingFmt = (iso: string) =>
    new Date(iso).toLocaleString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Sales"
        description="Who to contact and what to do next to make a sale."
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

      {!data && !error && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-md border border-border bg-surface px-4 py-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-12" />
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Hot leads" value={data.hot_leads_count} href="/dashboard/leads" />
            <Metric label="Follow-ups due" value={data.needs_follow_up_count} href="/dashboard/follow-ups" />
            <Metric label="Proposals out" value={data.proposals_count} />
            <Metric label="Potential value" value={formatAud(data.estimated_revenue_cents)} hint="open proposals" />
            <Metric label="Won deals" value={data.won_deals_count} hint={`${pct(data.conversion_rate_pct)} win rate`} />
            <Metric label="Revenue won" value={formatAud(data.actual_revenue_cents)} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel
              title="Hot leads"
              subtitle="High priority or a strongly fixable site — chase these first."
              right={<Link href="/dashboard/leads" className="hover:text-fg">Open in Leads →</Link>}
            >
              {data.hot_leads.length === 0 ? (
                <EmptyRow>No hot leads right now.</EmptyRow>
              ) : (
                <ul className="divide-y divide-border">
                  {data.hot_leads.map((lead) => {
                    const fu =
                      followUps &&
                      [...followUps.overdue, ...followUps.due_today].find((f) => f.lead_id === lead.id);
                    return (
                      <li key={lead.id}>
                        <LeadRow
                          href={`/dashboard/leads/${lead.id}`}
                          primary={lead.business_name}
                          secondary={`${lead.status.replace("_", " ")} · ${lead.priority} priority${
                            lead.score !== null ? ` · score ${lead.score}` : ""
                          }`}
                          right={fu ? "Follow up" : (lead.assigned_user_name ?? "Unassigned")}
                          rightTone={fu ? "warn" : "muted"}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              title="Needs follow-up"
              subtitle="Overdue first, then due today, then coming up."
              right={<Link href="/dashboard/follow-ups" className="hover:text-fg">All follow-ups →</Link>}
            >
              {!followUps ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="px-4 py-3">
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  ))}
                </div>
              ) : followUps.overdue.length + followUps.due_today.length + followUps.upcoming.length === 0 ? (
                <EmptyRow>Nothing&apos;s gone quiet — you&apos;re caught up.</EmptyRow>
              ) : (
                <ul className="divide-y divide-border">
                  {followUps.overdue.map((f) => (
                    <li key={f.id}>
                      <LeadRow
                        href={`/dashboard/leads/${f.lead_id}`}
                        primary={f.business_name}
                        secondary={f.suggested_next_action}
                        right="Overdue"
                        rightTone="danger"
                      />
                    </li>
                  ))}
                  {followUps.due_today.map((f) => (
                    <li key={f.id}>
                      <LeadRow
                        href={`/dashboard/leads/${f.lead_id}`}
                        primary={f.business_name}
                        secondary={f.suggested_next_action}
                        right="Due today"
                        rightTone="warn"
                      />
                    </li>
                  ))}
                  {followUps.upcoming.map((f) => (
                    <li key={f.id}>
                      <LeadRow
                        href={`/dashboard/leads/${f.lead_id}`}
                        primary={f.business_name}
                        secondary={f.suggested_next_action}
                        right={new Date(f.due_date).toLocaleDateString()}
                        rightTone="muted"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel
            title="Recent sales activity"
            subtitle={`${data.outreach_activity.sent_last_7_days} sent · ${data.outreach_activity.replied_last_7_days} replied in the last 7 days${
              data.outreach_activity.reply_rate_pct !== null
                ? ` · ${pct(data.outreach_activity.reply_rate_pct)} reply rate`
                : ""
            }`}
            bodyClassName="max-h-72"
            right={
              <div className="flex gap-1">
                {ACTIVITY_TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setActivityTab(t)}
                    className={`rounded px-2 py-0.5 ${
                      activityTab === t ? "bg-accent text-accent-fg" : "hover:text-fg"
                    }`}
                  >
                    {ACTIVITY_TAB_LABEL[t]}
                  </button>
                ))}
              </div>
            }
          >
            {activityTab === "outreach" &&
              (data.outreach_activity.recent.length === 0 ? (
                <EmptyRow>No outreach in the last 7 days.</EmptyRow>
              ) : (
                <ul className="divide-y divide-border">
                  {data.outreach_activity.recent.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0 text-sm text-fg-muted">
                        <Link href={`/dashboard/leads/${item.lead_id}`} className="font-medium text-fg hover:underline">
                          {item.business_name}
                        </Link>{" "}
                        {item.kind === "sent" ? "— outreach sent" : "— they replied"}
                        {item.summary ? <span> — {item.summary}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs text-fg-subtle">{timeAgo(item.occurred_at)}</span>
                    </li>
                  ))}
                </ul>
              ))}

            {activityTab === "proposals" &&
              (data.proposals.length === 0 ? (
                <EmptyRow>No proposals waiting on a decision.</EmptyRow>
              ) : (
                <ul className="divide-y divide-border">
                  {data.proposals.map((p) => (
                    <li key={p.lead_id}>
                      <LeadRow
                        href={`/dashboard/leads/${p.lead_id}`}
                        primary={p.business_name}
                        secondary={`${p.tier ?? "No tier on file"} · out since ${new Date(p.since).toLocaleDateString()}`}
                        right={formatAud(p.proposed_price_cents)}
                      />
                    </li>
                  ))}
                </ul>
              ))}

            {activityTab === "closed" &&
              (data.recent_won.length + data.recent_lost.length === 0 ? (
                <EmptyRow>No deals closed recently.</EmptyRow>
              ) : (
                <ul className="divide-y divide-border">
                  {[
                    ...data.recent_won.map((d) => ({ ...d, won: true })),
                    ...data.recent_lost.map((d) => ({ ...d, won: false })),
                  ]
                    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""))
                    .map((d) => (
                      <li key={`${d.won ? "w" : "l"}-${d.lead_id}`}>
                        <Link
                          href={`/dashboard/leads/${d.lead_id}`}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                        >
                          <span className="min-w-0">
                            <span className="text-sm font-medium text-fg">{d.business_name}</span>
                            <span className="ml-2 text-xs text-fg-muted">
                              {d.tier ?? "No tier"}
                              {d.closed_at ? ` · ${timeAgo(d.closed_at)}` : ""}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-xs">
                            <span
                              className={`rounded px-1.5 py-0.5 font-medium ${
                                d.won
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                                  : "bg-surface-subtle text-fg-muted"
                              }`}
                            >
                              {d.won ? "Won" : "Lost"}
                            </span>
                            <span className="text-fg-muted">{formatAud(d.proposed_price_cents)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                </ul>
              ))}

            {activityTab === "meetings" &&
              (data.upcoming_meetings.length === 0 ? (
                <EmptyRow>No sales calls on the books.</EmptyRow>
              ) : (
                <ul className="divide-y divide-border">
                  {data.upcoming_meetings.map((m) => (
                    <li key={m.id}>
                      <LeadRow
                        href="/dashboard/calendar"
                        primary={m.business_name}
                        secondary={m.title}
                        right={meetingFmt(m.scheduled_at)}
                      />
                    </li>
                  ))}
                </ul>
              ))}
          </Panel>
        </>
      )}
    </div>
  );
}
