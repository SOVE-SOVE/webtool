"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { addMonths, toDateKey } from "@/lib/calendarGrid";
import { compactMonthCells, indexScheduleByDay, type ScheduleEvent } from "@/lib/taskSchedule";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_TITLES_PER_SOURCE = 4;
const POPOVER_GAP = 4;
const POPOVER_MAX_WIDTH = 192; // px — w-48

const NAV_BUTTON =
  "rounded p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring";

/** Where the day popover sits, measured from the cell it belongs to. */
type Anchor = { key: string; left: number; top?: number; bottom?: number; width: number };

function TaskDot() {
  return <span className="h-1 w-1 shrink-0 rounded-full bg-pill-warning-fg" />;
}

function ClientDot() {
  return <span className="h-1 w-1 shrink-0 rounded-full bg-pill-info-fg" />;
}

/**
 * A compact, read-only month grid for a task's schedule: one subtle dot
 * for days with task-related activity, a second for days with activity
 * on its linked client's calendar, both when a day has both. Hovering,
 * focusing or clicking a marked day opens a small popover naming what's
 * on it; nothing permanently takes space.
 *
 * Presentational — the caller supplies already-normalised events for
 * each source, and this decides nothing about where they came from. An
 * item present in both sources is shown once (see `indexScheduleByDay`).
 *
 * Deliberately small (fits a sidebar or a ~340px dialog): quiet leading
 * and trailing days from the adjacent months only square off the weeks
 * and never carry markers, since those days belong to another month.
 */
