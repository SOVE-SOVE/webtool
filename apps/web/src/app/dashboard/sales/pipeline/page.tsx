"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type FollowUpBuckets, type SalesDashboard } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric } from "@/components/ui/Metric";
import { EmptyRow, ItemRow, Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { TabBar } from "@/components/ui/Tabs";
import { formatAud, timeAgo } from "@/lib/format";

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

const ACTIVITY_TABS = ["outreach", "proposals", "closed", "meetings"] as const;
type ActivityTab = (typeof ACTIVITY_TABS)[number];
const ACTIVITY_TAB_LABEL: Record<ActivityTab, string> = {
  outreach: "Outreach",
  proposals: "Proposals",
  closed: "Closed",
  meetings: "Meetings",
};

/**
 * "Sales Pipeline" — the funnel/activity dashboard that used to be the
 * standalone /dashboard/sales page (moved here verbatim, see
 * docs/07_SESSION_LOG.md). No page-level title of its own — the shared
 * Sales workspace header (dashboard/sales/layout.tsx) already says
 * "Sales" and hosts the Leads/Sales Pipeline/Follow-ups switch; "Add
 * lead"/"Find leads" (this view's own primary actions) sit in their own
 * small row here instead of a PageHeader actions slot.
 */
export default function SalesPipelinePage() {
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/dashboard/sales/leads?new=1" className="btn btn-primary">
          Add lead
        </Link>
        <Link href="/dashboard/discovery" className="btn btn-secondary">
          Find leads
        </Link>
      </div>

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
        <div className="content-reveal space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Hot leads" value={data.hot_leads_count} href="/dashboard/sales/leads" />
            <Metric label="Follow-ups due" value={data.needs_follow_up_count} href="/dashboard/sales/follow-ups" />
            <Metric label="Proposals out" value={data.proposals_count} />
            <Metric label="Potential value" value={formatAud(data.estimated_revenue_cents)} hint="open proposals" />
            <Metric label="Won deals" value={data.won_deals_count} hint={`${pct(data.conversion_rate_pct)} win rate`} />
            <Metric label="Revenue won" value={formatAud(data.actual_revenue_cents)} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel
              title="Hot leads"
              subtitle="High priority or a strongly fixable site — chase these first."
              right={
                <Link
                  href="/dashboard/sales/leads"
                  className="rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  Open in Leads →
                </Link>
              }
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
                        <ItemRow
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
              right={
                <Link
                  href="/dashboard/sales/follow-ups"
                  className="rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  All follow-ups →
                </Link>
              }
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
                      <ItemRow
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
                      <ItemRow
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
                      <ItemRow
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
            swapKey={activityTab}
            subtitle={`${data.outreach_activity.sent_last_7_days} sent · ${data.outreach_activity.replied_last_7_days} replied in the last 7 days${
              data.outreach_activity.reply_rate_pct !== null
                ? ` · ${pct(data.outreach_activity.reply_rate_pct)} reply rate`
                : ""
            }`}
            bodyClassName="max-h-72"
            right={
              <TabBar
                className="border-b-0"
                ariaLabel="Activity view"
                tabs={ACTIVITY_TABS.map((t) => ({ id: t, label: ACTIVITY_TAB_LABEL[t] }))}
                active={activityTab}
                onChange={(id) => setActivityTab(id as ActivityTab)}
              />
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
                      <ItemRow
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
                            <Badge tone={d.won ? "success" : "muted"}>{d.won ? "Won" : "Lost"}</Badge>
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
                      <ItemRow
                        href="/dashboard?tab=calendar"
                        primary={m.business_name}
                        secondary={m.title}
                        right={meetingFmt(m.scheduled_at)}
                      />
                    </li>
                  ))}
                </ul>
              ))}
          </Panel>
        </div>
      )}
    </div>
  );
}
