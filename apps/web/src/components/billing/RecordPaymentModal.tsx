"use client";

import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  type HostingCharge,
  type HostingPlan,
  type PaymentAllocation,
  type WebsiteAgreement,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Records a payment against either the project's website agreement or a
 * specific hosting charge — the one place both the Project Payment
 * summary and Client Billing page create payments, so a payment entered
 * from either surface produces the exact same underlying row (no
 * duplicated transaction paths).
 */
export function RecordPaymentModal({
  projectId,
  agreement,
  hostingPlans,
  currency,
  onClose,
  onSaved,
  initialAllocation,
  initialAmountCents,
}: {
  projectId: string;
  agreement: WebsiteAgreement | null;
  hostingPlans: HostingPlan[];
  currency: string;
  onClose: () => void;
  onSaved: () => void;
  /** Pre-selects "Applies to" — e.g. opened directly from a specific Next Payment obligation. */
  initialAllocation?: PaymentAllocation;
  /** Pre-fills Amount with the obligation's outstanding amount, still editable. */
  initialAmountCents?: number;
}) {
  const [charges, setCharges] = useState<HostingCharge[]>([]);
  const [allocation, setAllocation] = useState<PaymentAllocation | null>(
    initialAllocation ?? (agreement ? { type: "agreement", id: agreement.id } : null),
  );
  const [amount, setAmount] = useState(initialAmountCents ? (initialAmountCents / 100).toString() : "");
  const [receivedDate, setReceivedDate] = useState(todayIso());
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(hostingPlans.map((p) => api.listHostingCharges(p.id)))
      .then((lists) => setCharges(lists.flat().filter((c) => c.outstanding_cents > 0)))
      .catch(() => {});
  }, [hostingPlans]);

  const amountCents = Math.round(parseFloat(amount || "0") * 100);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allocation || !amountCents || amountCents <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await api.recordPayment({
        project_id: projectId,
        allocation,
        amount_cents: amountCents,
        received_date: receivedDate,
        method: method.trim() || undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record this payment.");
    } finally {
      setSaving(false);
    }
  }

  const allocationKey = allocation ? `${allocation.type}:${allocation.id}` : "";

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <form
        onSubmit={handleSubmit}
        className="modal-panel max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-payment-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="record-payment-title" className="section-title">
          Record a payment
        </h2>

        <label className="field-label mt-4">Applies to</label>
        <select
          required
          value={allocationKey}
          onChange={(e) => {
            const [type, id] = e.target.value.split(":");
            setAllocation(type && id ? ({ type, id } as PaymentAllocation) : null);
          }}
          className="input mt-1.5"
        >
          <option value="">Select…</option>
          {agreement && (
            <option value={`agreement:${agreement.id}`}>Website agreement</option>
          )}
          {charges.map((c) => (
            <option key={c.id} value={`hosting_charge:${c.id}`}>
              Hosting — {c.billing_period.slice(0, 7)} ({formatMoney(c.outstanding_cents, currency)} owed)
            </option>
          ))}
        </select>
        {!agreement && charges.length === 0 && (
          <p className="mt-1 text-xs text-fg-subtle">
            Set a website agreement or wait for a hosting charge to be generated before recording a payment.
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="field-label">Amount</label>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input mt-1.5"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="field-label">Received</label>
            <input
              required
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              className="input mt-1.5"
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="field-label">Method (optional)</label>
            <input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="Bank transfer"
              className="input mt-1.5"
            />
          </div>
          <div>
            <label className="field-label">Reference (optional)</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input mt-1.5"
            />
          </div>
        </div>

        <label className="field-label mt-3">Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input mt-1.5" />

        {error && <p className="text-error mt-2">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !allocation || !amountCents} className="btn btn-primary">
            {saving ? "Saving…" : "Record payment"}
          </button>
        </div>
      </form>
    </div>
  );
}
