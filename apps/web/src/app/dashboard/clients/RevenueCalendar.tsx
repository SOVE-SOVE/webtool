"use client";

import { useMemo } from "react";
import { addMonths, addWeeks, calendarRangeLabel, monthGrid, toDateKey, weekGrid, type CalendarGridMode } from "@/lib/calendarGrid";
import { formatMoney } from "@/lib/format";

export type { CalendarGridMode };

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
   * or NEXT_PAYMENT_KIND_LABEL's wording for an obligation. Shown on
   * the entry's second line, after the amount, only where it fits — a
   * secondary detail, never load-bearing (the day-detail panel always
   * has the full type). */
  typeLabel?: string;
  /** A scheduled-but-not-yet-issued hosting charge — shown with a
   * light "Scheduled" qualifier, never a separate colour category (see
   * lib/billing.ts's own NextPaymentObligation.scheduled). */
  scheduled?: boolean;
  onClick: () => void;
};

const STATUS_DOT_CLASS: Record<CalendarEntryStatus, string> = {
  paid: "bg-emerald-600 dark:bg-emerald-400",
  refunded: "bg-amber-600 dark:bg-amber-400",
  reversed: "bg-fg-subtle",
  overdue: "bg-red-600 dark:bg-red-400",
  due_today: "bg-amber-600 dark:bg-amber-400",
  upcoming: "bg-fg-subtle",
};

const STATUS_NAME_CLASS: Record<CalendarEntryStatus, string> = {
  paid: "text-fg",
  refunded: "text-amber-700 dark:text-amber-400",
  reversed: "text-fg-subtle line-through",
  overdue: "text-red-700 dark:text-red-400",
  due_today: "text-amber-700 dark:text-amber-400",
  upcoming: "text-fg",
};

/** The status dot + coloured name are the sighted cue; this is the same
 * information spelled out for assistive tech, since colour/a dot alone
 * never carries meaning on its own in this app. */
const STATUS_LABEL: Record<CalendarEntryStatus, string> = {
  paid: "Paid",
  refunded: "Refunded",
  reversed: "Reversed",
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
};

/**
 * One calendar entry — client name on its own line (the identifying
 * fact), amount + an optional short type label on the line below (the
 * financial fact), a small coloured status dot beside the name, and the
 * full status spelled out in `aria-label` for assistive tech. Two short
 * lines read far better at a glance than one line cramming both facts
 * together ever did, and — since this cell isn't `overflow-hidden` —
 * a busy day simply grows the row rather than clipping or overlapping.
 */
