"use client";

import { useId, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { NextPaymentObligation, RevenueReport } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  activeHostingClients,
  percentChange,
  receiptsByCategory,
  weeklyCashFlow,
  type WeekFlow,
} from "./revenueAnalytics";
import { overdueAgeBuckets, type RevenueFocus } from "./revenueVisuals";
import { HostingPlansList, MetricDefinition, OverdueAgeList, SnapshotMetric } from "./RevenueSummaryBoxes";
import { ReceiptsDonut } from "./ReceiptsDonut";
import { WeeklyCashFlowChart } from "./WeeklyCashFlowChart";
import { plural, rangeLabel } from "./revenueChartParts";

/** The Revenue summary cards, then the two charts. Expanded, the summary
 * is a row of cards above the charts (2 across on small screens, 3 at lg,
 * all 5 at xl) — beside the charts it was far taller than the one charts
 * row and left a tall empty band. Collapsing hides the row, so the charts
 * sit directly under the header — never an empty row. */
const ANALYTICS_GRID = "grid grid-cols-1 gap-4";
const ANALYTICS_GRID_COLLAPSED = "grid grid-cols-1 gap-4";
// The charts row sizes on its OWN width (container query), not the
// viewport — the metric column may or may not be beside it. With room,
// "Received by type" takes only the width its content needs (capped at
// 28rem) beside a wider "Weekly cash flow", each at its own height (no
// stretched blank card); otherwise they stack.
const CHARTS_CONTAINER = "@container min-w-0";
const CHARTS_GRID = "grid grid-cols-1 gap-4 @[52rem]:grid-cols-[fit-content(28rem)_minmax(0,1fr)] @[52rem]:items-start";
// Equal columns, and from sm up every row as tall as the tallest card
// (`auto-rows-fr`, cards stretch) — so wrapped rows match too. Equal height
// comes from the grid, never from clipping: each card is label → figure →
// footer (pinned to the bottom), and breakdowns open in a popover instead
// of growing one card. One column on phones, at each card's own height.
const METRIC_COLUMN = "grid grid-cols-1 gap-3 sm:auto-rows-fr sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
const METRIC_CARD = "card";

type Previous = { start: string; end: string; elapsedOnly: boolean; report: RevenueReport | null } | null;

/* Whether the Revenue summary column is collapsed — remembered per
 * browser under a `wdos-*` key (same convention as the sidebar's
 * SIDEBAR_COLLAPSED_KEY). Read through useSyncExternalStore so the server
 * render and first client paint agree (expanded), then the stored choice
 * applies. Storage failures fall back to an in-memory value, so the toggle
 * still works for this session. */
const SUMMARY_COLLAPSED_KEY = "wdos-revenue-summary-collapsed";
let summaryCollapsed: boolean | null = null;
const summaryListeners = new Set<() => void>();

function readSummaryCollapsed(): boolean {
  if (summaryCollapsed === null) {
    try {
      summaryCollapsed = localStorage.getItem(SUMMARY_COLLAPSED_KEY) === "1";
    } catch {
      summaryCollapsed = false;
    }
  }
  return summaryCollapsed;
}

function setSummaryCollapsed(next: boolean) {
  summaryCollapsed = next;
  try {
    localStorage.setItem(SUMMARY_COLLAPSED_KEY, next ? "1" : "0");
  } catch {
    // Storage disabled — remembered for this session only.
  }
  summaryListeners.forEach((l) => l());
}

function subscribeSummaryCollapsed(listener: () => void) {
  summaryListeners.add(listener);
  return () => {
    summaryListeners.delete(listener);
  };
}

function useSummaryCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribeSummaryCollapsed, readSummaryCollapsed, () => false);
  return [collapsed, () => setSummaryCollapsed(!collapsed)];
}

/**
 * The analytics area's one heading row: the Revenue summary disclosure
 * (a real button — aria-expanded/aria-controls, native Enter/Space), a
 * read-only line of the headline figures while collapsed, and the analytics
 * Range selector beside the period it sets (it drives these charts and
 * cards, never the calendar below).
 */
