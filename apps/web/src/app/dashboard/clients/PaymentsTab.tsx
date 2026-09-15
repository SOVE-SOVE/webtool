"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { RevenueReport, RevenueTransaction } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { withParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaymentDetailPanel } from "@/components/billing/PaymentDetailPanel";

type SortOrder = "date_desc" | "date_asc";

function StatusTag({ tx }: { tx: RevenueTransaction }) {
  if (tx.voided) {
    return <span className="text-xs text-fg-subtle">Reversed</span>;
  }
  if (tx.refunded_cents > 0) {
    return <span className="text-xs text-amber-700 dark:text-amber-400">Refunded</span>;
  }
  return null;
}

function TransactionRow({
  tx,
  currency,
  onOpen,
}: {
  tx: RevenueTransaction;
  currency: string;
  onOpen: () => void;
}) {
  return (
    <tr onClick={onOpen} className="cursor-pointer hover:bg-surface-hover">
      <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{formatDate(tx.received_date)}</td>
      <td className="max-w-[14rem] px-3 py-2" onClick={(e) => e.stopPropagation()}>
        {tx.client_id ? (
          <Link href={`/dashboard/clients/${tx.client_id}`} className="block truncate font-medium text-fg hover:underline">
            {tx.client_business_name ?? "Client"}
          </Link>
        ) : (
          <span className="block truncate text-fg-subtle">No client (prospect)</span>
        )}
      </td>
      <td className="max-w-[12rem] px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <Link href={`/dashboard/projects/${tx.project_id}`} className="block truncate text-fg hover:underline">
          {tx.project_name}
        </Link>
      </td>
      <td className="px-3 py-2 capitalize text-fg-muted">{tx.kind}</td>
      <td className="px-3 py-2 text-fg-muted">{tx.method ?? "—"}</td>
      <td className="max-w-[8rem] truncate px-3 py-2 text-fg-muted">{tx.reference ?? "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <div className="flex items-center justify-end gap-2">
          <StatusTag tx={tx} />
          {tx.voided ? (
            <span className="text-fg-subtle line-through">{formatMoney(tx.amount_cents, currency)}</span>
          ) : tx.net_cents !== tx.amount_cents ? (
            <span title={`Original ${formatMoney(tx.amount_cents, currency)}, refunded ${formatMoney(tx.refunded_cents, currency)}`}>
              {formatMoney(tx.net_cents, currency)}
            </span>
          ) : (
            formatMoney(tx.amount_cents, currency)
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * The Revenue page's transaction ledger — search/filter/sort state all
 * lives in the URL (not component state) so switching tabs and coming
 * back, or returning from a payment's detail panel, never loses it; the
 * detail panel itself is just another URL param on this same page
 * (`?payment=`), same pattern as Leads' `?preview=`, so closing it never
 * touches scroll position either.
 */
export function PaymentsTab({
  report,
  currency,
  onChanged,
}: {
  report: RevenueReport | null;
  currency: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlSearch = searchParams.get("q") ?? "";
  const kindFilter = (searchParams.get("kind") as "" | "website" | "hosting" | null) ?? "";
  const statusFilter = (searchParams.get("status") as "" | "payments" | "refunded" | "reversed" | null) ?? "";
  const sort = (searchParams.get("sort") as SortOrder | null) ?? "date_desc";
  const paymentId = searchParams.get("payment");

  const [search, setSearch] = useState(urlSearch);
  useDebouncedUrlSync("q", search);

  function setParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value || null)}`, { scroll: false });
  }

  function openPayment(id: string) {
    router.push(`${pathname}?${withParam(searchParams, "payment", id)}`, { scroll: false });
  }

  function closePayment() {
    router.push(`${pathname}?${withParam(searchParams, "payment", null)}`, { scroll: false });
  }

  const visible = useMemo(() => {
    if (!report) return [];
    const q = urlSearch.trim().toLowerCase();
    let rows = report.transactions.filter((tx) => {
      if (kindFilter && tx.kind !== kindFilter) return false;
      if (statusFilter === "refunded" && !(tx.refunded_cents > 0 && !tx.voided)) return false;
      if (statusFilter === "reversed" && !tx.voided) return false;
      if (statusFilter === "payments" && (tx.voided || tx.refunded_cents > 0)) return false;
      if (!q) return true;
      return (
        tx.project_name.toLowerCase().includes(q) ||
        (tx.client_business_name ?? "").toLowerCase().includes(q) ||
        (tx.reference ?? "").toLowerCase().includes(q) ||
        (tx.method ?? "").toLowerCase().includes(q)
      );
    });
    rows = [...rows].sort((a, b) =>
      sort === "date_asc"
        ? a.received_date.localeCompare(b.received_date)
        : b.received_date.localeCompare(a.received_date),
    );
    return rows;
  }, [report, urlSearch, kindFilter, statusFilter, sort]);

  const openTx = paymentId ? (report?.transactions.find((t) => t.payment_id === paymentId) ?? null) : null;

  if (!report) return null;

  const hasActiveFilters = Boolean(urlSearch || kindFilter || statusFilter);

  function clearFilters() {
    setSearch("");
    setParam("q", null);
    setParam("kind", null);
    setParam("status", null);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <input
          placeholder="Search client, project, method, reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-64 shrink-0"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setParam("kind", e.target.value)}
            className="input w-auto"
            aria-label="Filter by type"
          >
            <option value="">Website &amp; hosting</option>
            <option value="website">Website only</option>
            <option value="hosting">Hosting only</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setParam("status", e.target.value)}
            className="input w-auto"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="payments">Payments only</option>
            <option value="refunded">Refunded</option>
            <option value="reversed">Reversed</option>
          </select>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-sm text-fg-muted hover:text-fg hover:underline">
              Clear filters
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => setParam("sort", e.target.value === "date_desc" ? null : e.target.value)}
          className="input ml-auto w-auto shrink-0"
          aria-label="Sort order"
        >
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
        </select>
      </div>

      {report.transactions.length > 0 && (
        <p className="mt-2 text-xs text-fg-muted">
          {visible.length} of {report.transactions.length} transaction{report.transactions.length === 1 ? "" : "s"}
        </p>
      )}

      {report.transactions.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No payments in this period"
            description="Payments recorded in this date range will show up here, along with links to the client and project."
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No matching transactions" description="Try a different search or filter." />
        </div>
      ) : (
        <div className="table-shell mt-4">
          <table className="table">
            <thead>
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Project</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((tx) => (
                <TransactionRow key={tx.payment_id} tx={tx} currency={currency} onOpen={() => openPayment(tx.payment_id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openTx && (
        <PaymentDetailPanel
          tx={openTx}
          currency={currency}
          onClose={closePayment}
          onChanged={() => {
            onChanged();
          }}
        />
      )}
    </div>
  );
}
