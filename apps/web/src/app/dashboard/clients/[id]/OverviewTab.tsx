"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api,
  type ActivityItem,
  type ChecklistItem,
  type ClientBillingSummary,
  type ClientChecklist,
  type NextPaymentSummary,
  type Project,
  type Task,
} from "@/lib/api";
import { formatMoney, timeAgo } from "@/lib/format";
import { activityHref } from "@/lib/today";
import { clientNextAction } from "@/lib/clients";
import { deadlineStatus } from "@/lib/projects";
import { FINISHED_STAGES } from "@/lib/filters";
import { describeNextPayment } from "@/lib/billing";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { ThumbnailPlaceholder } from "@/components/ui/ThumbnailPlaceholder";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Panel, EmptyRow } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";

type Attention = { key: string; text: string; href: string };

function flattenChecklist(checklist: ClientChecklist): ChecklistItem[] {
  return [...checklist.client_items, ...checklist.projects.flatMap((p) => p.items)];
}

function combinedRequiredPct(checklist: ClientChecklist): number | null {
  const sections = [checklist.client_progress, ...checklist.projects.map((p) => p.progress)];
  let completed = 0;
  let total = 0;
  for (const s of sections) {
    completed += s.required.completed;
    total += s.required.total;
  }
  return total === 0 ? null : Math.round((completed / total) * 100);
}

