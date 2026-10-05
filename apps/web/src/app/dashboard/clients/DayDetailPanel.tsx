"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { NextPaymentObligation, RevenueTransaction } from "@/lib/api";
import { NEXT_PAYMENT_KIND_LABEL, obligationKey, relativeObligationLabel } from "@/lib/billing";
import { formatDate } from "@/lib/format";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { Badge } from "@/components/ui/Badge";
import type { DayTotals } from "./revenueVisuals";
import { selectionBreakdown } from "./calendarCashFlow";
import { AdjustIcon, OverdueIcon } from "./RevenueCalendar";
import { InfoPopover, MARK, plural } from "./revenueChartParts";
import { adjustmentsLabel, exactMoney, scopeDatesLabel, shortDayHeading } from "./calendarLabels";
import { ringDashes, ringSeriesAt, type RingDash } from "./breakdownRing";
import { Tooltip } from "@/components/ui/Tooltip";

export type DayDetailItem = { type: "transaction"; tx: RevenueTransaction } | { type: "obligation"; o: NextPaymentObligation };

/** A record's kind as a compact chip ("Website", "Monthly hosting"). */
function KindChip({ label }: { label: string }) {
  return <span className="shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 text-[11px] leading-4 text-fg-muted">{label}</span>;
}

const CARD_LINK = "text-sm text-fg-muted hover:text-fg hover:underline";

/**
 * One payment. Client, amount and status lead; the kind is a chip; the
 * project shows only when it tells this record apart; the date only when
 * it isn't simply the selected day. Refund and reversal facts stay
 * visible (a reversed amount is struck through — it isn't counted).
 */
