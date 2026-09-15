"use client";

import { useState } from "react";
import { api, ApiError, type HostingPlan } from "@/lib/api";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Changes a hosting plan's monthly fee from a stated effective date — past charges keep their old amount. */
export function ChangeFeeModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: HostingPlan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fee, setFee] = useState((plan.monthly_fee_cents / 100).toString());
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feeCents = Math.round(parseFloat(fee || "0") * 100);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!feeCents || feeCents <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await api.changeHostingFee(plan.id, { new_monthly_fee_cents: feeCents, effective_date: effectiveDate });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change the fee.");
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
        aria-labelledby="change-fee-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="change-fee-title" className="section-title">
          Change hosting fee
        </h2>
        <p className="mt-1 text-xs text-fg-subtle">
          No proration — the new fee applies to charges generated from the effective date; past charges are unchanged.
        </p>

        <label className="field-label mt-4">New monthly fee</label>
        <input
          required
          type="number"
          min="0.01"
          step="0.01"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          className="input mt-1.5"
        />

        <label className="field-label mt-3">Effective date</label>
        <input
          required
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          className="input mt-1.5"
        />

        {error && <p className="text-error mt-2">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !feeCents} className="btn btn-primary">
            {saving ? "Saving…" : "Save fee"}
          </button>
        </div>
      </form>
    </div>
  );
}