export function OverviewTab({
  clientId,
  business,
  clientProjects,
  nextTask,
  activity,
  workspaceCurrency,
  onOpenTab,
}: {
  clientId: string;
  business: { suburb: string | null; state: string | null; website_url: string | null };
  clientProjects: Project[];
  nextTask: Task | null;
  activity: ActivityItem[];
  workspaceCurrency: string;
  onOpenTab: (tab: "tasks" | "projects" | "billing") => void;
}) {
  const [checklist, setChecklist] = useState<ClientChecklist | null>(null);
  const [billing, setBilling] = useState<ClientBillingSummary | null>(null);
  const [nextPayment, setNextPayment] = useState<NextPaymentSummary | null>(null);
  const [feedbackOpenCount, setFeedbackOpenCount] = useState(0);

  useEffect(() => {
    api.getClientChecklist(clientId).then(setChecklist).catch(() => {});
    api.getClientBillingSummary(clientId).then(setBilling).catch(() => {});
    api.getNextPaymentSummary(clientId).then(setNextPayment).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    Promise.allSettled(clientProjects.map((p) => api.listWebsiteFeedback(p.id))).then((results) => {
      const count = results.reduce(
        (sum, r) => sum + (r.status === "fulfilled" ? r.value.filter((f) => f.status === "open").length : 0),
        0,
      );
      setFeedbackOpenCount(count);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, clientProjects.length]);

  const activeProjects = clientProjects.filter((p) => !FINISHED_STAGES.includes(p.stage));
  const overviewProject = activeProjects[0] ?? clientProjects[0] ?? null;

  const topTasks = checklist
    ? flattenChecklist(checklist)
        .filter((item) => item.status === "pending" || item.status === "blocked")
        .sort((a, b) => {
          if (a.status === "blocked" && b.status !== "blocked") return -1;
          if (b.status === "blocked" && a.status !== "blocked") return 1;
          if (a.is_required !== b.is_required) return a.is_required ? -1 : 1;
          return a.order_index - b.order_index;
        })
        .slice(0, 3)
    : [];
  const combinedPct = checklist ? combinedRequiredPct(checklist) : null;

  const attention: Attention[] = [];
  if (checklist) {
    for (const item of flattenChecklist(checklist)) {
      if (item.status === "blocked" && item.is_required) {
        attention.push({
          key: `blocked-${item.id}`,
          text: `"${item.title}" is blocked${item.blocked_reason ? ` — ${item.blocked_reason}` : ""}`,
          href: "#tasks",
        });
      }
    }
  }
  if (nextPayment) {
    // Reuses the same server-computed obligations the Billing tab's
    // Next Payment panel shows — not a second, independently-derived
    // overdue calculation (agreements only covered website balances;
    // this also covers hosting charges).
    for (const o of nextPayment.overdue) {
      attention.push({
        key: `overdue-${o.website_agreement_id ?? o.hosting_charge_id ?? o.hosting_plan_id}`,
        text: `${o.project_name}: ${formatMoney(o.amount_cents, workspaceCurrency)} overdue since ${o.due_date}`,
        href: "#billing",
      });
    }
  }
  for (const project of activeProjects) {
    if (deadlineStatus(project.deadline) === "overdue") {
      attention.push({
        key: `deadline-${project.id}`,
        text: `${project.name}'s deadline has passed`,
        href: "#projects",
      });
    }
  }
  if (feedbackOpenCount > 0) {
    attention.push({
      key: "feedback",
      text: `${feedbackOpenCount} piece${feedbackOpenCount === 1 ? "" : "s"} of client feedback awaiting review`,
      href: "#projects",
    });
  }

  function attentionTab(href: string): "tasks" | "projects" | "billing" {
    if (href === "#tasks") return "tasks";
    if (href === "#billing") return "billing";
    return "projects";
  }

  const billingProjectsWithAgreement = billing?.projects.filter((p) => p.agreement !== null) ?? [];
  const hasAnyAgreement = billing !== null && billingProjectsWithAgreement.length > 0;
  const totalOutstanding = billingProjectsWithAgreement.reduce((sum, p) => sum + p.agreement_outstanding_cents, 0);
  const totalPaid = billingProjectsWithAgreement.reduce((sum, p) => sum + p.agreement_paid_cents, 0);
  const monthlyHostingTotal =
    billing?.projects
      .flatMap((p) => p.hosting_plans)
      .filter((plan) => plan.status === "active")
      .reduce((sum, plan) => sum + plan.monthly_fee_cents, 0) ?? 0;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
      <div className="flex min-w-0 flex-col gap-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-fg-muted">Next action</p>
          <p className="mt-1 text-sm text-fg">{clientNextAction(overviewProject, nextTask?.title ?? null)}</p>
        </div>

        <div>
          <h2 className="section-title">Active projects</h2>
          {activeProjects.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">No active projects.</p>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {activeProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/dashboard/projects/${project.id}`}
                  className="flex flex-col rounded-md border border-border bg-surface p-3 transition duration-[var(--duration-fast)] ease-standard hover:border-border-strong active:scale-[0.99] motion-reduce:transition-colors motion-reduce:active:scale-100"
                >
                  <ThumbnailPlaceholder label={project.name} />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-fg">{project.name}</span>
                    <ProjectStatusBadge project={project} className="shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h2 className="section-title">Tasks</h2>
            <button onClick={() => onOpenTab("tasks")} className="text-sm text-fg-muted hover:text-fg hover:underline">
              View all in Tasks →
            </button>
          </div>
          {!checklist ? (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ) : (
            <>
              {combinedPct !== null && <ProgressBar value={combinedPct} label={`${combinedPct}% required tasks complete`} />}
              {topTasks.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">No open tasks.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border border border-border">
                  {topTasks.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="truncate text-fg">{item.title}</span>
                      {item.status === "blocked" ? (
                        <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-500/15 dark:text-red-300">
                          Blocked
                        </span>
                      ) : !item.is_required ? (
                        <span className="shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 text-xs font-medium text-fg-muted">
                          Optional
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {attention.length > 0 && (
          <div>
            <h2 className="section-title">Needs attention</h2>
            <ul className="mt-2 space-y-1">
              {attention.map((a) => (
                <li key={a.key}>
                  <button
                    onClick={() => onOpenTab(attentionTab(a.href))}
                    className="text-left text-sm text-amber-800 hover:underline dark:text-amber-400"
                  >
                    {a.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <aside className="mt-6 flex flex-col gap-6 lg:mt-0 lg:self-start">
        <div>
          <h2 className="section-title">Contact</h2>
          <div className="mt-2 space-y-1 text-sm text-fg-muted">
            {(business.suburb || business.state) && <p>{[business.suburb, business.state].filter(Boolean).join(", ")}</p>}
            {business.website_url && (
              <a href={business.website_url} target="_blank" rel="noreferrer" className="block truncate text-fg hover:underline">
                {business.website_url}
              </a>
            )}
            {!business.suburb && !business.state && !business.website_url && <p>No details on file.</p>}
          </div>
        </div>

        <div>
          <h2 className="section-title">Billing</h2>
          {!billing ? (
            <Skeleton className="mt-2 h-10 w-full" />
          ) : !hasAnyAgreement ? (
            <button onClick={() => onOpenTab("billing")} className="mt-2 text-sm text-fg-muted hover:text-fg hover:underline">
              Set agreement →
            </button>
          ) : (
            <div className="mt-2 space-y-1 text-sm text-fg">
              <p>
                Website: {formatMoney(totalPaid, workspaceCurrency)} paid
                {totalOutstanding > 0 ? ` · ${formatMoney(totalOutstanding, workspaceCurrency)} outstanding` : ""}
              </p>
              {monthlyHostingTotal > 0 && <p>Hosting: {formatMoney(monthlyHostingTotal, workspaceCurrency)}/month</p>}
              <button onClick={() => onOpenTab("billing")} className="text-fg-muted hover:text-fg hover:underline">
                View billing →
              </button>
            </div>
          )}

          {nextPayment && (
            <button
              onClick={() => onOpenTab("billing")}
              className="mt-3 block w-full rounded-md border border-border px-2.5 py-2 text-left text-sm hover:border-border-strong"
            >
              {(() => {
                const display = describeNextPayment(nextPayment);
                const amount =
                  display.status === "overdue" || display.status === "upcoming"
                    ? formatMoney(
                        display.primary.reduce((sum, o) => sum + o.amount_cents, 0),
                        workspaceCurrency,
                      )
                    : display.status === "no_due_date"
                      ? formatMoney(nextPayment.no_due_date_cents, workspaceCurrency)
                      : null;
                return (
                  <>
                    <span className="text-xs uppercase tracking-wide text-fg-subtle">Next payment</span>
                    <span
                      className={`mt-0.5 block font-medium ${
                        display.status === "overdue" ? "text-red-700 dark:text-red-400" : "text-fg"
                      }`}
                    >
                      {display.headline}
                      {amount && ` — ${amount}`}
                    </span>
                  </>
                );
              })()}
            </button>
          )}
        </div>

        <Panel title="Recent activity" bodyClassName="max-h-72">
          {activity.length === 0 ? (
            <EmptyRow>No activity yet.</EmptyRow>
          ) : (
            <ul className="divide-y divide-border">
              {activity.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <Link
                    href={activityHref(item)}
                    className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                  >
                    <span className="min-w-0 truncate text-sm text-fg">{item.summary ?? item.action}</span>
                    <span className="shrink-0 text-xs text-fg-subtle">{timeAgo(item.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </aside>
    </div>
  );
}
