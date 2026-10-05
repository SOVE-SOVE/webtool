"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { RevenueExpectedHostingPlan } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import type { OverdueAgeBucket, RevenueFocus } from "./revenueVisuals";

/**
 * One metric card in the Revenue summary row — label, one figure, one
 * short footer line, in a fixed order so every card's title, figure and
 * footer line up across the row. Two separate controls, so focus and
 * details never share a click:
 *
 * - the card body is a toggle button (`aria-pressed`) that sets
 *   `?focus=` and narrows the calendar records below;
 * - a small "i" control in the corner opens the metric's definition and
 *   its breakdown in a popover (MetricInfo) — the card itself never
 *   grows, so the row keeps its alignment.
 *
 * The selected state is carried by a tint, an accent top rule AND a
 * "Filtering below" tag — never colour alone. Neither control ever
 * changes the headline value.
 */
export function SnapshotMetric({
  label,
  value,
  footer,
  pressed,
  onToggle,
  focusHint,
  infoLabel,
  info,
  className = "",
}: {
  label: string;
  value: ReactNode;
  /** One short line under the figure (a count, a comparison). */
  footer?: ReactNode;
  pressed: boolean;
  onToggle: () => void;
  /** Spoken after the area's own text — what pressing it does. */
  focusHint: string;
  /** Accessible name of the info control, e.g. "About monthly hosting". */
  infoLabel?: string;
  /** Definition + breakdown, shown in the info popover. */
  info?: MetricInfoContent;
  /** Shell classes — set by the analytics grid. */
  className?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={cardRef}
      className={`relative flex min-w-0 flex-col transition-colors duration-fast ease-standard motion-reduce:transition-none ${
        pressed ? "bg-accent-soft shadow-[inset_0_2px_0_0_var(--accent)]" : ""
      } ${className}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={pressed}
        className={`flex flex-1 flex-col rounded-[inherit] px-4 py-3 text-left transition-colors duration-fast ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${
          pressed ? "" : "hover:bg-surface-hover"
        }`}
      >
        {/* Right padding keeps the label clear of the corner info control. */}
        <span className={`flex min-h-5 items-center text-xs text-fg-muted ${info ? "pr-7" : ""}`}>{label}</span>
        <span className="mt-1 block text-2xl font-semibold leading-8 tracking-tight tabular-nums text-fg [overflow-wrap:anywhere]">
          {value}
        </span>
        <span className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1.5 text-xs text-fg-muted">
          <span className="tabular-nums">{footer}</span>
          {pressed && (
            <span className="shrink-0 rounded-full border border-border-strong bg-surface px-1.5 text-[11px] font-medium leading-4 text-fg">
              Filtering below
            </span>
          )}
        </span>
        <span className="sr-only">. {pressed ? "Selected. Press again to show all records." : focusHint}</span>
      </button>

      {info && infoLabel && (
        <div className="absolute right-1.5 top-1.5">
          <MetricInfo label={infoLabel} anchorRef={cardRef}>
            {info}
          </MetricInfo>
        </div>
      )}
    </div>
  );
}

/** Popover body — plain content, or a function given `close` (for an
 * action inside it that opens another panel). */
export type MetricInfoContent = ReactNode | ((close: () => void) => ReactNode);

const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * The "i" control on a metric card and the popover it opens: the
 * metric's definition plus its full breakdown. Same non-modal behaviour
 * as FilterPopover — `aria-haspopup`/`aria-expanded`/`aria-controls` on
 * the trigger, `role="dialog"` on the panel, which takes focus on open;
 * Escape closes it and returns focus to the trigger; a press outside or
 * Tab leaving it closes it. The panel lives in the top layer
 * (`popover="manual"`) and is placed against the whole CARD (`anchorRef`),
 * not the tiny trigger — below it, or above when there's more room,
 * clamped to the viewport — so it's never clipped by the narrow card or
 * an `overflow` ancestor, and never pushes the row's layout around.
 */
function MetricInfo({
  label,
  anchorRef,
  children,
}: {
  label: string;
  anchorRef: RefObject<HTMLElement | null>;
  children: MetricInfoContent;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!open || !panel || !anchor) return;
    panel.showPopover?.();

    function place() {
      if (!panel || !anchor) return;
      const a = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      panel.style.maxHeight = "";
      const spaceBelow = vh - a.bottom - POPOVER_GAP - VIEWPORT_MARGIN;
      const spaceAbove = a.top - POPOVER_GAP - VIEWPORT_MARGIN;
      const natural = panel.offsetHeight;
      const below = natural <= spaceBelow || spaceBelow >= spaceAbove;
      const height = Math.min(natural, Math.max(below ? spaceBelow : spaceAbove, 0));
      const width = panel.offsetWidth;
      panel.style.maxHeight = `${height}px`;
      panel.style.top = `${below ? a.bottom + POPOVER_GAP : a.top - POPOVER_GAP - height}px`;
      panel.style.left = `${Math.min(Math.max(a.left, VIEWPORT_MARGIN), vw - width - VIEWPORT_MARGIN)}px`;
    }

    function handleScroll(e: Event) {
      if (!(e.target instanceof Node && panel?.contains(e.target))) place();
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const close = () => setOpen(false);

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
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`inline-flex size-8 items-center justify-center rounded-full text-fg-muted transition-colors duration-fast ease-standard hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none ${
          open ? "bg-surface-hover text-fg" : ""
        }`}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v3.75" />
          <path d="M8 4.9h.01" strokeWidth="1.8" />
        </svg>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          popover="manual"
          // `inset-auto m-0` undo the UA popover centring; `place()` sets top/left/max-height.
          className="animate-rise-in fixed inset-auto m-0 w-[20rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border bg-surface p-3 text-left text-xs text-fg-muted shadow-xl outline-none"
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** A definition line at the top of a metric's info popover. */
export function MetricDefinition({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-5 text-fg">{children}</p>;
}

/** Expected hosting's breakdown — the active plans whose monthly fees make
 * up the headline, soonest next-due first. */
export function HostingPlansList({ plans, currency }: { plans: RevenueExpectedHostingPlan[]; currency: string }) {
  if (plans.length === 0) return <p className="text-xs text-fg-muted">No active hosting plans.</p>;
  const sorted = [...plans].sort((a, b) => a.next_due_date.localeCompare(b.next_due_date));
  return (
    <div>
      <p className="text-xs font-medium text-fg-muted">Active plans&apos; monthly fees</p>
      {/* No inner scroll: the info popover scrolls as a whole. */}
      <ul className="mt-1 divide-y divide-border">
        {sorted.map((p) => (
          <li key={p.plan_id} className="flex items-start justify-between gap-3 py-1.5 text-xs">
            <span className="min-w-0">
              <span className="block truncate text-fg">{p.client_business_name ?? "No client"}</span>
              <span className="block text-fg-muted">
                {p.project_name} · next due {formatDate(p.next_due_date)}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-fg">
              {formatMoney(p.monthly_fee_cents, currency)}
              <span className="text-fg-muted">/mo</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Overdue by age, from the same rows as the headline (so the buckets add
 * up to it) — one thin bar per bucket on a shared scale, exact amounts
 * beside it; plus the way into the full all-months overdue list. */
export function OverdueAgeList({
  buckets,
  currency,
  onViewAll,
}: {
  buckets: OverdueAgeBucket[];
  currency: string;
  onViewAll: () => void;
}) {
  const max = Math.max(...buckets.map((b) => b.cents), 1);
  return (
    <div>
      <p className="text-xs font-medium text-fg-muted">By days overdue, as of today</p>
      <ul className="mt-1 space-y-1.5">
        {buckets.map((b) => (
          <li key={b.label} className="text-xs">
            <span className="flex items-baseline justify-between gap-3">
              <span className={b.count > 0 ? "text-fg" : "text-fg-muted"}>
                {b.label}
                {b.count > 0 && <span className="text-fg-muted"> · {b.count}</span>}
              </span>
              <span className={`tabular-nums ${b.count > 0 ? "text-fg" : "text-fg-muted"}`}>{formatMoney(b.cents, currency)}</span>
            </span>
            <span aria-hidden="true" className="mt-0.5 block h-1 rounded-full bg-surface-subtle">
              {b.cents > 0 && (
                <span className="block h-1 rounded-full bg-chart-overdue" style={{ width: `max(4px, ${(b.cents / max) * 100}%)` }} />
              )}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onViewAll}
        className="mt-2 rounded text-xs text-fg-muted hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        View all overdue →
      </button>
    </div>
  );
}


export const FOCUS_LABEL: Record<RevenueFocus, string> = {
  received: "Received payments",
  hosting: "Hosting charges",
  overdue: "Overdue",
};

export const FOCUS_SCOPE: Record<RevenueFocus, string> = {
  received: "Money actually received — reversals hidden.",
  hosting: "Issued and scheduled hosting charges.",
  overdue: "Overdue payments due in the period shown.",
};

function FilterTag({ label, value, onRemove, removeLabel }: { label: string; value: string; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-border-strong bg-surface pl-2.5 pr-1 text-xs">
      <span className="text-fg-muted">{label}:</span>
      <span className="font-medium text-fg">{value}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="inline-flex size-6 items-center justify-center rounded-full text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : (
        <span className="w-1.5" />
      )}
    </span>
  );
}

/**
 * The one "what's narrowing the calendar" line: a metric-card focus, the
 * payment type picked on the donut (`?kind=`), and a week/month the
 * calendar was moved to from a chart. One visible Reset clears focus and
 * type (the calendar keeps its position). Headline figures never change
 * with any of these. For Overdue it also offers the existing all-months
 * overdue panel, since the calendar shows one period at a time.
 */
export function ActiveFiltersBar({
  focus,
  kindLabel,
  calendarSelection,
  onReset,
  onClearKind,
  onClearCalendarSelection,
  onViewAllOverdue,
  hasOverdue,
}: {
  /** Only when it applies to the current view. */
  focus: RevenueFocus | null;
  kindLabel: string | null;
  /** e.g. "Week 14 Sep – 20 Sep 2026 (from Weekly cash flow)". */
  calendarSelection: string | null;
  onReset: () => void;
  onClearKind: () => void;
  onClearCalendarSelection: () => void;
  onViewAllOverdue: () => void;
  hasOverdue: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm"
    >
      <span className="text-xs text-fg-muted">Showing</span>
      {focus && <FilterTag label="Focus" value={FOCUS_LABEL[focus]} />}
      {kindLabel && <FilterTag label="Type" value={kindLabel} onRemove={onClearKind} removeLabel={`Remove type filter: ${kindLabel}`} />}
      {calendarSelection && (
        <FilterTag
          label="Calendar"
          value={calendarSelection}
          onRemove={onClearCalendarSelection}
          removeLabel="Back to the month view"
        />
      )}
      {focus && <span className="text-xs text-fg-subtle">{FOCUS_SCOPE[focus]}</span>}
      {focus === "overdue" && hasOverdue && (
        <button
          type="button"
          onClick={onViewAllOverdue}
          className="rounded text-xs text-fg-muted hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          All overdue as of today, across every month →
        </button>
      )}
      {(focus || kindLabel) && (
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset — clear focus and type filters"
          className="ml-auto inline-flex min-h-7 items-center rounded px-1.5 text-xs font-medium text-fg-muted hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Reset
        </button>
      )}
    </div>
  );
}
