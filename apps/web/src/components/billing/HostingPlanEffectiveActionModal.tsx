"use client";

import { useState } from "react";
import { api, ApiError, type HostingPlan } from "@/lib/api";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const COPY = {
  pause: { title: "Pause hosting plan", cta: "Pause", note: "The next charge won't be generated until resumed." },
  resume: { title: "Resume hosting plan", cta: "Resume", note: "Billing picks up from the chosen date — no backlog for the paused period." },
  cancel: { title: "Cancel hosting plan", cta: "Cancel plan", note: "Unpaid charges and past payments are kept, not erased." },
} as const;

/**
 * Pause, resume, or cancel a hosting plan with a stated effective date —
 * shared by all three actions since they're the same shape (a date plus
 * an optional reason).
 */
export function HostingPlanEffectiveActionModal({
  plan,
  action,
  onClose,
  onSaved,
}: {
  plan: HostingPlan;
  action: "pause" | "resume" | "cancel";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[action];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = { effective_date: effectiveDate, reason: reason.trim() || undefined };
      if (action === "pause") await api.pauseHostingPlan(plan.id, data);
      else if (action === "resume") await api.resumeHostingPlan(plan.id, data);
      else await api.cancelHostingPlan(plan.id, data);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't ${action} this hosting plan.`);
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
        aria-labelledby="hosting-effective-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="hosting-effective-title" className="section-title">
          {copy.title}
        </h2>
        <p className="mt-1 text-xs text-fg-subtle">{copy.note}</p>

        <label className="field-label mt-4">Effective date</label>
        <input
          required
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          className="input mt-1.5"
        />

        {action !== "resume" && (
          <>
            <label className="field-label mt-3">Reason (optional)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="input mt-1.5" />
          </>
        )}

        {error && <p className="text-error mt-2">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Back
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Saving…" : copy.cta}
          </button>
        </div>
      </form>
    </div>
  );
}