function AnalyticsHeader({
  collapsed,
  onToggle,
  controlsId,
  rangeText,
  summary,
  today,
  rangeControl,
}: {
  collapsed: boolean;
  onToggle: () => void;
  controlsId: string;
  rangeText: string;
  summary: ReactNode;
  /** Today's compact entry point — shown while collapsed, since the Today box is in the hidden column. */
  today: ReactNode;
  /** The analytics Range selector — it sets this period, so it sits here with the charts. */
  rangeControl?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="text-sm font-semibold text-fg">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls={controlsId}
          className="-ml-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1.5 transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform duration-fast ease-standard motion-reduce:transition-none ${
              collapsed ? "-rotate-90" : ""
            }`}
          />
          Revenue summary
        </button>
      </h2>
      {collapsed && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {summary}
          {summary && (
            <span aria-hidden="true" className="text-xs text-fg-subtle">
              ·
            </span>
          )}
          {today}
        </div>
      )}
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {rangeControl}
        <p className="text-xs tabular-nums text-fg-muted">{rangeText}</p>
      </div>
    </div>
  );
}

/** Loading placeholder in the grid's own shape, so nothing jumps. */
function AnalyticsSkeleton({ collapsed, summaryId, todayCard }: { collapsed: boolean; summaryId: string; todayCard: ReactNode }) {
  const metric = (key: number) => (
    <div key={key} className={`${METRIC_CARD} px-4 py-3`}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2.5 h-7 w-28" />
      <Skeleton className="mt-3 h-3 w-20" />
    </div>
  );
  const chart = (className: string, plot: string) => (
    <div className={`card min-w-0 px-4 py-3 ${className}`}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className={`mt-5 w-full ${plot}`} />
      <Skeleton className="mt-2 h-3 w-2/3" />
    </div>
  );
  // Same shape as the compact donut card: ring beside (or above) two legend rows.
  const donut = (
    <div className="card min-w-0 px-4 py-3">
      <Skeleton className="h-4 w-32" />
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
        <Skeleton className="size-36 shrink-0 rounded-full" />
        <div className="min-w-[13rem] max-w-sm flex-1 space-y-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    </div>
  );
  return (
    <div aria-busy="true" aria-label="Revenue analytics, loading" className={collapsed ? ANALYTICS_GRID_COLLAPSED : ANALYTICS_GRID}>
      <div id={summaryId} hidden={collapsed} className={METRIC_COLUMN}>
        {todayCard}
        {[0, 1, 2, 3].map(metric)}
      </div>
      <div className={CHARTS_CONTAINER}>
        <div className={CHARTS_GRID}>
          {donut}
          {/* ≈ the compact weekly card's loaded height (~197px), so it doesn't jump. */}
          {chart("", "h-29")}
        </div>
      </div>
    </div>
  );
}

/** The Received card's change vs the previous period — only when an
 * honest comparison exists. `short` is the card's footer ("▲ +12% vs
 * prior period"); `full` names the comparison period, for the card's
 * info popover. */
function comparisonTo(current: number, previous: Previous): { short: ReactNode; full: string } | null {
  if (!previous?.report) return null;
  const pct = percentChange(current, previous.report.total_payments_received_cents, true);
  if (pct === null) return null;
  const rounded = Math.round(pct);
  const period = rangeLabel(previous.start, previous.end, false);
  const glyph = rounded > 0 ? "▲" : rounded < 0 ? "▼" : "";
  const text = rounded === 0 ? "No change" : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
  return {
    short: (
      <span className="inline-flex items-baseline gap-1">
        {glyph && (
          <span aria-hidden="true" className="text-[9px] leading-none">
            {glyph}
          </span>
        )}
        <span>
          <span className="font-medium text-fg">{text}</span> vs prior period
        </span>
      </span>
    ),
    full: `${text} compared with ${period}${previous.elapsedOnly ? " (the same number of days before)" : ""}.`,
  };
}

/**
 * Revenue analytics (Payments and Upcoming views): a narrow column of
 * metric cards, then "Received by type" and "Weekly cash flow" side by
 * side. Period figures follow the
 * selected range; Overdue, Expected hosting and Active hosting clients are
 * current balances as of today and say so. Chart selections narrow the
 * calendar below — the headline figures never change with them. The metric
 * column (Today + the four cards) is the collapsible "Revenue summary";
 * collapsed, the heading row keeps the headline figures and Today's entry.
 */
export function RevenueAnalyticsGrid({
  todayCard,
  todayInline,
  report,
  error,
  onRetry,
  range,
  today,
  historyStart,
  previous,
  currency,
  clientFilter,
  obligations,
  obligationsError,
  focus,
  onToggleFocus,
  onViewAllOverdue,
  kind,
  onSelectKind,
  onWeekClick,
  rangeControl,
}: {
  /** The Today box — heads the Revenue summary column. */
  todayCard: ReactNode;
  /** Today's compact form, for the collapsed summary line. */
  todayInline: ReactNode;
  report: RevenueReport | null;
  error: string | null;
  onRetry: () => void;
  range: { start: string; end: string };
  today: string;
  historyStart: string | null;
  previous: Previous;
  currency: string;
  clientFilter: string | null;
  obligations: NextPaymentObligation[] | null;
  obligationsError: string | null;
  focus: RevenueFocus | null;
  onToggleFocus: (f: RevenueFocus) => void;
  onViewAllOverdue: () => void;
  kind: "website" | "hosting" | null;
  onSelectKind: (k: "website" | "hosting") => void;
  onWeekClick: (w: WeekFlow) => void;
  /** The analytics Range selector, shown in the header beside the period it sets. */
  rangeControl?: ReactNode;
}) {
  const transactions = report?.transactions;
  const slices = useMemo(() => receiptsByCategory(transactions ?? [], clientFilter), [transactions, clientFilter]);
  const weeks = useMemo(
    () => weeklyCashFlow(range.start, range.end, transactions ?? [], obligationsError ? null : obligations, today, clientFilter, historyStart),
    [range.start, range.end, transactions, obligations, obligationsError, today, clientFilter, historyStart],
  );

  const summaryId = useId();
  const [collapsed, toggleCollapsed] = useSummaryCollapsed();
  const rangeText = rangeLabel(range.start, range.end);

  // Read-only, same figures as the cards — never a second focus control.
  const summaryLine = report && (
    <p className="min-w-0 text-xs tabular-nums text-fg-muted">
      Received <span className="font-medium text-fg">{formatMoney(report.total_payments_received_cents, currency)}</span>
      <span aria-hidden="true"> · </span>
      Overdue{" "}
      <span className={`font-medium ${report.overdue_cents > 0 ? "text-red-700 dark:text-red-400" : "text-fg"}`}>
        {formatMoney(report.overdue_cents, currency)}
      </span>
      <span aria-hidden="true"> · </span>
      Expected hosting <span className="font-medium text-fg">{formatMoney(report.expected_mrr_cents, currency)}</span>/mo
    </p>
  );

  const header = (
    <AnalyticsHeader collapsed={collapsed} onToggle={toggleCollapsed} controlsId={summaryId} rangeText={rangeText} summary={summaryLine} today={todayInline} rangeControl={rangeControl} />
  );

  if (error && !report) {
    // Today doesn't depend on the analytics report, so it stays in its column.
    return (
      <div className="space-y-3">
        {header}
        <div className={collapsed ? ANALYTICS_GRID_COLLAPSED : ANALYTICS_GRID}>
          <div id={summaryId} hidden={collapsed} className={METRIC_COLUMN}>
            {todayCard}
          </div>
          <div className="min-w-0">
            <ErrorState message={error} onRetry={onRetry} compact />
          </div>
        </div>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="space-y-3">
        {header}
        <AnalyticsSkeleton collapsed={collapsed} summaryId={summaryId} todayCard={todayCard} />
      </div>
    );
  }

  const plans = report.expected_hosting_plans;
  const overdueItems = report.overdue_items;
  const isOverdue = report.overdue_cents > 0;
  const hosting = plans ? activeHostingClients(plans) : null;
  const filtered = Boolean(clientFilter);
  const comparison = comparisonTo(report.total_payments_received_cents, previous);

  return (
    <div className="space-y-3">
      {header}
      {error && <ErrorState message={error} onRetry={onRetry} compact />}
      <div className={collapsed ? ANALYTICS_GRID_COLLAPSED : ANALYTICS_GRID}>
        {/* Kept mounted while collapsed (`hidden`), so collapsing and
            re-expanding doesn't remount the cards. */}
        <div id={summaryId} hidden={collapsed} className={METRIC_COLUMN}>
          {todayCard}
          <SnapshotMetric
            className={METRIC_CARD}
            label="Received"
            value={formatMoney(report.total_payments_received_cents, currency)}
            footer={comparison?.short}
            pressed={focus === "received"}
            onToggle={() => onToggleFocus("received")}
            focusHint="Show only received payments in the calendar."
            infoLabel="About received"
            info={
              <div className="space-y-1.5">
                <MetricDefinition>Payments received in the selected period, {rangeText}.</MetricDefinition>
                {comparison && <p>{comparison.full}</p>}
              </div>
            }
          />
          <SnapshotMetric
            className={METRIC_CARD}
            label="Monthly hosting"
            value={
              <>
                {formatMoney(report.expected_mrr_cents, currency)}
                <span className="inline-block text-sm font-normal tracking-normal text-fg-muted">/mo</span>
              </>
            }
            footer={plans ? (plans.length > 0 ? plural(plans.length, "active plan") : "No active plans") : undefined}
            pressed={focus === "hosting"}
            onToggle={() => onToggleFocus("hosting")}
            focusHint="Show only hosting charges in the Upcoming calendar."
            infoLabel="About monthly hosting"
            info={
              <div className="space-y-2.5">
                <MetricDefinition>
                  Expected hosting revenue: the monthly fees of all active hosting plans, as of {formatDate(today)}. Not money
                  received.
                </MetricDefinition>
                {plans && <HostingPlansList plans={plans} currency={currency} />}
              </div>
            }
          />
          {/* Restrained overdue emphasis: red value text only, neutral at zero. */}
          <SnapshotMetric
            className={METRIC_CARD}
            label="Overdue"
            value={<span className={isOverdue ? "text-red-700 dark:text-red-400" : undefined}>{formatMoney(report.overdue_cents, currency)}</span>}
            footer={isOverdue ? plural(report.overdue_count, "payment") : "None overdue"}
            pressed={focus === "overdue"}
            onToggle={() => onToggleFocus("overdue")}
            focusHint="Show only overdue payments in the Upcoming calendar."
            infoLabel="About overdue"
            info={(close) => (
              <div className="space-y-2.5">
                <MetricDefinition>
                  Unpaid payments past their due date. A current balance as of {formatDate(today)}, not limited to the
                  selected period.
                </MetricDefinition>
                {overdueItems && overdueItems.length > 0 && (
                  <OverdueAgeList
                    buckets={overdueAgeBuckets(overdueItems)}
                    currency={currency}
                    onViewAll={() => {
                      close();
                      onViewAllOverdue();
                    }}
                  />
                )}
              </div>
            )}
          />
          {hosting && (
            <SnapshotMetric
              className={METRIC_CARD}
              label="Hosting clients"
              value={hosting.clientCount}
              // The plan count only where it adds something: when it differs
              // from the client count (several plans for one client, or
              // plans for prospects). The full split is in the info popover.
              footer={hosting.planCount !== hosting.clientCount ? plural(hosting.planCount, "plan") : undefined}
              pressed={focus === "hosting"}
              onToggle={() => onToggleFocus("hosting")}
              focusHint="Show only hosting charges in the Upcoming calendar."
              infoLabel="About hosting clients"
              info={
                <div className="space-y-1.5">
                  <MetricDefinition>Clients with at least one active hosting plan, as of {formatDate(today)}.</MetricDefinition>
                  <p>
                    {plural(hosting.planCount, "active plan")}
                    {hosting.prospectPlanCount > 0
                      ? `, ${hosting.prospectPlanCount} of them for prospects (not counted as clients).`
                      : "."}
                  </p>
                </div>
              }
            />
          )}
        </div>

        <div className={CHARTS_CONTAINER}>
        <div className={CHARTS_GRID}>
        <ReceiptsDonut slices={slices} rangeText={rangeText} currency={currency} kind={kind} filtered={filtered} onSelect={onSelectKind} />

        <WeeklyCashFlowChart
          weeks={weeks}
          rangeText={rangeText}
          currency={currency}
          today={today}
          obligationsLoading={!obligations && !obligationsError}
          obligationsUnavailable={Boolean(obligationsError)}
          filtered={filtered}
          onWeekClick={onWeekClick}
        />

        </div>
        </div>
      </div>
    </div>
  );
}
