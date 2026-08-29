import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A single summary metric — small label, big value, optional hint line.
 * Shared by the Overview and Sales dashboards (each previously defined
 * its own near-identical `MetricTile`). Pass `href` to make the whole
 * tile a link to the screen that metric drills into.
 */
export function Metric({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-fg">{value}</p>
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
