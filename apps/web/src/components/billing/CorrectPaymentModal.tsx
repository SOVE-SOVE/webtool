"use client";

import { useState } from "react";
import { api, ApiError, type Payment } from "@/lib/api";
import { formatMoney } from "@/lib/format";

/**
 * Corrects an incorrectly recorded payment — either voiding it entirely
 * (entered in error) or partially/fully refunding it. Both keep the
 * original row visible in history, per the audit-trail requirement.
 */
export function CorrectPaymentModal({
  payment,
  currency,
  onClose,
  onSaved,
}: {
  // Only these four fields are read below — a Pick, not the full
  // `Payment`, so the Revenue page's transaction rows (which already
  // carry these via `RevenueTransaction`) can open this directly
  // without a second fetch just to get a full Payment object.
  payment: Pick<Payment, "id" | "amount_cents" | "refunded_cents" | "received_date">;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"void" | "refund">("refund");
  const [refundAmount, setRefundAmount] = useState(((payment.amount_cents - payment.refunded_cents) / 100).toString());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refundCents = Math.round(parseFloat(refundAmount || "0") * 100);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "void") {
        await api.voidPayment(payment.id, { reason: reason.trim() });
      } else {
        if (!refundCents || refundCents <= 0) return;
        await api.refundPayment(payment.id, { refund_amount_cents: refundCents, reason: reason.trim() });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't correct this payment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <form
        onSubmit={handleSubmit}
        className="modal-panel max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="correct-payment-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="correct-payment-title" className="section-title">
          Correct payment
        </h2>
        <p className="mt-1 text-xs text-fg-subtle">
          {formatMoney(payment.amount_cents, currency)} received {payment.received_date}
        </p>

        <div className="mt-4 flex rounded-md border border-border-strong p-0.5 text-sm">
          {(["refund", "void"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded px-2 py-1 ${mode === m ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
            >
              {m === "refund" ? "Refund" : "Void (entered in error)"}
            </button>
          ))}
        </div>

        {mode === "refund" && (
          <>
            <label className="field-label mt-3">Refund amount</label>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              max={(payment.amount_cents - payment.refunded_cents) / 100}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className="input mt-1.5"
            />
            <p className="mt-1 text-xs text-fg-subtle">
              Reduces payments received by this amount; the original payment stays visible in history.
            </p>
          </>
        )}

        <label className="field-label mt-3">Reason</label>
        <input required value={reason} onChange={(e) => setReason(e.target.value)} className="input mt-1.5" />

        {error && <p className="text-error mt-2">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !reason.trim()} className="btn btn-primary">
            {saving ? "Saving…" : mode === "void" ? "Void payment" : "Refund payment"}
          </button>
        </div>
      </form>
    </div>
  );
}
