"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatMoney } from "@/lib/format";
import { RECEIPT_CATEGORY_LABEL, type CategorySlice, type ReceiptCategory } from "./revenueAnalytics";
import { ChartCard, MARK, STROKE, TOOLTIP_CLASS, TooltipRow, plural } from "./revenueChartParts";

const CX = 50;
const CY = 50;
const R = 38;
const STROKE_WIDTH = 12;
/** ~2px surface gap between segments at the rendered size. */
const GAP_UNITS = 1.6;
/** Hover/focus pull-out along the segment's mid-angle: ~4px at the
 * rendered 144px (1 viewBox unit = 1.44px). */
const OFFSET_UNITS = 2.8;

function point(angle: number, r: number): [number, number] {
  return [CX + r * Math.cos(angle), CY + r * Math.sin(angle)];
}

/** SVG arc from `a0` to `a1` (radians, clockwise from 12 o'clock) in the
 * 100-unit donut viewBox — shared with the day-detail breakdown ring. */
export function arcPath(a0: number, a1: number, r: number): string {
  const [x0, y0] = point(a0, r);
  const [x1, y1] = point(a1, r);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(3)},${y0.toFixed(3)} A${r},${r} 0 ${large} 1 ${x1.toFixed(3)},${y1.toFixed(3)}`;
}

function percent(share: number): string {
  const p = share * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/** Centre-only labels — the hole fits one short word. The legend, tooltip
 * and accessible text keep the full names. */
const CENTRE_LABEL: Record<ReceiptCategory, string> = {
  website: "Builds",
  hosting: "Hosting",
  uncategorised: "Other",
};

/** The centre block's width as a share of the 100-unit viewBox: the hole's
 * diameter (2 × inner radius) × 0.78 — ~72px at the rendered size, so the
 * fixed 36px-tall two-line block's corners sit ~6px inside the hole, and
 * "Received" still fits in the mono app font. */
const CENTRE_WIDTH_PCT = (2 * (R - STROKE_WIDTH / 2) * 0.78).toFixed(2);

/** "$1.23M" — only for the centre when the exact figure can't fit there. */
function compactMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency, notation: "compact", maximumSignificantDigits: 3 }).format(cents / 100);
}

/** Centre amount candidates, largest first: exact at 16 then 15px, then
 * the compact form. The first that fits the centre block wins. */
const AMOUNT_FITS = [
  { compact: false, px: 16 },
  { compact: false, px: 15 },
  { compact: true, px: 16 },
  { compact: true, px: 15 },
] as const;

/** TOOLTIP_CLASS's min-w-[11rem]. */
const TOOLTIP_MIN_PX = 176;

type Box = { x: number; y: number; w: number; h: number };

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How far a box reaches into a circle (0 when clear of it). */
function intrusion(b: Box, cx: number, cy: number, r: number): number {
  const dx = Math.max(b.x - cx, 0, cx - (b.x + b.w));
  const dy = Math.max(b.y - cy, 0, cy - (b.y + b.h));
  return Math.max(0, r - Math.hypot(dx, dy));
}

/**
 * Tooltip position (in the chart body's coordinates): tries below, beside
 * and above the ring. It must stay in the viewport and clear of the donut
 * hole and the legend amounts; then it prefers staying off the ring, then
 * inside the (compact) card, then off the legend. A transient tooltip may
 * float over the neighbouring card rather than cover the chart it
 * explains. Falls back to the spot that intrudes least.
 */
function placeTooltip(body: HTMLElement, ring: HTMLElement, tip: HTMLElement) {
  const origin = body.getBoundingClientRect();
  const rel = (r: DOMRect): Box => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
  const card = rel((body.closest("section") ?? body).getBoundingClientRect());
  const view: Box = { x: -origin.left, y: -origin.top, w: document.documentElement.clientWidth, h: window.innerHeight };
  const ringBox = rel(ring.getBoundingClientRect());
  const legend = body.querySelector("ul");
  const legendBox = legend ? rel(legend.getBoundingClientRect()) : null;
  const amounts = [...body.querySelectorAll("[data-legend-amount]")].map((el) => rel(el.getBoundingClientRect()));
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const cx = ringBox.x + ringBox.w / 2;
  const cy = ringBox.y + ringBox.h / 2;
  const scale = ringBox.w / 100;
  const holeR = (R - STROKE_WIDTH / 2) * scale;
  const ringR = (R + STROKE_WIDTH / 2 + OFFSET_UNITS) * scale;
  const gap = 8;
  const inset = 4; // keep off the card's border / the viewport edge
  const clampX = (x: number) => Math.min(Math.max(x, card.x + inset), card.x + card.w - inset - w);
  const clampY = (y: number) => Math.min(Math.max(y, card.y + inset), card.y + card.h - inset - h);
  const inView = (s: Box): Box => ({
    ...s,
    x: Math.min(Math.max(s.x, view.x + inset), view.x + view.w - inset - w),
    y: Math.min(Math.max(s.y, view.y + inset), view.y + view.h - inset - h),
  });
  const below = cy + ringR + gap;
  const above = cy - ringR - gap - h;
  const right = cx + ringR + gap;
  const left = cx - ringR - gap - w;
  // Aligned to the ring (centre, either edge), else pinned to a card edge —
  // on a narrow card that keeps it over the legend's names, off its amounts.
  const xs = [cx - w / 2, ringBox.x, ringBox.x + ringBox.w - w, -Infinity, Infinity].map(clampX);
  const ys = [ringBox.y, cy - h / 2, ringBox.y + ringBox.h - h, -Infinity, Infinity].map(clampY);
  const spots: Box[] = [
    ...xs.map((x) => ({ x, y: below, w, h })),
    ...ys.map((y) => ({ x: right, y, w, h })),
    ...ys.map((y) => ({ x: left, y, w, h })),
    ...xs.map((x) => ({ x, y: above, w, h })),
  ].map(inView);
  let best: Box = spots[0];
  let bestScore = Infinity;
  let bestHard = Infinity;
  for (const s of spots) {
    const offScreen = w * h - overlap(s, view);
    const hard = offScreen + intrusion(s, cx, cy, holeR) * 100 + amounts.reduce((sum, a) => sum + overlap(s, a), 0);
    // Ring intrusion is in px (≤ ~80), so it outranks the 0–20 card term.
    const outsideCard = ((w * h - overlap(s, card)) / (w * h)) * 20;
    const soft = intrusion(s, cx, cy, ringR) * 2 + outsideCard + (legendBox ? overlap(s, legendBox) / (w * h) : 0);
    const score = hard * 1000 + soft;
    if (score < bestScore) {
      best = s;
      bestScore = score;
      bestHard = hard;
    }
  }
  // Room left of the legend amounts — a narrower width to retry with when
  // no spot is clean (a long amount on a narrow card: the rows then wrap).
  const narrow = amounts.length ? Math.min(...amounts.map((a) => a.x)) - gap - (card.x + inset) : 0;
  return { left: best.x, top: best.y, clean: bestHard < 0.5, narrow };
}

/**
 * "Received by type" — part-to-whole of the range's receipts (website
 * builds vs hosting; uncategorised only when non-zero). Never mixes in
 * expected or overdue amounts. Each drawn segment is a keyboard-focusable
 * button: focus/hover puts its short name and amount in the centre and its
 * full name, amount, share and count in a tooltip beside the ring, and
 * activating it filters the Payments calendar by that type (`?kind=`). The
 * legend beside (or below) the ring carries every value in words, so
 * nothing depends on the tooltip or on colour.
 */
export function ReceiptsDonut({
  slices,
  rangeText,
  currency,
  kind,
  filtered,
  onSelect,
  className = "",
}: {
  slices: CategorySlice[];
  rangeText: string;
  currency: string;
  /** Current `?kind=` (Payments type filter), if any. */
  kind: "website" | "hosting" | null;
  /** A client filter is active — the donut follows it, and says so. */
  filtered: boolean;
  onSelect: (category: "website" | "hosting") => void;
  className?: string;
}) {
  const titleId = useId();
  const [active, setActive] = useState<ReceiptCategory | null>(null);
  const [focused, setFocused] = useState<ReceiptCategory | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const centreRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const total = slices.reduce((sum, s) => sum + s.cents, 0);

  const shown = active ?? focused;
  const shownSlice = shown ? slices.find((s) => s.category === shown) ?? null : null;
  const centreCents = shownSlice ? shownSlice.cents : total;
  const exact = formatMoney(centreCents, currency);
  const compact = compactMoney(centreCents, currency);
  // Index into AMOUNT_FITS, for the amount it was measured against.
  const [fit, setFit] = useState({ text: "", index: 0 });
  const fitIndex = fit.text === exact ? fit.index : 0;
  const amountFit = AMOUNT_FITS[fitIndex];

  // Pick the largest amount form that fits the centre block — measured, so
  // it holds for every app font (incl. mono) and currency symbol. Re-runs
  // when the block's font metrics change (e.g. a font switch).
  useLayoutEffect(() => {
    const probe = probeRef.current;
    const box = centreRef.current;
    if (!probe || !box) return;
    let live = true;
    const measure = () => {
      if (!live) return;
      const room = box.clientWidth;
      let index = AMOUNT_FITS.length - 1;
      for (let i = 0; i < AMOUNT_FITS.length; i++) {
        probe.style.fontSize = `${AMOUNT_FITS[i].px}px`;
        probe.textContent = AMOUNT_FITS[i].compact ? compact : exact;
        if (probe.offsetWidth <= room) {
          index = i;
          break;
        }
      }
      setFit((prev) => (prev.text === exact && prev.index === index ? prev : { text: exact, index }));
    };
    measure();
    // The label's width tracks the app font, so it signals a font switch.
    const ro = new ResizeObserver(measure);
    if (box.firstElementChild) ro.observe(box.firstElementChild);
    document.fonts?.ready.then(measure);
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [exact, compact]);

  // Tooltip placement happens before paint, straight on the node, so it
  // never flashes at its default spot.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const ring = ringRef.current;
    const tip = tipRef.current;
    if (!shown || !body || !ring || !tip) return;
    tip.style.maxWidth = "";
    let spot = placeTooltip(body, ring, tip);
    if (!spot.clean && spot.narrow >= TOOLTIP_MIN_PX) {
      tip.style.maxWidth = `${spot.narrow}px`;
      spot = placeTooltip(body, ring, tip);
    }
    Object.assign(tip.style, { left: `${spot.left}px`, top: `${spot.top}px` });
  }, [shown]);

  // The period is in the analytics header (and the ring's label); the
  // calculation note lives behind the info control.
  const info = (
    <ul className="space-y-1.5">
      <li>
        <span className="font-medium text-fg">Received</span> — payments net of refunds, counted on the day they were received. Voided
        payments are left out.
      </li>
      <li>Select a type on the ring or in the list to show only those payments in the calendar.</li>
      <li>Amounts in {currency}.</li>
    </ul>
  );

  if (total === 0) {
    return (
      <ChartCard titleId={titleId} title="Received by type" info={info} className={className}>
        <p className="mt-2 text-sm text-fg-subtle">
          No payments received in this period.{filtered && " Filtered by client."}
        </p>
      </ChartCard>
    );
  }

  // Segment geometry — zero slices are listed in the legend but not drawn.
  const drawn = slices.filter((s) => s.cents > 0);
  const gap = drawn.length > 1 ? GAP_UNITS / R : 0;
  const segments = drawn.map((s, i) => {
    const before = drawn.slice(0, i).reduce((sum, d) => sum + d.share, 0);
    const from = -Math.PI / 2 + before * Math.PI * 2;
    const sweep = s.share * Math.PI * 2;
    return { slice: s, a0: from + gap / 2, a1: from + sweep - gap / 2, full: drawn.length === 1 };
  });

  // Hover/focus softens the other segments; with nothing hovered, the
  // persistent `?kind=` selection keeps its (stronger) dimming.
  const opacity = (c: ReceiptCategory) => (shown ? (shown === c ? "opacity-100" : "opacity-45") : kind !== null && kind !== c ? "opacity-35" : "opacity-100");
  // The emphasised segment moves outward (translate only — the ring's
  // geometry and the chart never scale). A lone full ring has no mid-angle.
  const offset = (c: ReceiptCategory, a0: number, a1: number, full: boolean) => {
    if (full || shown !== c) return "translate(0px, 0px)";
    const mid = (a0 + a1) / 2;
    return `translate(${(OFFSET_UNITS * Math.cos(mid)).toFixed(3)}px, ${(OFFSET_UNITS * Math.sin(mid)).toFixed(3)}px)`;
  };
  const clickable = (c: ReceiptCategory): c is "website" | "hosting" => c === "website" || c === "hosting";

  function describe(s: CategorySlice): string {
    return `${RECEIPT_CATEGORY_LABEL[s.category]}: ${formatMoney(s.cents, currency)}, ${percent(s.share)} of received, ${plural(s.count, "payment")}.`;
  }

  return (
    <ChartCard titleId={titleId} title="Received by type" info={info} className={className}>
      {/* Sized by its content (no container query, so the grid's
          fit-content column can measure it): the legend sits beside the
          ring while it has 13rem, and wraps under it otherwise. */}
      <div ref={bodyRef} className="relative mt-2">
        <div className="flex flex-wrap items-center justify-center gap-4">
          <div ref={ringRef} className="relative size-36 shrink-0" onMouseLeave={() => setActive(null)}>
            <svg viewBox="0 0 100 100" className="block size-full overflow-visible" role="group" aria-label={`Received by type, ${rangeText}. Total ${formatMoney(total, currency)}.`}>
              {segments.map(({ slice, a0, a1, full }) => {
                const c = slice.category;
                const canSelect = clickable(c);
                const common = {
                  className: `${STROKE[c]} fill-none transition-[opacity,transform] duration-fast ease-standard motion-reduce:transition-none ${opacity(c)} ${
                    canSelect ? "cursor-pointer" : ""
                  } outline-none`,
                  style: { transform: offset(c, a0, a1, full) },
                  strokeWidth: STROKE_WIDTH,
                  onMouseEnter: () => setActive(c),
                  // Keyboard focus only — a click's leftover focus mustn't
                  // hold the emphasis after the pointer leaves.
                  onFocus: (e: { currentTarget: Element }) => {
                    if (e.currentTarget.matches(":focus-visible")) setFocused(c);
                  },
                  onBlur: () => setFocused(null),
                  tabIndex: 0,
                  role: canSelect ? "button" : "img",
                  "aria-label": `${describe(slice)}${canSelect ? ` ${kind === c ? "Filtering the Payments calendar. Press to clear." : "Press to show only these payments in the calendar."}` : ""}`,
                  "aria-pressed": canSelect ? kind === c : undefined,
                  onClick: canSelect ? () => onSelect(c) : undefined,
                  onKeyDown: canSelect
                    ? (e: KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(c);
                        }
                      }
                    : undefined,
                };
                return full ? (
                  <circle key={c} cx={CX} cy={CY} r={R} {...common} />
                ) : (
                  <path key={c} d={arcPath(a0, a1, R)} {...common} />
                );
              })}
              {/* Keyboard focus ring — an accent arc just outside the
                  focused segment (SVG paths have no reliable outline). */}
              {focused &&
                segments
                  .filter((s) => s.slice.category === focused)
                  .map(({ slice, a0, a1, full }) =>
                    full ? (
                      <circle key="focus" cx={CX} cy={CY} r={R + STROKE_WIDTH / 2 + 2.5} className="pointer-events-none fill-none stroke-accent" strokeWidth={1.5} />
                    ) : (
                      <path
                        key={`focus-${slice.category}`}
                        d={arcPath(a0, a1, R + STROKE_WIDTH / 2 + 2.5)}
                        className="pointer-events-none fill-none stroke-accent transition-transform duration-fast ease-standard motion-reduce:transition-none"
                        style={{ transform: offset(slice.category, a0, a1, full) }}
                        strokeWidth={1.5}
                        strokeLinecap="round"
                      />
                    ),
                  )}
            </svg>
            {/* Centre: two fixed lines — a short label and the amount (the
                total, or the hovered/focused type's). Sized to sit inside
                the hole; share and count live in the tooltip. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div ref={centreRef} style={{ width: `${CENTRE_WIDTH_PCT}%` }} className="relative flex h-9 flex-col items-center justify-center text-center">
                <span className="max-w-full truncate text-xs leading-4 text-fg-muted">{shownSlice ? CENTRE_LABEL[shownSlice.category] : "Received"}</span>
                <span style={{ fontSize: amountFit.px }} className="max-w-full whitespace-nowrap font-semibold leading-5 tabular-nums text-fg">
                  {amountFit.compact ? compact : exact}
                </span>
                {/* Measuring probe for the amount's fit (see the effect above). */}
                <span ref={probeRef} className="invisible absolute left-0 top-0 whitespace-nowrap font-semibold leading-5 tabular-nums" />
              </div>
            </div>
          </div>

          {/* Legend with values — also a pointer target per row (keyboard
              users reach each type through its segment above). */}
          <ul className="min-w-[13rem] max-w-sm flex-1 space-y-1 text-xs">
            {slices.map((s) => {
              const canSelect = clickable(s.category);
              const selected = kind === s.category;
              return (
                // Hover lives on the row: the disabled (uncategorised) button fires no mouse events.
                <li key={s.category} onMouseEnter={() => setActive(s.category)} onMouseLeave={() => setActive(null)}>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    disabled={!canSelect}
                    onClick={canSelect ? () => onSelect(s.category as "website" | "hosting") : undefined}
                    className={`flex min-h-8 w-full items-center gap-2 rounded px-1.5 text-left transition-colors duration-fast ease-standard motion-reduce:transition-none disabled:cursor-default ${
                      selected ? "bg-accent-soft" : "enabled:hover:bg-surface-hover"
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${MARK[s.category]}`} />
                    <span className={`min-w-0 flex-1 truncate ${selected ? "font-medium text-fg" : "text-fg-muted"}`}>
                      {RECEIPT_CATEGORY_LABEL[s.category]}
                    </span>
                    <span data-legend-amount className="shrink-0 tabular-nums text-fg">{formatMoney(s.cents, currency)}</span>
                    <span className="w-9 shrink-0 text-right tabular-nums text-fg-subtle">{percent(s.share)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {/* Detail for the hovered/focused type — placed beside the ring
            (see placeTooltip). The segments' labels carry the same values. */}
        {shownSlice && (
          <div ref={tipRef} aria-hidden="true" className={TOOLTIP_CLASS}>
            <p className="text-[11px] font-medium text-fg">{RECEIPT_CATEGORY_LABEL[shownSlice.category]}</p>
            <div className="mt-1 space-y-0.5 text-xs">
              <TooltipRow keyClass={MARK[shownSlice.category]} value={formatMoney(shownSlice.cents, currency)} label={`${percent(shownSlice.share)} of received`} />
              <TooltipRow value={String(shownSlice.count)} label={shownSlice.count === 1 ? "payment" : "payments"} />
            </div>
          </div>
        )}
        {/* A data-state note, not fine print — it stays visible. */}
        {filtered && <p className="mt-2 text-xs text-fg-subtle">Filtered by client.</p>}
      </div>
    </ChartCard>
  );
}
