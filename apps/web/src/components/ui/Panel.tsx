import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A compact module: title + optional right slot, then a fixed-height,
 * internally-scrolling body so no single list stretches the page.
 * Originally Sales-only; shared here so Today (and anywhere else that
 * needs a bordered, titled list module) looks identical rather than
 * re-deriving the same card treatment.
 */
export function Panel({
  title,
  subtitle,
  right,
  children,
  bodyClassName = "max-h-80",
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-md border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {subtitle && <p className="truncate text-xs text-fg-muted">{subtitle}</p>}
        </div>
        {right && <div className="shrink-0 text-xs text-fg-muted">{right}</div>}
      </div>
      <div className={`overflow-y-auto overscroll-contain ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Centred placeholder text for an empty Panel body / bordered list. */
export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-fg-muted">{children}</p>;
}

/**
 * A two-line list row — bold primary line, muted secondary line, and an
 * optional toned status label on the right. Used for lead/follow-up rows
 * on Sales and priority/schedule rows on Today, so both pages share one
 * definition of "what a list item looks like."
 */
export function ItemRow({
  href,
  primary,
  secondary,
  right,
  rightTone,
}: {
  href: string;
  primary: string;
  secondary: string;
  right?: string;
  rightTone?: "danger" | "warn" | "muted";
}) {
  const toneCls =
    rightTone === "danger"
      ? "text-red-700 dark:text-red-400"
      : rightTone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "text-fg-muted";
  return (
    <Link href={href} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-fg">{primary}</span>
        <span className="block truncate text-xs text-fg-muted">{secondary}</span>
      </span>
      {right && <span className={`shrink-0 text-xs ${toneCls}`}>{right}</span>}
    </Link>
  );
}
