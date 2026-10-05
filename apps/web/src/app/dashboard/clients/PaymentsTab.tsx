"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { NextPaymentObligation, RevenueReport } from "@/lib/api";
import { withParam } from "@/lib/url";
import { CompactSelect } from "@/components/ui/CompactSelect";
import { ContentLoadingIndicator } from "@/components/ui/SectionLoadingIndicator";
import { ErrorState } from "@/components/ui/ErrorState";
import type { FilterChip } from "@/components/ui/FilterChips";
import { FilterField } from "@/components/ui/FilterPopover";
import type { RevenueFilterUi } from "./revenueFilterUi";
import { PaymentDetailPanel } from "@/components/billing/PaymentDetailPanel";
import { CALENDAR_COLUMN, CALENDAR_GROUP_LABELS, CALENDAR_PANEL_SLOT, CALENDAR_SPLIT, CalendarDetailPlaceholder, DayDetailPanel, type DayDetailItem } from "./DayDetailPanel";
import { calendarPeriodBounds, calendarRangeLabel } from "@/lib/calendarGrid";
import { parseFocus, totalsByDay, transactionMatchesFocus } from "./revenueVisuals";
import { RevenueCalendar, type CalendarEntry, type CalendarGridMode } from "./RevenueCalendar";
import {
  obligationEntry,
  obligationMatchesShared,
  seriesVisibility,
  sumTotals,
  transactionEntry,
  weekSelectionParam,
  calendarPeriodScope,
  calendarSelectionScope,
} from "./calendarCashFlow";

