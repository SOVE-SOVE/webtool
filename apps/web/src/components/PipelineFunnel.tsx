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

/**
 * A single horizontal segmented bar: one segment per pipeline stage, in
 * stage order, width proportional to its lead count. Clicking a segment
 * opens the Leads list filtered to that stage.
 *
 * Segments are too narrow to carry text (a stage can be 1 lead in 200),
 * so the labels and counts live in the legend beneath — which is also the
 * keyboard path (the bar's own links are skipped by Tab so a screen-reader
 * or keyboard user doesn't hit every stage twice). A stage with no leads
 * draws no segment and shows in the legend as a muted, non-link "0".
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
  const filled = segments.filter((s) => s.count > 0);

  return (
    <div className="card p-4">
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
        <div className="mt-3 flex h-9 items-center justify-center rounded-md border border-dashed border-border-strong px-3 text-sm text-fg-subtle">
          No leads in the pipeline yet
          {emptyAction && <span className="ml-2">{emptyAction}</span>}
        </div>
      ) : (
        <>
          <div className="mt-3 flex h-9 gap-px overflow-hidden rounded-md" role="group" aria-label="Leads by pipeline stage">
            {filled.map((segment) => {
              const style: CSSProperties = { flex: `${segment.count} 1 0`, minWidth: 6, backgroundColor: fillFor(segment) };
              return (
                <Link
                  key={segment.key}
                  href={leadsHrefForStage(segment.key)}
                  tabIndex={-1}
                  aria-hidden="true"
                  title={describe(segment)}
                  style={style}
                  className="block transition-[filter] duration-[var(--duration-fast)] hover:brightness-110 motion-reduce:transition-none"
                />
              );
            })}
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3 xl:grid-cols-5">
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
        </>
      )}

      {children && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-sm">{children}</div>}
    </div>
  );
}
