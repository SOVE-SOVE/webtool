"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { RevenueTransaction } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { CorrectPaymentModal } from "./CorrectPaymentModal";

function StatusTag({ tx }: { tx: RevenueTransaction }) {
  if (tx.voided) {
    return (
      <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-xs font-medium text-fg-subtle">Reversed</span>
    );
  }
  if (tx.refunded_cents > 0) {
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
        Refunded
      </span>
    );
  }
  return (
    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
      Payment
    </span>
  );
}

/**
 * Compact detail panel opened from a Payments-tab row — same
 * side-panel pattern as Leads' preview panel (URL-param driven, so
 * closing it never loses the table's scroll position or filters). Lets
 * an operator inspect one transaction and reach the existing
 * correct/refund/void flow without leaving the list.
 */
export function PaymentDetailPanel({
  tx,
  currency,
  onClose,
  onChanged,
}: {
  tx: RevenueTransaction;
  currency: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: closeButtonRef });

  return (
    <div className="side-panel-overlay" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Payment detail"
        className="side-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tabular-nums text-fg">
              {formatMoney(tx.amount_cents, currency)}
            </h2>
            <p className="mt-0.5 truncate text-xs text-fg-muted">
              {formatDate(tx.received_date)} · {tx.kind === "website" ? "Website" : "Hosting"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close payment detail"
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <StatusTag tx={tx} />

          <div>
            <p className="text-xs text-fg-muted">Client</p>
            {tx.client_id ? (
              <Link href={`/dashboard/clients/${tx.client_id}`} className="text-sm text-fg hover:underline">
                {tx.client_business_name ?? "Client"}
              </Link>
            ) : (
              <p className="text-sm text-fg-subtle">No client (prospect)</p>
            )}
          </div>

          <div>
            <p className="text-xs text-fg-muted">Project / site</p>
            <Link href={`/dashboard/projects/${tx.project_id}`} className="text-sm text-fg hover:underline">
              {tx.project_name}
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-fg-muted">Amount</p>
              <p className="text-sm tabular-nums text-fg">{formatMoney(tx.amount_cents, currency)}</p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">Net received</p>
              <p className="text-sm tabular-nums text-fg">{formatMoney(tx.net_cents, currency)}</p>
            </div>
          </div>

          {tx.refunded_cents > 0 && (
            <div>
              <p className="text-xs text-fg-muted">Refunded</p>
              <p className="text-sm tabular-nums text-amber-700 dark:text-amber-400">
                {formatMoney(tx.refunded_cents, currency)}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-fg-muted">Method</p>
              <p className="text-sm text-fg">{tx.method ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">Reference</p>
              <p className="text-sm text-fg">{tx.reference ?? "—"}</p>
            </div>
          </div>

          {tx.notes && (
            <div>
              <p className="text-xs text-fg-muted">Notes</p>
              <p className="text-sm text-fg">{tx.notes}</p>
            </div>
          )}

          {tx.voided && tx.voided_reason && (
            <div>
              <p className="text-xs text-fg-muted">Reversal reason</p>
              <p className="text-sm text-fg">{tx.voided_reason}</p>
            </div>
          )}
        </div>

        {!tx.voided && (
          <div className="flex justify-end gap-2 border-t border-border p-4">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCorrecting(true)}>
              Correct…
            </button>
          </div>
        )}
      </div>

      {correcting && (
        <CorrectPaymentModal
          payment={{
            id: tx.payment_id,
            amount_cents: tx.amount_cents,
            refunded_cents: tx.refunded_cents,
            received_date: tx.received_date,
          }}
          currency={currency}
          onClose={() => setCorrecting(false)}
          onSaved={() => {
            setCorrecting(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