function useUrlParam() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  function setParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value || null)}`, { scroll: false });
  }
  return { searchParams, setParam };
}

/** The Payments view's own secondary filters — type, status, client —
 * returned as the body of the shared Filters popover plus the matching
 * removable chips, for the parent's command bar to place. No currency
 * filter: this workspace has exactly one currency (Workspace.currency —
 * no RevenueTransaction ever carries its own), so every amount here is
 * already in the one currency with nothing to separate. Sort no longer
 * applies now that the calendar (not a table) is the main view — date
 * is the calendar's own axis. */
export function usePaymentsFilters(clients: { id: string; business_name: string }[]): RevenueFilterUi {
  const { searchParams, setParam } = useUrlParam();
  const kindFilter = (searchParams.get("kind") as "" | "website" | "hosting" | null) ?? "";
  const statusFilter = (searchParams.get("status") as "" | "payments" | "refunded" | "reversed" | null) ?? "";
  const clientFilter = searchParams.get("client") ?? "";

  const kindOptions = [
    { value: "", label: "Website & hosting" },
    { value: "website", label: "Website only" },
    { value: "hosting", label: "Hosting only" },
  ];
  const statusOptions = [
    { value: "", label: "All statuses" },
    { value: "payments", label: "Payments only" },
    { value: "refunded", label: "Refunded" },
    { value: "reversed", label: "Reversed" },
  ];
  const clientOptions = [
    { value: "", label: "Any client" },
    ...clients.map((c) => ({ value: c.id, label: c.business_name })),
  ];

  const chips: FilterChip[] = [];
  if (kindFilter) chips.push({ id: "kind", label: "Type", value: kindOptions.find((o) => o.value === kindFilter)?.label ?? kindFilter, onRemove: () => setParam("kind", null) });
  if (statusFilter) chips.push({ id: "status", label: "Status", value: statusOptions.find((o) => o.value === statusFilter)?.label ?? statusFilter, onRemove: () => setParam("status", null) });
  if (clientFilter) chips.push({ id: "client", label: "Client", value: clients.find((c) => c.id === clientFilter)?.business_name ?? "Unknown", onRemove: () => setParam("client", null) });

  const panel = (
    <>
      <FilterField label="Type">
        <CompactSelect aria-label="Filter by payment type" value={kindFilter} onValueChange={(v) => setParam("kind", v)} options={kindOptions} />
      </FilterField>
      <FilterField label="Status">
        <CompactSelect aria-label="Filter by payment status" value={statusFilter} onValueChange={(v) => setParam("status", v)} options={statusOptions} />
      </FilterField>
      <FilterField label="Client">
        <CompactSelect aria-label="Filter by client" value={clientFilter} onValueChange={(v) => setParam("client", v)} options={clientOptions} />
      </FilterField>
    </>
  );
  return { panel, chips };
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
  onChanged,
  onClearAll,
  obligations,
  obligationsError,
  onRecordObligation,
  todayKey,
}: {
  report: RevenueReport | null;
  error: string | null;
  onRetry: () => void;
  currency: string;
  cursor: Date;
  grid: CalendarGridMode;
  onChanged: () => void;
  /** Clears the shared search box too — owned by the parent toolbar, since a plain `setParam("q", null)` here would be silently undone by the parent's own debounced write-back of its still-stale input state. */
  onClearAll: () => void;
  /** Every unpaid obligation workspace-wide (the parent's existing fetch) —
   * the calendar's Outstanding series. `null` while loading. */
  obligations: NextPaymentObligation[] | null;
  /** Set when that fetch failed — Outstanding then shows as unavailable, never $0. */
  obligationsError: string | null;
  /** The parent's existing Record Payment flow for one obligation row. */
  onRecordObligation: (o: NextPaymentObligation) => void;
  /** Today in the workspace timezone (YYYY-MM-DD). */
  todayKey: string;
}) {
  const { searchParams, setParam } = useUrlParam();

  const urlSearch = searchParams.get("q") ?? "";
  const kindFilter = (searchParams.get("kind") as "" | "website" | "hosting" | null) ?? "";
  const statusFilter = (searchParams.get("status") as "" | "payments" | "refunded" | "reversed" | null) ?? "";
  const clientFilter = searchParams.get("client") ?? "";
  // "Received this month" focus — only money actually received (see revenueVisuals.ts).
  const focus = parseFocus(searchParams.get("focus"));
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

  function openWeek(weekStart: string) {
    setParam("day", weekSelectionParam(weekStart));
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
      if (!transactionMatchesFocus(tx, focus)) return false;
      if (!q) return true;
      return (
        tx.project_name.toLowerCase().includes(q) ||
        (tx.client_business_name ?? "").toLowerCase().includes(q) ||
        (tx.reference ?? "").toLowerCase().includes(q) ||
        (tx.method ?? "").toLowerCase().includes(q)
      );
    });
  }, [report, urlSearch, kindFilter, statusFilter, clientFilter, focus]);

  // The Outstanding series beside this view's receipts: unpaid obligations
  // narrowed by the filters both series share (search, client, type).
  // A payment-status filter or the Received focus narrows to payment
  // records only, so Outstanding is hidden then (calendarCashFlow.ts).
  const visibility = seriesVisibility("payments", focus, statusFilter);
  const outstanding = useMemo(() => {
    if (!visibility.outstanding || !obligations) return [];
    const shared = { q: urlSearch, clientId: clientFilter, type: kindFilter };
    return obligations.filter((o) => o.due_date !== null && obligationMatchesShared(o, shared));
  }, [obligations, visibility.outstanding, urlSearch, clientFilter, kindFilter]);

  const entries = useMemo<CalendarEntry[]>(
    () => [...visible.map(transactionEntry), ...outstanding.map(obligationEntry).filter((e): e is CalendarEntry => e !== null)],
    [visible, outstanding],
  );

  const openTx = paymentId ? (report?.transactions.find((t) => t.payment_id === paymentId) ?? null) : null;

  // `?day=` holds a date or `week:<start>`; either way the panel lists the
  // same records the calendar summed for that scope.
  const selection = calendarSelectionScope(dayKey, cursor, grid);
  // Nothing selected → the panel covers the visible month (or week) itself.
  const scope = selection ?? calendarPeriodScope(cursor, grid);
  const scopeKeys = new Set(scope.keys);
  const dayItems: DayDetailItem[] = [
    ...visible.filter((tx) => scopeKeys.has(tx.received_date)).map((tx) => ({ type: "transaction" as const, tx })),
    ...outstanding.filter((o) => scopeKeys.has(o.due_date as string)).map((o) => ({ type: "obligation" as const, o })),
  ];
  const scopeSummary = sumTotals(scope.keys, totalsByDay(entries));

  const hasActiveFilters = Boolean(urlSearch || kindFilter || statusFilter || clientFilter);

  // The selection's panel is always beside the calendar (under it when
  // the container is narrow): the breakdown + records for `?day=`, or a
  // resting "Select a day" state. It sits in a fixed slot so selecting
  // never remounts the calendar or moves focus off the tile.
  const receivedStatus = error ? "error" : report ? "ready" : "loading";
  const outstandingStatus = obligationsError ? "error" : obligations ? "ready" : "loading";
  const period = calendarPeriodBounds(cursor, grid);
  const inView = selection !== null && selection.keys.some((k) => k >= period.start && k <= period.end);
  const dayPanel = selection && !inView ? (
    // Only this period's payments are loaded, so a selection left behind
    // by month navigation is named, not shown with missing figures.
    <CalendarDetailPlaceholder
      message={`The selected ${selection.kind === "week" ? "week" : "date"} is outside ${calendarRangeLabel(cursor, grid)}, so its figures aren't loaded here. Go back to it, or choose a day in this ${grid}.`}
      onClear={closeDay}
    />
  ) : (
    <DayDetailPanel
      variant="inline"
      scopeKind={scope.kind}
      periodLabel={calendarRangeLabel(cursor, grid)}
      dateKey={scope.kind === "day" ? scope.keys[0] : null}
      heading={scope.kind === "day" ? undefined : scope.heading}
      description={scope.kind === "week" ? scope.description : undefined}
      summary={scopeSummary}
      summarySeries={visibility}
      summaryStatus={{ received: receivedStatus, outstanding: outstandingStatus }}
      selectionKeys={scope.keys}
      groupLabels={CALENDAR_GROUP_LABELS}
      items={dayItems}
      currency={currency}
      onClose={closeDay}
      onOpenTransaction={openPayment}
      onRecordPayment={onRecordObligation}
    />
  );

  // The calendar frame (and its Month/Week/prev/next/Today controls)
  // stays up through every state — still loading (a fresh range's
  // report hasn't arrived yet), genuinely empty, or filtered to
  // nothing — rather than disappearing and reappearing around it. Only
  // the status line below it changes.
  return (
    <div>
      <div className="@container">
        <div className={CALENDAR_SPLIT}>
          <div className={CALENDAR_COLUMN}>
            <RevenueCalendar
              cursor={cursor}
              grid={grid}
              entries={entries}
              currency={currency}
              onDayClick={openDay}
              onWeekClick={openWeek}
              selectedDay={selection?.kind === "day" ? selection.keys[0] : null}
              selectedWeek={selection?.kind === "week" ? selection.weekStart : null}
              todayKey={todayKey}
              showReceived={visibility.received}
              showOutstanding={visibility.outstanding}
              primary="received"
              shade
              receivedStatus={receivedStatus}
              outstandingStatus={outstandingStatus}
            />

            {error ? (
              <div className="mt-3">
                <ErrorState message={error} onRetry={onRetry} compact />
              </div>
            ) : !report ? (
              <ContentLoadingIndicator variant="clients" label="Loading payments…" className="mt-3" />
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
          </div>
          <div className={CALENDAR_PANEL_SLOT}>{dayPanel}</div>
        </div>
      </div>

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
