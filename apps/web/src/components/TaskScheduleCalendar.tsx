"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { addMonths, toDateKey } from "@/lib/calendarGrid";
import { compactMonthCells, indexScheduleByDay, type ScheduleEvent } from "@/lib/taskSchedule";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * A compact, read-only month grid for a task's schedule: one subtle dot
 * for days with task-related activity, a second for days with activity
 * on its linked client's calendar, both when a day has both. Purely
 * presentational — the caller supplies already-normalised events for
 * each source, and this decides nothing about where they came from.
 *
 * Deliberately small (fits a sidebar or a ~340px dialog): quiet leading
 * and trailing days from the adjacent months only square off the weeks
 * and never carry markers, since those days belong to another month.
 */
export function TaskScheduleCalendar({
  taskEvents,
  clientEvents,
  initialMonth,
  className = "",
}: {
  taskEvents: ScheduleEvent[];
  clientEvents: ScheduleEvent[];
  /** Any date within the month to open on. Defaults to the current month. */
  initialMonth?: Date;
  className?: string;
}) {
  const [cursor, setCursor] = useState(() => {
    const start = initialMonth ?? new Date();
    return new Date(start.getFullYear(), start.getMonth(), 1);
  });

  const byDay = useMemo(() => indexScheduleByDay(taskEvents, clientEvents), [taskEvents, clientEvents]);
  const cells = compactMonthCells(cursor.getFullYear(), cursor.getMonth());
  const todayKey = toDateKey(new Date());
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className={`w-full select-none ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-fg" aria-live="polite">
          {monthLabel}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setCursor((c) => addMonths(c, -1))}
            aria-label="Previous month"
            className="rounded p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
          >
            <ChevronDownIcon className="h-3.5 w-3.5 rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => setCursor((c) => addMonths(c, 1))}
            aria-label="Next month"
            className="rounded p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
          >
            <ChevronDownIcon className="h-3.5 w-3.5 -rotate-90" />
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-7 text-center" role="grid" aria-label={monthLabel}>
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
        {cells.map((day) => {
          const key = toDateKey(day);
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = key === todayKey;
          const schedule = inMonth ? byDay.get(key) : undefined;
          const hasTask = (schedule?.task.length ?? 0) > 0;
          const hasClient = (schedule?.client.length ?? 0) > 0;

          const activity = [hasTask && "task activity", hasClient && "client calendar activity"]
            .filter(Boolean)
            .join(" and ");
          const label = `${day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${
            isToday ? ", today" : ""
          }${activity ? `, ${activity}` : ""}`;

          return (
            <div
              key={key}
              role="gridcell"
              aria-label={label}
              aria-current={isToday ? "date" : undefined}
              className="flex h-8 flex-col items-center justify-center"
            >
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
                {hasTask && <span className="h-1 w-1 rounded-full bg-pill-warning-fg" />}
                {hasClient && <span className="h-1 w-1 rounded-full bg-pill-info-fg" />}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