function TransactionRow({
  tx,
  currency,
  onOpen,
  showDate,
  showProject,
}: {
  tx: RevenueTransaction;
  currency: string;
  onOpen?: (paymentId: string) => void;
  showDate: boolean;
  showProject: boolean;
}) {
  const amount = exactMoney(tx.voided ? tx.amount_cents : tx.net_cents, currency);
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {tx.client_id ? (
            <Link href={`/dashboard/clients/${tx.client_id}`} className="block truncate font-medium text-fg hover:underline">
              {tx.client_business_name ?? "Client"}
            </Link>
          ) : (
            <p className="truncate font-medium text-fg-subtle">No client (prospect)</p>
          )}
        </div>
        <p className={`shrink-0 font-semibold tabular-nums ${tx.voided ? "text-fg-muted line-through" : "text-fg"}`}>
          {amount}
          {tx.voided && <span className="sr-only"> (reversed, not counted)</span>}
        </p>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <KindChip label={tx.kind === "website" ? "Website" : "Hosting"} />
          {showProject && <span className="truncate">{tx.project_name}</span>}
          {showDate && <span className="tabular-nums">{formatDate(tx.received_date)}</span>}
          {!tx.voided && tx.refunded_cents > 0 && (
            <span className="tabular-nums text-amber-700 dark:text-amber-400">Refunded {exactMoney(tx.refunded_cents, currency)}</span>
          )}
        </div>
        {tx.voided ? (
          <Badge tone="muted">Reversed</Badge>
        ) : tx.refunded_cents > 0 ? (
          <Badge tone="warning">Refunded</Badge>
        ) : (
          <Badge tone="success">Paid</Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {onOpen && (
          <button type="button" onClick={() => onOpen(tx.payment_id)} className={CARD_LINK}>
            Details →
          </button>
        )}
        {tx.client_id && (
          <Link href={`/dashboard/clients/${tx.client_id}?tab=billing`} className={CARD_LINK}>
            Client Billing →
          </Link>
        )}
      </div>
    </div>
  );
}

/** One unpaid charge: client, remaining amount and status lead; the kind
 * chip, the project (when it helps) and the due status follow. */
function ObligationRow({
  o,
  currency,
  onRecordPayment,
  showProject,
}: {
  o: NextPaymentObligation;
  currency: string;
  onRecordPayment?: (o: NextPaymentObligation) => void;
  showProject: boolean;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {o.client_id ? (
            <Link href={`/dashboard/clients/${o.client_id}`} className="block truncate font-medium text-fg hover:underline">
              {o.client_business_name ?? "Client"}
            </Link>
          ) : (
            <p className="truncate font-medium text-fg-subtle">No client (prospect)</p>
          )}
        </div>
        <p className="shrink-0 text-right tabular-nums">
          <span className="text-xs text-fg-muted">Remaining </span>
          <span className="font-semibold text-fg">{exactMoney(o.amount_cents, currency)}</span>
        </p>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <KindChip label={NEXT_PAYMENT_KIND_LABEL[o.kind]} />
          {showProject && (
            <Link href={`/dashboard/projects/${o.project_id}`} className="truncate hover:underline">
              {o.project_name}
            </Link>
          )}
          <span>{relativeObligationLabel(o)}</span>
        </div>
        {o.scheduled ? (
          <Badge tone="muted">Scheduled</Badge>
        ) : o.is_overdue ? (
          <Badge tone="danger">Overdue</Badge>
        ) : o.days_relative === 0 ? (
          <Badge tone="warning">Due today</Badge>
        ) : (
          <Badge tone="info">Upcoming</Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {!o.scheduled && onRecordPayment && (
          <button type="button" onClick={() => onRecordPayment(o)} className="btn btn-secondary btn-sm">
            Record Payment
          </button>
        )}
        {o.client_id && (
          <Link href={`/dashboard/clients/${o.client_id}?tab=billing`} className={CARD_LINK}>
            Client Billing →
          </Link>
        )}
        {!showProject && (
          <Link href={`/dashboard/projects/${o.project_id}`} className={CARD_LINK}>
            Project →
          </Link>
        )}
      </div>
    </div>
  );
}

type SeriesStatus = "ready" | "loading" | "error";
type SeriesKey = "received" | "overdue";

// The breakdown's two colours: the calendar's received green and its
// muted overdue red (RevenueCalendar's OVERDUE_FILL), as SVG strokes and
// as legend swatches, so the ring, the bars and the legend agree.
const SEGMENT = {
  received: { stroke: "stroke-chart-received", fill: MARK.received },
  overdue: { stroke: "stroke-chart-overdue-soft", fill: "bg-chart-overdue-soft" },
} as const;

const RING_R = 38;
const RING_STROKE = 11;
const RING_C = 2 * Math.PI * RING_R;
/** A ~3px surface gap between the two segments at the rendered size (the
 * same gap, in viewBox units, as the Received by type ring). */
const RING_GAP = 1.6;
/** The least a real amount draws (~2px), however small its share. */
const RING_MIN = 1;
/** The keyboard focus ring's radius, just outside the segments. */
const RING_FOCUS_R = RING_R + RING_STROKE / 2 + 2.5;
/** The ring's rendered size: 176px, 200px once the breakdown is ≥30rem
 * wide (wide screens, or stacked under the calendar). */
const RING_SIZE = "size-44 @[30rem]/breakdown:size-[12.5rem]";

// A new selection moves each dash to its new start and length from
// wherever it is now (interrupting a move still in progress), on the
// panel timing; the hover dim keeps its own quicker fade.
// (Each class is written out whole — Tailwind only sees literal names.)
const SEGMENT_MOTION =
  "[transition:opacity_var(--duration-fast)_var(--ease-standard),stroke-dasharray_var(--duration-panel)_var(--ease-out-calm),stroke-dashoffset_var(--duration-panel)_var(--ease-out-calm)] motion-reduce:transition-none";
const FOCUS_RING_MOTION =
  "[transition:stroke-dasharray_var(--duration-panel)_var(--ease-out-calm),stroke-dashoffset_var(--duration-panel)_var(--ease-out-calm)] motion-reduce:transition-none";

/** A dash (breakdownRing.ringDashes, in RING_R units) as the stroke of a
 * full circle of radius `r` that starts at 12 o'clock. */
function dashStyle({ start, length }: RingDash, r = RING_R) {
  const scale = r / RING_R;
  const drawn = length * scale;
  return {
    strokeDasharray: `${drawn.toFixed(3)} ${(RING_C * scale - drawn).toFixed(3)}`,
    strokeDashoffset: (-start * scale).toFixed(3),
  };
}

/**
 * Received vs overdue as a two-segment ring — plain amounts compared,
 * never a percentage or a combined total. Each segment is a focusable
 * image with its exact amount (hover/focus shows it too); the legend
 * beside it carries the words, so nothing depends on colour.
 *
 * Both segments are always-mounted circles drawn as one dash each, so a
 * new selection glides them to their new sizes. Only the strokes move:
 * every amount, label and tooltip is the new selection's from the start.
 */
function BreakdownRing({
  receivedCents,
  overdueCents,
  currency,
  labels,
}: {
  receivedCents: number;
  overdueCents: number;
  currency: string;
  /** Each series' full accessible label, time basis and count included —
   * "Received on 1 Oct 2026: $1,079 from 2 payments". */
  labels: Record<SeriesKey, string>;
}) {
  // The pointer's last place on a segment, as a position round the ring —
  // not which segment it was — so what's highlighted and described always
  // comes from the amounts drawn now.
  const [pointer, setPointer] = useState<number | null>(null);
  const [focusedKey, setFocusedKey] = useState<SeriesKey | null>(null);
  const dashes = ringDashes(receivedCents, overdueCents, RING_C, RING_GAP, RING_MIN);
  const cents = { received: receivedCents, overdue: overdueCents };
  const hovered = pointer === null ? null : ringSeriesAt(dashes, pointer);
  const focused = focusedKey && dashes[focusedKey].length > 0 ? focusedKey : null;
  const active = hovered ?? focused;
  return (
    <div
      className={`relative shrink-0 ${RING_SIZE}`}
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - box.left) / box.width) * 100 - 50;
        const y = ((e.clientY - box.top) / box.height) * 100 - 50;
        if (Math.abs(Math.hypot(x, y) - RING_R) > RING_STROKE / 2) return;
        const position = ((Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2)) * RING_R;
        if (ringSeriesAt(dashes, position)) setPointer(position);
      }}
      onMouseLeave={() => setPointer(null)}
    >
      <svg viewBox="0 0 100 100" className="block size-full overflow-visible" role="group" aria-label={`${labels.received}. ${labels.overdue}.`}>
        <circle cx={50} cy={50} r={RING_R} className="fill-none stroke-border/60" strokeWidth={RING_STROKE} />
        {(["received", "overdue"] as const).map((key) => {
          const drawn = dashes[key].length > 0;
          return (
            <circle
              key={key}
              cx={50}
              cy={50}
              r={RING_R}
              transform="rotate(-90 50 50)"
              className={`${SEGMENT[key].stroke} fill-none outline-none ${SEGMENT_MOTION} ${active && active !== key ? "opacity-40" : ""}`}
              style={dashStyle(dashes[key])}
              strokeWidth={RING_STROKE}
              // A series with nothing to draw stays mounted (it may grow
              // back) but is out of the tab order and the accessibility tree.
              tabIndex={drawn ? 0 : undefined}
              role={drawn ? "img" : undefined}
              aria-label={drawn ? labels[key] : undefined}
              aria-hidden={drawn ? undefined : true}
              onFocus={(e) => {
                if (e.currentTarget.matches(":focus-visible")) setFocusedKey(key);
              }}
              onBlur={() => setFocusedKey(null)}
            />
          );
        })}
        {/* Keyboard focus ring just outside the focused segment. */}
        {focused && (
          <circle
            cx={50}
            cy={50}
            r={RING_FOCUS_R}
            transform="rotate(-90 50 50)"
            className={`pointer-events-none fill-none stroke-accent ${FOCUS_RING_MOTION}`}
            style={dashStyle(dashes[focused], RING_FOCUS_R)}
            strokeWidth={1.5}
            strokeLinecap={dashes[focused].length < RING_C ? "round" : undefined}
          />
        )}
      </svg>
      {/* The centre stays empty — never a combined total. */}
      {active && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-full z-20 mt-1 w-max max-w-[15rem] rounded-md border border-border-strong bg-surface p-2 text-xs shadow-lg"
        >
          <p className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-sm ${SEGMENT[active].fill}`} />
            <span className="font-medium tabular-nums text-fg">{exactMoney(cents[active], currency)}</span>
            <span className="text-fg-muted">{active === "received" ? "Received" : "Overdue"}</span>
          </p>
          <p className="mt-0.5 max-w-[13rem] text-fg-muted">{labels[active]}</p>
        </div>
      )}
    </div>
  );
}

/** The ring's place-holder when there's nothing to chart — a quiet dashed
 * outline, not data. */
function RingPlaceholder() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className="size-28 shrink-0">
      <circle cx={50} cy={50} r={RING_R} className="fill-none stroke-border-strong" strokeWidth={1.5} strokeDasharray="4 5" />
    </svg>
  );
}

function seriesWords(series: SeriesKey[]): string {
  const words = series.map((k) => (k === "received" ? "received" : "overdue"));
  return words.join(" and ");
}

/**
 * The top of a calendar selection's panel: received vs overdue for the
 * selected date(s), from calendarCashFlow.selectionBreakdown (the
 * definitions live there). A ring only when there is something real to
 * compare; every other state is words — never a fabricated or zero pie.
 */
function SelectionBreakdown({
  summary,
  status,
  visible,
  keys,
  isWeek,
  isPeriod = false,
  currency,
  action,
  inline = false,
  heading,
}: {
  summary: DayTotals;
  status: { received: SeriesStatus; outstanding: SeriesStatus };
  visible: { received: boolean; outstanding: boolean };
  keys: string[];
  isWeek: boolean;
  /** The whole visible month/week rather than a selection. */
  isPeriod?: boolean;
  currency: string;
  /** The way to the records behind these figures ("View 3 records"). */
  action?: ReactNode;
  /** The inline panel beside/under the calendar. Its wrapper is the
   * `breakdown` container, and beside the calendar the breakdown lays out
   * the panel's scope heading (`heading`) around its ring. The records
   * drawer sits inside the calendar's container too, so every
   * beside-the-calendar class here is applied only when `inline`. */
  inline?: boolean;
  heading?: ReactNode;
}) {
  const state = selectionBreakdown(summary, status, visible);
  const dates = scopeDatesLabel(keys);
  // The scope as a phrase: "on this date", "on these dates", "in this period".
  const onUnit = isPeriod ? "in this period" : isWeek ? "on these dates" : "on this date";
  // The time basis and counts, for accessible labels and tooltips — the
  // visible legend stays "Received $1,079".
  const receivedLabel = (cents: number) =>
    `Received on ${dates}: ${exactMoney(cents, currency)}${summary.receivedCount > 0 ? ` from ${plural(summary.receivedCount, "payment")}` : ""}`;
  const overdueLabel = (cents: number) => `Overdue: current unpaid balance of charges due ${dates}: ${exactMoney(cents, currency)}`;

  // A legend row: the label above its exact amount, so the column stays
  // narrow enough to sit beside the ring even with a seven-figure amount.
  const row = (key: SeriesKey, cents: number, srLabel: string) => (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-fg-muted">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-sm ${SEGMENT[key].fill}`} />
        {key === "received" ? "Received" : "Overdue"}
        {key === "overdue" && (
          <span className="text-chart-overdue-icon">
            <OverdueIcon className="h-2.5 w-2.5" />
          </span>
        )}
      </dt>
      <dd className="mt-0.5 break-words text-lg font-semibold leading-tight tabular-nums text-fg">
        {exactMoney(cents, currency)}
        <span className="sr-only">. {srLabel}</span>
      </dd>
    </div>
  );

  // Refunds change what Received means, so their note stays — short; the
  // full definition is in the info control beside the heading.
  const adjustments =
    summary.adjustedCount > 0 && state.kind !== "negative" ? (
      <p className="flex items-start gap-1.5 text-xs text-fg-muted">
        <AdjustIcon className="mt-0.5 h-3 w-3" />
        <span>
          {adjustmentsLabel(summary.adjustedCount)} — Received is net of refunds
          {state.kind === "chart" && state.netAdjustmentCents < 0 && (
            <>
              , including <span className="font-medium tabular-nums text-fg">{exactMoney(state.netAdjustmentCents, currency)}</span> refunded beyond a
              payment
            </>
          )}
          .
        </span>
      </p>
    ) : null;

  let figures: ReactNode;
  if (state.kind === "chart") {
    figures = (
      // Beside the calendar: one row under the ring, or one column in the
      // ring's right-hand 1fr (≥28rem) — see the layout note below.
      <dl
        className={`grid w-full min-w-0 grid-cols-2 gap-x-4 gap-y-3 @[18rem]/breakdown:grid-cols-1 ${
          inline
            ? "@[60rem]/calendar:mt-4 @[60rem]/calendar:w-auto @[60rem]/calendar:grid-cols-[repeat(2,auto)] @[60rem]/calendar:gap-x-8 @[60rem]/calendar:@[28rem]/breakdown:mt-0 @[60rem]/calendar:@[28rem]/breakdown:w-full @[60rem]/calendar:@[28rem]/breakdown:grid-cols-1"
            : ""
        }`}
      >
        {row("received", state.receivedCents, receivedLabel(state.receivedCents))}
        {row("overdue", state.overdueCents, overdueLabel(state.overdueCents))}
      </dl>
    );
  } else if (state.kind === "unavailable") {
    figures = state.loading
      ? `Loading ${seriesWords(state.series)} figures…`
      : `The ${seriesWords(state.series)} figures couldn't be loaded, so there's no breakdown — they aren't zero.`;
  } else if (state.kind === "hidden") {
    figures = `The current filters hide ${seriesWords(state.series)} amounts. Clear them to compare received with overdue.`;
  } else if (state.kind === "negative") {
    figures = (
      <>
        Refunds exceeded receipts {onUnit}, so the net is negative — shown as figures, not a chart.
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 tabular-nums">
          <dt className="text-fg-muted">Received</dt>
          <dd className="break-words text-right text-fg">{exactMoney(state.receivedCents, currency)}</dd>
          <dt className="text-fg-muted">Refunds</dt>
          <dd className="break-words text-right text-fg">{exactMoney(state.netAdjustmentCents, currency)}</dd>
          <dt className="font-medium text-fg">Net</dt>
          <dd className="break-words text-right font-medium text-fg">{exactMoney(state.netCents, currency)}</dd>
          <dt className="text-fg-muted">Overdue</dt>
          <dd className="break-words text-right text-fg">
            {exactMoney(state.overdueCents, currency)}
            <span className="sr-only">. {overdueLabel(state.overdueCents)}</span>
          </dd>
        </dl>
      </>
    );
  } else {
    figures = `Nothing received and nothing overdue ${onUnit}.`;
  }

  const chart = state.kind === "chart";
  const side = inline && chart;
  return (
    // No heading of its own: the panel's scope heading names it, the
    // legend names both series, and the definitions sit in the info
    // control beside that heading (BreakdownInfo). Stacked under the
    // calendar: ring and figures side by side once there's room (≥18rem),
    // vertically centred on each other; on a very narrow phone the ring
    // is centred above them.
    //
    // Beside the calendar, the ring is the centre of the empty space
    // right of the calendar, on both axes. This fills the date grid's row
    // as a column — the scope heading's space, the ring, the figures' —
    // reaching back over the column gap (--calendar-gap) so the ring is
    // centred midway between the calendar's edge and the card's. The
    // spaces above and below the ring both start from nothing and share
    // what's left equally, so the ring sits on the date grid's centre; the
    // figures' space never gets shorter than the figures, so on a short
    // date grid the ring rises just enough to keep them inside. The heading sits at
    // the bottom of its space, just above the ring (overflowing upward
    // into the calendar's header row if it must, as before). When the
    // ring's right-hand side is wide enough (≥28rem) the figures sit
    // there instead, and an empty space below mirrors the heading's. The
    // records button moves up beside the scope heading here.
    <div
      className={
        inline
          ? `@[60rem]/calendar:flex @[60rem]/calendar:flex-1 @[60rem]/calendar:flex-col @[60rem]/calendar:after:flex-1 @[60rem]/calendar:after:basis-0 @[60rem]/calendar:after:content-[''] ${
              side
                ? "@[60rem]/calendar:-ml-(--calendar-gap) @[60rem]/calendar:items-center @[60rem]/calendar:after:hidden @[60rem]/calendar:@[28rem]/breakdown:after:block"
                : ""
            }`
          : "@container/breakdown"
      }
    >
      {heading !== undefined && (
        <div
          className={`@[60rem]/calendar:flex @[60rem]/calendar:min-h-0 @[60rem]/calendar:flex-1 @[60rem]/calendar:basis-0 @[60rem]/calendar:flex-col @[60rem]/calendar:justify-end @[60rem]/calendar:self-stretch ${
            side ? "@[60rem]/calendar:pl-(--calendar-gap)" : ""
          }`}
        >
          {heading}
        </div>
      )}
      <div
        className={`grid justify-items-center gap-4 @[18rem]/breakdown:grid-cols-[auto_minmax(0,1fr)] @[18rem]/breakdown:items-center @[18rem]/breakdown:justify-items-stretch ${
          side
            ? "@[60rem]/calendar:contents @[60rem]/calendar:@[28rem]/breakdown:grid @[60rem]/calendar:@[28rem]/breakdown:w-full @[60rem]/calendar:@[28rem]/breakdown:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @[60rem]/calendar:@[28rem]/breakdown:gap-0"
            : ""
        }`}
      >
        {chart ? (
          <div className={side ? "@[60rem]/calendar:shrink-0 @[60rem]/calendar:@[28rem]/breakdown:col-start-2" : undefined}>
            <BreakdownRing
              receivedCents={state.receivedCents}
              overdueCents={state.overdueCents}
              currency={currency}
              labels={{ received: receivedLabel(state.receivedCents), overdue: overdueLabel(state.overdueCents) }}
            />
          </div>
        ) : (
          <RingPlaceholder />
        )}
        <div
          className={`flex w-full min-w-0 flex-col items-start gap-3 ${
            side
              ? "@[60rem]/calendar:flex-1 @[60rem]/calendar:basis-0 @[60rem]/calendar:items-center @[60rem]/calendar:@[28rem]/breakdown:col-start-3 @[60rem]/calendar:@[28rem]/breakdown:items-start @[60rem]/calendar:@[28rem]/breakdown:pl-4"
              : ""
          }`}
        >
          {chart ? figures : <div className="text-xs text-fg-muted">{figures}</div>}
          {adjustments}
          {action && <div className={inline ? "@[60rem]/calendar:hidden" : undefined}>{action}</div>}
        </div>
      </div>
    </div>
  );
}

