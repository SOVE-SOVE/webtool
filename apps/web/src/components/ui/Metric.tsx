import Link from "next/link";
import type { ReactNode } from "react";
import { AnimatedCount } from "./AnimatedCount";

/**
 * A single summary metric — small label, big value, optional hint line.
 * Shared by the Overview and Sales dashboards (each previously defined
 * its own near-identical `MetricTile`). Pass `href` to make the whole
 * tile a link to the screen that metric drills into.
 *
 * `count` marks the value as a plain count (leads, tasks…), which then
 * eases when it changes in place (AnimatedCount). Off by default, and
 * never set it for money: an amount must always land exactly, at once.
 */
export function Metric({
  label,
  value,
  hint,
  href,
  count = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  count?: boolean;
}) {
  const body = (
    <>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-fg">
        {count && (typeof value === "number" || typeof value === "string") ? <AnimatedCount value={value} /> : value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>}
    </>
  );

  const className = "block rounded-md border border-border bg-surface px-4 py-3";

  return href ? (
    <Link href={href} className={`${className} transition-colors hover:bg-surface-hover`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Responsive grid wrapper for a row of `<Metric>`s. */
export function MetricGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${className}`}>
      {children}
    </div>
  );
}
