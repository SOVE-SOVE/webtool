"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { RevenueReport, RevenueTransaction } from "@/lib/api";
import { withParam } from "@/lib/url";
import { ErrorState } from "@/components/ui/ErrorState";
import { PaymentDetailPanel } from "@/components/billing/PaymentDetailPanel";
import { DayDetailPanel, type DayDetailItem } from "./DayDetailPanel";
import { RevenueCalendar, type CalendarEntry, type CalendarEntryStatus, type CalendarGridMode } from "./RevenueCalendar";

function useUrlParam() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  function setParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value || null)}`, { scroll: false });
  }
  return { searchParams, setParam };
}

function transactionStatus(tx: RevenueTransaction): CalendarEntryStatus {
  if (tx.voided) return "reversed";
  if (tx.refunded_cents > 0) return "refunded";
  return "paid";
}

/** The Payments view's own secondary filters — type, status, client —
 * kept inside the shared "More filters" popover the parent renders,
 * rather than a second row of selects competing with the main toolbar.
 * No currency filter: this workspace has exactly one currency
 * (Workspace.currency — no RevenueTransaction ever carries its own), so
 * every amount here is already in the one currency with nothing to
 * separate. Sort no longer applies now that the calendar (not a table)
 * is the main view — date is the calendar's own axis. */
export function PaymentsFilterPanel({ clients }: { clients: { id: string; business_name: string }[] }) {
  const { searchParams, setParam } = useUrlParam();
  const kindFilter = (searchParams.get("kind") as "" | "website" | "hosting" | null) ?? "";
  const statusFilter = (searchParams.get("status") as "" | "payments" | "refunded" | "reversed" | null) ?? "";
  const clientFilter = searchParams.get("client") ?? "";
  const activeCount = [kindFilter, statusFilter, clientFilter].filter(Boolean).length;

  return (
    <div className="space-y-2.5">
      <label className="block text-xs text-fg-muted">
        Type
        <select value={kindFilter} onChange={(e) => setParam("kind", e.target.value)} className="input mt-1 w-full">
          <option value="">Website &amp; hosting</option>
          <option value="website">Website only</option>
          <option value="hosting">Hosting only</option>
        </select>
      </label>
      <label className="block text-xs text-fg-muted">
        Status
        <select value={statusFilter} onChange={(e) => setParam("status", e.target.value)} className="input mt-1 w-full">
          <option value="">All statuses</option>
          <option value="payments">Payments only</option>
          <option value="refunded">Refunded</option>
          <option value="reversed">Reversed</option>
        </select>
      </label>
      <label className="block text-xs text-fg-muted">
        Client
        <select value={clientFilter} onChange={(e) => setParam("client", e.target.value)} className="input mt-1 w-full">
          <option value="">Any client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.business_name}
            </option>
          ))}
        </select>
      </label>
      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setParam("kind", null);
            setParam("status", null);
            setParam("client", null);
          }}
          className="block w-full rounded px-1 py-1 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

/**
 * The Revenue page's payments calendar — recorded transactions plotted
 * on their actual `received_date`, distinguishing receipts/refunds/
 * reversals. Filter state all lives in the URL (not component state) so
 * switching sub-tabs and coming back, or returning from a payment's
 * detail panel, never loses it; the detail panel itself is just another
 * URL param on this same page (`?payment=`), same pattern as Leads'
 * `?preview=`. `q`/calendar cursor/grid are owned by the parent toolbar
 * — read here, not re-implemented.
 */
export function PaymentsTab({
  report,
  error,
  onRetry,
  currency,
  cursor,
  grid,
  onCursorChange,
  onGridChange,
  onChanged,
  onClearAll,
  onRecordPayment,
}: {
  report: RevenueReport | null;
  error: string | null;
  onRetry: () => void;
  currency: string;
  cursor: Date;
  grid: CalendarGridMode;
  onCursorChange: (next: Date) => void;
  onGridChange: (next: CalendarGridMode) => void;
  onChanged: () => void;
  /** Clears the shared search box too — owned by the parent toolbar, since a plain `setParam("q", null)` here would be silently undone by the parent's own debounced write-back of its still-stale input state. */
  onClearAll: () => void;
  /** Owned by ClientsRevenueTab — passed straight through to the calendar's own toolbar, which is where this control now lives. */
  onRecordPayment: () => void;
}) {
  const { searchParams, setParam } = useUrlParam();

  const urlSearch = searchParams.get("q") ?? "";
  const kindFilter = (searchParams.get("kind") as "" | "website" | "hosting" | null) ?? "";
  const statusFilter = (searchParams.get("status") as "" | "payments" | "refunded" | "reversed" | null) ?? "";
  const clientFilter = searchParams.get("client") ?? "";
  const paymentId = searchParams.get("payment");
  const dayKey = searchParams.get("day");

  function openPayment(id: string) {
    setParam("payment", id);
  }

  function closePayment() {
    setParam("payment", null);
  }

  function openDay(key: string) {
    setParam("day", key);
  }

  function closeDay() {
    setParam("day", null);
  }

  const visible = useMemo(() => {
    if (!report) return [];
    const q = urlSearch.trim().toLowerCase();
    return report.transactions.filter((tx) => {
      if (kindFilter && tx.kind !== kindFilter) return false;
      if (statusFilter === "refunded" && !(tx.refunded_cents > 0 && !tx.voided)) return false;
      if (statusFilter === "reversed" && !tx.voided) return false;
      if (statusFilter === "payments" && (tx.voided || tx.refunded_cents > 0)) return false;
      if (clientFilter && tx.client_id !== clientFilter) return false;
      if (!q) return true;
      return (
        tx.project_name.toLowerCase().includes(q) ||
        (tx.client_business_name ?? "").toLowerCase().includes(q) ||
        (tx.reference ?? "").toLowerCase().includes(q) ||
        (tx.method ?? "").toLowerCase().includes(q)
      );
    });
  }, [report, urlSearch, kindFilter, statusFilter, clientFilter]);

  const entries = useMemo<CalendarEntry[]>(
    () =>
      visible.map((tx) => ({
        key: tx.payment_id,
        dateKey: tx.received_date,
        clientName: tx.client_business_name ?? "No client",
        amountCents: tx.voided ? tx.amount_cents : tx.net_cents,
        status: transactionStatus(tx),
        typeLabel: tx.kind === "website" ? "Website" : "Hosting",
        onClick: () => openPayment(tx.payment_id),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  );

  const openTx = paymentId ? (report?.transactions.find((t) => t.payment_id === paymentId) ?? null) : null;
  const dayItems: DayDetailItem[] = dayKey ? visible.filter((tx) => tx.received_date === dayKey).map((tx) => ({ type: "transaction", tx })) : [];

  const hasActiveFilters = Boolean(urlSearch || kindFilter || statusFilter || clientFilter);

  // The calendar frame (and its Month/Week/prev/next/Today controls)
  // stays up through every state — still loading (a fresh range's
  // report hasn't arrived yet), genuinely empty, or filtered to
  // nothing — rather than disappearing and reappearing around it. Only
  // the status line below it changes.
  return (
    <div>
      <RevenueCalendar
        cursor={cursor}
        grid={grid}
        onCursorChange={onCursorChange}
        onGridChange={onGridChange}
        entries={entries}
        currency={currency}
        onDayClick={openDay}
        onRecordPayment={onRecordPayment}
      />

      {error ? (
        <div className="mt-3">
          <ErrorState message={error} onRetry={onRetry} compact />
        </div>
      ) : !report ? (
        <p className="mt-3 text-sm text-fg-subtle">Loading payments…</p>
      ) : report.transactions.length === 0 ? (
        <p className="mt-3 text-sm text-fg-subtle">No payments in this period.</p>
      ) : visible.length === 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-fg-subtle">No matching transactions in this period. Try a different search or filter.</p>
          {hasActiveFilters && (
            <button onClick={onClearAll} className="text-sm text-fg-muted hover:text-fg hover:underline">
              Clear filters
            </button>
          )}
        </div>
      ) : null}

      {dayKey && !paymentId && (
        <DayDetailPanel dateKey={dayKey} items={dayItems} currency={currency} onClose={closeDay} onOpenTransaction={openPayment} />
      )}

      {openTx && (
        <PaymentDetailPanel
          tx={openTx}
          currency={currency}
          onClose={closePayment}
          onChanged={() => {
            onChanged();
          }}
        />
      )}
    </div>
  );
}
