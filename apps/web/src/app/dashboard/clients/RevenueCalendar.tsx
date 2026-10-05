"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { addMonths, addWeeks, calendarRangeLabel, isoToLocalDate, monthGrid, toDateKey, weekGrid, type CalendarGridMode } from "@/lib/calendarGrid";
import { emptyDayTotals, totalsByDay, type DayTotals } from "./revenueVisuals";
import {
  barShare,
  calendarReceivedMaxCents,
  calendarScaleCents,
  calendarWeekTotals,
  outstandingCents,
  outstandingCount,
  receivedShadeLevel,
  trimMonthRows,
} from "./calendarCashFlow";
import {
  adjustmentsLabel,
  compactMoney,
  describeCalendarTotals,
  exactMoney,
  describeDayTotals,
  primaryCents,
  shortSpanLabel,
  type CalendarPrimary,
  type SeriesStatus,
} from "./calendarLabels";
import { InfoPopover, MARK, TOOLTIP_CLASS, TooltipRow, plural } from "./revenueChartParts";
import { Tooltip } from "@/components/ui/Tooltip";

export type { CalendarGridMode };
export { describeDayTotals };
export type { CalendarPrimary, SeriesStatus };

export type CalendarEntryStatus = "paid" | "refunded" | "reversed" | "overdue" | "due_today" | "upcoming";

export type CalendarEntry = {
  /** Stable identifier for the underlying record — a payment_id, or
   * lib/billing.ts's obligationKey() for an obligation — so the same
   * real-world record never renders as two different entries. */
  key: string;
  dateKey: string;
  clientName: string;
  amountCents: number;
  status: CalendarEntryStatus;
  /** Short payment-type word — "Website"/"Hosting" for a transaction,
   * or NEXT_PAYMENT_KIND_LABEL's wording for an obligation. Cells now
   * show per-day totals, so this (like `clientName`) is carried for the
   * record's identity rather than rendered in the grid; the day-detail
   * panel always has the full type. */
  typeLabel?: string;
  /** A scheduled-but-not-yet-issued hosting charge (see lib/billing.ts's
   * NextPaymentObligation.scheduled); the day panel shows its
   * "Scheduled" badge. Its totals bucket follows `status`. */
  scheduled?: boolean;
  /** No longer rendered per entry — a day cell now shows that day's
   * totals and opens the day-detail panel, which lists every record
   * with its own Details action. Kept optional so existing callers and
   * fixtures stay valid. */
  onClick?: () => void;
};

/** "1 September 2026" style long date, shared by a day cell's
 * accessible name and the mobile agenda's heading. */
function longDateLabel(day: Date): string {
  return day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// TOOLTIP_CLASS pins to `top-0` (the charts place it beside a column);
// calendar tooltips sit above/below their cell instead.
const CELL_TOOLTIP_CLASS = `${TOOLTIP_CLASS.replace("top-0 ", "")} text-xs`;

// 12px line icons (currentColor) — the shape cues for Overdue and
// Adjustment, so neither relies on colour alone. Shared with the
// day-detail panel's summary.
export function OverdueIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth="1.5" strokeLinecap="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5v3" />
      <path d="M6 8.5h.01" strokeWidth="1.75" />
    </svg>
  );
}
export function AdjustIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 5.5A3.75 3.75 0 1 1 3.6 8.4" />
      <path d="M2.25 2.75v2.75H5" />
    </svg>
  );
}

// The overdue share of an Outstanding bar: a muted red (≥3:1 against the
// tile in both themes) — the small labelled glyph is the tile's one clear
// overdue signal, so the bar doesn't need full-strength red as well.
const OVERDUE_FILL = "bg-chart-overdue-soft";

/** The pill shape the day bars use, for the legend and summaries. */
export function BarSwatch({ fill, overdue = false }: { fill: string; overdue?: boolean }) {
  return (
    <span aria-hidden="true" className={`flex h-1.5 w-4 shrink-0 overflow-hidden rounded-full ${fill}`}>
      {overdue && <span className={`h-full w-1.5 ${OVERDUE_FILL}`} />}
    </span>
  );
}

/**
 * A day's two bars — Received and Outstanding — against ONE scale for
 * the whole visible period (calendarCashFlow.calendarScaleCents), so two
 * days' bar lengths compare directly. A series that is genuinely zero
 * that day draws nothing — no bar, no track — but keeps its slot, so
 * Received is always the upper line and Outstanding the lower. The overdue part of
 * Outstanding is drawn INSIDE that bar from the left — it's a share of
 * Outstanding, never an extra amount.
 */