export function TaskScheduleCalendar({
  taskEvents,
  clientEvents,
  showClientLegend = true,
  initialMonth,
  className = "",
}: {
  taskEvents: ScheduleEvent[];
  clientEvents: ScheduleEvent[];
  /** Hide the client entry of the legend when there is no client to show. */
  showClientLegend?: boolean;
  /** Any date within the month to open on. Defaults to the current month. */
  initialMonth?: Date;
  className?: string;
}) {
  const [cursor, setCursor] = useState(() => {
    const start = initialMonth ?? new Date();
    return new Date(start.getFullYear(), start.getMonth(), 1);
  });
  // Click pins a day's popover open; hover/focus only shows it transiently.
  const [pinned, setPinned] = useState<Anchor | null>(null);
  const [hovered, setHovered] = useState<Anchor | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  const byDay = useMemo(() => indexScheduleByDay(taskEvents, clientEvents), [taskEvents, clientEvents]);
  const cells = compactMonthCells(cursor.getFullYear(), cursor.getMonth());
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const todayKey = toDateKey(new Date());
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const active = pinned ?? hovered;
  const activeDay = active ? byDay.get(active.key) : undefined;

  // A pinned popover closes on a press anywhere outside the widget.
  useEffect(() => {
    if (!pinned) return;
    function handlePointerDown(e: PointerEvent) {
      if (!gridRef.current?.contains(e.target as Node)) setPinned(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [pinned]);

  function measure(key: string, cell: HTMLElement): Anchor | null {
    const grid = gridRef.current;
    if (!grid) return null;
    const gridBox = grid.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    const width = Math.min(POPOVER_MAX_WIDTH, gridBox.width);
    const centre = cellBox.left - gridBox.left + cellBox.width / 2;
    const left = Math.min(Math.max(centre - width / 2, 0), gridBox.width - width);
    const cellTop = cellBox.top - gridBox.top;
    // Open away from the nearer edge so the popover never leaves the grid's
    // surroundings: below for the upper half, above for the lower half.
    return cellTop > gridBox.height / 2
      ? { key, left, width, bottom: gridBox.height - cellTop + POPOVER_GAP }
      : { key, left, width, top: cellTop + cellBox.height + POPOVER_GAP };
  }

  function changeMonth(delta: number) {
    setCursor((c) => addMonths(c, delta));
    setPinned(null);
    setHovered(null);
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Escape closes the popover first; only once it's gone does it fall
    // through to whatever dialog this sits in. That dialog listens on
    // `document`, which in the app router is also where React's own event
    // root lives, so stopPropagation() alone wouldn't stop it — it has to
    // be the immediate variant on the native event.
    if (e.key === "Escape" && active) {
      e.nativeEvent.stopImmediatePropagation();
      setPinned(null);
      setHovered(null);
    }
  }

  return (
    <div className={`w-full select-none ${className}`} onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-fg" aria-live="polite">
          {monthLabel}
        </span>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month" className={NAV_BUTTON}>
            <ChevronDownIcon className="h-3.5 w-3.5 rotate-90" />
          </button>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Next month" className={NAV_BUTTON}>
            <ChevronDownIcon className="h-3.5 w-3.5 -rotate-90" />
          </button>
        </div>
      </div>

      <div ref={gridRef} className="relative mt-2 text-center" role="grid" aria-label={monthLabel}>
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((label, i) => (
            <div
              key={i}
              role="columnheader"
              aria-label={WEEKDAY_NAMES[i]}
              className="pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle"
            >
              {label}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={toDateKey(week[0])} role="row" className="grid grid-cols-7">
            {week.map((day) => {
              const key = toDateKey(day);
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = key === todayKey;
              const schedule = inMonth ? byDay.get(key) : undefined;
              const hasTask = (schedule?.task.length ?? 0) > 0;
              const hasClient = (schedule?.client.length ?? 0) > 0;
              const marked = hasTask || hasClient;

              const activity = [hasTask && "task activity", hasClient && "client calendar activity"]
                .filter(Boolean)
                .join(" and ");
              const label = `${day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${
                isToday ? ", today" : ""
              }${activity ? `, ${activity}` : ""}`;

              const content = (
                <>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] leading-none tabular-nums ${
                      isToday
                        ? "bg-accent font-semibold text-accent-fg"
                        : inMonth
                          ? "text-fg"
                          : "text-fg-subtle/60"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <span className="mt-0.5 flex h-1 items-center gap-0.5" aria-hidden="true">
                    {hasTask && <TaskDot />}
                    {hasClient && <ClientDot />}
                  </span>
                </>
              );

              return (
                <div key={key} role="gridcell" aria-current={isToday ? "date" : undefined}>
                  {marked ? (
                    <button
                      type="button"
                      aria-label={label}
                      aria-expanded={active?.key === key}
                      aria-describedby={active?.key === key ? popoverId : undefined}
                      onMouseEnter={(e) => setHovered(measure(key, e.currentTarget))}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={(e) => setHovered(measure(key, e.currentTarget))}
                      onBlur={() => setHovered(null)}
                      onClick={(e) => setPinned(pinned?.key === key ? null : measure(key, e.currentTarget))}
                      className="flex h-8 w-full cursor-pointer flex-col items-center justify-center rounded transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
                    >
                      {content}
                    </button>
                  ) : (
                    <div aria-label={label} className="flex h-8 flex-col items-center justify-center">
                      {content}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {active && activeDay && (
          <div
            id={popoverId}
            role="tooltip"
            style={{ left: active.left, top: active.top, bottom: active.bottom, width: active.width }}
            className="pointer-events-none absolute z-20 rounded-md border border-border-strong bg-surface p-2 text-left shadow-lg"
          >
            <p className="text-[11px] font-medium text-fg">
              {new Date(`${active.key}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </p>
            <EventList dot={<TaskDot />} events={activeDay.task} />
            <EventList dot={<ClientDot />} events={activeDay.client} />
          </div>
        )}
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
        <li className="flex items-center gap-1.5">
          <TaskDot />
          Task
        </li>
        {showClientLegend && (
          <li className="flex items-center gap-1.5">
            <ClientDot />
            Client calendar
          </li>
        )}
      </ul>
    </div>
  );
}

function EventList({ dot, events }: { dot: ReactNode; events: ScheduleEvent[] }) {
  if (events.length === 0) return null;
  const shown = events.slice(0, MAX_TITLES_PER_SOURCE);
  return (
    <ul className="mt-1 space-y-0.5">
      {shown.map((event) => (
        <li key={event.id} className="flex items-center gap-1.5 text-[11px] leading-snug text-fg-muted">
          {dot}
          <span className="truncate">{event.title}</span>
        </li>
      ))}
      {events.length > shown.length && (
        <li className="pl-2.5 text-[11px] text-fg-subtle">+{events.length - shown.length} more</li>
      )}
    </ul>
  );
}
