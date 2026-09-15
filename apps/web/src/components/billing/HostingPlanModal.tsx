"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Configures a new recurring monthly hosting plan for a Project. */
export function HostingPlanModal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fee, setFee] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [billingDay, setBillingDay] = useState(new Date().getDate().toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const feeCents = Math.round(parseFloat(fee || "0") * 100);
  const day = parseInt(billingDay, 10);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!feeCents || feeCents <= 0 || !day || day < 1 || day > 31) return;
    setSaving(true);
    setError(null);
    try {
      await api.createHostingPlan(projectId, { monthly_fee_cents: feeCents, start_date: startDate, billing_day: day });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create this hosting plan.");
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
        aria-labelledby="hosting-plan-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="hosting-plan-title" className="section-title">
          New hosting plan
        </h2>

        <label className="field-label mt-4">Monthly fee</label>
        <input
          required
          type="number"
          min="0.01"
          step="0.01"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          placeholder="0.00"
          className="input mt-1.5"
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="field-label">Start date</label>
            <input
              required
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input mt-1.5"
            />
          </div>
          <div>
            <label className="field-label">Billing day</label>
            <input
              required
              type="number"
              min="1"
              max="31"
              value={billingDay}
              onChange={(e) => setBillingDay(e.target.value)}
              className="input mt-1.5"
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-fg-subtle">
          In shorter months, billing lands on the last day of that month instead.
        </p>

        {error && <p className="text-error mt-2">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !feeCents} className="btn btn-primary">
            {saving ? "Saving…" : "Create plan"}
          </button>
        </div>
      </form>
    </div>
  );
}
