"use client";

import { useId, useState, type ReactNode } from "react";
import { formatMoney } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import type { WeekFlow } from "./revenueAnalytics";
import {
  COLUMN_BUTTON_CLASS,
  ChartCard,
  LegendKey,
  MARK,
  NO_RECORDS_HATCH,
  TOOLTIP_CLASS,
  TableToggleButton,
  TooltipRow,
  barHeight,
  dayMonthLabel,
  niceCeilCents,
  plural,
  rangeLabel,
  tooltipPlacement,
  useColumnNav,
  usePlotWidth,
} from "./revenueChartParts";

const PLOT_HEIGHT_CLASS = "h-26"; // 104px
/** The strip above the plot: the axis maximum (left) and "View as table"
 * (right) share one 24px row, so the card stays as compact as the
 * "Received by type" donut beside it. */
const STRIP_CLASS = "mt-0.5 flex min-h-6 items-center justify-between gap-3";
/** Emphasis only — opacity, never bar geometry, so heights stay exact. */
const SOFTEN_CLASS = "transition-opacity duration-fast ease-standard motion-reduce:transition-none";
/**
 * The active week's bars rise 2px together — a translate on the bars
 * wrapper only (never the column button, so the hit area can't flicker;
 * never scale, so heights stay exact). `motion-fast` carries the opacity
 * fade too. Reduced motion keeps the band + fade, without displacement.
 */
const BARS_CLASS = "motion-fast motion-reduce:transition-none";
const LIFT_CLASS = "-translate-y-[2px] motion-reduce:translate-y-0";

function scheduledCents(w: WeekFlow): number {
  return w.expectedCents + w.overdueCents + w.notInvoicedCents;
}

/** Axis tick only — "$2.5K", "$1.2M" (a non-AUD workspace reads "USD 2.5K").
 * Exact amounts stay in the tooltip, aria-labels and table. */
function compactMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
}

/** Legend swatch for the scheduled bar: its segment hues stacked in bar
 * order (expected over not-yet-invoiced over overdue) — the words in the
 * info panel and tooltip name each one. */
function ScheduledSwatch({ withNotInvoiced }: { withNotInvoiced: boolean }) {
  return (
    <span aria-hidden="true" className="flex h-2.5 w-2 shrink-0 flex-col gap-px overflow-hidden rounded-sm">
      <span className={`flex-1 ${MARK.expected}`} />
      {withNotInvoiced && <span className={`flex-1 ${MARK.notInvoiced}`} />}
      <span className={`flex-1 ${MARK.overdue}`} />
    </span>
  );
}

/** Definition row in the info panel — a key, the term, its meaning. */
function InfoTerm({ swatch, term, children }: { swatch?: ReactNode; term: string; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-[3px] flex w-2 shrink-0 justify-center">{swatch}</span>
      <span>
        <span className="font-medium text-fg">{term}</span> — {children}
      </span>
    </li>
  );
}

/**
 * Weekly cash flow for the selected range — per week, two bars on ONE
 * money axis: received (left) and scheduled (right). The scheduled bar
 * stacks, from the baseline up, overdue → not yet invoiced → expected,
 * separated by 2px surface gaps; its segments are today's unpaid
 * remainders on their due dates (expected, not guaranteed). One tab
 * stop with roving arrow-key focus; hover or focus shows the week's
 * exact figures; activating a week opens the calendar on that week.
 */