/** The breakdown's definitions, one tap away beside the panel's scope
 * heading (the breakdown itself has no heading). */
function BreakdownInfo({ keys, showDates }: { keys: string[]; showDates: boolean }) {
  const dates = scopeDatesLabel(keys);
  return (
    <InfoPopover label="About this breakdown">
      <div className="space-y-2">
        <p>
          <span className="font-medium text-fg">Received</span> — payments recorded on {dates}, net of refunds. A partial refund is
          netted from its payment; full refunds and reversals aren&apos;t counted.
        </p>
        <p>
          <span className="font-medium text-fg">Overdue</span> — the current unpaid balance of issued charges due on {dates}. It&apos;s
          today&apos;s balance, not what was overdue back then, and not the account-wide overdue total.
        </p>
        {showDates && <p>Dates covered: {dates}.</p>}
      </div>
    </InfoPopover>
  );
}

/** The inline panel's resting state (nothing selected, or a selection
 * outside the period the calendar has loaded): same shell as the panel,
 * a quiet ring outline and one hint. */
export function CalendarDetailPlaceholder({ message, onClear }: { message?: string; onClear?: () => void }) {
  const headingId = useId();
  return (
    <aside aria-labelledby={headingId} className={INLINE_ASIDE_CLASS}>
      <div className="flex items-start justify-between gap-3 pb-4">
        <h2 id={headingId} className="text-base font-semibold text-fg">
          {onClear ? "Selection not in view" : "Select a day"}
        </h2>
        {onClear && (
          <button type="button" onClick={onClear} className="btn btn-ghost btn-sm h-8 px-2.5">
            Clear
          </button>
        )}
      </div>
      <div className="flex items-center gap-4">
        <RingPlaceholder />
        <p className="min-w-0 flex-1 text-xs text-fg-muted">
          {message ?? "Choose a date — or a week total — in the calendar to see what was received and what's overdue for it, with every record."}
        </p>
      </div>
    </aside>
  );
}

