"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type HostingPlan, type NextPaymentObligation, type RevenueTransaction, type WebsiteAgreement } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { withParam } from "@/lib/url";
import { CompactSelect } from "@/components/ui/CompactSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import type { FilterChip } from "@/components/ui/FilterChips";
import { FilterField } from "@/components/ui/FilterPopover";
import type { RevenueFilterUi } from "./revenueFilterUi";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { RecordPaymentModal } from "@/components/billing/RecordPaymentModal";
import { CALENDAR_COLUMN, CALENDAR_GROUP_LABELS, CALENDAR_PANEL_SLOT, CALENDAR_SPLIT, CalendarDetailPlaceholder, DayDetailPanel, type DayDetailItem } from "./DayDetailPanel";
import { calendarPeriodBounds, calendarRangeLabel } from "@/lib/calendarGrid";
import { obligationMatchesFocus, parseFocus, totalsByDay } from "./revenueVisuals";
import { RevenueCalendar, type CalendarEntry, type CalendarGridMode } from "./RevenueCalendar";
import {
  calendarPeriodScope,
  calendarSelectionScope,
  obligationEntry,
  seriesVisibility,
  sumTotals,
  transactionEntry,
  transactionMatchesShared,
  weekSelectionParam,
} from "./calendarCashFlow";

type TypeFilter = "" | "website" | "hosting";

// The `day` URL param doubles as the panel selector: a real "YYYY-MM-DD"
// opens that date's panel, and these two sentinels (never a valid date
// string) open the overdue strip's or the due-date-not-set indicator's
// panel instead — one param, three trigger points, no extra state.
export const OVERDUE_SENTINEL = "overdue";
const NO_DUE_DATE_SENTINEL = "no-due-date";

