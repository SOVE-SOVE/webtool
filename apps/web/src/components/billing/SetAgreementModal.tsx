"use client";

import { useState } from "react";
import { api, ApiError, type WebsiteAgreement } from "@/lib/api";

function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toString();
}

function inputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Math.round(parseFloat(trimmed) * 100);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Sets or edits a Project's website-purchase agreement — price, an
 * optional deposit (part of the total, not additional), and an optional
 * overall due date. Leaving price blank keeps it unconfigured, distinct
 * from entering 0 for a genuine free/zero-price agreement.
 */
export function SetAgreementModal({
  projectId,
  agreement,
  onClose,
  onSaved,
}: {
  projectId: string;
  agreement: WebsiteAgreement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [price, setPrice] = useState(agreement ? centsToInput(agreement.price_cents) : "");
  const [deposit, setDeposit] = useState(agreement ? centsToInput(agreement.deposit_required_cents) : "");
  const [dueDate, setDueDate] = useState(agreement?.due_date ?? "");
  const [notes, setNotes] = useState(agreement?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.upsertAgreement(projectId, {
        price_cents: inputToCents(price),
        deposit_required_cents: inputToCents(deposit),
        due_date: dueDate || null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this agreement.");
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
        aria-labelledby="set-agreement-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="set-agreement-title" className="section-title">
          Website agreement
        </h2>

        <label className="field-label mt-4">Agreed price</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Leave blank if not yet agreed"
          className="input mt-1.5"
        />
        <p className="mt-1 text-xs text-fg-subtle">
          Blank = not configured yet. Enter 0 for a genuinely free/zero-price agreement.
        </p>

        <label className="field-label mt-3">Deposit required (optional)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
          className="input mt-1.5"
        />
        <p className="mt-1 text-xs text-fg-subtle">Part of the total above, not an additional charge.</p>

        <label className="field-label mt-3">Due date (optional)</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input mt-1.5" />

        <label className="field-label mt-3">Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input mt-1.5" />

        {error && <p className="text-error mt-2">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Saving…" : "Save agreement"}
          </button>
        </div>
      </form>
    </div>
  );
}