/** The calendar + selection-panel layout, inside an `@container`: stacked
 * below 60rem of container width, then calendar ~70% / panel ~30%
 * (at least 19rem). 60rem is where the calendar column (container − panel
 * − gap ≈ 40rem+) still gives day tiles ≥ ~80px beside the week column —
 * the width the tiles were verified readable at.
 *
 * Side by side, both columns share three subgrid rows — the calendar's
 * key + weekday header, its date grid, and its status line — so the
 * panel can sit in the date grid's own row and centre on it, whatever
 * the month's row count (CALENDAR_COLUMN, CALENDAR_PANEL_SLOT).
 *
 * It is also the `calendar` container (same width as its `@container`
 * parent), so the panel's contents can tell "beside the calendar" from
 * "stacked", and it shares its column gap as `--calendar-gap` so the
 * breakdown can centre its ring on the whole space right of the calendar. */
export const CALENDAR_SPLIT =
  "@container/calendar grid gap-y-4 [--calendar-gap:1rem] gap-x-(--calendar-gap) @[60rem]:grid-cols-[minmax(0,7fr)_minmax(19rem,3fr)] @[60rem]:gap-y-0";

/** The calendar's column in CALENDAR_SPLIT: RevenueCalendar's header and
 * date grid, then the status line, fill the three shared rows. */
