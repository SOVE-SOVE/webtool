"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, type RevenueReport, type Workspace } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { withParam } from "@/lib/url";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { useToast } from "@/components/ui/ToastProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { Skeleton } from "@/components/ui/Skeleton";
import { RecordPaymentLauncher } from "@/components/billing/RecordPaymentLauncher";
import { useRevenueSubTab, type RevenueSubTabId } from "./useRevenueSubTab";
import { PaymentsTab } from "./PaymentsTab";
import { UpcomingOverdueTab } from "./UpcomingOverdueTab";
import { HostingPlansTab } from "./HostingPlansTab";
import { ReceiptsTrendChart } from "./ReceiptsTrendChart";

type Period = "this-month" | "last-month" | "custom";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function monthRange(offsetMonths: number): { start: string; end: string } {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  const start = toIso(d);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start, end: toIso(last) };
}

const THIS_MONTH = monthRange(0);
const LAST_MONTH = monthRange(-1);

function periodLabel(period: Period, start: string, end: string): string {
  if (period === "this-month") return "this month";
  if (period === "last-month") return "last month";
  return `${start} to ${end}`;
}

const REVENUE_SUB_TABS: { id: RevenueSubTabId; label: string }[] = [
  { id: "payments", label: "Payments" },
  { id: "upcoming", label: "Upcoming & Overdue" },
  { id: "hosting", label: "Hosting Plans" },
];

/**
 * Deliberately not the shared `<TabBar>` (an underline strip, same
 * visual weight as the Clients workspace's own Overview/Websites/
 * Revenue tabs one level up) — a compact segmented control instead, so
 * these three sub-views read as "a view toggle within Revenue," not a
 * second competing row of primary navigation.
 */
