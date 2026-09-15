"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Client, NextPaymentObligation, Project, RevenueHostingPlan, Task } from "@/lib/api";
import { NEXT_PAYMENT_KIND_LABEL, relativeObligationLabel } from "@/lib/billing";
import { formatDate, formatMoney } from "@/lib/format";
import { HOSTING_STATUS_CLASS } from "@/components/billing/ClientBillingSection";
import type { ClientTone } from "@/lib/clients";

/**
 * One client's Overview-tab row data — shared by the table row, the
 * mobile card, and the quick-preview panel, so all three always read
 * from the exact same derived values (never three slightly different
 * summaries of the same client).
 */
export type EnrichedClient = {
  client: Client;
  tone: ClientTone;
  project: Project | null;
  activeProjects: number;
  liveProjects: Project[];
  /** Every one of this client's projects, for the preview panel's "linked projects" list — the table/card only ever show the live subset. */
  allProjects: Project[];
  nextTask: Task | null;
  lastActivity: string | null;
  hostingPlans: RevenueHostingPlan[];
  nextPayment: NextPaymentObligation | null;
  requiredOutstanding: number;
};

/** A small "N of them" dropdown, click-to-open — the same controlled-menu pattern as ClientHeader's ProjectPickerMenu, reused here for a row field with more than one website/plan to show without crowding the row. */
export function CountDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="text-fg underline decoration-dotted underline-offset-2 hover:decoration-solid"
      >
        {label}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            aria-hidden="true"
          />
          <span
            className="absolute left-0 z-20 mt-1 block w-56 rounded-md border border-border bg-surface py-1 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </span>
        </>
      )}
    </span>
  );
}

export function WebsitesField({ row }: { row: EnrichedClient }) {
  return (
    <span className="text-fg">
      {row.liveProjects.length === 0 ? (
        <span className="text-fg-subtle">0 live</span>
      ) : row.liveProjects.length === 1 ? (
        <Link href={`/dashboard/projects/${row.liveProjects[0].id}/website`} className="hover:underline">
          1 live
        </Link>
      ) : (
        <CountDisclosure label={`${row.liveProjects.length} live`}>
          {row.liveProjects.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/projects/${p.id}/website`}
              className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-fg hover:bg-surface-hover"
            >
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
        </CountDisclosure>
      )}
      {row.activeProjects > 0 && <span className="text-fg-subtle"> · {row.activeProjects} active</span>}
    </span>
  );
}

export function HostingField({ row, currency }: { row: EnrichedClient; currency: string }) {
  if (row.hostingPlans.length === 0) return <span className="text-fg-subtle">No hosting</span>;
  if (row.hostingPlans.length === 1) {
    const plan = row.hostingPlans[0];
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${HOSTING_STATUS_CLASS[plan.status]}`}>
          {plan.status}
        </span>
        {plan.status !== "cancelled" && (
          <span className="text-fg">{formatMoney(plan.monthly_fee_cents, currency)}/mo</span>
        )}
      </span>
    );
  }
  return (
    <CountDisclosure label={`${row.hostingPlans.length} plans`}>
      {row.hostingPlans.map((plan) => (
        <span key={plan.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-fg">
          <span className="truncate">{plan.project_name}</span>
          <span className="shrink-0 text-fg-muted">
            {plan.status} · {formatMoney(plan.monthly_fee_cents, currency)}/mo
          </span>
        </span>
      ))}
    </CountDisclosure>
  );
}

export function NextPaymentField({ row, currency }: { row: EnrichedClient; currency: string }) {
  if (!row.nextPayment) return <span className="text-fg-subtle">No payment scheduled</span>;
  const o = row.nextPayment;
  return (
    <Link
      href={`/dashboard/clients/${row.client.id}?tab=billing`}
      className={`block ${o.is_overdue ? "text-red-700 hover:underline dark:text-red-400" : "text-fg hover:underline"}`}
    >
      <span className="tabular-nums">{formatMoney(o.amount_cents, currency)}</span>
      {o.due_date && <span className="text-fg-subtle"> · {formatDate(o.due_date)}</span>}
      <span className={`block text-xs ${o.is_overdue ? "" : "text-fg-subtle"}`}>
        {NEXT_PAYMENT_KIND_LABEL[o.kind]} · {relativeObligationLabel(o)}
      </span>
    </Link>
  );
}

export function NextTaskField({ row }: { row: EnrichedClient }) {
  if (!row.project) {
    return <span className="text-fg-subtle">Start intake</span>;
  }
  if (!row.nextTask) {
    return <span className="text-fg-subtle">No open tasks</span>;
  }
  return (
    <Link href={`/dashboard/clients/${row.client.id}?tab=tasks`} className="block text-fg hover:underline">
      <span className="block truncate" title={row.nextTask.title}>
        {row.nextTask.title}
      </span>
      <span className="text-xs text-fg-subtle">{row.nextTask.assigned_user_name ?? "Unassigned"}</span>
    </Link>
  );
}