function DayBars({
  totals,
  scaleCents,
  showReceived,
  showOutstanding,
}: {
  totals: DayTotals;
  scaleCents: number;
  showReceived: boolean;
  showOutstanding: boolean;
}) {
  const out = outstandingCents(totals);
  const overdueShare = out > 0 ? totals.overdueCents / out : 0;
  const track = "block h-1 overflow-hidden rounded-full bg-border/60";
  return (
    <span aria-hidden="true" className="mt-auto flex flex-col gap-0.5">
      {showReceived &&
        (totals.receivedCents > 0 ? (
          <span className={track}>
            <span className={`block h-full rounded-full ${MARK.received}`} style={{ width: `${barShare(totals.receivedCents, scaleCents) * 100}%` }} />
          </span>
        ) : (
          <span className="block h-1" />
        ))}
      {showOutstanding &&
        (out > 0 ? (
          <span className={track}>
            <span className={`flex h-full overflow-hidden rounded-full ${MARK.expected}`} style={{ width: `${barShare(out, scaleCents) * 100}%` }}>
              {totals.overdueCents > 0 && <span className={`block h-full ${OVERDUE_FILL}`} style={{ width: `max(3px, ${overdueShare * 100}%)` }} />}
            </span>
          </span>
        ) : (
          <span className="block h-1" />
        ))}
    </span>
  );
}

/** Exact amounts behind a cell's bars or a week's totals — shown on hover
 * and keyboard focus (the same words are the button's accessible name,
 * so this copy is aria-hidden). */