export function WeeklyCashFlowChart({
  weeks,
  rangeText,
  currency,
  today,
  obligationsLoading,
  obligationsUnavailable,
  filtered,
  onWeekClick,
  className = "",
}: {
  weeks: WeekFlow[];
  rangeText: string;
  currency: string;
  today: string;
  obligationsLoading: boolean;
  /** Obligations failed to load — receipts still draw, with a note. */
  obligationsUnavailable: boolean;
  filtered: boolean;
  onWeekClick: (week: WeekFlow) => void;
  className?: string;
}) {
  const titleId = useId();
  const tableId = useId();
  const [showTable, setShowTable] = useState(false);
  const n = weeks.length;
  const todayIndex = weeks.findIndex((w) => today >= w.weekStart && today <= w.weekEnd);
  const nav = useColumnNav(n, todayIndex >= 0 ? todayIndex : 0);
  const [measurePlot, plotWidth] = usePlotWidth();

  const hasNotInvoiced = !obligationsUnavailable && weeks.some((w) => w.notInvoicedCents > 0);
  // Weeks entirely before the workspace existed, with nothing in them —
  // "no records", never drawn or announced as a genuine $0 week.
  const hasNoRecords = weeks.some((w) => !w.available);
  // One compact legend: the two bars. The scheduled bar's three hues are
  // named in the info panel and in every tooltip row, never by colour alone.
  // The conditional "No records" key sits in the strip above the plot
  // instead, so the header stays one line beside the donut.
  const legend = (
    <>
      <LegendKey className={MARK.received} label="Received" />
      {!obligationsUnavailable && (
        <span className="inline-flex items-center gap-1.5">
          <ScheduledSwatch withNotInvoiced={hasNotInvoiced} />
          Scheduled outstanding
        </span>
      )}
    </>
  );

  const swatch = (mark: string) => <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${mark}`} />;
  const info = (
    <ul className="space-y-1.5">
      <InfoTerm swatch={swatch(MARK.received)} term="Received">
        net of refunds, on the day it was received.
      </InfoTerm>
      <InfoTerm swatch={<ScheduledSwatch withNotInvoiced />} term="Scheduled outstanding">
        still unpaid today, placed on its due date. Stacked from the top:
        <span className="mt-1 block space-y-0.5">
          <span className="flex items-center gap-1.5">{swatch(MARK.expected)}<span><span className="text-fg">Expected</span> — not guaranteed</span></span>
          <span className="flex items-center gap-1.5">{swatch(MARK.notInvoiced)}<span><span className="text-fg">Not yet invoiced</span></span></span>
          <span className="flex items-center gap-1.5">{swatch(MARK.overdue)}<span><span className="text-fg">Overdue</span> — past due, unpaid</span></span>
        </span>
      </InfoTerm>
      <InfoTerm swatch={<span aria-hidden="true" className={`h-2 w-2 rounded-sm border border-border-strong ${NO_RECORDS_HATCH}`} />} term="Hatched weeks">
        no records, as they&apos;re before this workspace existed.
      </InfoTerm>
      <InfoTerm term="Weeks">run Sunday–Saturday; the first and last are trimmed to the period. Select a week to open it in the calendar.</InfoTerm>
      <InfoTerm term="Currency">amounts in {currency}; the top axis label is the scale&apos;s maximum.</InfoTerm>
    </ul>
  );

  const card = (body: ReactNode, busy = false) => (
    <ChartCard titleId={titleId} title="Weekly cash flow" legend={legend} info={info} className={className} busy={busy}>
      {body}
    </ChartCard>
  );

  if (obligationsLoading) {
    return card(
      <>
        <Skeleton className={`mt-6.5 w-full ${PLOT_HEIGHT_CLASS}`} />
        <Skeleton className="mt-2 h-3 w-2/3" />
      </>,
      true,
    );
  }

  const received = weeks.reduce((s, w) => s + w.receivedCents, 0);
  const scheduled = obligationsUnavailable ? 0 : weeks.reduce((s, w) => s + scheduledCents(w), 0);

  const notes: string[] = [];
  if (obligationsUnavailable) notes.push("Scheduled amounts couldn't be loaded — showing receipts only.");
  if (filtered) notes.push("Filtered by client.");

  if (received === 0 && scheduled === 0) {
    return card(
      <p className="mt-3 text-sm text-fg-subtle">
        {obligationsUnavailable ? "No payments received in this period." : "No payments received or scheduled in this period."}
        {notes.length > 0 && ` ${notes.join(" ")}`}
      </p>,
    );
  }

  const maxCents = niceCeilCents(
    Math.max(...weeks.map((w) => Math.max(w.receivedCents, obligationsUnavailable ? 0 : scheduledCents(w))), 1),
  );
  const activeWeek = nav.active !== null ? weeks[nav.active] : null;
  const labelEvery = Math.max(1, Math.ceil(n / 5));

  function describe(w: WeekFlow): string {
    if (!w.available) return `Week ${rangeLabel(w.weekStart, w.weekEnd)}. No records — before this workspace existed.`;
    const parts = [`Week ${rangeLabel(w.weekStart, w.weekEnd)}`];
    parts.push(`Received ${formatMoney(w.receivedCents, currency)} from ${plural(w.receivedCount, "payment")}`);
    if (obligationsUnavailable) parts.push("Scheduled amounts unavailable");
    else {
      parts.push(`Expected ${formatMoney(w.expectedCents, currency)} (${plural(w.expectedCount, "payment")})`);
      parts.push(`Overdue ${formatMoney(w.overdueCents, currency)} (${plural(w.overdueCount, "payment")})`);
      if (w.notInvoicedCount > 0) parts.push(`Not yet invoiced ${formatMoney(w.notInvoicedCents, currency)} (${plural(w.notInvoicedCount, "charge")})`);
    }
    return `${parts.join(". ")}. Opens this week in the calendar.`;
  }

  const tableRows = weeks.filter((w) => w.receivedCount > 0 || (!obligationsUnavailable && scheduledCents(w) > 0));

  return card(
    <>
      <div className={STRIP_CLASS}>
        <span aria-hidden="true" className="text-[11px] leading-4 tabular-nums text-fg-subtle">
          {compactMoney(maxCents, currency)}
        </span>
        <div className="flex items-center gap-3">
          {hasNoRecords && (
            <span className="text-xs text-fg-muted">
              <LegendKey className={`border border-border-strong ${NO_RECORDS_HATCH}`} label="No records" />
            </span>
          )}
          <TableToggleButton tableId={tableId} open={showTable} onToggle={() => setShowTable((v) => !v)} className="-mr-1" />
        </div>
      </div>
      {/* The tooltip is top-aligned to the plot, so it hangs down over the
          week labels (and, if taller, past the card) — never up over the
          legend or "View as table". */}
      <div ref={measurePlot} className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-border" aria-hidden="true" />

        <div
          role="group"
          aria-label={`Weekly cash flow, ${rangeText}. Arrow keys move between weeks; Enter opens a week in the calendar.`}
          className={`relative grid border-b border-border ${PLOT_HEIGHT_CLASS}`}
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
          onMouseLeave={nav.clearHover}
        >
          {weeks.map((w, i) => {
            const showScheduled = !obligationsUnavailable && scheduledCents(w) > 0;
            // Hover/focus: the active week gets a faint full-height band
            // (the button's own background); the other weeks recede.
            const receded = nav.active !== null && nav.active !== i;
            return (
              <button
                key={w.weekStart}
                type="button"
                {...nav.columnProps(i)}
                aria-label={describe(w)}
                onClick={() => {
                  nav.select(i);
                  onWeekClick(w);
                }}
                className={`${COLUMN_BUTTON_CLASS} px-[10%] ${nav.active === i ? "bg-surface-hover" : ""}`}
              >
                {!w.available ? (
                  <span className={`block h-full w-full max-w-[44px] rounded-t-sm ${SOFTEN_CLASS} ${receded ? "opacity-35" : "opacity-60"} ${NO_RECORDS_HATCH}`} />
                ) : (
                <span
                  className={`flex h-full w-full max-w-[44px] items-end justify-center gap-[2px] ${BARS_CLASS} ${receded ? "opacity-55" : "opacity-100"} ${nav.active === i ? LIFT_CLASS : ""}`}
                >
                  <span className="flex h-full max-w-[20px] flex-1 items-end">
                    {w.receivedCents > 0 && (
                      <span className={`w-full rounded-t-sm ${MARK.received}`} style={{ height: barHeight(w.receivedCents, maxCents) }} />
                    )}
                  </span>
                  <span className="flex h-full max-w-[20px] flex-1 items-end">
                    {showScheduled && (
                      <span className="flex w-full flex-col justify-end gap-[2px]" style={{ height: barHeight(scheduledCents(w), maxCents) }}>
                        {[
                          { cents: w.expectedCents, mark: MARK.expected },
                          { cents: w.notInvoicedCents, mark: MARK.notInvoiced },
                          { cents: w.overdueCents, mark: MARK.overdue },
                        ]
                          .filter((seg) => seg.cents > 0)
                          .map((seg, k) => (
                            <span
                              key={seg.mark}
                              className={`min-h-[2px] w-full ${k === 0 ? "rounded-t-sm" : ""} ${seg.mark}`}
                              style={{ flexGrow: seg.cents, flexBasis: 0 }}
                            />
                          ))}
                      </span>
                    )}
                  </span>
                </span>
                )}
              </button>
            );
          })}
        </div>

        {activeWeek && nav.active !== null && (
          <div aria-hidden="true" style={tooltipPlacement(nav.active, n, plotWidth)} className={TOOLTIP_CLASS}>
            <p className="text-[11px] font-medium text-fg">Week {rangeLabel(activeWeek.weekStart, activeWeek.weekEnd)}</p>
            {!activeWeek.available ? (
              <p className="mt-1 text-xs text-fg-muted">No records — before this workspace existed.</p>
            ) : (
            <div className="mt-1 space-y-0.5 text-xs">
              <TooltipRow keyClass={MARK.received} value={formatMoney(activeWeek.receivedCents, currency)} label={`Received · ${plural(activeWeek.receivedCount, "payment")}`} />
              {obligationsUnavailable ? (
                <p className="text-fg-subtle">Scheduled amounts unavailable</p>
              ) : (
                <>
                  <TooltipRow keyClass={MARK.expected} value={formatMoney(activeWeek.expectedCents, currency)} label={`Expected · ${plural(activeWeek.expectedCount, "payment")}`} />
                  <TooltipRow keyClass={MARK.overdue} value={formatMoney(activeWeek.overdueCents, currency)} label={`Overdue · ${plural(activeWeek.overdueCount, "payment")}`} />
                  {activeWeek.notInvoicedCount > 0 && (
                    <TooltipRow
                      keyClass={MARK.notInvoiced}
                      value={formatMoney(activeWeek.notInvoicedCents, currency)}
                      label={`Not yet invoiced · ${plural(activeWeek.notInvoicedCount, "charge")}`}
                    />
                  )}
                  <p className="flex items-center gap-2 border-t border-border pt-0.5">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0" />
                    <span className="font-medium tabular-nums text-fg">{formatMoney(scheduledCents(activeWeek), currency)}</span>
                    <span className="text-fg-muted">Scheduled outstanding</span>
                  </p>
                </>
              )}
            </div>
            )}
          </div>
        )}

        {/* X axis — sparse week-start labels; the current week emphasised. */}
        <div aria-hidden="true" className="mt-1 grid text-[11px] tabular-nums text-fg-subtle" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {weeks.map((w, i) => (
            <span key={w.weekStart} className={`overflow-visible whitespace-nowrap ${i === todayIndex ? "font-semibold text-fg" : ""}`}>
              {i % labelEvery === 0 ? dayMonthLabel(w.weekStart) : ""}
            </span>
          ))}
        </div>
      </div>

      {/* A data-state note, not fine print — it stays visible (as on the donut). */}
      {notes.length > 0 && <p className="mt-1 text-xs text-fg-subtle">{notes.join(" ")}</p>}
      {showTable && (
        <div id={tableId} className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <caption className="sr-only">Weekly cash flow, {rangeText}. Weeks with nothing received or scheduled are omitted.</caption>
            <thead className="sticky top-0 bg-surface-subtle text-fg-muted">
              <tr>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">Week</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Received</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Expected</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Overdue</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Not invoiced</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-fg">
              {tableRows.map((w) => (
                <tr key={w.weekStart} className="border-t border-border">
                  <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-normal">
                    {rangeLabel(w.weekStart, w.weekEnd, false)}
                  </th>
                  <td className="px-2 py-1.5 text-right">{formatMoney(w.receivedCents, currency)}</td>
                  <td className="px-2 py-1.5 text-right">{obligationsUnavailable ? "—" : formatMoney(w.expectedCents, currency)}</td>
                  <td className="px-2 py-1.5 text-right">{obligationsUnavailable ? "—" : formatMoney(w.overdueCents, currency)}</td>
                  <td className="px-2 py-1.5 text-right">{obligationsUnavailable ? "—" : formatMoney(w.notInvoicedCents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>,
  );
}
