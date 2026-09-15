"use client";

import { useId, useMemo } from "react";
import type { RevenueTransaction } from "@/lib/api";
import { formatMoney } from "@/lib/format";

type Bucket = { label: string; start: string; websiteCents: number; hostingCents: number };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daySpan(start: string, end: string): number {
  return Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86_400_000) + 1;
}

function shortLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/**
 * Buckets actual receipts (never expected/scheduled amounts — only
 * non-voided payments net of refunds) into daily/weekly/monthly groups
 * depending on the selected period's length, so a "This month" view
 * reads as days and a year-long custom range doesn't render 365 bars.
 */
function bucketReceipts(transactions: RevenueTransaction[], start: string, end: string): Bucket[] {
  const span = daySpan(start, end);
  const stepDays = span <= 31 ? 1 : span <= 180 ? 7 : 30;
  const buckets: Bucket[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, stepDays)) {
    buckets.push({ label: shortLabel(cursor), start: cursor, websiteCents: 0, hostingCents: 0 });
  }
  for (const tx of transactions) {
    if (tx.voided) continue;
    // Find the last bucket whose start is <= this transaction's date.
    let bucket = buckets[0];
    for (const b of buckets) {
      if (b.start <= tx.received_date) bucket = b;
      else break;
    }
    if (tx.kind === "website") bucket.websiteCents += tx.net_cents;
    else bucket.hostingCents += tx.net_cents;
  }
  return buckets;
}

/**
 * Optional, dependency-free receipts trend — plain inline SVG bars, no
 * charting library. Actual receipts only (never expected MRR), exact
 * amounts in both a hover tooltip and a visually-hidden data table for
 * screen readers, and never a comparison/percentage figure since
 * nothing in this app tracks a prior period to compare against.
 */
export function ReceiptsTrendChart({
  transactions,
  currency,
  start,
  end,
}: {
  transactions: RevenueTransaction[];
  currency: string;
  start: string;
  end: string;
}) {
  const titleId = useId();
  const buckets = useMemo(() => bucketReceipts(transactions, start, end), [transactions, start, end]);
  const hasReceipts = buckets.some((b) => b.websiteCents + b.hostingCents > 0);

  if (!hasReceipts) return null;

  const maxTotal = Math.max(...buckets.map((b) => b.websiteCents + b.hostingCents), 1);
  const barWidth = 100 / buckets.length;

  return (
    <section className="mt-6" aria-labelledby={titleId}>
      <div className="flex items-center justify-between">
        <h2 id={titleId} className="text-sm font-semibold text-fg">
          Payments received over time
        </h2>
        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-fg" /> Website
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-fg-subtle" /> Hosting
          </span>
        </div>
      </div>

      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-3 h-32 w-full" role="img" aria-hidden="true">
        {buckets.map((b, i) => {
          const total = b.websiteCents + b.hostingCents;
          const totalH = (total / maxTotal) * 36;
          const websiteH = total > 0 ? (b.websiteCents / total) * totalH : 0;
          const hostingH = totalH - websiteH;
          const x = i * barWidth + barWidth * 0.15;
          const w = barWidth * 0.7;
          return (
            <g key={b.start}>
              <title>
                {b.label}: {formatMoney(b.websiteCents, currency)} website, {formatMoney(b.hostingCents, currency)} hosting
              </title>
              <rect x={x} y={40 - totalH} width={w} height={hostingH} className="fill-fg-subtle" />
              <rect x={x} y={40 - totalH} width={w} height={websiteH} className="fill-fg" />
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex text-xs text-fg-subtle">
        {buckets.map((b, i) => (
          <span key={b.start} className="text-center" style={{ width: `${barWidth}%` }}>
            {i === 0 || i === buckets.length - 1 || buckets.length <= 8 ? b.label : ""}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>Payments received per period, website and hosting</caption>
        <thead>
          <tr>
            <th>Period</th>
            <th>Website</th>
            <th>Hosting</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.start}>
              <td>{b.label}</td>
              <td>{formatMoney(b.websiteCents, currency)}</td>
              <td>{formatMoney(b.hostingCents, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
