import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { leadsHrefForStage, type Funnel, type FunnelSegment, type FunnelTone } from "@/lib/pipelineFunnel";

/** Theme-aware fill per stage, from the existing pill/foreground tokens —
 * no palette of its own. Active stages ramp from a light to a strong tint
 * of the info colour as the lead moves down the funnel. */
function fillFor(segment: FunnelSegment): string {
  const tones: Record<Exclude<FunnelTone, "active">, string> = {
    won: "var(--pill-success-fg)",
    lost: "var(--pill-danger-fg)",
    parked: "var(--fg-subtle)",
  };
  if (segment.tone !== "active") return tones[segment.tone];
  const percent = Math.round(35 + segment.depth * 50);
  return `color-mix(in srgb, var(--pill-info-fg) ${percent}%, var(--surface))`;
}

function describe(segment: FunnelSegment): string {
  const leads = `${segment.count} ${segment.count === 1 ? "lead" : "leads"}`;
  return `${segment.label}: ${leads} (${Math.round(segment.share * 100)}%)`;
}

/** Width of an empty stage's sliver in the bar — thinner than any filled segment's minimum. */
const EMPTY_SEGMENT_PX = 4;
const MIN_FILLED_SEGMENT_PX = 8;

/**
 * A single horizontal segmented bar: one segment per pipeline stage, in
 * stage order, width proportional to its lead count. Clicking a segment
 * opens the Leads list filtered to that stage.
 *
 * Every stage is drawn, so the bar always shows the shape of the whole
 * pipeline: a stage with no leads is a thin muted sliver in its legend
 * colour, never a gap. A filled segment carries its label and count in a
 * small surface-coloured chip once it's wide enough (count alone when it's
 * a little narrower, nothing when it's a sliver) — the chip keeps the text
 * readable on every fill in both themes. Widths come from each segment's
 * own container query, so no measuring in JS.
 *
 * The legend beneath still lists every stage with its count and is the
 * keyboard path (the bar's own links are skipped by Tab so a screen-reader
 * or keyboard user doesn't hit every stage twice).
 * `children` sits in a footer row (extra links that aren't pipeline stages).
 */
export function PipelineFunnel({
  funnel,
  emptyAction,
  children,
}: {
  funnel: Funnel;
  /** Shown in the empty state, e.g. a link to where leads come from. */
  emptyAction?: ReactNode;
  children?: ReactNode;
}) {
  const { segments, total } = funnel;

  return (
    // `@container`: the legend picks its column count from this card's own width, not the
    // viewport — the card sits beside the calendar, so its width varies independently of the screen.
    <div className="card @container flex flex-1 flex-col p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-fg-muted">
          <span className="text-2xl font-semibold tabular-nums text-fg">{total}</span>{" "}
          {total === 1 ? "lead" : "leads"} in the pipeline
        </p>
        <Link
          href="/dashboard/sales/leads"
          className="rounded text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          All leads →
        </Link>
      </div>

      {total === 0 ? (
        <div className="mt-3 flex min-h-9 flex-1 items-center justify-center rounded-md border border-dashed border-border-strong px-3 text-sm text-fg-subtle">
          No leads in the pipeline yet
          {emptyAction && <span className="ml-2">{emptyAction}</span>}
        </div>
      ) : (
        <>
          <div className="mt-3 flex h-9 gap-px overflow-hidden rounded-md" role="group" aria-label="Leads by pipeline stage">
            {segments.map((segment) => {
              if (segment.count === 0) {
                // Same muted swatch the legend uses for an empty stage.
                const style: CSSProperties = { flex: `0 0 ${EMPTY_SEGMENT_PX}px`, backgroundColor: fillFor(segment), opacity: 0.35 };
                return <div key={segment.key} aria-hidden="true" title={describe(segment)} style={style} />;
              }
              const style: CSSProperties = {
                flex: `${segment.count} 1 0`,
                minWidth: MIN_FILLED_SEGMENT_PX,
                backgroundColor: fillFor(segment),
              };
              return (
                <Link
                  key={segment.key}
                  href={leadsHrefForStage(segment.key)}
                  tabIndex={-1}
                  aria-hidden="true"
                  title={describe(segment)}
                  style={style}
                  className="@container flex min-w-0 items-center px-1.5 transition-[filter] duration-[var(--duration-fast)] hover:brightness-110 motion-reduce:transition-none"
                >
                  <span className="hidden max-w-full items-center gap-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-xs leading-none text-fg @min-[2rem]:flex">
                    <span className="hidden min-w-0 truncate @min-[7rem]:inline">{segment.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{segment.count}</span>
                  </span>
                </Link>
              );
            })}
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-0.5 @md:grid-cols-3 @3xl:grid-cols-5">
            {segments.map((segment) => {
              const body = (
                <>
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: fillFor(segment), opacity: segment.count > 0 ? 1 : 0.35 }}
                  />
                  <span className="min-w-0 flex-1 truncate">{segment.label}</span>
                  <span className="tabular-nums">{segment.count}</span>
                </>
              );
              return (
                <li key={segment.key}>
                  {segment.count > 0 ? (
                    <Link
                      href={leadsHrefForStage(segment.key)}
                      aria-label={describe(segment)}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {body}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-2 px-1.5 py-1 text-sm text-fg-subtle">{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {/* Takes any spare height (the card stretches to match the calendar beside it), so the footer links sit at the bottom. */}
          <div className="flex-1" aria-hidden="true" />
        </>
      )}

      {children && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-sm">{children}</div>}
    </div>
  );
}