export const CALENDAR_COLUMN = "min-w-0 @[60rem]:row-span-3 @[60rem]:grid @[60rem]:grid-rows-subgrid";

/** The panel's slot in CALENDAR_SPLIT, on the same three rows; the panel
 * itself takes the middle (date grid) row — no fixed height, no scroll. */
export const CALENDAR_PANEL_SLOT = "min-w-0 @[60rem]:row-span-3 @[60rem]:grid @[60rem]:grid-rows-subgrid";

// The drawer portals to <body>, which only exists on the client: false
// while server-rendering/hydrating (a drawer opened by a URL param), true
// from then on.
const subscribeNever = () => () => {};
const useIsClient = () => useSyncExternalStore(subscribeNever, () => true, () => false);

// Inline aside: no box of its own — it sits directly in the calendar's
// card, set apart by whitespace. Natural height stacked under the
// calendar; beside it, it fills the date grid's row and centres its
// content there. The 4px inset keeps focus outlines clear of the edge.
const INLINE_ASIDE_CLASS = "flex min-w-0 flex-col p-1 @[60rem]:row-start-2 @[60rem]:justify-center";

/** Calendar-selection group headings ("Received" / "Outstanding"). */
export const CALENDAR_GROUP_LABELS = { transaction: "Received", obligation: "Outstanding" };

