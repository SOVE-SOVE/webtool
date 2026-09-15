"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type HostingPlan, type NextPaymentObligation, type WebsiteAgreement } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { NEXT_PAYMENT_KIND_LABEL, groupObligations, relativeObligationLabel } from "@/lib/billing";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { RecordPaymentModal } from "@/components/billing/RecordPaymentModal";

function ObligationRow({
  o,
  currency,
  onRecordPayment,
}: {
  o: NextPaymentObligation;
  currency: string;
  onRecordPayment: (o: NextPaymentObligation) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium text-fg">
          {o.client_id ? (
            <Link href={`/dashboard/clients/${o.client_id}`} className="hover:underline">
              {o.client_business_name ?? "Client"}
            </Link>
          ) : (
            <span className="font-normal text-fg-subtle">No client (prospect)</span>
          )}
          <span className="font-normal text-fg-muted"> · </span>
          <Link href={`/dashboard/projects/${o.project_id}`} className="font-normal hover:underline">
            {o.project_name}
          </Link>
        </p>
        <p className={`truncate text-xs ${o.is_overdue ? "text-red-700 dark:text-red-400" : "text-fg-muted"}`}>
          {NEXT_PAYMENT_KIND_LABEL[o.kind]}
          {o.due_date && ` · ${formatDate(o.due_date)}`} · {relativeObligationLabel(o)}
          {o.scheduled && " · Scheduled"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="tabular-nums text-fg">{formatMoney(o.amount_cents, currency)}</span>
        {!o.scheduled && (
          <button onClick={() => onRecordPayment(o)} className="btn btn-secondary btn-sm">
            Record payment
          </button>
        )}
      </div>
    </li>
  );
}

function Section({
  title,
  tone,
  obligations,
  currency,
  onRecordPayment,
}: {
  title: string;
  tone: "overdue" | "default";
  obligations: NextPaymentObligation[];
  currency: string;
  onRecordPayment: (o: NextPaymentObligation) => void;
}) {
  if (obligations.length === 0) return null;
  return (
    <div
      className={`mt-4 rounded-md border border-border ${
        tone === "overdue" ? "border-l-2 border-l-red-500" : ""
      }`}
    >
      <p
        className={`px-3 pt-2 text-xs font-medium uppercase tracking-wide ${
          tone === "overdue" ? "text-red-700 dark:text-red-400" : "text-fg-subtle"
        }`}
      >
        {title}
      </p>
      <ul className="divide-y divide-border">
        {obligations.map((o) => (
          <ObligationRow
            key={`${o.website_agreement_id ?? ""}${o.hosting_charge_id ?? ""}${o.hosting_plan_id ?? ""}${o.scheduled}`}
            o={o}
            currency={currency}
            onRecordPayment={onRecordPayment}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Every unpaid obligation across the whole workspace, overdue first —
 * the workspace-wide sibling of the Client detail page's per-client
 * NextPaymentPanel, grouped into the periods the spec calls for rather
 * than only the single earliest one.
 */
export function UpcomingOverdueTab({
  currency,
  dataVersion,
  onChanged,
}: {
  currency: string;
  dataVersion: number;
  onChanged: () => void;
}) {
  const [obligations, setObligations] = useState<NextPaymentObligation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    obligation: NextPaymentObligation;
    agreement: WebsiteAgreement | null;
    hostingPlans: HostingPlan[];
  } | null>(null);

  function load() {
    api
      .getWorkspaceObligations()
      .then((o) => {
        setError(null);
        setObligations(o);
      })
      .catch(() => setError("Couldn't load upcoming & overdue payments."));
  }

  useEffect(load, [dataVersion]);

  async function handleRecordPayment(o: NextPaymentObligation) {
    const [agreement, hostingPlans] = await Promise.all([
      api.getAgreement(o.project_id).catch(() => null),
      api.listHostingPlans(o.project_id).catch(() => []),
    ]);
    setPaymentModal({ obligation: o, agreement, hostingPlans });
  }

  if (error) {
    return <ErrorState message={error} onRetry={load} compact />;
  }

  if (!obligations) {
    return <TableSkeleton rows={4} cols={3} />;
  }

  const groups = groupObligations(obligations);
  const nothingAtAll =
    groups.overdue.length === 0 &&
    groups.due_today.length === 0 &&
    groups.next_7_days.length === 0 &&
    groups.later.length === 0 &&
    groups.no_due_date.length === 0;

  if (nothingAtAll) {
    return <EmptyState title="No upcoming or overdue payments" description="Nothing is scheduled or unpaid right now — a calm balance sheet." />;
  }

  return (
    <div>
      {groups.overdue.length === 0 && (
        <p className="text-sm text-fg-muted">No overdue payments.</p>
      )}
      <Section title="Overdue" tone="overdue" obligations={groups.overdue} currency={currency} onRecordPayment={handleRecordPayment} />
      <Section title="Due today" tone="default" obligations={groups.due_today} currency={currency} onRecordPayment={handleRecordPayment} />
      <Section title="Next 7 days" tone="default" obligations={groups.next_7_days} currency={currency} onRecordPayment={handleRecordPayment} />
      <Section title="Later" tone="default" obligations={groups.later} currency={currency} onRecordPayment={handleRecordPayment} />
      <Section title="Due date not set" tone="default" obligations={groups.no_due_date} currency={currency} onRecordPayment={handleRecordPayment} />

      {paymentModal && (
        <RecordPaymentModal
          projectId={paymentModal.obligation.project_id}
          agreement={paymentModal.agreement}
          hostingPlans={paymentModal.hostingPlans}
          currency={currency}
          initialAllocation={
            paymentModal.obligation.website_agreement_id
              ? { type: "agreement", id: paymentModal.obligation.website_agreement_id }
              : paymentModal.obligation.hosting_charge_id
                ? { type: "hosting_charge", id: paymentModal.obligation.hosting_charge_id }
                : undefined
          }
          initialAmountCents={paymentModal.obligation.amount_cents}
          onClose={() => setPaymentModal(null)}
          onSaved={() => {
            setPaymentModal(null);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
