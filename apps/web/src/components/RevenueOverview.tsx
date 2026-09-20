"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type SalesDashboard, type WonDealsSeries } from "@/lib/api";
import { formatAud, formatDate } from "@/lib/format";
import {
  cumulativeRevenue,
  DEFAULT_REVENUE_RANGE,
  rangeQuery,
  REVENUE_RANGES,
  type RevenueRange,
} from "@/lib/revenueChart";
import { RevenueChart } from "@/components/RevenueChart";

// `data` is the last series that loaded (kept while a new range loads); `failed` is set when the request for `range` errored.
type Result = { range: RevenueRange; data: WonDealsSeries | null; failed: boolean };

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

/**
 * The Today overview's revenue block: "Revenue won" as a plain large
 * number, and beside it the cumulative revenue line for a selectable
 * range (30 days / 90 days / 12 months). The chart's series comes from
 * `GET /dashboard/sales/won-deals`; everything else is the
 * `SalesDashboard` the page already loaded.
 *
 * The series refetches when the range changes and whenever the page
 * reloads its `sales` data (a deal won elsewhere), holding the previous
 * render at reduced opacity meanwhile rather than flashing a skeleton.
 */
export function RevenueOverview({ sales }: { sales: SalesDashboard }) {
  const [range, setRange] = useState<RevenueRange>(DEFAULT_REVENUE_RANGE);
  const [result, setResult] = useState<Result | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [attempt, setAttempt] = useState(0); // bumped by Retry to refetch the same range

  useEffect(() => {
    let cancelled = false;
    const q = rangeQuery(range, new Date());
    api
      .salesWonDeals(q.start, q.end, q.groupBy)
      .then((data) => !cancelled && setResult({ range, data, failed: false }))
      .catch(() => !cancelled && setResult((prev) => ({ range, data: prev?.data ?? null, failed: true })));
    return () => {
      cancelled = true;
    };
  }, [range, sales, attempt]);

  const data = result?.data ?? null;
  const points = useMemo(() => (data ? cumulativeRevenue(data) : []), [data]);
  const loading = result === null || result.range !== range;
  const failed = result !== null && result.range === range && result.failed;

  const anyInRange = points.some((p) => p.dealsCount > 0);
  const emptyMessage = !data || anyInRange ? null : data.prior_deals_count > 0 ? "No deals won in this period" : "No deals won yet";

  return (
    <div className="card p-4">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(12rem,auto)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">Revenue won</p>
          <p className="mt-1 break-words text-4xl font-semibold leading-none text-fg xl:text-5xl">
            {formatAud(sales.actual_revenue_cents)}
          </p>
          <p className="mt-2 text-xs text-fg-subtle">
            from {sales.won_deals_count} won {sales.won_deals_count === 1 ? "deal" : "deals"}
          </p>

          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-fg-muted">Proposals out</dt>
              <dd className="tabular-nums text-fg">{sales.proposals_count}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-fg-muted">Potential value</dt>
              <dd className="tabular-nums text-fg">{formatAud(sales.estimated_revenue_cents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-fg-muted">Win rate</dt>
              <dd className="tabular-nums text-fg">{pct(sales.conversion_rate_pct)}</dd>
            </div>
          </dl>

          <Link href="/dashboard/sales/pipeline" className={`mt-3 inline-block rounded text-xs text-fg-muted hover:text-fg ${FOCUS}`}>
            View pipeline →
          </Link>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">Cumulative revenue</h3>
            <div className="flex items-center gap-2">
              <div role="radiogroup" aria-label="Chart range" className="flex rounded-md border border-border-strong p-0.5 text-xs">
                {REVENUE_RANGES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={range === r.id}
                    onClick={() => setRange(r.id)}
                    className={`rounded px-2 py-1 ${FOCUS} ${range === r.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-pressed={showTable}
                onClick={() => setShowTable((v) => !v)}
                className={`rounded px-1.5 py-1 text-xs text-fg-muted hover:text-fg ${FOCUS}`}
              >
                {showTable ? "Hide table" : "Table"}
              </button>
            </div>
          </div>

          <div className="mt-3">
            {failed ? (
              <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong text-sm text-fg-muted" role="status">
                Couldn&apos;t load the revenue chart.
                <button type="button" onClick={() => setAttempt((a) => a + 1)} className={`rounded underline hover:text-fg ${FOCUS}`}>
                  Retry
                </button>
              </div>
            ) : loading && points.length === 0 ? (
              <div className="skeleton h-[200px] w-full" aria-hidden="true" />
            ) : (
              <div className={`transition-opacity duration-[var(--duration-fast)] motion-reduce:transition-none ${loading ? "opacity-60" : ""}`}>
                <RevenueChart points={points} weekly={data?.group_by === "week"} emptyMessage={emptyMessage} />
              </div>
            )}
          </div>

          {showTable && data && (
            <div className="mt-3 table-shell max-h-56 overflow-y-auto">
              <table className="table table--compact w-full text-sm">
                <caption className="sr-only">Deals won in the selected range, with the running revenue total</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">{data.group_by === "week" ? "Week of" : "Date"}</th>
                    <th scope="col" className="text-right">Deals</th>
                    <th scope="col" className="text-right">Revenue</th>
                    <th scope="col" className="text-right">Running total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.prior_deals_count > 0 && (
                    <tr>
                      <td className="text-fg-muted">Before this period</td>
                      <td className="text-right tabular-nums">{data.prior_deals_count}</td>
                      <td className="text-right tabular-nums">{formatAud(data.prior_revenue_cents)}</td>
                      <td className="text-right tabular-nums">{formatAud(data.prior_revenue_cents)}</td>
                    </tr>
                  )}
                  {points
                    .filter((p) => p.dealsCount > 0)
                    .map((p) => (
                      <tr key={p.date}>
                        <td>{formatDate(p.date)}</td>
                        <td className="text-right tabular-nums">{p.dealsCount}</td>
                        <td className="text-right tabular-nums">{formatAud(p.revenueCents)}</td>
                        <td className="text-right tabular-nums">{formatAud(p.cumulativeCents)}</td>
                      </tr>
                    ))}
                  {!anyInRange && data.prior_deals_count === 0 && (
                    <tr>
                      <td colSpan={4} className="text-fg-subtle">No deals won yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {data && (data.total_unpriced_deals_count > 0 || data.undated_deals_count > 0) && (
            <p className="mt-2 text-xs text-fg-subtle">
              {data.total_unpriced_deals_count > 0 &&
                `${data.total_unpriced_deals_count} won ${data.total_unpriced_deals_count === 1 ? "deal has" : "deals have"} no price logged, so add nothing to the total. `}
              {data.undated_deals_count > 0 &&
                `${data.undated_deals_count} won ${data.undated_deals_count === 1 ? "deal has" : "deals have"} no close date and ${data.undated_deals_count === 1 ? "isn't" : "aren't"} on the chart.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
