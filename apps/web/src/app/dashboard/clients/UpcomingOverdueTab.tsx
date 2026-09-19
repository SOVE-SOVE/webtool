"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type HostingPlan, type NextPaymentObligation, type WebsiteAgreement } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { NEXT_PAYMENT_KIND_LABEL, obligationKey } from "@/lib/billing";
import { withParam } from "@/lib/url";
import { CompactSelect } from "@/components/ui/CompactSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import type { FilterChip } from "@/components/ui/FilterChips";
import { FilterField } from "@/components/ui/FilterPopover";
import type { RevenueFilterUi } from "./revenueFilterUi";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { RecordPaymentModal } from "@/components/billing/RecordPaymentModal";
import { DayDetailPanel, type DayDetailItem } from "./DayDetailPanel";
import { RevenueCalendar, type CalendarEntry, type CalendarEntryStatus, type CalendarGridMode } from "./RevenueCalendar";

type TypeFilter = "" | "website" | "hosting";

// The `day` URL param doubles as the panel selector: a real "YYYY-MM-DD"
// opens that date's panel, and these two sentinels (never a valid date
// string) open the overdue strip's or the due-date-not-set indicator's
// panel instead — one param, three trigger points, no extra state.
const OVERDUE_SENTINEL = "overdue";
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

function obligationStatus(o: NextPaymentObligation): CalendarEntryStatus {
  if (o.is_overdue) return "overdue";
  if (o.days_relative === 0) return "due_today";
  return "upcoming";
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
  onCursorChange,
  onGridChange,
  dataVersion,
  onChanged,
  onClearAll,
  onRecordPayment,
}: {
  currency: string;
  cursor: Date;
  grid: CalendarGridMode;
  onCursorChange: (next: Date) => void;
  onGridChange: (next: CalendarGridMode) => void;
  dataVersion: number;
  onChanged: () => void;
  /** Clears the shared search box too — owned by the parent toolbar; see PaymentsTab's identical prop for why this can't just be a local setParam("q", null). */
  onClearAll: () => void;
  /** Owned by ClientsRevenueTab — passed straight through to the calendar's own toolbar, which is where this control now lives. Distinct from this file's own `handleRecordPayment` (which opens RecordPaymentModal for one specific obligation row) — this one opens the client/project-picker launcher, same as the old beside-Today-box button did. */
  onRecordPayment: () => void;
}) {
  const { searchParams, setParam } = useUrlParam();
  const search = (searchParams.get("q") ?? "").trim().toLowerCase();
  const typeFilter = (searchParams.get("type") as TypeFilter | null) ?? "";
  const clientFilter = searchParams.get("client") ?? "";
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

  const visible = useMemo(() => {
    if (!obligations) return [];
    return obligations.filter((o) => {
      if (typeFilter === "website" && !o.kind.startsWith("website")) return false;
      if (typeFilter === "hosting" && !o.kind.startsWith("hosting")) return false;
      if (clientFilter && o.client_id !== clientFilter) return false;
      if (!search) return true;
      return (
        (o.client_business_name ?? "").toLowerCase().includes(search) || o.project_name.toLowerCase().includes(search)
      );
    });
  }, [obligations, search, typeFilter, clientFilter]);

  const overdue = useMemo(() => visible.filter((o) => o.is_overdue), [visible]);
  const noDueDate = useMemo(() => visible.filter((o) => o.due_date === null), [visible]);
  const onCalendar = useMemo(() => visible.filter((o) => o.due_date !== null), [visible]);

  const entries = useMemo<CalendarEntry[]>(
    () =>
      onCalendar.map((o) => ({
        key: obligationKey(o),
        dateKey: o.due_date as string,
        clientName: o.client_business_name ?? "No client",
        amountCents: o.amount_cents,
        status: obligationStatus(o),
        typeLabel: NEXT_PAYMENT_KIND_LABEL[o.kind],
        scheduled: o.scheduled,
        onClick: () => openDay(o.due_date as string),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onCalendar],
  );

  const panel: { heading?: string; dateKey: string | null; items: DayDetailItem[] } | null = !dayParam
    ? null
    : dayParam === OVERDUE_SENTINEL
      ? { heading: `Overdue payments (${overdue.length})`, dateKey: null, items: overdue.map((o) => ({ type: "obligation", o })) }
      : dayParam === NO_DUE_DATE_SENTINEL
        ? {
            heading: `Due date not set (${noDueDate.length})`,
            dateKey: null,
            items: noDueDate.map((o) => ({ type: "obligation", o })),
          }
        : {
            dateKey: dayParam,
            items: onCalendar.filter((o) => o.due_date === dayParam).map((o) => ({ type: "obligation", o })),
          };

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

  return (
    <div>
      <div className="space-y-2">
        <OverdueStrip obligations={overdue} currency={currency} onOpen={() => setParam("day", OVERDUE_SENTINEL)} />
        <NoDueDateStrip obligations={noDueDate} onOpen={() => setParam("day", NO_DUE_DATE_SENTINEL)} />
      </div>

      {/* The calendar frame (and its own Month/Week/prev/next/Today
          controls) stays up even when the current filters match
          nothing — same reasoning as Payments' identical case. */}
      <div className="mt-3">
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

      {panel && (
        <DayDetailPanel
          dateKey={panel.dateKey}
          heading={panel.heading}
          items={panel.items}
          currency={currency}
          onClose={closeDay}
          onRecordPayment={handleRecordPayment}
        />
      )}

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