const TODAY_GROUP_LABELS = { transaction: "Received today", obligation: "Due today" };

/**
 * "Clicking a date opens a side panel with that day's records and
 * relevant actions" — same side-panel shell/dismiss behaviour as
 * ClientPreviewPanel/PaymentDetailPanel (URL-param driven, focus
 * restored on close). Renders whichever of Payments' transactions or
 * Upcoming's obligations the caller collected for this one date — the
 * two shapes differ, so each gets its own row renderer, but both reuse
 * the exact same labels/formatters the rest of Revenue already uses.
 *
 * `variant="inline"` renders the same content as a non-modal aside
 * beside the calendar (wide screens): no overlay or focus trap, so the
 * selected day stays visible and the calendar stays usable; Escape
 * closes it while focus is inside it.
 */
export function DayDetailPanel({
  dateKey,
  heading,
  description,
  items,
  currency,
  onClose,
  onOpenTransaction,
  onRecordPayment,
  summary,
  summarySeries = { received: true, outstanding: true },
  summaryStatus = { received: "ready", outstanding: "ready" },
  selectionKeys = [],
  scopeKind,
  periodLabel,
  groupLabels = TODAY_GROUP_LABELS,
  variant = "drawer",
}: {
  /** A specific calendar day — renders as its full formatted date. Pass `null` when `heading` already says what this list is (the overdue strip, the "due date not set" indicator). */
  dateKey: string | null;
  /** Overrides the date-derived heading — used by the overdue strip and "due date not set" indicator, whose records span many dates rather than one. */
  heading?: string;
  /** One plain line under the record count stating the list's scope (e.g. the overdue panel spanning every month). */
  description?: string;
  items: DayDetailItem[];
  currency: string;
  onClose: () => void;
  /** Only relevant when `items` can include transactions (the Payments calendar). */
  onOpenTransaction?: (paymentId: string) => void;
  /** Only relevant when `items` can include obligations (the Upcoming calendar). */
  onRecordPayment?: (o: NextPaymentObligation) => void;
  /** Totals for the selected day/week — the same sums its calendar cell
   * or weekly total shows (received, outstanding = due + overdue, the
   * overdue portion, adjustments). */
  summary?: DayTotals;
  /** Which series the summary shows — a filter that hides one calendar
   * series (seriesVisibility) hides its tile too, so a narrowed view
   * never shows a misleading "$0". */
  summarySeries?: { received: boolean; outstanding: boolean };
  /** Whether each series has loaded ("loading"/"error" are never shown as zero). */
  summaryStatus?: { received: SeriesStatus; outstanding: SeriesStatus };
  /** The selected dates (one day, or a week's in-scope dates) — the
   * breakdown's "on 10 Sep" / "due 1–5 Sep" basis. */
  selectionKeys?: string[];
  /** Group headings for a list mixing both kinds. Defaults to the Today
   * box's "Received today" / "Due today"; calendar selections pass
   * "Received" / "Outstanding". */
  groupLabels?: { transaction: string; obligation: string };
  /** "drawer" (default): modal side panel. "inline": non-modal aside for
   * wide layouts, placed by the caller beside the calendar. */
  variant?: "drawer" | "inline";
  /** What the panel covers: a selected day or week, or — with nothing
   * selected — the visible period itself (no "Clear selection" then). */
  scopeKind?: "day" | "week" | "period";
  /** The visible period ("October 2026") — the inline panel's way back
   * from a day/week to the period's own breakdown. */
  periodLabel?: string;
}) {
  const inline = variant === "inline";
  const isClient = useIsClient();
  const headingId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open: !inline, onClose, initialFocusRef: closeButtonRef });

  // Inline: remember the last focused element outside the aside (normally
  // the day cell or week total that opened it), so closing from inside
  // hands focus back there instead of dropping it on <body>. Focus inside
  // an overlay opened from here (the records drawer, Record Payment)
  // doesn't count — those elements are gone once it closes.
  const asideRef = useRef<HTMLElement>(null);
  const lastOutsideFocus = useRef<HTMLElement | null>(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  useEffect(() => {
    if (!inline) return;
    if (document.activeElement instanceof HTMLElement) lastOutsideFocus.current = document.activeElement;
    function onFocusIn(e: FocusEvent) {
      if (e.target instanceof HTMLElement && !asideRef.current?.contains(e.target) && !e.target.closest(".side-panel-overlay, .modal-overlay")) {
        lastOutsideFocus.current = e.target;
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [inline]);

  function close() {
    const restore = inline && asideRef.current?.contains(document.activeElement) ? lastOutsideFocus.current : null;
    // Move focus out first, while the aside is still mounted.
    if (restore?.isConnected) restore.focus();
    onClose();
  }

  // Inline, only a selected day/week can be cleared — back to the period.
  const backToPeriod = inline && scopeKind !== "period" && Boolean(periodLabel);
  const mixed = items.some((x) => x.type === "transaction") && items.some((x) => x.type === "obligation");
  const label =
    heading ??
    (dateKey
      ? inline
        ? shortDayHeading(dateKey)
        : new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : "Records");
  const recordCount = `${items.length} record${items.length === 1 ? "" : "s"}`;

  // A card shows its project only when it tells records apart — this
  // client's records here span more than one project, or the project name
  // isn't just "{client} …" — and its date only when the panel isn't that
  // one day.
  const projectsPerClient = new Map<string, Set<string>>();
  for (const it of items) {
    const id = (it.type === "transaction" ? it.tx.client_id : it.o.client_id) ?? "";
    const project = it.type === "transaction" ? it.tx.project_id : it.o.project_id;
    projectsPerClient.set(id, (projectsPerClient.get(id) ?? new Set()).add(project));
  }
  const showProjectFor = (clientId: string | null, client: string | null, project: string) =>
    (projectsPerClient.get(clientId ?? "")?.size ?? 0) > 1 || !client || !project.toLowerCase().startsWith(client.toLowerCase());

  const breakdownKeys = selectionKeys.length > 0 ? selectionKeys : dateKey ? [dateKey] : [];
  const info = summary ? <BreakdownInfo keys={breakdownKeys} showDates={!dateKey || scopeKind === "period"} /> : null;

  // Inline, the records are one step away: "View N records" opens this
  // same panel as its drawer (modal) variant — every record with its
  // Details / Record Payment / Client Billing actions. Closing it hands
  // focus back to the button (useDismissableOverlay).
  // Beside the calendar the button sits at the end of the scope heading's
  // row instead (the breakdown keeps the space around its ring for the
  // ring), so it's rendered in both places and each shows in one layout.
  const recordsButtonFor = (className: string) =>
    inline && items.length > 0 ? (
      <button type="button" onClick={() => setRecordsOpen(true)} aria-haspopup="dialog" className={`btn btn-secondary btn-sm h-8 px-2.5 ${className}`}>
        View {recordCount}
      </button>
    ) : null;
  const recordsButton = recordsButtonFor("");

  const header = (
    // `relative`: the info popover opens below this row, full width.
    // Inline, the breakdown places it (SelectionBreakdown's `heading`):
    // beside the calendar, just above the ring, outside its centring.
    // Without a breakdown it hangs just above the records button.
    <div
      className={`relative flex items-start justify-between gap-3 ${
        !inline
          ? "border-b border-border p-4"
          : summary
            ? "pb-4"
            : "pb-4 @[60rem]/calendar:absolute @[60rem]/calendar:inset-x-0 @[60rem]/calendar:bottom-full"
      }`}
    >
      <div className={inline ? "min-w-0 flex-1 flow-root" : "min-w-0"}>
        {/* Inline, a selected day/week leads back to the period's own
            breakdown — a back control above the title, not a close ×. */}
        {backToPeriod && (
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label={`Back to ${periodLabel} breakdown`}
            className="-ml-1.5 mb-1 inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-fg-muted transition-colors duration-fast ease-standard hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring motion-reduce:transition-none"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
            {periodLabel}
          </button>
        )}
        {/* Beside the calendar: the records button, floated to the top
            right — level with the back control, or with the heading when
            there's none — so a long heading or scope note keeps the full
            width below it. */}
        {inline && summary && recordsButtonFor("float-right ml-3 hidden @[60rem]/calendar:inline-flex")}
        {/* The scope heading, with the breakdown's definitions beside
            it. The heading and scope note are live (announced when the
            selection changes while focus stays on the calendar); the
            info control sits outside them, so opening it isn't. */}
        <div className="flex min-w-0 items-center gap-1">
          <h2 id={headingId} aria-live={inline ? "polite" : undefined} className={`${inline ? "" : "truncate"} min-w-0 text-base font-semibold text-fg`}>
            {label}
            {/* Inline, the count is for assistive tech only — the button shows it. */}
            {inline && <span className="sr-only">, {recordCount}</span>}
          </h2>
          {info}
        </div>
        {!inline && <p className="mt-0.5 text-xs text-fg-muted">{recordCount}</p>}
        {/* Inline, always mounted (empty = no height) so a scope note
            that appears with a new selection is announced. */}
        {inline ? (
          <p aria-live="polite" className="mt-0.5 text-xs text-fg-subtle empty:mt-0">
            {description}
          </p>
        ) : (
          description && <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>
        )}
      </div>
      {!inline && (
        <Tooltip label="Close" side="bottom">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label="Close day detail"
            className="-m-1 inline-flex size-8 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </Tooltip>
      )}
    </div>
  );

  const breakdown = summary ? (
    <SelectionBreakdown
      summary={summary}
      status={summaryStatus}
      visible={summarySeries}
      keys={breakdownKeys}
      isWeek={!dateKey}
      isPeriod={scopeKind === "period"}
      currency={currency}
      action={recordsButton}
      inline={inline}
      heading={inline ? header : undefined}
    />
  ) : (
    recordsButton
  );

  if (inline) {
    return (
      <>
        <aside
          ref={asideRef}
          aria-labelledby={headingId}
          onKeyDown={(e) => {
            // While the records drawer is open, Escape is its own.
            if (e.key === "Escape" && backToPeriod && !recordsOpen) {
              e.stopPropagation();
              close();
            }
          }}
          className={INLINE_ASIDE_CLASS}
        >
          {/* Just the heading and the breakdown — the records are in the
              drawer below, so nothing here needs to scroll. The breakdown's
              container; beside the calendar it fills the date grid's row
              so the breakdown can centre its ring there. */}
          <div className={`@container/breakdown relative ${summary ? "@[60rem]/calendar:flex @[60rem]/calendar:flex-1 @[60rem]/calendar:flex-col" : ""}`}>
            {!summary && header}
            {breakdown}
          </div>
        </aside>
        {recordsOpen && (
          <DayDetailPanel
            dateKey={dateKey}
            heading={heading}
            description={description}
            items={items}
            currency={currency}
            onClose={() => setRecordsOpen(false)}
            onOpenTransaction={
              onOpenTransaction
                ? (id) => {
                    // Payment details replace the drawer (same as the Today
                    // panel), so two side panels never stack.
                    setRecordsOpen(false);
                    onOpenTransaction(id);
                  }
                : undefined
            }
            onRecordPayment={onRecordPayment}
            scopeKind={scopeKind}
            groupLabels={groupLabels}
          />
        )}
      </>
    );
  }

  if (!isClient) return null;

  // Rendered into <body>, not where the caller sits: the calendar's
  // `@container` wrappers (and the tabs' entrance animations while they
  // run) can become the containing block and stacking context for a
  // `fixed` descendant, which pins the overlay to the calendar's box,
  // under the app bars, instead of the viewport. From <body>, `z-40`
  // ranks against the app's real layers (as Sidebar's account menu does):
  // above page content and the z-30/31 app bars, below modals and toasts
  // (z-50) — Record Payment opens over this drawer from the caller's own
  // tree, earlier in the DOM, so an equal z-50 here would cover it.
  // A scroll container that never scrolls (`overflow-hidden`) so
  // `overscroll-contain` applies: a wheel/drag over the backdrop or the
  // header doesn't scroll the page behind.
  return createPortal(
    <div className="side-panel-overlay z-40 overflow-hidden overscroll-contain" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="side-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        {summary && <div className="border-b border-border px-4 py-3">{breakdown}</div>}
        {/* The list scrolls on its own and doesn't hand the scroll on to
            the page behind; its last record clears the device's bottom
            inset. */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          {items.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nothing recorded for this {scopeKind === "period" ? "period" : scopeKind === "week" || heading?.startsWith("Week") ? "week" : "day"}.</p>
          ) : (
            items.map((item, i) => {
              // A group heading only appears when the list genuinely mixes
              // both kinds (the Today box's "received + due" view, or a
              // calendar day/week holding receipts and outstanding
              // amounts). Shown once, right before that kind's first row.
              const showHeading = mixed && items.findIndex((x) => x.type === item.type) === i;
              return (
                <div key={item.type === "transaction" ? `tx-${item.tx.payment_id}` : `o-${obligationKey(item.o)}`}>
                  {showHeading && (
                    <p className={`pb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle ${i > 0 ? "pt-2" : ""}`}>
                      {item.type === "transaction" ? groupLabels.transaction : groupLabels.obligation}
                    </p>
                  )}
                  {item.type === "transaction" ? (
                    <TransactionRow
                      tx={item.tx}
                      currency={currency}
                      onOpen={onOpenTransaction}
                      showDate={!(scopeKind === "day" && dateKey === item.tx.received_date)}
                      showProject={showProjectFor(item.tx.client_id, item.tx.client_business_name, item.tx.project_name)}
                    />
                  ) : (
                    <ObligationRow
                      o={item.o}
                      currency={currency}
                      onRecordPayment={onRecordPayment}
                      showProject={showProjectFor(item.o.client_id, item.o.client_business_name, item.o.project_name)}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
