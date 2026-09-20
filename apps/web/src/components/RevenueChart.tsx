"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatAud } from "@/lib/format";
import {
  evenIndices,
  formatAxisCents,
  nearestIndex,
  niceAxis,
  parseDateKey,
  stepPath,
  type RevenuePoint,
} from "@/lib/revenueChart";

const HEIGHT = 200;
const MARGIN = { top: 16, right: 14, bottom: 24, left: 42 };
const TOOLTIP_WIDTH = 168;
const LINE = "var(--pill-info-fg)";

function dayLabel(key: string): string {
  return parseDateKey(key).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/**
 * A cumulative revenue line: one series, so one colour, no legend box
 * (the card's title names it). A step line, because a running total only
 * changes on the day a deal lands — it holds flat between deals and jumps
 * at the next, which is also what keeps a handful of deals reading as a
 * deliberate shape rather than a broken line. Dots mark the days a deal
 * was won; the endpoint is the only direct label. A crosshair snaps to the
 * nearest day on hover, and arrow keys do the same when the chart is
 * focused; the parent offers a table view for the same numbers.
 *
 * `emptyMessage` is shown over a flat baseline when there is nothing to
 * plot yet — the chart keeps its axes and frame so it looks intentional.
 */
export function RevenueChart({
  points,
  weekly,
  emptyMessage,
}: {
  points: RevenuePoint[];
  weekly: boolean;
  emptyMessage: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = points.length;
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + innerH;
  const maxCents = points.reduce((m, p) => Math.max(m, p.cumulativeCents), 0);
  // 10% headroom so the line (and its endpoint label) never sits on the top gridline.
  const axis = niceAxis(Math.ceil(maxCents * 1.1));

  const xs = points.map((_, i) => MARGIN.left + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1)));
  const ys = points.map((p) => MARGIN.top + innerH * (1 - p.cumulativeCents / axis.max));

  const last = n - 1;
  const period = (i: number) => (weekly ? `Week of ${dayLabel(points[i].date)}` : dayLabel(points[i].date));
  const labelIdx = evenIndices(n, width < 420 ? 3 : 5);

  function onPointerMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box || n === 0) return;
    setActive(nearestIndex(xs, e.clientX - box.left));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (n === 0) return;
    const at = active ?? last;
    let next = at;
    if (e.key === "ArrowLeft") next = Math.max(0, at - 1);
    else if (e.key === "ArrowRight") next = Math.min(last, at + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    setActive(next);
  }

  const summary =
    n > 0
      ? `Cumulative revenue won, ${formatAud(points[0].cumulativeCents)} ${weekly ? "the week of" : "on"} ${dayLabel(points[0].date)} to ${formatAud(points[last].cumulativeCents)} ${weekly ? "the week of" : "on"} ${dayLabel(points[last].date)}.`
      : "Cumulative revenue won: no data.";

  const tip = active !== null ? points[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(xs[active] - TOOLTIP_WIDTH / 2, 0), width - TOOLTIP_WIDTH) : 0;

  return (
    <div
      ref={wrapRef}
      className="relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      tabIndex={0}
      role="group"
      aria-label="Cumulative revenue chart. Use the left and right arrow keys to read each day."
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? (n > 0 ? last : null))}
      onBlur={() => setActive(null)}
    >
      <svg width={width} height={HEIGHT} role="img" aria-label={summary} className="block overflow-visible">
        {axis.ticks.map((tick) => {
          const y = MARGIN.top + innerH * (1 - tick / axis.max);
          return (
            <g key={tick}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
              <text x={MARGIN.left - 8} y={y} textAnchor="end" dominantBaseline="central" fontSize={11} className="fill-fg-subtle">
                {formatAxisCents(tick)}
              </text>
            </g>
          );
        })}

        {labelIdx.map((i, k) => (
          <text
            key={i}
            x={xs[i]}
            y={HEIGHT - 6}
            fontSize={11}
            className="fill-fg-subtle"
            textAnchor={k === 0 ? "start" : k === labelIdx.length - 1 ? "end" : "middle"}
          >
            {dayLabel(points[i].date)}
          </text>
        ))}

        {n > 0 && (
          <>
            <path d={stepPath(xs, ys, baseline)} fill={LINE} fillOpacity={0.1} />
            <path d={stepPath(xs, ys)} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {points.map(
              (p, i) =>
                p.dealsCount > 0 &&
                i !== last && <circle key={p.date} cx={xs[i]} cy={ys[i]} r={4} fill={LINE} stroke="var(--surface)" strokeWidth={2} />,
            )}
            <circle cx={xs[last]} cy={ys[last]} r={4.5} fill={LINE} stroke="var(--surface)" strokeWidth={2} />
            <text
              x={xs[last] - 8}
              y={Math.max(ys[last] - 12, MARGIN.top + 6)}
              textAnchor="end"
              fontSize={12}
              fontWeight={600}
              className="fill-fg"
            >
              {formatAud(points[last].cumulativeCents)}
            </text>
          </>
        )}

        {active !== null && (
          <g pointerEvents="none">
            <line x1={xs[active]} x2={xs[active]} y1={MARGIN.top} y2={baseline} stroke="var(--border-strong)" strokeWidth={1} />
            <circle cx={xs[active]} cy={ys[active]} r={4.5} fill={LINE} stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}

        {/* The hit target is the whole plot, not the 2px line. */}
        <rect
          x={MARGIN.left}
          y={0}
          width={Math.max(innerW, 0)}
          height={HEIGHT - MARGIN.bottom + 8}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
        />
      </svg>

      {emptyMessage && (
        <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-sm text-fg-subtle">{emptyMessage}</p>
      )}

      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: tipLeft, top: 0, width: TOOLTIP_WIDTH }}
        >
          <p className="text-fg-muted">{period(active!)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: LINE }} />
            {formatAud(tip.cumulativeCents)}
          </p>
          <p className="mt-0.5 text-fg-muted">
            {tip.dealsCount === 0
              ? "No deals won"
              : [
                  tip.revenueCents > 0 ? `+${formatAud(tip.revenueCents)}` : null,
                  `${tip.dealsCount} ${tip.dealsCount === 1 ? "deal" : "deals"} won`,
                  tip.unpricedCount > 0 ? `${tip.unpricedCount} unpriced` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}
