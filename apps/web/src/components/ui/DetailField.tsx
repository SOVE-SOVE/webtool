import type { ReactNode } from "react";

/**
 * A stacked label/value pair — small uppercase label above the value.
 * The shape a `field()` local helper was independently re-typed as on
 * Lead detail, Client detail, and elsewhere (see
 * docs/11_UI_REDESIGN_PLAN.md §2.4/§4) for "at a glance" detail-page
 * grids. Use this instead of a new local helper.
 */
export function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

/**
 * A label/value pair on one line — label left, value right-aligned and
 * truncating. The shape a local `summaryRow()` helper re-typed for
 * compact summary lists (e.g. Lead detail's "Status"/"Next" cards).
 */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-fg">{value}</span>
    </div>
  );
}