function EntryButton({ entry, currency }: { entry: CalendarEntry; currency: string }) {
  const struck = entry.status === "reversed";
  const statusText = entry.scheduled ? `${STATUS_LABEL[entry.status]}, scheduled` : STATUS_LABEL[entry.status];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        entry.onClick();
      }}
      title={`${entry.clientName} — ${formatMoney(entry.amountCents, currency)} — ${statusText}`}
      aria-label={`${entry.clientName}, ${formatMoney(entry.amountCents, currency)}, ${statusText}`}
      className="block w-full rounded px-1.5 py-1 text-left leading-tight hover:bg-surface-hover"
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[entry.status]}`} />
        <span className={`truncate text-xs font-medium ${STATUS_NAME_CLASS[entry.status]} ${struck ? "line-through" : ""}`}>
          {entry.clientName}
        </span>
      </span>
      <span className="mt-0.5 flex items-baseline gap-1 truncate pl-3 text-[11px] text-fg-muted">
        <span className={`tabular-nums font-medium text-fg ${struck ? "line-through" : ""}`}>
          {formatMoney(entry.amountCents, currency)}
        </span>
        {entry.typeLabel && <span className="truncate">· {entry.typeLabel}</span>}
        {entry.scheduled && <span className="shrink-0 text-fg-subtle">(Scheduled)</span>}
      </span>
    </button>
  );
}

const MAX_VISIBLE_PER_DAY = 3;

/**
 * The shared Revenue calendar surface — used by both the Payments and
 * Upcoming views (Hosting keeps its own plan-management table, so it
 * never renders this and has no Record Payment control of its own).
 * Cursor and grid mode are controlled by the parent so navigating the
 * calendar survives switching between Payments/Upcoming, matching how
 * every other filter on this page already lives one level up. Day-grid
 * math is the same `monthGrid`/`weekGrid` used by the standalone
 * Calendar page — one definition, not a second slightly-different one.
 * `onRecordPayment` is owned further up, by ClientsRevenueTab (the same
 * `RecordPaymentLauncher` flow the old beside-Today-box button already
 * used) — passed down through whichever of Payments/Upcoming is active,
 * so both calendar instances open the exact same modal.
 */
export function RevenueCalendar({
  cursor,
  grid,
  onCursorChange,
  onGridChange,
  entries,
  currency,
  onDayClick,
  onRecordPayment,
}: {
  cursor: Date;
  grid: CalendarGridMode;
  onCursorChange: (next: Date) => void;
  onGridChange: (next: CalendarGridMode) => void;
  entries: CalendarEntry[];
  currency: string;
  onDayClick: (dateKey: string) => void;
  /** Opens the existing Record Payment flow — lives here now, right of
   * the nav controls, rather than beside the Today summary box (a
   * different, larger element one level up in ClientsRevenueTab). */
  onRecordPayment: () => void;
}) {
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);

  const days = useMemo(
    () => (grid === "month" ? monthGrid(cursor.getFullYear(), cursor.getMonth()) : weekGrid(cursor)),
    [grid, cursor],
  );

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      if (!map.has(entry.dateKey)) map.set(entry.dateKey, []);
      map.get(entry.dateKey)!.push(entry);
    }
    return map;
  }, [entries]);

  const rangeLabel = calendarRangeLabel(cursor, grid);

  function goToday() {
    onCursorChange(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  }
  function goPrev() {
    onCursorChange(grid === "month" ? addMonths(cursor, -1) : addWeeks(cursor, -1));
  }
  function goNext() {
    onCursorChange(grid === "month" ? addMonths(cursor, 1) : addWeeks(cursor, 1));
  }

  const daysWithEntries = days.filter((d) => (entriesByDay.get(toDateKey(d))?.length ?? 0) > 0);

  return (
    <div>
      {/* Controls: Month/Week, prev/next, Today, Record Payment, and
          the visible date-range heading — everything the spec's
          "Calendar layout" section asks for, all in one row. Record
          Payment sits right after the next ("→") arrow, alongside
          Today — same `.btn-sm` sizing and `gap-2` spacing as every
          other control here, so it reads as part of this same toolbar
          rather than a visually distinct addition. The inner group is
          its own `flex-wrap` (not just the outer row's) so a narrow
          viewport can wrap these controls onto their own lines instead
          of ever overflowing past the calendar's own width. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* text-xs to match the .btn-sm buttons beside it in this
              same row (prev/Today/next) — a bare text-sm here read
              visibly taller than its row-mates. */}
          <div className="flex rounded-md border border-border-strong p-0.5 text-xs" role="group" aria-label="Calendar grid">
            <button
              type="button"
              onClick={() => onGridChange("month")}
              aria-current={grid === "month" ? "true" : undefined}
              className={`rounded px-2 py-1 ${grid === "month" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => onGridChange("week")}
              aria-current={grid === "week" ? "true" : undefined}
              className={`rounded px-2 py-1 ${grid === "week" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
            >
              Week
            </button>
          </div>
          <button type="button" onClick={goPrev} aria-label="Previous" className="btn btn-secondary btn-sm">
            ←
          </button>
          <button type="button" onClick={goToday} className="btn btn-secondary btn-sm">
            Today
          </button>
          <button type="button" onClick={goNext} aria-label="Next" className="btn btn-secondary btn-sm">
            →
          </button>
          <span className="text-xs text-fg-subtle">{currency}</span>
          <button type="button" onClick={onRecordPayment} className="btn btn-primary btn-sm">
            Record Payment
          </button>
        </div>
        <h3 className="text-sm font-medium text-fg" aria-live="polite">
          {rangeLabel}
        </h3>
      </div>

      {/* Desktop grid. */}
      <div className="mt-3 hidden sm:block">
        <div className={`grid grid-cols-7 border-l border-t border-border text-xs`}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <div key={label} className="border-b border-r border-border bg-surface-subtle px-2 py-1 font-medium text-fg-muted">
              {label}
            </div>
          ))}
          {days.map((day) => {
            const key = toDateKey(day);
            const inRange = grid === "week" || day.getMonth() === cursor.getMonth();
            const dayEntries = entriesByDay.get(key) ?? [];
            const visible = dayEntries.slice(0, MAX_VISIBLE_PER_DAY);
            const hiddenCount = dayEntries.length - visible.length;
            const isToday = key === todayKey;
            return (
              // A day cell holds its own nested entry buttons, so this
              // can't be a real <button> (invalid, browser-mangled DOM)
              // — role="button" + explicit key handling instead, same
              // as the "+N more" affordance below it.
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => onDayClick(key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onDayClick(key);
                  }
                }}
                aria-label={`${day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${dayEntries.length > 0 ? `, ${dayEntries.length} record${dayEntries.length === 1 ? "" : "s"}` : ""}`}
                className={`flex min-h-[8rem] cursor-pointer flex-col items-stretch border-b border-r border-border px-1.5 py-1.5 text-left align-top focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  grid === "month" && !inRange ? "bg-surface-subtle" : "bg-surface hover:bg-surface-hover"
                }`}
              >
                {/* The date number sits in its own row, never sharing a
                    line with an entry — the visual break between "which
                    day this is" and "what's on it". */}
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    isToday ? "bg-accent font-semibold text-accent-fg" : inRange ? "text-fg-muted" : "text-fg-subtle"
                  }`}
                >
                  {day.getDate()}
                </span>
                <span className="mt-1.5 flex-1 space-y-1">
                  {visible.map((entry) => (
                    <EntryButton key={entry.key} entry={entry} currency={currency} />
                  ))}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDayClick(key);
                      }}
                      className="block w-full rounded px-1.5 py-1 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg hover:underline"
                    >
                      +{hiddenCount} more
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile agenda — a readable day-by-day list instead of a
          squeezed 7-column grid, per the spec's explicit mobile
          requirement. Only days that actually have records are listed
          (a 42-cell empty month agenda would defeat "readable"). */}
      <div className="mt-3 space-y-2 sm:hidden">
        {daysWithEntries.length === 0 ? (
          <p className="px-1 text-sm text-fg-subtle">No records in this range.</p>
        ) : (
          daysWithEntries.map((day) => {
            const key = toDateKey(day);
            const dayEntries = entriesByDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div key={key} className="rounded-md border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => onDayClick(key)}
                  className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-left"
                >
                  <span className={`text-sm ${isToday ? "font-semibold text-fg" : "text-fg-muted"}`}>
                    {day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                    {isToday && " · Today"}
                  </span>
                  <span className="text-xs text-fg-subtle">
                    {dayEntries.length} record{dayEntries.length === 1 ? "" : "s"}
                  </span>
                </button>
                <div className="space-y-1 p-1.5">
                  {dayEntries.map((entry) => (
                    <EntryButton key={entry.key} entry={entry} currency={currency} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
