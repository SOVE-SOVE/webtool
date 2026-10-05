import type { CSSProperties } from "react";
import { chartPaletteVars, type ChartPalette } from "@/lib/chartPalette";
import { BarSwatch, OverdueIcon, SHADE } from "../clients/RevenueCalendar";
import { LegendKey, MARK, STROKE } from "../clients/revenueChartParts";

// Made-up figures — the preview never reads real financial records.
// `start` and `share` are % of the ring.
const DONUT = [
  { key: "website", label: "Website builds", start: 0, share: 58 },
  { key: "hosting", label: "Hosting", start: 58, share: 30 },
  { key: "uncategorised", label: "Other", start: 88, share: 12 },
] as const;
const DONUT_R = 38;
const DONUT_GAP = 1.5; // % of the ring left clear between segments

/** Bar heights as % of the plot. Overdue stacks on Outstanding, as in the weekly chart. */
const WEEKS = [
  { label: "W1", received: 62, outstanding: 0, overdue: 22 },
  { label: "W2", received: 88, outstanding: 0, overdue: 0 },
  { label: "W3", received: 40, outstanding: 34, overdue: 12 },
  { label: "W4", received: 0, outstanding: 70, overdue: 0 },
];

/**
 * A miniature of the revenue charts, drawn with the same token classes
 * the real ones use. `chartPaletteVars` on the wrapper scopes the DRAFT
 * palette to this subtree, so it previews colours the rest of the app
 * hasn't been given yet. Every mark has a worded legend — nothing here
 * is told apart by colour alone.
 */
export function ChartColoursPreview({ palette }: { palette: ChartPalette }) {
  return (
    <figure style={chartPaletteVars(palette) as CSSProperties} className="rounded-lg border border-border bg-surface p-3">
      <figcaption className="text-xs font-medium text-fg-muted">Preview · Sample data</figcaption>
      <div className="mt-3 grid gap-x-5 gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="flex items-center gap-3 sm:flex-col sm:items-start">
          <div className="relative size-20 shrink-0">
            <svg viewBox="0 0 100 100" aria-hidden="true" className="block size-full -rotate-90">
              {DONUT.map((d) => (
                <circle
                  key={d.key}
                  cx="50"
                  cy="50"
                  r={DONUT_R}
                  pathLength={100}
                  strokeWidth="12"
                  strokeDasharray={`${d.share - DONUT_GAP} ${100 - d.share + DONUT_GAP}`}
                  strokeDashoffset={-d.start}
                  className={`fill-none ${STROKE[d.key]}`}
                />
              ))}
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-fg">$4,800</span>
          </div>
          <ul className="space-y-0.5 text-xs text-fg-muted">
            {DONUT.map((d) => (
              <li key={d.key}>
                <LegendKey className={MARK[d.key]} label={`${d.label} ${d.share}%`} />
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0">
          <div aria-hidden="true" className="flex h-20 items-end gap-2 border-b border-border">
            {WEEKS.map((w) => (
              <div key={w.label} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
                <span className={`w-full max-w-4 rounded-t-sm ${MARK.received}`} style={{ height: `${w.received}%` }} />
                <span className="flex h-full w-full max-w-4 flex-col justify-end">
                  {w.overdue > 0 && <span className={`w-full rounded-t-sm ${MARK.overdue}`} style={{ height: `${w.overdue}%` }} />}
                  {w.outstanding > 0 && (
                    <span className={`w-full ${w.overdue > 0 ? "" : "rounded-t-sm"} ${MARK.expected}`} style={{ height: `${w.outstanding}%` }} />
                  )}
                </span>
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="mt-0.5 flex gap-2 text-center text-[10px] leading-4 text-fg-muted">
            {WEEKS.map((w) => (
              <span key={w.label} className="flex-1">
                {w.label}
              </span>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
            <LegendKey className={MARK.received} label="Received" />
            <LegendKey className={MARK.expected} label="Outstanding" />
            <LegendKey className={MARK.overdue} label="Overdue" />
          </div>
        </div>

        <div className="flex items-start gap-3 sm:flex-col sm:gap-2">
          {/* One calendar day, styled like a RevenueCalendar tile. */}
          <div aria-hidden="true" className={`flex min-h-[3.875rem] w-24 shrink-0 flex-col gap-0.5 rounded-lg border border-border/70 p-1.5 ${SHADE[3]}`}>
            <span className="flex items-center justify-between gap-1">
              <span className="-ml-0.5 inline-flex size-5 items-center justify-center text-[11px] font-medium tabular-nums text-fg">14</span>
              <span className="text-chart-overdue-icon">
                <OverdueIcon />
              </span>
            </span>
            <span className="text-[13px] font-semibold leading-4 tabular-nums text-fg">$1,200</span>
            <span className="mt-auto flex flex-col gap-0.5">
              <span className="block h-1 overflow-hidden rounded-full bg-border/60">
                <span className={`block h-full w-[72%] rounded-full ${MARK.received}`} />
              </span>
              <span className="block h-1 overflow-hidden rounded-full bg-border/60">
                <span className={`flex h-full w-[55%] overflow-hidden rounded-full ${MARK.expected}`}>
                  <span className="block h-full w-[40%] bg-chart-overdue-soft" />
                </span>
              </span>
            </span>
          </div>
          <ul className="space-y-0.5 text-xs text-fg-muted">
            <li className="flex items-center gap-1.5">
              <BarSwatch fill={MARK.received} />
              Received, with day shading
            </li>
            <li className="flex items-center gap-1.5">
              <BarSwatch fill={MARK.expected} overdue />
              Outstanding, overdue part first
            </li>
            <li className="flex items-center gap-1.5">
              <span className="flex w-4 justify-center text-chart-overdue-icon">
                <OverdueIcon />
              </span>
              Overdue mark
            </li>
          </ul>
        </div>
      </div>
    </figure>
  );
}
