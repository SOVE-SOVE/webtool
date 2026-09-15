"use client";

import Link from "next/link";
import { useState } from "react";
import { api, type NextPaymentObligation, type NextPaymentSummary } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { NEXT_PAYMENT_KIND_LABEL, describeNextPayment, relativeObligationLabel } from "@/lib/billing";

function DueDateEditor({ chargeId, currentDueDate, onSaved }: { chargeId: string; currentDueDate: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentDueDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-xs text-fg-muted hover:text-fg hover:underline">
        Edit due date
      </button>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updateHostingChargeDueDate(chargeId, { due_date: value });
      setEditing(false);
      onSaved();
    } catch {
      setError("Couldn't update due date.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="input h-7 py-0 text-xs" />
      <button onClick={handleSave} disabled={saving} className="text-xs text-fg hover:underline">
        {saving ? "Saving…" : "Save"}
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-fg-muted hover:underline">
        Cancel
      </button>
      {error && <span className="text-error text-xs">{error}</span>}
    </div>
  );
}

function ObligationRow({
  obligation,
  currency,
  onRecordPayment,
  onSaved,
}: {
  obligation: NextPaymentObligation;
  currency: string;
  onRecordPayment: (o: NextPaymentObligation) => void;
  onSaved: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="text-fg">
          <Link href={`/dashboard/projects/${obligation.project_id}`} className="hover:underline">
            {obligation.project_name}
          </Link>{" "}
          <span className="text-fg-muted">· {NEXT_PAYMENT_KIND_LABEL[obligation.kind]}</span>
        </p>
        <p className={`text-xs ${obligation.is_overdue ? "text-red-700 dark:text-red-400" : "text-fg-muted"}`}>
          {relativeObligationLabel(obligation)}
          {obligation.scheduled && " · Scheduled"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="tabular-nums text-fg">{formatMoney(obligation.amount_cents, currency)}</span>
        {obligation.hosting_charge_id && obligation.due_date && (
          <DueDateEditor chargeId={obligation.hosting_charge_id} currentDueDate={obligation.due_date} onSaved={onSaved} />
        )}
        {!obligation.scheduled && (
          <button onClick={() => onRecordPayment(obligation)} className="btn btn-secondary btn-sm">
            Record payment
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Full "Next payment due" detail for the Billing tab — every obligation
 * behind the Overview snapshot's one-line summary, with the due-date
 * editor the existing Billing UI was missing (for generated hosting
 * charges) and a direct "Record payment" action per obligation.
 */
export function NextPaymentPanel({
  summary,
  currency,
  onReload,
  onRecordPayment,
}: {
  summary: NextPaymentSummary;
  currency: string;
  onReload: () => void;
  onRecordPayment: (o: NextPaymentObligation) => void;
}) {
  const display = describeNextPayment(summary);

  return (
    <section className="mb-6">
      <h2 className="section-title">Next payment</h2>

      {display.status === "none" ? (
        <p className="mt-2 text-sm text-fg-muted">No upcoming payment scheduled.</p>
      ) : display.status === "no_due_date" ? (
        <p className="mt-2 text-sm text-fg-muted">
          {formatMoney(summary.no_due_date_cents, currency)} outstanding across {summary.no_due_date_count} item
          {summary.no_due_date_count === 1 ? "" : "s"} with no due date set — set one on the relevant agreement below.
        </p>
      ) : (
        <>
          {display.status === "overdue" && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10">
              <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-red-800 dark:text-red-300">
                {display.headline}
              </p>
              <ul className="divide-y divide-red-200 dark:divide-red-500/20">
                {display.primary.map((o) => (
                  <ObligationRow
                    key={`${o.website_agreement_id ?? ""}${o.hosting_charge_id ?? ""}${o.hosting_plan_id ?? ""}`}
                    obligation={o}
                    currency={currency}
                    onRecordPayment={onRecordPayment}
                    onSaved={onReload}
                  />
                ))}
              </ul>
            </div>
          )}

          {(display.status === "upcoming" || display.secondaryUpcoming) && (
            <div className="mt-2 rounded-md border border-border">
              {display.status === "upcoming" && (
                <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{display.headline}</p>
              )}
              {display.secondaryUpcoming && (
                <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Next upcoming</p>
              )}
              <ul className="divide-y divide-border">
                {(display.status === "upcoming" ? display.primary : display.secondaryUpcoming ?? []).map((o) => (
                  <ObligationRow
                    key={`${o.website_agreement_id ?? ""}${o.hosting_charge_id ?? ""}${o.hosting_plan_id ?? ""}`}
                    obligation={o}
                    currency={currency}
                    onRecordPayment={onRecordPayment}
                    onSaved={onReload}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
