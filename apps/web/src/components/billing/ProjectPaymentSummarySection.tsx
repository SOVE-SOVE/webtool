"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type ProjectPaymentSummary } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { RecordPaymentModal } from "./RecordPaymentModal";

const STATUS_LABEL: Record<ProjectPaymentSummary["status"], string> = {
  unconfigured: "Not configured",
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
  overpaid: "Overpaid",
};

const STATUS_CLASS: Record<ProjectPaymentSummary["status"], string> = {
  unconfigured: "bg-surface-subtle text-fg-subtle",
  unpaid: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  partially_paid: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  overpaid: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
};

/**
 * Compact payment summary on a Project's detail page — agreed price,
 * amount paid, balance remaining, status, and (only when the project
 * has a Client) a link to that Client's fuller Billing area. Works
 * identically for a prospect Project with no Client, per
 * docs/05_DECISIONS.md's "no automatic Lead → Client conversion" rule.
 */
export function ProjectPaymentSummarySection({ projectId, currency }: { projectId: string; currency: string }) {
  const [summary, setSummary] = useState<ProjectPaymentSummary | null>(null);
  const [showRecordPayment, setShowRecordPayment] = useState(false);

  function load() {
    api
      .getProjectPaymentSummary(projectId)
      .then(setSummary)
      .catch(() => setSummary(null));
  }

  useEffect(load, [projectId]);

  if (!summary) return null;

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Payment summary</h2>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[summary.status]}`}>
          {STATUS_LABEL[summary.status]}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-fg-muted">Agreed price</p>
          <p className="mt-0.5 font-medium tabular-nums text-fg">{formatMoney(summary.price_cents, currency)}</p>
        </div>
        <div>
          <p className="text-xs text-fg-muted">Amount paid</p>
          <p className="mt-0.5 font-medium tabular-nums text-fg">{formatMoney(summary.paid_cents, currency)}</p>
        </div>
        <div>
          <p className="text-xs text-fg-muted">Balance remaining</p>
          <p className="mt-0.5 font-medium tabular-nums text-fg">{formatMoney(summary.outstanding_cents, currency)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button onClick={() => setShowRecordPayment(true)} className="btn btn-secondary btn-sm">
          Record payment
        </button>
        {summary.client_id && (
          <Link href={`/dashboard/clients/${summary.client_id}?tab=billing`} className="text-fg-muted hover:underline">
            View in Client Billing →
          </Link>
        )}
      </div>

      {showRecordPayment && (
        <RecordPaymentModal
          projectId={projectId}
          agreement={summary.agreement}
          hostingPlans={summary.hosting_plans}
          currency={currency}
          onClose={() => setShowRecordPayment(false)}
          onSaved={() => {
            setShowRecordPayment(false);
            load();
          }}
        />
      )}
    </section>
  );
}
