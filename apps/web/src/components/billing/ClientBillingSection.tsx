"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type ClientBillingProject,
  type ClientBillingSummary,
  type HostingPlan,
  type Payment,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { SetAgreementModal } from "./SetAgreementModal";
import { RecordPaymentModal } from "./RecordPaymentModal";
import { HostingPlanModal } from "./HostingPlanModal";
import { HostingPlanEffectiveActionModal } from "./HostingPlanEffectiveActionModal";
import { ChangeFeeModal } from "./ChangeFeeModal";
import { CorrectPaymentModal } from "./CorrectPaymentModal";

export const HOSTING_STATUS_CLASS: Record<HostingPlan["status"], string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  cancelled: "bg-surface-subtle text-fg-subtle",
};

type Modal =
  | { type: "agreement"; project: ClientBillingProject }
  | { type: "payment"; project: ClientBillingProject }
  | { type: "hostingPlan"; project: ClientBillingProject }
  | { type: "pause" | "resume" | "cancel"; plan: HostingPlan }
  | { type: "fee"; plan: HostingPlan }
  | { type: "correct"; payment: Payment };

function ProjectBillingBlock({
  project,
  currency,
  onAction,
}: {
  project: ClientBillingProject;
  currency: string;
  onAction: (modal: Modal) => void;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/dashboard/projects/${project.project_id}`} className="font-medium text-fg hover:underline">
          {project.project_name}
        </Link>
        <div className="flex gap-2">
          <button onClick={() => onAction({ type: "agreement", project })} className="text-xs text-fg-muted hover:text-fg hover:underline">
            {project.agreement ? "Edit agreement" : "Set agreement"}
          </button>
          <button onClick={() => onAction({ type: "payment", project })} className="text-xs text-fg-muted hover:text-fg hover:underline">
            Record payment
          </button>
          <button onClick={() => onAction({ type: "hostingPlan", project })} className="text-xs text-fg-muted hover:text-fg hover:underline">
            Add hosting plan
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-fg-muted">Agreed price</p>
          <p className="tabular-nums text-fg">{formatMoney(project.agreement?.price_cents ?? null, currency)}</p>
          {project.agreement?.deposit_required_cents != null && (
            <p className="text-xs text-fg-subtle">Deposit {formatMoney(project.agreement.deposit_required_cents, currency)}</p>
          )}
        </div>
        <div>
          <p className="text-xs text-fg-muted">Paid</p>
          <p className="tabular-nums text-fg">{formatMoney(project.agreement_paid_cents, currency)}</p>
        </div>
        <div>
          <p className="text-xs text-fg-muted">Balance</p>
          <p className="tabular-nums text-fg">{formatMoney(project.agreement_outstanding_cents, currency)}</p>
        </div>
      </div>

      {project.hosting_plans.length > 0 && (
        <div className="mt-3 space-y-2">
          {project.hosting_plans.map((plan) => (
            <div key={plan.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-surface-subtle px-2 py-1.5 text-sm">
              <span className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${HOSTING_STATUS_CLASS[plan.status]}`}>
                  {plan.status}
                </span>
                <span className="text-fg">{formatMoney(plan.monthly_fee_cents, currency)}/mo</span>
                <span className="text-xs text-fg-muted">billing day {plan.billing_day} · next due {plan.next_due_date}</span>
              </span>
              <span className="flex gap-2 text-xs">
                <button onClick={() => onAction({ type: "fee", plan })} className="text-fg-muted hover:text-fg hover:underline">
                  Change fee
                </button>
                {plan.status === "active" && (
                  <button onClick={() => onAction({ type: "pause", plan })} className="text-fg-muted hover:text-fg hover:underline">
                    Pause
                  </button>
                )}
                {plan.status === "paused" && (
                  <button onClick={() => onAction({ type: "resume", plan })} className="text-fg-muted hover:text-fg hover:underline">
                    Resume
                  </button>
                )}
                {plan.status !== "cancelled" && (
                  <button onClick={() => onAction({ type: "cancel", plan })} className="text-fg-muted hover:text-fg hover:underline">
                    Cancel
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A Client's Billing area — websites/projects purchased, agreed prices,
 * deposits, payments received/remaining, hosting plans/fees/billing
 * dates/status, and the actions to manage all of it. Reused verbatim by
 * the Project Payment summary's "Record payment" action (same modal,
 * same underlying API call) so a payment entered from either surface
 * produces one record, not duplicated transactions.
 */
export function ClientBillingSection({
  clientId,
  currency,
  onChanged,
  refreshToken,
}: {
  clientId: string;
  currency: string;
  /** Called after every successful mutation, in addition to this component's own reload — lets a parent (e.g. the Next Payment panel) stay in sync without a second independent poll. */
  onChanged?: () => void;
  /** Bump this (e.g. a counter) to force a reload from outside — for a mutation made through a sibling component's own modal (the Next Payment panel's "Record payment" opens its own RecordPaymentModal instance, not this component's), so this section doesn't keep showing a stale balance. */
  refreshToken?: number;
}) {
  const [summary, setSummary] = useState<ClientBillingSummary | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);

  function load() {
    api
      .getClientBillingSummary(clientId)
      .then(setSummary)
      .catch(() => setSummary(null));
  }

  useEffect(load, [clientId, refreshToken]);

  function closeAndReload() {
    setModal(null);
    load();
    onChanged?.();
  }

  if (!summary) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-fg">Billing</h2>

      {summary.projects.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">No projects yet — billing appears once a project exists.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {summary.projects.map((project) => (
            <ProjectBillingBlock key={project.project_id} project={project} currency={currency} onAction={setModal} />
          ))}
        </div>
      )}

      {summary.payments.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Payment history</h3>
          <ul className="mt-2 divide-y divide-border border border-border">
            {summary.payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className={payment.voided_at ? "text-fg-subtle line-through" : "text-fg"}>
                  {formatMoney(payment.amount_cents, currency)} · {payment.received_date}
                  {payment.method ? ` · ${payment.method}` : ""}
                  {payment.refunded_cents > 0 && !payment.voided_at && (
                    <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                      refunded {formatMoney(payment.refunded_cents, currency)}
                    </span>
                  )}
                  {payment.voided_at && <span className="ml-2 text-xs text-fg-subtle">voided</span>}
                </span>
                {!payment.voided_at && (
                  <button
                    onClick={() => setModal({ type: "correct", payment })}
                    className="text-xs text-fg-muted hover:text-fg hover:underline"
                  >
                    Correct…
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {modal?.type === "agreement" && (
        <SetAgreementModal
          projectId={modal.project.project_id}
          agreement={modal.project.agreement}
          onClose={() => setModal(null)}
          onSaved={closeAndReload}
        />
      )}
      {modal?.type === "payment" && (
        <RecordPaymentModal
          projectId={modal.project.project_id}
          agreement={modal.project.agreement}
          hostingPlans={modal.project.hosting_plans}
          currency={currency}
          onClose={() => setModal(null)}
          onSaved={closeAndReload}
        />
      )}
      {modal?.type === "hostingPlan" && (
        <HostingPlanModal projectId={modal.project.project_id} onClose={() => setModal(null)} onSaved={closeAndReload} />
      )}
      {(modal?.type === "pause" || modal?.type === "resume" || modal?.type === "cancel") && (
        <HostingPlanEffectiveActionModal
          plan={modal.plan}
          action={modal.type}
          onClose={() => setModal(null)}
          onSaved={closeAndReload}
        />
      )}
      {modal?.type === "fee" && (
        <ChangeFeeModal plan={modal.plan} onClose={() => setModal(null)} onSaved={closeAndReload} />
      )}
      {modal?.type === "correct" && (
        <CorrectPaymentModal
          payment={modal.payment}
          currency={currency}
          onClose={() => setModal(null)}
          onSaved={closeAndReload}
        />
      )}
    </section>
  );
}