function RevenueSubTabBar({ active, onChange }: { active: RevenueSubTabId; onChange: (id: RevenueSubTabId) => void }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap rounded-md border border-border-strong p-0.5 text-sm">
      {REVENUE_SUB_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded px-3 py-1.5 transition-colors duration-[var(--duration-fast)] ${
            active === tab.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The Clients workspace's Revenue tab — the full Revenue experience,
 * moved here verbatim from the old standalone /dashboard/revenue page
 * (see docs/07_SESSION_LOG.md). Deliberately renders no page-level
 * title of its own (the workspace shell's "Clients" header plus this
 * tab's own label already say what this is) — just the period
 * selector/currency/Record Payment row, the 4 metrics, the optional
 * trend chart, and its own Payments/Upcoming & Overdue/Hosting Plans
 * sub-tabs (URL param `revenueTab`, deliberately distinct from the
 * workspace's own `tab` param so the two levels never collide).
 */
export function ClientsRevenueTab() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const { activeTab, setTab } = useRevenueSubTab();

  const period = (searchParams.get("period") as Period | null) ?? "this-month";
  const customStart = searchParams.get("start");
  const customEnd = searchParams.get("end");

  const { start, end } = useMemo(() => {
    if (period === "this-month") return THIS_MONTH;
    if (period === "last-month") return LAST_MONTH;
    return { start: customStart ?? THIS_MONTH.start, end: customEnd ?? THIS_MONTH.end };
  }, [period, customStart, customEnd]);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [showRecordPayment, setShowRecordPayment] = useState(false);

  function loadReport() {
    api
      .getRevenueReport(start, end)
      .then((r) => {
        setError(null);
        setReport(r);
      })
      .catch(() => setError("Couldn't load the revenue report."));
  }

  useEffect(() => {
    api.getWorkspace().then(setWorkspace).catch(() => {});
  }, []);

  // Clears the previous range's figures immediately on a period change,
  // reacted to during render (comparing against the previous range)
  // rather than in the effect body — so a stale range's numbers never
  // linger under a new one while the fresh report is loading.
  const [prevRangeKey, setPrevRangeKey] = useState(`${start}:${end}`);
  if (prevRangeKey !== `${start}:${end}`) {
    setPrevRangeKey(`${start}:${end}`);
    setReport(null);
  }

  useEffect(loadReport, [start, end, dataVersion]);

  useScrollRestoration(report !== null);

  function setPeriod(next: Period) {
    let query = withParam(searchParams, "period", next === "this-month" ? null : next);
    if (next !== "custom") {
      query = withParam(new URLSearchParams(query), "start", null);
      query = withParam(new URLSearchParams(query), "end", null);
    }
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  function setCustomRange(nextStart: string, nextEnd: string) {
    let query = withParam(searchParams, "period", "custom");
    query = withParam(new URLSearchParams(query), "start", nextStart);
    query = withParam(new URLSearchParams(query), "end", nextEnd);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  function onChanged(message: string) {
    setDataVersion((v) => v + 1);
    showToast(message);
  }

  const currency = workspace?.currency ?? "AUD";
  let upcomingHrefQuery = withParam(searchParams, "tab", "revenue");
  upcomingHrefQuery = withParam(new URLSearchParams(upcomingHrefQuery), "revenueTab", "upcoming");
  const upcomingTabHref = `${pathname}?${upcomingHrefQuery}`;

  return (
    <div>
      {/* One toolbar: date range, currency, and the primary action —
          nothing else competes with it for attention. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="revenue-period" className="text-sm text-fg-muted">
            Period
          </label>
          <select
            id="revenue-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="input w-auto"
          >
            <option value="this-month">This month</option>
            <option value="last-month">Last month</option>
            <option value="custom">Custom range</option>
          </select>
          {period === "custom" && (
            <>
              <label htmlFor="revenue-start" className="sr-only">
                From
              </label>
              <input
                id="revenue-start"
                type="date"
                value={start}
                onChange={(e) => setCustomRange(e.target.value, end)}
                className="input"
              />
              <span className="text-fg-subtle">–</span>
              <label htmlFor="revenue-end" className="sr-only">
                To
              </label>
              <input
                id="revenue-end"
                type="date"
                value={end}
                onChange={(e) => setCustomRange(start, e.target.value)}
                className="input"
              />
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm text-fg-muted">{currency}</span>
          <button onClick={() => setShowRecordPayment(true)} className="btn btn-primary btn-sm">
            Record Payment
          </button>
        </div>
      </div>

      {/* One short line covering exactly what the spec requires (period
          vs. current-balance) — everything else that used to live here
          (the tax/accounting disclaimer) is dropped as redundant
          introductory copy; each metric's own hint already repeats the
          period-vs-balance distinction where it matters most. */}
      <p className="mt-2 text-xs text-fg-subtle">
        Payments received follows {periodLabel(period, start, end)}. Outstanding and Overdue are current balances as
        of today.
      </p>

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={loadReport} compact />
        </div>
      )}

      {!report && !error && (
        <MetricGrid className="mt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-md border border-border bg-surface px-4 py-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-24" />
            </div>
          ))}
        </MetricGrid>
      )}

      {report && (
        <>
          <MetricGrid className="mt-4">
            <Metric
              label="Payments received"
              value={formatMoney(report.total_payments_received_cents, currency)}
              hint={`Website ${formatMoney(report.website_payments_received_cents, currency)} · Hosting ${formatMoney(report.hosting_payments_received_cents, currency)}${
                report.refunds_cents > 0 ? ` · Refunds −${formatMoney(report.refunds_cents, currency)}` : ""
              }`}
            />
            <Metric
              label="Monthly hosting revenue"
              value={formatMoney(report.expected_mrr_cents, currency)}
              hint="Expected — from active hosting plans, not money received"
            />
            <Metric
              label="Outstanding"
              value={formatMoney(report.outstanding_balance_cents, currency)}
              hint="Current balance, as of today"
              href={upcomingTabHref}
            />
            <Metric
              label="Overdue"
              value={formatMoney(report.overdue_cents, currency)}
              hint={
                report.overdue_count > 0
                  ? `${report.overdue_count} overdue — current balance, as of today`
                  : "None overdue — current balance, as of today"
              }
              href={upcomingTabHref}
            />
          </MetricGrid>

          <ReceiptsTrendChart transactions={report.transactions} currency={currency} start={start} end={end} />

          <div className="mt-6">
            <RevenueSubTabBar active={activeTab} onChange={setTab} />
          </div>

          <div key={activeTab} className="animate-fade-in mt-6">
            {activeTab === "payments" && (
              <PaymentsTab report={report} currency={currency} onChanged={() => onChanged("Payment updated")} />
            )}
            {activeTab === "upcoming" && (
              <UpcomingOverdueTab currency={currency} dataVersion={dataVersion} onChanged={() => onChanged("Payment recorded")} />
            )}
            {activeTab === "hosting" && (
              <HostingPlansTab currency={currency} dataVersion={dataVersion} onChanged={() => onChanged("Hosting plan updated")} />
            )}
          </div>
        </>
      )}

      {showRecordPayment && (
        <RecordPaymentLauncher
          currency={currency}
          onClose={() => setShowRecordPayment(false)}
          onSaved={() => {
            setShowRecordPayment(false);
            onChanged("Payment recorded");
          }}
        />
      )}
    </div>
  );
}