function TotalsTooltip({
  title,
  note,
  totals,
  currency,
  showReceived,
  showOutstanding,
  status,
  className,
}: {
  title: string;
  note?: string;
  totals: DayTotals;
  currency: string;
  showReceived: boolean;
  showOutstanding: boolean;
  status: { received: SeriesStatus; outstanding: SeriesStatus };
  className: string;
}) {
  const outCount = outstandingCount(totals);
  const unavailable = (s: SeriesStatus) => (s === "loading" ? "loading…" : "unavailable");
  return (
    <div aria-hidden="true" className={`${CELL_TOOLTIP_CLASS} ${className}`}>
      <p className="font-medium text-fg">{title}</p>
      {note && <p className="text-[11px] text-fg-subtle">{note}</p>}
      <div className="mt-1.5 space-y-0.5">
        {showReceived && status.received !== "ready" && <TooltipRow value="—" label={`Received · ${unavailable(status.received)}`} />}
        {showOutstanding && status.outstanding !== "ready" && (
          <TooltipRow value="—" label={`Outstanding · ${unavailable(status.outstanding)}`} />
        )}
        {totals.recordCount === 0 ? (
          <p className="text-fg-muted">No records</p>
        ) : (
          <>
            {showReceived && status.received === "ready" && (
              <TooltipRow
                keyClass={MARK.received}
                value={exactMoney(totals.receivedCents, currency)}
                label={totals.receivedCount > 0 ? `Received · ${plural(totals.receivedCount, "payment")}` : "Received"}
              />
            )}
            {showOutstanding && status.outstanding === "ready" && (
              <TooltipRow
                keyClass={MARK.expected}
                value={exactMoney(outstandingCents(totals), currency)}
                label={outCount > 0 ? `Outstanding · ${plural(outCount, "payment")}` : "Outstanding"}
              />
            )}
            {showOutstanding && totals.overdueCents > 0 && (
              <div className="pl-4">
                <TooltipRow keyClass={MARK.overdue} value={exactMoney(totals.overdueCents, currency)} label="of which overdue" />
              </div>
            )}
            {totals.adjustedCount > 0 && (
              <p className="flex items-center gap-2 pt-0.5 text-fg-muted">
                <AdjustIcon className="h-3 w-3" />
                <span>
                  {adjustmentsLabel(totals.adjustedCount)}
                  {totals.netAdjustmentCents < 0 && ` (net ${exactMoney(totals.netAdjustmentCents, currency)})`} — not in Received
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The mobile agenda's per-day amounts, as text — no hover there, so the
 * exact figures are shown rather than bars. Outstanding carries its
 * overdue part as an indented "of which" line, never a separate total. */
function AgendaAmounts({
  totals,
  currency,
  showReceived,
  showOutstanding,
}: {
  totals: DayTotals;
  currency: string;
  showReceived: boolean;
  showOutstanding: boolean;
}) {
  const row = (swatch: ReactNode, label: string, amount: string, labelClass = "text-fg-muted") => (
    <span className="flex items-center gap-2 text-xs leading-5">
      {swatch}
      <span className={`truncate ${labelClass}`}>{label}</span>
      <span className="ml-auto shrink-0 font-medium tabular-nums text-fg">{amount}</span>
    </span>
  );
  return (
    <span className="flex flex-col">
      {showReceived && totals.receivedCount > 0 && row(<BarSwatch fill={MARK.received} />, "Received", exactMoney(totals.receivedCents, currency))}
      {showOutstanding && outstandingCount(totals) > 0 && row(<BarSwatch fill={MARK.expected} />, "Outstanding", exactMoney(outstandingCents(totals), currency))}
      {showOutstanding &&
        totals.overdueCount > 0 &&
        row(
          <span className="flex w-4 justify-end text-chart-overdue-icon">
            <OverdueIcon />
          </span>,
          "of which overdue",
          exactMoney(totals.overdueCents, currency),
          "text-red-700 dark:text-red-400",
        )}
      {totals.adjustedCount > 0 && (
        <span className="flex items-center gap-2 text-xs leading-5 text-fg-muted">
          <span className="flex w-4 justify-end">
            <AdjustIcon />
          </span>
          {adjustmentsLabel(totals.adjustedCount)} — not in Received
        </span>
      )}
    </span>
  );
}

// Payments' activity shading: four light steps of the received colour
// (`--chart-received-shade`: emerald by default, else the user's own), on
// a month-wide scale (calendarCashFlow.receivedShadeLevel). Dark uses
// stronger alphas so its four steps stay as distinguishable as light's.
// Tile text on every step is `text-fg` only — ≥14.8:1 light, ≥11:1 dark.
export const SHADE = [
  "",
  "bg-chart-received-shade/[0.05] dark:bg-chart-received-shade/[0.08]",
  "bg-chart-received-shade/[0.09] dark:bg-chart-received-shade/[0.14]",
  "bg-chart-received-shade/[0.14] dark:bg-chart-received-shade/[0.21]",
  "bg-chart-received-shade/[0.2] dark:bg-chart-received-shade/[0.3]",
] as const;

/** One compact week-total line: colour key left, amount right-aligned. */
function WeekLine({ fill, value, muted = false, overdue = false }: { fill: string; value: string; muted?: boolean; overdue?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
      <BarSwatch fill={fill} />
      {overdue && (
        <span className="text-chart-overdue-icon">
          <OverdueIcon className="h-2.5 w-2.5" />
        </span>
      )}
      <span className={`ml-auto truncate tabular-nums ${muted ? "text-fg-muted" : "font-medium text-fg"}`}>{value}</span>
    </span>
  );
}

// The desktop grid's columns, shared by the weekday labels and the date
// grid so the two line up: 7 days, plus the week totals from lg.
const DESKTOP_COLUMNS = "grid-cols-7 gap-1.5 lg:grid-cols-[repeat(7,minmax(0,1fr))_minmax(4.75rem,6rem)]";

const NAV_BUTTON =
  "inline-flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-fast ease-standard hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring motion-reduce:transition-none";

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} />
    </svg>
  );
}

/**
 * The calendar's navigation — ← one month/week label →, Today, and the
 * Month/Week toggle. Rendered by the parent inside the calendar
 * container's header (beside search and filters), since the parent owns
 * the cursor and grid mode. The label is the ONE heading for the period.
 */
export function CalendarNav({
  cursor,
  grid,
  onCursorChange,
  onGridChange,
  todayKey,
  headingId,
  currency,
}: {
  cursor: Date;
  grid: CalendarGridMode;
  onCursorChange: (next: Date) => void;
  onGridChange: (next: CalendarGridMode) => void;
  /** Today in the workspace timezone (YYYY-MM-DD). */
  todayKey: string;
  headingId: string;
  /** Shown once, beside the period — every amount below is in it. */
  currency: string;
}) {
  const unit = grid === "month" ? "month" : "week";
  const step = (n: number) => onCursorChange(grid === "month" ? addMonths(cursor, n) : addWeeks(cursor, n));
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div className="flex items-center">
        <Tooltip label={`Previous ${unit}`}>
          <button type="button" onClick={() => step(-1)} aria-label={`Previous ${unit}`} className={NAV_BUTTON}>
            <ChevronIcon dir="left" />
          </button>
        </Tooltip>
        <h2 id={headingId} aria-live="polite" className="px-1 text-sm font-semibold tabular-nums text-fg">
          {calendarRangeLabel(cursor, grid)}
          <span className="font-normal text-fg-muted"> · {currency}</span>
        </h2>
        <Tooltip label={`Next ${unit}`}>
          <button type="button" onClick={() => step(1)} aria-label={`Next ${unit}`} className={NAV_BUTTON}>
            <ChevronIcon dir="right" />
          </button>
        </Tooltip>
      </div>
      <button type="button" onClick={() => onCursorChange(isoToLocalDate(todayKey))} className="btn btn-ghost btn-sm h-8 px-2.5">
        Today
      </button>
      {/* Compact segmented selector: 32px tall, the active segment raised. */}
      <div className="flex h-8 items-center rounded-lg bg-surface-subtle p-0.5 text-xs" role="group" aria-label="Calendar grid">
        {(["month", "week"] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onGridChange(g)}
            aria-pressed={grid === g}
            className={`toggle-pill h-7 rounded-md px-2.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring ${
              grid === g ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            {g === "month" ? "Month" : "Week"}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The shared Revenue calendar surface — used by both the Payments and
 * Upcoming views (Hosting keeps its own plan-management table). The
 * parent owns the cursor, grid mode and navigation (CalendarNav) and
 * places them in the calendar container's header; this renders the key
 * and the grid. Day-grid math is the same `monthGrid`/`weekGrid` used by
 * the standalone Calendar page (the month grid trimmed to the 4–6 rows
 * it needs).
 *
 * Each day tile shows ONE amount — `primary`: received (Payments) or
 * outstanding (Upcoming) — plus Received / Outstanding mini bars on one
 * month-wide scale; exact figures are in the tooltip, the accessible
 * name and the day panel. Payments tints tiles by received activity.
 * Each week row ends in a totals tile that opens that week's records.
 * Out-of-month days are quiet — their records belong to the adjacent
 * month's own view. A series that hasn't loaded or failed shows "—",
 * never $0.
 */
export function RevenueCalendar({
  cursor,
  grid,
  entries,
  currency,
  onDayClick,
  onWeekClick,
  selectedDay = null,
  selectedWeek = null,
  todayKey: todayKeyProp,
  showReceived = true,
  showOutstanding = true,
  primary,
  shade = false,
  receivedStatus = "ready",
  outstandingStatus = "ready",
}: {
  cursor: Date;
  grid: CalendarGridMode;
  entries: CalendarEntry[];
  currency: string;
  onDayClick: (dateKey: string) => void;
  /** Opens a week's records (the weekly totals tiles). */
  onWeekClick?: (weekStart: string) => void;
  /** The date whose details are open, if any — stays highlighted. */
  selectedDay?: string | null;
  /** The week (its Sunday) whose details are open, if any. */
  selectedWeek?: string | null;
  /** Today in the workspace timezone (YYYY-MM-DD). */
  todayKey?: string;
  /** Which bar series this view shows (see calendarCashFlow.seriesVisibility). */
  showReceived?: boolean;
  showOutstanding?: boolean;
  /** The one amount each tile shows. */
  primary: CalendarPrimary;
  /** Tint tiles by received activity (Payments only — never for outstanding). */
  shade?: boolean;
  /** Whether each series' data is loaded; "loading"/"error" render as unavailable. */
  receivedStatus?: SeriesStatus;
  outstandingStatus?: SeriesStatus;
}) {
  const browserTodayKey = useMemo(() => toDateKey(new Date()), []);
  const todayKey = todayKeyProp ?? browserTodayKey;
  const status = { received: receivedStatus, outstanding: outstandingStatus };
  const visible = { received: showReceived, outstanding: showOutstanding };
  const receivedReady = showReceived && receivedStatus === "ready";
  const outstandingReady = showOutstanding && outstandingStatus === "ready";
  const primaryReady = status[primary] === "ready";

  // Hover and keyboard focus drive the same tooltip. Ids: "d:<date>" for
  // a day, "w:<Sunday>" for a week total.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const active = hovered ?? focused;
  // Tooltips open below their tile unless that would run past the bottom
  // of the viewport — measured when shown, so scroll position counts.
  const [tipAbove, setTipAbove] = useState(false);

  const days = useMemo(
    () => (grid === "month" ? trimMonthRows(monthGrid(cursor.getFullYear(), cursor.getMonth()), cursor.getMonth()) : weekGrid(cursor)),
    [grid, cursor],
  );

  // Per-day totals from the SAME entries the day panel lists (see
  // revenueVisuals.totalsByDay), so a tile and the panel it opens agree.
  const totals = useMemo(() => totalsByDay(entries), [entries]);

  // Month grid: only that month's dates are in scope (bars, shading,
  // weekly sums, the shared scales); week grid: all seven.
  const { dayKeys, weeks, scaleCents, receivedMax, inScope } = useMemo(() => {
    const keys = days.map(toDateKey);
    const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const scope = (key: string) => grid === "week" || key.startsWith(month);
    return {
      dayKeys: keys,
      weeks: calendarWeekTotals(keys, totals, scope),
      scaleCents: calendarScaleCents(keys, totals, scope),
      receivedMax: calendarReceivedMaxCents(keys, totals, scope),
      inScope: scope,
    };
  }, [days, cursor, grid, totals]);

  const monthName = cursor.toLocaleDateString(undefined, { month: "long" });
  const shading = shade && receivedReady;

  function placeTip(el: HTMLElement) {
    setTipAbove(el.getBoundingClientRect().bottom + 160 > window.innerHeight);
  }

  function tooltipHandlers(id: string) {
    return {
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        placeTip(e.currentTarget);
        setHovered(id);
      },
      onMouseLeave: () => setHovered((h) => (h === id ? null : h)),
      onFocus: (e: { currentTarget: HTMLElement }) => {
        // Keyboard focus shows the tooltip; the focus a click leaves
        // behind doesn't, so moving the pointer away always clears it.
        if (e.currentTarget.matches(":focus-visible")) {
          placeTip(e.currentTarget);
          setFocused(id);
        }
      },
      onBlur: () => setFocused((f) => (f === id ? null : f)),
    };
  }

  const tileFocus = "focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
  // Selecting a tile eases its border and fill over; nothing else moves.
  const tileColors = "transition-[border-color,background-color] duration-fast ease-standard motion-reduce:transition-none";
  const tileMotion = "transition-[border-color,background-color,translate,box-shadow] duration-fast ease-standard motion-reduce:transition-none";
  // Hover (pointers that can hover only): a 1px lift and a soft shadow on
  // every selectable grid tile, whatever its state — an emphasis that is
  // neither the selected fill nor today's accent. It's driven by the
  // tile's wrapper (`group/tile`), which stays put, so the lift can't
  // carry the tile out from under the pointer.
  const tileLift = "group-hover/tile:-translate-y-px group-hover/tile:shadow-sm motion-reduce:group-hover/tile:translate-y-0";

  /** A tile's single amount: compact, "—" when its series is unavailable. */
  function primaryAmount(t: DayTotals | undefined, className: string) {
    if (!primaryReady) return <span className={`${className} font-normal text-fg-muted`}>—</span>;
    const cents = primaryCents(t, primary);
    if (!t || t.recordCount === 0 || cents <= 0) return null;
    return <span className={`${className} truncate font-semibold tabular-nums text-fg`}>{compactMoney(cents, currency)}</span>;
  }

  // Two parts — the header (key + weekday labels) and the date grid — as
  // the root's children, under `display: contents`, so a parent grid can
  // place them on its own rows: Revenue's calendar/panel split centres the
  // breakdown on the date grid alone (DayDetailPanel CALENDAR_COLUMN).
  // Without such a parent they simply stack as before.
  return (
    <div className="contents">
      <div>
        {/* A short key — the three series only. Everything else (what the
            tile amount is, the adjustment mark, shading, overdue ⊂
            outstanding, "—") is one tap away in "How to read this". */}
        <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          <ul aria-label="Calendar key" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {showReceived && (
              <li className="inline-flex items-center gap-1.5">
                <BarSwatch fill={MARK.received} />
                Received
              </li>
            )}
            {showOutstanding && (
              <li className="inline-flex items-center gap-1.5">
                <BarSwatch fill={MARK.expected} />
                Outstanding
              </li>
            )}
            {showOutstanding && (
              <li className="inline-flex items-center gap-1.5">
                <span className="text-chart-overdue-icon">
                  <OverdueIcon />
                </span>
                Overdue
              </li>
            )}
          </ul>
          <InfoPopover label="How to read this calendar">
            <div className="space-y-2">
              <p>
                <span className="font-medium text-fg">Tile amount:</span> {primary === "received" ? "money received that day, net of refunds" : "still unpaid that day (due + overdue)"}, in {currency}. Hover or focus a day for exact figures; select it for every record.
              </p>
              {/* Bars, shading and the week column are desktop-grid only. */}
              <p className="hidden sm:block">
                <span className="font-medium text-fg">Bars:</span> Received (upper) and Outstanding (lower), on one scale for the whole {grid === "month" ? "month" : "week"} — the longest bar is its largest day. A day with nothing in a series has no bar.
              </p>
              {showOutstanding && (
                <p>
                  <span className="font-medium text-fg">Overdue</span> is part of outstanding, not extra. A day with anything overdue shows the overdue mark; on the grid, the overdue share is the red start of its Outstanding bar.
                </p>
              )}
              {showReceived && (
                <p className="flex items-start gap-1.5">
                  <AdjustIcon className="mt-0.5 h-3 w-3" />
                  <span>A refund or reversal. It&apos;s never added to Received — the day&apos;s tooltip and panel have the details.</span>
                </p>
              )}
              {shading && (
                <p className="hidden sm:block">
                  <span className="font-medium text-fg">Shading</span> (Payments only): stronger green = more received that day, scaled to the month&apos;s largest day. It never shows expected income.
                  <span aria-hidden="true" className="ml-1.5 inline-flex gap-0.5 align-middle">
                    {SHADE.slice(1).map((c) => (
                      <span key={c} className={`size-3 rounded-sm border border-border ${c}`} />
                    ))}
                  </span>
                </p>
              )}
              <p>
                <span className="font-medium text-fg">—</span> means those figures couldn&apos;t be loaded yet — it never means zero.
              </p>
              <p className="hidden sm:block">
                <span className="font-medium text-fg">Week column:</span> each week&apos;s totals. A week crossing the month&apos;s edge counts only this month&apos;s dates.
              </p>
            </div>
          </InfoPopover>
        </div>

        {/* Desktop grid: 7 day columns of tiles, plus the weekly totals as
            an 8th column from lg. Between sm and lg each week's total is a
            full-width tile under its row instead, so day tiles never get
            squeezed to make room for it. No fixed height: 4–6 rows. The
            weekday labels are a grid of their own with the same columns,
            so the date grid below them is one box a parent can align to. */}
        <div className={`mb-1.5 mt-3 hidden text-xs sm:grid ${DESKTOP_COLUMNS}`}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <div key={label} className="px-1.5 text-[11px] font-medium text-fg-muted">
              {label}
            </div>
          ))}
          <div className="hidden px-1.5 text-right text-[11px] font-medium text-fg-muted lg:block">Week</div>
        </div>
      </div>

      <div className="self-start">
        <div className={`hidden text-xs sm:grid ${DESKTOP_COLUMNS}`} onMouseLeave={() => setHovered(null)}>
          {weeks.map((week, r) => {
            const rowKeys = dayKeys.slice(r * 7, r * 7 + 7);
            const vertical = tipAbove ? "bottom-full mb-1" : "top-full mt-1";
            const weekSelected = selectedWeek === week.weekStart;
            const hasScope = week.keys.length > 0;
            const scopeSpan = hasScope ? shortSpanLabel(week.keys[0], week.keys[week.keys.length - 1]) : "";
            const weekTitle = `Week of ${shortSpanLabel(rowKeys[0], rowKeys[6])}`;
            const weekId = `w:${week.weekStart}`;
            const outWeek = outstandingCents(week.totals);
            return (
              <Fragment key={week.weekStart}>
                {rowKeys.map((key, c) => {
                  const day = days[r * 7 + c];
                  const inRange = inScope(key);
                  const dayTotals = totals.get(key);
                  const hasRecords = inRange && dayTotals !== undefined && dayTotals.recordCount > 0;
                  const isToday = key === todayKey;
                  const isSelected = selectedDay === key;
                  const inSelectedWeek = weekSelected && inRange;
                  const level = shading && hasRecords ? receivedShadeLevel(dayTotals.receivedCents, receivedMax, 4) : 0;
                  const id = `d:${key}`;
                  const ariaLabel = inRange
                    ? `${longDateLabel(day)}${isToday ? ", today" : ""}. ${describeCalendarTotals(dayTotals, currency, primary, status, visible)}.`
                    : `${longDateLabel(day)}${isToday ? ", today" : ""}. Outside ${monthName}.`;
                  // Selected: accent-soft fill + 1px accent border. Today: the
                  // filled date circle + a faint accent outline. Keyboard focus:
                  // a separate offset ring. Any combination stays readable.
                  const surface = !inRange
                    ? "border-transparent bg-surface-tile group-hover/tile:border-border-strong"
                    : isSelected
                      ? "border-accent bg-accent-soft"
                      : `${inSelectedWeek || isToday ? "border-accent/40" : "border-border/70 group-hover/tile:border-border-strong"} ${level > 0 ? SHADE[level] : "bg-surface group-hover/tile:bg-surface-hover"}`;
                  return (
                    <div key={key} className="group/tile relative flex min-w-0">
                      {/* A real <button>: the whole day is one target that
                          opens the day panel (every record, with actions). */}
                      <button
                        type="button"
                        onClick={() => onDayClick(key)}
                        aria-label={ariaLabel}
                        aria-pressed={isSelected}
                        aria-current={isToday ? "date" : undefined}
                        {...tooltipHandlers(id)}
                        className={`flex min-h-[3.875rem] w-full min-w-0 cursor-pointer flex-col items-stretch gap-0.5 rounded-lg border p-1.5 text-left ${tileMotion} ${tileLift} ${tileFocus} ${surface}`}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <span
                            className={`-ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums ${
                              isToday ? "bg-accent font-semibold text-accent-fg" : inRange ? "font-medium text-fg" : "text-fg-subtle"
                            }`}
                          >
                            {day.getDate()}
                          </span>
                          {hasRecords && (
                            <span className="flex items-center gap-1">
                              {outstandingReady && dayTotals.overdueCount > 0 && (
                                <span className="text-chart-overdue-icon">
                                  <OverdueIcon />
                                </span>
                              )}
                              {receivedReady && dayTotals.adjustedCount > 0 && (
                                <span className="text-fg-muted">
                                  <AdjustIcon />
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                        {inRange && primaryAmount(dayTotals, "text-[13px] leading-4")}
                        {/* Bars only for real activity — a day holding only a
                            refund/reversal keeps just its adjustment mark. */}
                        {hasRecords && (dayTotals.receivedCents > 0 || outstandingCents(dayTotals) > 0) && (
                          <DayBars totals={dayTotals} scaleCents={scaleCents} showReceived={receivedReady} showOutstanding={outstandingReady} />
                        )}
                      </button>
                      {active === id && inRange && (hasRecords || !primaryReady) && (
                        <TotalsTooltip
                          title={day.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
                          totals={dayTotals ?? emptyDayTotals()}
                          currency={currency}
                          showReceived={showReceived}
                          showOutstanding={showOutstanding}
                          status={status}
                          className={`${vertical} ${c < 4 ? "left-0" : "right-0"}`}
                        />
                      )}
                    </div>
                  );
                })}

                {/* The week's total: an 8th column of tiles from lg, a
                    full-width tile under the row between sm and lg. */}
                <div className="group/tile relative col-span-7 flex min-w-0 lg:col-span-1">
                  {hasScope ? (
                    <button
                      type="button"
                      onClick={() => onWeekClick?.(week.weekStart)}
                      disabled={!onWeekClick}
                      aria-pressed={weekSelected}
                      aria-label={`${weekTitle}${week.partial ? `, ${scopeSpan} only — this week's dates in ${monthName}` : ""}. ${describeCalendarTotals(week.totals, currency, primary, status, visible)}.`}
                      {...tooltipHandlers(weekId)}
                      className={`flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-2 py-1 text-left lg:flex-col lg:flex-nowrap lg:items-stretch lg:justify-center lg:gap-0.5 lg:py-1.5 ${tileMotion} ${onWeekClick ? tileLift : ""} ${tileFocus} ${
                        weekSelected ? "border-accent bg-accent-soft" : `border-transparent bg-surface-tile ${onWeekClick ? "group-hover/tile:border-border-strong" : ""}`
                      }`}
                    >
                      <span className="text-[11px] font-medium text-fg-muted lg:hidden">Week</span>
                      {week.partial && <span className="text-[10px] leading-3 text-fg-muted lg:text-right">{scopeSpan}</span>}
                      {/* Words, not "—": the dash means unavailable data here. */}
                      {week.totals.recordCount === 0 && (!showReceived || receivedReady) && (!showOutstanding || outstandingReady) ? (
                        <span className="text-[11px] text-fg-muted lg:text-right">No records</span>
                      ) : (
                        <>
                          {/* Only non-zero lines; the week's full totals are in
                              its accessible name, tooltip and detail panel. */}
                          {showReceived && (!receivedReady || week.totals.receivedCents > 0) && (
                            <WeekLine fill={MARK.received} value={receivedReady ? compactMoney(week.totals.receivedCents, currency) : "—"} muted={!receivedReady} />
                          )}
                          {showOutstanding && (!outstandingReady || outWeek > 0) && (
                            <WeekLine
                              fill={MARK.expected}
                              value={outstandingReady ? compactMoney(outWeek, currency) : "—"}
                              muted={!outstandingReady}
                              overdue={outstandingReady && week.totals.overdueCents > 0}
                            />
                          )}
                          {receivedReady &&
                            outstandingReady &&
                            week.totals.receivedCents <= 0 &&
                            outWeek <= 0 &&
                            week.totals.adjustedCount > 0 && (
                              <span className="flex items-center gap-1 text-[11px] text-fg-muted lg:justify-end">
                                <AdjustIcon />
                                {week.totals.adjustedCount}
                              </span>
                            )}
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="w-full rounded-lg bg-surface-tile" />
                  )}
                  {active === weekId && hasScope && (
                    <TotalsTooltip
                      title={weekTitle}
                      note={week.partial ? `${scopeSpan} only — this week's dates in ${monthName}` : undefined}
                      totals={week.totals}
                      currency={currency}
                      showReceived={showReceived}
                      showOutstanding={showOutstanding}
                      status={status}
                      className={`right-0 ${vertical} lg:right-full lg:mr-1 ${tipAbove ? "lg:bottom-0 lg:mb-0" : "lg:top-0 lg:mt-0"}`}
                    />
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>

        {/* Mobile agenda — a readable day-by-day list instead of a
            squeezed 7-column grid. Only in-scope days that actually have
            records are listed, grouped under their week's subtotal (which
            opens that week, like the desktop week tiles). */}
        <div className="mt-3 space-y-3 sm:hidden">
          {(!primaryReady || (showOutstanding && outstandingStatus !== "ready") || (showReceived && receivedStatus !== "ready")) && (
            <p className="rounded-lg bg-surface-subtle px-3 py-2 text-xs text-fg-muted">
              {[
                showReceived && receivedStatus !== "ready" ? `Received ${receivedStatus === "loading" ? "loading…" : "unavailable"}` : null,
                showOutstanding && outstandingStatus !== "ready" ? `Outstanding ${outstandingStatus === "loading" ? "loading…" : "unavailable"}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {weeks.every((w) => w.totals.recordCount === 0) ? (
            <p className="px-1 text-sm text-fg-muted">No records in this range.</p>
          ) : (
            weeks
              .filter((w) => w.totals.recordCount > 0)
              .map((week) => {
                const weekSelected = selectedWeek === week.weekStart;
                const span = shortSpanLabel(week.keys[0], week.keys[week.keys.length - 1]);
                const outWeek = outstandingCents(week.totals);
                return (
                  <section key={week.weekStart} aria-label={`Week of ${span}`} className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => onWeekClick?.(week.weekStart)}
                      disabled={!onWeekClick}
                      aria-pressed={weekSelected}
                      aria-label={`Week of ${span}${week.partial ? " (this month's dates only)" : ""}. ${describeCalendarTotals(week.totals, currency, primary, status, visible)}.`}
                      className={`flex min-h-10 w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-2.5 py-1.5 text-left text-xs ${tileColors} ${tileFocus} ${
                        weekSelected ? "border-accent bg-accent-soft" : "border-transparent bg-surface-tile enabled:hover:border-border-strong"
                      }`}
                    >
                      <span className="font-medium text-fg">Week · {span}</span>
                      <span className="ml-auto flex flex-wrap items-center gap-x-3 tabular-nums text-fg">
                        {receivedReady && week.totals.receivedCents > 0 && (
                          <span className="inline-flex items-center gap-1.5">
                            <BarSwatch fill={MARK.received} />
                            {compactMoney(week.totals.receivedCents, currency)}
                          </span>
                        )}
                        {outstandingReady && outWeek > 0 && (
                          <span className="inline-flex items-center gap-1.5">
                            <BarSwatch fill={MARK.expected} />
                            {week.totals.overdueCents > 0 && (
                              <span className="text-chart-overdue-icon">
                                <OverdueIcon className="h-2.5 w-2.5" />
                              </span>
                            )}
                            {compactMoney(outWeek, currency)}
                          </span>
                        )}
                      </span>
                    </button>
                    {week.keys.map((key) => {
                      const dayTotals = totals.get(key);
                      if (!dayTotals || dayTotals.recordCount === 0) return null;
                      const day = isoToLocalDate(key);
                      const isToday = key === todayKey;
                      const isSelected = selectedDay === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => onDayClick(key)}
                          aria-pressed={isSelected}
                          aria-current={isToday ? "date" : undefined}
                          aria-label={`${longDateLabel(day)}${isToday ? ", today" : ""}. ${describeCalendarTotals(dayTotals, currency, primary, status, visible)}.`}
                          className={`block w-full rounded-lg border px-3 py-2 text-left ${tileColors} ${tileFocus} ${
                            isSelected ? "border-accent bg-accent-soft" : `${isToday ? "border-accent/40" : "border-border/70"} bg-surface hover:bg-surface-hover`
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className={`text-sm ${isToday ? "font-semibold text-fg" : "text-fg-muted"}`}>
                              {day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                              {isToday && " · Today"}
                            </span>
                            <span className="text-xs text-fg-muted">{plural(dayTotals.recordCount, "record")}</span>
                          </span>
                          <span className="mt-1.5 block">
                            <AgendaAmounts totals={dayTotals} currency={currency} showReceived={receivedReady} showOutstanding={outstandingReady} />
                          </span>
                        </button>
                      );
                    })}
                  </section>
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}