function useUrlParam() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  function setParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value || null)}`, { scroll: false });
  }
  return { searchParams, setParam };
}

/** The Upcoming view's own secondary filters — type, client — returned
 * as the body of the shared Filters popover plus the matching chips. No
 * currency filter: see usePaymentsFilters' identical note (one workspace
 * currency, nothing to separate). No status/sort: the calendar itself is
 * the grouping now. */
export function useUpcomingFilters(clients: { id: string; business_name: string }[]): RevenueFilterUi {
  const { searchParams, setParam } = useUrlParam();
  const typeFilter = (searchParams.get("type") as TypeFilter | null) ?? "";
  const clientFilter = searchParams.get("client") ?? "";

  const typeOptions = [
    { value: "", label: "Website & hosting" },
    { value: "website", label: "Website only" },
    { value: "hosting", label: "Hosting only" },
  ];
  const clientOptions = [
    { value: "", label: "Any client" },
    ...clients.map((c) => ({ value: c.id, label: c.business_name })),
  ];

  const chips: FilterChip[] = [];
  if (typeFilter) chips.push({ id: "type", label: "Type", value: typeOptions.find((o) => o.value === typeFilter)?.label ?? typeFilter, onRemove: () => setParam("type", null) });
  if (clientFilter) chips.push({ id: "client", label: "Client", value: clients.find((c) => c.id === clientFilter)?.business_name ?? "Unknown", onRemove: () => setParam("client", null) });

  const panel = (
    <>
      <FilterField label="Type">
        <CompactSelect aria-label="Filter by payment type" value={typeFilter} onValueChange={(v) => setParam("type", v)} options={typeOptions} />
      </FilterField>
      <FilterField label="Client">
        <CompactSelect aria-label="Filter by client" value={clientFilter} onValueChange={(v) => setParam("client", v)} options={clientOptions} />
      </FilterField>
    </>
  );
  return { panel, chips };
}

/** Compact strip above the calendar — every overdue obligation stays
 * reachable here regardless of which month/week the calendar is
 * currently showing (an overdue charge from three months ago doesn't
 * become invisible just because the calendar has since moved on). */
function OverdueStrip({ obligations, currency, onOpen }: { obligations: NextPaymentObligation[]; currency: string; onOpen: () => void }) {
  if (obligations.length === 0) return null;
  const total = obligations.reduce((sum, o) => sum + o.amount_cents, 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-l-2 border-border border-l-red-500 bg-surface px-3 py-2 text-left hover:bg-surface-hover"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600 dark:bg-red-400" />
        {obligations.length} overdue payment{obligations.length === 1 ? "" : "s"}
      </span>
      <span className="shrink-0 text-sm tabular-nums text-fg-muted">{formatMoney(total, currency)} →</span>
    </button>
  );
}

/** A separate, equally compact indicator for unpaid obligations with no
 * due date at all — they can never be placed on the calendar grid, so
 * without this they'd simply vanish from view. */
function NoDueDateStrip({ obligations, onOpen }: { obligations: NextPaymentObligation[]; onOpen: () => void }) {
  if (obligations.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left hover:bg-surface-hover"
    >
      <span className="text-sm text-fg-muted">
        {obligations.length} payment{obligations.length === 1 ? "" : "s"} with due date not set
      </span>
      <span className="shrink-0 text-sm text-fg-subtle">→</span>
    </button>
  );
}

/**
 * The Revenue page's upcoming/overdue calendar — every unpaid
 * obligation across the whole workspace plotted on its due date
 * (scheduled hosting charges included, distinguished from issued ones
 * via their own "Scheduled" tag rather than a separate obligation).
 * `q`/`type`/`client`/calendar cursor/grid come from the shared
 * toolbar the parent renders — read here, not re-implemented.
 */
export function UpcomingOverdueTab({
  currency,
  cursor,
  grid,
  dataVersion,
  onChanged,
  onClearAll,
  transactions,
  transactionsError,
  onOpenTransaction,
  todayKey,
}: {
  currency: string;
  cursor: Date;
  grid: CalendarGridMode;
  dataVersion: number;
  onChanged: () => void;
  /** Clears the shared search box too — owned by the parent toolbar; see PaymentsTab's identical prop for why this can't just be a local setParam("q", null). */
  onClearAll: () => void;
  /** The calendar period's payments (the parent's existing report) — the
   * calendar's Received series. `null` while loading. */
  transactions: RevenueTransaction[] | null;
  /** Set when that report failed — Received then shows as unavailable, never $0. */
  transactionsError: string | null;
  /** Opens a payment's existing detail panel (switches to Payments). */
  onOpenTransaction: (paymentId: string) => void;
  /** Today in the workspace timezone (YYYY-MM-DD). */
  todayKey: string;
}) {
  const { searchParams, setParam } = useUrlParam();
  const search = (searchParams.get("q") ?? "").trim().toLowerCase();
  const typeFilter = (searchParams.get("type") as TypeFilter | null) ?? "";
  const clientFilter = searchParams.get("client") ?? "";
  // Summary-box focus (Expected hosting / Overdue) — narrows the records
  // shown, never the headline totals above (see revenueVisuals.ts).
  const focus = parseFocus(searchParams.get("focus"));
  const dayParam = searchParams.get("day");

  const [obligations, setObligations] = useState<NextPaymentObligation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    obligation: NextPaymentObligation;
    agreement: WebsiteAgreement | null;
    hostingPlans: HostingPlan[];
  } | null>(null);

  function load() {
    api
      .getWorkspaceObligations()
      .then((o) => {
        setError(null);
        setObligations(o);
      })
      .catch(() => setError("Couldn't load upcoming & overdue payments."));
  }

  useEffect(load, [dataVersion]);

  async function handleRecordPayment(o: NextPaymentObligation) {
    const [agreement, hostingPlans] = await Promise.all([
      api.getAgreement(o.project_id).catch(() => null),
      api.listHostingPlans(o.project_id).catch(() => []),
    ]);
    setPaymentModal({ obligation: o, agreement, hostingPlans });
  }

  function openDay(key: string) {
    setParam("day", key);
  }
  function closeDay() {
    setParam("day", null);
  }
  function openWeek(weekStart: string) {
    setParam("day", weekSelectionParam(weekStart));
  }

  const visible = useMemo(() => {
    if (!obligations) return [];
    return obligations.filter((o) => {
      if (typeFilter === "website" && !o.kind.startsWith("website")) return false;
      if (typeFilter === "hosting" && !o.kind.startsWith("hosting")) return false;
      if (clientFilter && o.client_id !== clientFilter) return false;
      if (!obligationMatchesFocus(o, focus)) return false;
      if (!search) return true;
      return (
        (o.client_business_name ?? "").toLowerCase().includes(search) || o.project_name.toLowerCase().includes(search)
      );
    });
  }, [obligations, search, typeFilter, clientFilter, focus]);

  const overdue = useMemo(() => visible.filter((o) => o.is_overdue && !o.scheduled), [visible]);
  const noDueDate = useMemo(() => visible.filter((o) => o.due_date === null), [visible]);
  const onCalendar = useMemo(() => visible.filter((o) => o.due_date !== null), [visible]);

  // The Received series beside this view's obligations: the calendar
  // period's payments narrowed by the filters both series share. The
  // Hosting-charges and Overdue focuses narrow to obligations only, so
  // Received is hidden then (calendarCashFlow.ts).
  const visibility = seriesVisibility("upcoming", focus, "");
  const receipts = useMemo(() => {
    if (!visibility.received || !transactions) return [];
    const shared = { q: search, clientId: clientFilter, type: typeFilter };
    return transactions.filter((tx) => transactionMatchesShared(tx, shared));
  }, [transactions, visibility.received, search, clientFilter, typeFilter]);

  const entries = useMemo<CalendarEntry[]>(
    () => [...onCalendar.map(obligationEntry).filter((e): e is CalendarEntry => e !== null), ...receipts.map(transactionEntry)],
    [onCalendar, receipts],
  );

  // `?day=` is a date, `week:<start>`, or one of this view's sentinels.
  const selection = calendarSelectionScope(dayParam, cursor, grid);
  const selectedKeys = selection ? new Set(selection.keys) : null;
  // A calendar selection's panel sits beside (or under) the calendar; the
  // overdue / no-due-date lists stay drawers.
  const receivedStatus = transactionsError ? "error" : transactions ? "ready" : "loading";
  const period = calendarPeriodBounds(cursor, grid);

  const panel: {
    heading?: string;
    description?: string;
    dateKey: string | null;
    items: DayDetailItem[];
    summary?: ReturnType<typeof sumTotals>;
    calendar?: boolean;
  } | null = !dayParam
    ? null
    : dayParam === OVERDUE_SENTINEL
      ? {
          heading: `Overdue payments (${overdue.length})`,
          description: "All overdue as of today, across every month — not just the month shown.",
          dateKey: null,
          items: overdue.map((o) => ({ type: "obligation", o })),
        }
      : dayParam === NO_DUE_DATE_SENTINEL
        ? {
            heading: `Due date not set (${noDueDate.length})`,
            dateKey: null,
            items: noDueDate.map((o) => ({ type: "obligation", o })),
          }
        : selection && selectedKeys
          ? {
              dateKey: selection.kind === "day" ? selection.keys[0] : null,
              heading: selection.kind === "week" ? selection.heading : undefined,
              description: selection.kind === "week" ? selection.description : undefined,
              summary: sumTotals(selection.keys, totalsByDay(entries)),
              calendar: true,
              items: [
                ...receipts.filter((tx) => selectedKeys.has(tx.received_date)).map((tx) => ({ type: "transaction" as const, tx })),
                ...onCalendar.filter((o) => selectedKeys.has(o.due_date as string)).map((o) => ({ type: "obligation" as const, o })),
              ],
            }
          : null;

  if (error) {
    return <ErrorState message={error} onRetry={load} compact />;
  }

  if (!obligations) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (obligations.length === 0) {
    return (
      <EmptyState
        title="No upcoming or overdue payments"
        description="Nothing is scheduled or unpaid right now — a calm balance sheet."
      />
    );
  }

  const hasActiveFilters = Boolean(search || typeFilter || clientFilter);
  const inView = selection !== null && selection.keys.some((k) => k >= period.start && k <= period.end);
  // The always-present inline slot: the selection's breakdown + records,
  // a note when month navigation left the selection behind, or "Select a
  // day". A fixed slot, so selecting never remounts the calendar.
  // Nothing selected (or a drawer list open) → the visible period itself.
  const scope = selection ?? calendarPeriodScope(cursor, grid);
  const scopeKeys = new Set(scope.keys);
  const inlineSlot =
    selection && !inView ? (
      <CalendarDetailPlaceholder
        message={`The selected ${selection.kind === "week" ? "week" : "date"} is outside ${calendarRangeLabel(cursor, grid)}, so its payments aren't loaded here. Go back to it, or choose a day in this ${grid}.`}
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
        summary={sumTotals(scope.keys, totalsByDay(entries))}
        summarySeries={visibility}
        summaryStatus={{ received: receivedStatus, outstanding: "ready" }}
        selectionKeys={scope.keys}
        groupLabels={CALENDAR_GROUP_LABELS}
        items={[
          ...receipts.filter((tx) => scopeKeys.has(tx.received_date)).map((tx) => ({ type: "transaction" as const, tx })),
          ...onCalendar.filter((o) => scopeKeys.has(o.due_date as string)).map((o) => ({ type: "obligation" as const, o })),
        ]}
        currency={currency}
        onClose={closeDay}
        onOpenTransaction={onOpenTransaction}
        onRecordPayment={handleRecordPayment}
      />
    );
  // The overdue / no-due-date lists (not calendar dates) keep the drawer.
  const drawerPanel =
    panel && !panel.calendar ? (
      <DayDetailPanel
        dateKey={panel.dateKey}
        heading={panel.heading}
        description={panel.description}
        items={panel.items}
        currency={currency}
        onClose={closeDay}
        onOpenTransaction={onOpenTransaction}
        onRecordPayment={handleRecordPayment}
      />
    ) : null;

  return (
    <div className="content-reveal">
      <div className="space-y-2">
        <OverdueStrip obligations={overdue} currency={currency} onOpen={() => setParam("day", OVERDUE_SENTINEL)} />
        <NoDueDateStrip obligations={noDueDate} onOpen={() => setParam("day", NO_DUE_DATE_SENTINEL)} />
      </div>

      {/* The calendar frame (and its own Month/Week/prev/next/Today
          controls) stays up even when the current filters match
          nothing — same reasoning as Payments' identical case. */}
      <div className="mt-3 @container">
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
              primary="outstanding"
              receivedStatus={receivedStatus}
            />
          </div>
          <div className={CALENDAR_PANEL_SLOT}>{inlineSlot}</div>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-fg-subtle">No matching payments. Try a different search or filter.</p>
          {hasActiveFilters && (
            <button onClick={onClearAll} className="text-sm text-fg-muted hover:text-fg hover:underline">
              Clear filters
            </button>
          )}
        </div>
      )}

      {drawerPanel}

      {paymentModal && (
        <RecordPaymentModal
          projectId={paymentModal.obligation.project_id}
          agreement={paymentModal.agreement}
          hostingPlans={paymentModal.hostingPlans}
          currency={currency}
          initialAllocation={
            paymentModal.obligation.website_agreement_id
              ? { type: "agreement", id: paymentModal.obligation.website_agreement_id }
              : paymentModal.obligation.hosting_charge_id
                ? { type: "hosting_charge", id: paymentModal.obligation.hosting_charge_id }
                : undefined
          }
          initialAmountCents={paymentModal.obligation.amount_cents}
          onClose={() => setPaymentModal(null)}
          onSaved={() => {
            setPaymentModal(null);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
