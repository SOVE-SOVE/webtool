"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * Shared pieces for the Revenue analytics charts (plain HTML/SVG — no
 * charting dependency). Colours are fixed per MEANING, never per rank,
 * and come from the `--chart-*` tokens in globals.css, which Settings →
 * Appearance → Chart colours can override (lib/chartPalette.ts). The
 * built-in defaults:
 *
 * - Status (same hues as the calendar's day indicators): received =
 *   emerald, expected/due = indigo, overdue = red. Validated together with
 *   the dataviz checker on the light (#fff) and dark (#171717) surfaces.
 * - Receipt category (the donut): website = sky, hosting = amber — a
 *   separate categorical pair (validator: CVD ΔE 24.8, normal-vision
 *   ΔE 32.6, ≥3:1 on both surfaces) that avoids red and the status hues.
 *   "Uncategorised" is a neutral gray, only drawn when non-zero.
 *
 * Identity never rests on colour alone: every chart has a legend with
 * words, fixed bar order, tooltips and a text alternative.
 */
export const MARK = {
  received: "bg-chart-received",
  expected: "bg-chart-outstanding",
  overdue: "bg-chart-overdue",
  notInvoiced: "bg-zinc-400 dark:bg-zinc-500",
  website: "bg-chart-website",
  hosting: "bg-chart-hosting",
  uncategorised: "bg-chart-other",
} as const;

/** Same hues as `MARK`, for SVG strokes (the donut). */
export const STROKE = {
  website: "stroke-chart-website",
  hosting: "stroke-chart-hosting",
  uncategorised: "stroke-chart-other",
} as const;

/** Diagonal hatch for "no records" periods — distinct from a genuine zero. */
export const NO_RECORDS_HATCH =
  "bg-[repeating-linear-gradient(135deg,var(--border-strong)_0_1px,transparent_1px_6px)]";

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function dateOf(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "1 Jul" */
export function dayMonthLabel(key: string): string {
  return dateOf(key).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** "1 Jul – 30 Sep 2026" (year shown once when both ends share it). With
 * `withYear: false`: "1 Jul – 30 Sep". A single day reads as one date. */
export function rangeLabel(start: string, end: string, withYear = true): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const endText = dateOf(end).toLocaleDateString("en-AU", withYear ? { ...opts, year: "numeric" } : opts);
  if (start === end) return endText;
  const startText = dateOf(start).toLocaleDateString("en-AU", withYear && !sameYear ? { ...opts, year: "numeric" } : opts);
  return `${startText} – ${endText}`;
}

/** A clean axis ceiling (1 / 2 / 2.5 / 5 × 10ⁿ, in whole currency units)
 * so the one top tick reads as a round number. */
export function niceCeilCents(cents: number): number {
  const units = Math.max(1, Math.ceil(cents / 100));
  const magnitude = 10 ** Math.floor(Math.log10(units));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (units <= step * magnitude) return step * magnitude * 100;
  }
  return 10 * magnitude * 100;
}

/** Percentage bar height with a 2px floor so a small real amount never vanishes. */
export function barHeight(cents: number, maxCents: number): string {
  return `max(2px, ${(cents / maxCents) * 100}%)`;
}

export function LegendKey({ className, label }: { className: string; label: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

/** Tooltip row: a short key in the series colour, the value first, then the name. */
export function TooltipRow({ keyClass, value, label }: { keyClass?: string; value: string; label: string }) {
  return (
    <p className="flex items-center gap-2">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-sm ${keyClass ?? "bg-transparent"}`} />
      <span className="font-medium tabular-nums text-fg">{value}</span>
      <span className="text-fg-muted">{label}</span>
    </p>
  );
}

/**
 * A small "i" button that keeps a chart's definitions one tap away
 * instead of on the page. A non-modal disclosure: `aria-expanded` /
 * `aria-controls` on a real button; Escape (focus returns to the
 * trigger), a press outside, or Tab moving focus out closes it. The
 * panel is placed against the nearest positioned ancestor (the chart's
 * header row), not the tiny trigger, and never exceeds that width — so
 * it stays inside the card at 360px.
 */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="inline-flex"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (open && e.relatedTarget instanceof Node && !rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      {/* 32px target; the negative margin keeps the header row's height. */}
      <Tooltip label={open ? "" : label}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={label}
          aria-expanded={open}
          aria-controls={panelId}
          className={`-my-1.5 inline-flex size-8 items-center justify-center rounded-full text-fg-subtle transition-colors duration-fast ease-standard hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none ${
            open ? "bg-surface-hover text-fg" : ""
          }`}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 7.25v3.75" />
            <path d="M8 4.9h.01" strokeWidth="1.8" />
          </svg>
        </button>
      </Tooltip>
      <div
        id={panelId}
        hidden={!open}
        className="animate-rise-in absolute left-0 top-full z-30 mt-1 w-[20rem] max-w-full rounded-lg border border-border bg-surface p-3 text-left text-xs font-normal text-fg-muted shadow-xl"
      >
        {open && children}
      </div>
    </div>
  );
}

/** Card shell shared by every chart (and its skeleton) — title (+ an
 * optional info control) + optional right-hand legend, then the body.
 * `min-w-0` lets it shrink inside a grid. */
export function ChartCard({
  titleId,
  title,
  subtitle,
  legend,
  info,
  className = "",
  busy = false,
  children,
}: {
  titleId: string;
  title: string;
  subtitle?: ReactNode;
  legend?: ReactNode;
  /** Definitions/fine print, behind an "About …" info control beside the title. */
  info?: ReactNode;
  className?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  const heading = (
    <h3 id={titleId} className="text-sm font-semibold text-fg">
      {title}
      {subtitle && <span className="font-normal text-fg-muted"> · {subtitle}</span>}
    </h3>
  );
  return (
    <section aria-labelledby={titleId} aria-busy={busy || undefined} className={`card min-w-0 px-4 py-3 ${className}`}>
      <div className="relative flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {info ? (
          <div className="flex min-w-0 items-center gap-0.5">
            {heading}
            <InfoPopover label={`About ${title.toLowerCase()}`}>{info}</InfoPopover>
          </div>
        ) : (
          heading
        )}
        {legend && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">{legend}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Roving focus + hover state for a row of chart columns: one tab stop,
 * arrow keys / Home / End move between columns, hover and focus drive
 * the same tooltip.
 */
export function useColumnNav(count: number, defaultIndex: number) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [roving, setRoving] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = roving !== null && roving < count ? roving : Math.max(0, Math.min(defaultIndex, count - 1));
  const active = hovered ?? focused;

  function moveTo(index: number) {
    const next = Math.max(0, Math.min(count - 1, index));
    setRoving(next);
    refs.current[next]?.focus();
  }

  function columnProps(i: number) {
    return {
      ref: (el: HTMLButtonElement | null) => {
        refs.current[i] = el;
      },
      tabIndex: i === current ? 0 : -1,
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
        const moves: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: count - 1 };
        if (e.key in moves) {
          e.preventDefault();
          moveTo(moves[e.key]);
        }
      },
      onMouseEnter: () => setHovered(i),
      onFocus: (e: { currentTarget: HTMLButtonElement }) => {
        setRoving(i);
        // Keyboard focus shows the tooltip; the focus a mouse click leaves
        // behind doesn't, so pointer exit always restores the resting chart.
        if (e.currentTarget.matches(":focus-visible")) setFocused(i);
      },
      onBlur: () => setFocused(null),
    };
  }

  return {
    active: active !== null && active < count ? active : null,
    columnProps,
    clearHover: () => setHovered(null),
    select: (i: number) => setRoving(i),
  };
}

/** Width of a plot element, kept current with a ResizeObserver — used to
 * place the tooltip beside the active column. Returns `[measure, width]`;
 * pass `measure` to the plot's `ref`. */
export function usePlotWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

const TOOLTIP_MIN_PX = 176; // TOOLTIP_CLASS's min-w-[11rem]
const TOOLTIP_GAP_PX = 8;

/**
 * Tooltip position inside the plot: top-aligned, BESIDE the active column
 * on whichever side has more room — so it never covers the hovered bars,
 * the card's legend above or "View as table" below. When neither side
 * fits (narrow plots, middle columns) it pins to the plot edge on the
 * roomier side, which keeps any overlap with the active column smallest.
 */
export function tooltipPlacement(index: number, count: number, width: number): CSSProperties {
  const colLeft = (width * index) / count;
  const colRight = (width * (index + 1)) / count;
  const roomRight = width - colRight - TOOLTIP_GAP_PX;
  const roomLeft = colLeft - TOOLTIP_GAP_PX;
  const right = roomRight >= roomLeft;
  if (width > 0 && Math.max(roomLeft, roomRight) >= TOOLTIP_MIN_PX) {
    return right
      ? { left: colRight + TOOLTIP_GAP_PX, maxWidth: roomRight }
      : { right: width - colLeft + TOOLTIP_GAP_PX, maxWidth: roomLeft };
  }
  return right ? { right: 0 } : { left: 0 };
}

export const TOOLTIP_CLASS =
  "pointer-events-none absolute top-0 z-20 w-max min-w-[11rem] max-w-[16rem] rounded-md border border-border-strong bg-surface p-2 text-left shadow-lg";

export const COLUMN_BUTTON_CLASS =
  "flex h-full min-w-0 items-end justify-center rounded-t-sm transition-colors duration-fast ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none";

/** The "View as table" button (24px tall) for a bar chart's header row. */
export function TableToggleButton({
  tableId,
  open,
  onToggle,
  className = "",
}: {
  tableId: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={tableId}
      className={`${className} inline-flex min-h-6 shrink-0 items-center rounded px-1 text-xs text-fg-muted hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
    >
      {open ? "Hide table" : "View as table"}
    </button>
  );
}
