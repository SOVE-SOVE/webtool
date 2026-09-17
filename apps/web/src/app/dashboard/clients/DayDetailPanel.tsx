"use client";

import Link from "next/link";
import { useRef } from "react";
import type { NextPaymentObligation, RevenueTransaction } from "@/lib/api";
import { NEXT_PAYMENT_KIND_LABEL, obligationKey, relativeObligationLabel } from "@/lib/billing";
import { formatDate, formatMoney } from "@/lib/format";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { Badge } from "@/components/ui/Badge";

export type DayDetailItem = { type: "transaction"; tx: RevenueTransaction } | { type: "obligation"; o: NextPaymentObligation };

function TransactionRow({
  tx,
  currency,
  onOpen,
}: {
  tx: RevenueTransaction;
  currency: string;
  onOpen?: (paymentId: string) => void;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {tx.client_id ? (
            <Link href={`/dashboard/clients/${tx.client_id}`} className="truncate font-medium text-fg hover:underline">
              {tx.client_business_name ?? "Client"}
            </Link>
          ) : (
            <p className="truncate font-medium text-fg-subtle">No client (prospect)</p>
          )}
          <p className="truncate text-xs text-fg-muted">{tx.project_name}</p>
        </div>
        {tx.voided ? (
          <Badge tone="muted">Reversed</Badge>
        ) : tx.refunded_cents > 0 ? (
          <Badge tone="warning">Refunded</Badge>
        ) : (
          <Badge tone="success">Paid</Badge>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg-muted">
        <p>
          Type: <span className="text-fg">{tx.kind === "website" ? "Website" : "Hosting"}</span>
        </p>
        <p>
          Date: <span className="text-fg">{formatDate(tx.received_date)}</span>
        </p>
        <p className="col-span-2 tabular-nums">
          Amount: <span className="font-medium text-fg">{formatMoney(tx.voided ? tx.amount_cents : tx.net_cents, currency)}</span>
          {!tx.voided && tx.refunded_cents > 0 && (
            <span className="text-amber-700 dark:text-amber-400"> (refunded {formatMoney(tx.refunded_cents, currency)})</span>
          )}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {onOpen && (
          <button type="button" onClick={() => onOpen(tx.payment_id)} className="text-sm text-fg-muted hover:text-fg hover:underline">
            Details →
          </button>
        )}
        {tx.client_id && (
          <Link href={`/dashboard/clients/${tx.client_id}?tab=billing`} className="text-sm text-fg-muted hover:text-fg hover:underline">
            Client Billing →
          </Link>
        )}
      </div>
    </div>
  );
}

function ObligationRow({
  o,
  currency,
  onRecordPayment,
}: {
  o: NextPaymentObligation;
  currency: string;
  onRecordPayment?: (o: NextPaymentObligation) => void;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {o.client_id ? (
            <Link href={`/dashboard/clients/${o.client_id}`} className="truncate font-medium text-fg hover:underline">
              {o.client_business_name ?? "Client"}
            </Link>
          ) : (
            <p className="truncate font-medium text-fg-subtle">No client (prospect)</p>
          )}
          <Link href={`/dashboard/projects/${o.project_id}`} className="truncate text-xs text-fg-muted hover:underline">
            {o.project_name}
          </Link>
        </div>
        {o.scheduled ? (
          <Badge tone="muted">Scheduled</Badge>
        ) : o.is_overdue ? (
          <Badge tone="danger">Overdue</Badge>
        ) : o.days_relative === 0 ? (
          <Badge tone="warning">Due today</Badge>
        ) : (
          <Badge tone="info">Upcoming</Badge>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg-muted">
        <p>
          Type: <span className="text-fg">{NEXT_PAYMENT_KIND_LABEL[o.kind]}</span>
        </p>
        <p>
          Due: <span className="text-fg">{relativeObligationLabel(o)}</span>
        </p>
        <p className="col-span-2 tabular-nums">
          Remaining: <span className="font-medium text-fg">{formatMoney(o.amount_cents, currency)}</span>
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {!o.scheduled && onRecordPayment && (
          <button type="button" onClick={() => onRecordPayment(o)} className="btn btn-secondary btn-sm">
            Record Payment
          </button>
        )}
        {o.client_id && (
          <Link href={`/dashboard/clients/${o.client_id}?tab=billing`} className="text-sm text-fg-muted hover:text-fg hover:underline">
            Client Billing →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * "Clicking a date opens a side panel with that day's records and
 * relevant actions" — same side-panel shell/dismiss behaviour as
 * ClientPreviewPanel/PaymentDetailPanel (URL-param driven, focus
 * restored on close). Renders whichever of Payments' transactions or
 * Upcoming's obligations the caller collected for this one date — the
 * two shapes differ, so each gets its own row renderer, but both reuse
 * the exact same labels/formatters the rest of Revenue already uses.
 */
export function DayDetailPanel({
  dateKey,
  heading,
  items,
  currency,
  onClose,
  onOpenTransaction,
  onRecordPayment,
}: {
  /** A specific calendar day — renders as its full formatted date. Pass `null` when `heading` already says what this list is (the overdue strip, the "due date not set" indicator). */
  dateKey: string | null;
  /** Overrides the date-derived heading — used by the overdue strip and "due date not set" indicator, whose records span many dates rather than one. */
  heading?: string;
  items: DayDetailItem[];
  currency: string;
  onClose: () => void;
  /** Only relevant when `items` can include transactions (the Payments calendar). */
  onOpenTransaction?: (paymentId: string) => void;
  /** Only relevant when `items` can include obligations (the Upcoming calendar). */
  onRecordPayment?: (o: NextPaymentObligation) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: closeButtonRef });
  const mixed = items.some((x) => x.type === "transaction") && items.some((x) => x.type === "obligation");
  const label =
    heading ??
    (dateKey
      ? new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : "Records");

  return (
    <div className="side-panel-overlay" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Records for ${label}`}
        className="side-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-fg">{label}</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {items.length} record{items.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close day detail"
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nothing recorded for this day.</p>
          ) : (
            items.map((item, i) => {
              // A group heading only ever appears when the caller's own
              // list genuinely mixes both kinds (the Today box's
              // "received + due" combined view) — every other existing
              // caller here passes a single-type list, so this renders
              // nothing extra for them, unchanged. Shown once, right
              // before that kind's first row.
              const showHeading = mixed && items.findIndex((x) => x.type === item.type) === i;
              return (
                <div key={item.type === "transaction" ? `tx-${item.tx.payment_id}` : `o-${obligationKey(item.o)}`}>
                  {showHeading && (
                    <p className={`pb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle ${i > 0 ? "pt-2" : ""}`}>
                      {item.type === "transaction" ? "Received today" : "Due today"}
                    </p>
                  )}
                  {item.type === "transaction" ? (
                    <TransactionRow tx={item.tx} currency={currency} onOpen={onOpenTransaction} />
                  ) : (
                    <ObligationRow o={item.o} currency={currency} onRecordPayment={onRecordPayment} />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
