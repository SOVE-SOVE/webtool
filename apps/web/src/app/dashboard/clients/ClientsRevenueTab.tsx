"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  api,
  type Client,
  type HostingPlan,
  type NextPaymentObligation,
  type RevenueReport,
  type WebsiteAgreement,
  type Workspace,
} from "@/lib/api";
import { calendarPeriodBounds, toDateKey, type CalendarGridMode } from "@/lib/calendarGrid";
import { formatMoney } from "@/lib/format";
import { withParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { useToast } from "@/components/ui/ToastProvider";
import { CommandBar } from "@/components/ui/CommandBar";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterChips } from "@/components/ui/FilterChips";
import { FilterPopover } from "@/components/ui/FilterPopover";
import { SearchInput } from "@/components/ui/SearchInput";
import { Skeleton } from "@/components/ui/Skeleton";
import { Metric } from "@/components/ui/Metric";
import { RecordPaymentLauncher } from "@/components/billing/RecordPaymentLauncher";
import { RecordPaymentModal } from "@/components/billing/RecordPaymentModal";
import { useRevenueSubTab, type RevenueSubTabId } from "./useRevenueSubTab";
import { DayDetailPanel, type DayDetailItem } from "./DayDetailPanel";
import { PaymentsTab, usePaymentsFilters } from "./PaymentsTab";
import { UpcomingOverdueTab, useUpcomingFilters } from "./UpcomingOverdueTab";
import { HostingPlansTab, useHostingFilters } from "./HostingPlansTab";
import { ReceiptsTrendChart } from "./ReceiptsTrendChart";

function todayLocal(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Gates the Today box's dev-only demo fixture (see `demoObligationFor`
// below). `NODE_ENV` is "development" under `npm run dev` and
// "production" in any built app (`next build`/`next start`) — Next's
// bundler resolves this at build time, so a production bundle never
// even contains the fixture's code, not just a hidden branch of it.
// No separate toggle needed: run `npm run dev` to see it, build for
// production and it's gone — the two commands already are the on/off
// switch.
const SHOW_TODAY_DEMO = process.env.NODE_ENV === "development";

// A visibly-fake id — never shaped like a real UUID, so it can't
// collide with an actual project even by coincidence — used to keep
// the dev-only demo entry (below) fully isolated from every live
// action it might otherwise trigger (Record Payment, Client Billing).
const DEMO_PROJECT_ID = "__demo_today_example__";

/**
 * Dev-only fixture for visually reviewing a populated Today box/panel
 * — gated by `SHOW_TODAY_DEMO` above. A real `NextPaymentObligation`
 * shape, so it flows through the exact same
 * TodayBox/DayDetailPanel/ObligationRow rendering every real due-today
 * item already uses — no separate demo-only UI to build or keep in
 * sync. Never written into `todayObligations` (the real fetched
 * state) or any financial total; combined only at the display layer,
 * in ClientsRevenueTab's own `displayDueToday`. `client_id: null`
 * means ObligationRow's own existing "Client Billing →" link (which
 * only renders when `client_id` is set) never appears for it, and
 * `handleTodayRecordPayment` explicitly refuses `DEMO_PROJECT_ID`
 * before ever calling a real endpoint — see its own comment.
 */
function demoObligationFor(todayKey: string): NextPaymentObligation {
  return {
    kind: "hosting_charge",
    project_id: DEMO_PROJECT_ID,
    project_name: "Example Project (Demo)",
    client_id: null,
    client_business_name: "Example Client (Demo)",
    amount_cents: 4900,
    due_date: todayKey,
    is_overdue: false,
    days_relative: 0,
    website_agreement_id: null,
    hosting_charge_id: null,
    hosting_plan_id: null,
    scheduled: false,
  };
}

const REVENUE_SUB_TABS: { id: RevenueSubTabId; label: string }[] = [
  { id: "payments", label: "Payments" },
  { id: "upcoming", label: "Upcoming" },
  { id: "hosting", label: "Hosting" },
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
          className={`toggle-pill rounded px-3 py-1.5 ${
            active === tab.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Loading placeholder matching one summary box's own shape — same
 * "label bar, then a taller value bar" skeleton the rest of this app's
 * Metric grids already use (see the old 4-tile version this replaces). */
function SummaryBoxSkeleton() {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-2.5 h-7 w-24" />
    </div>
  );
}

/**
 * Three distinct summary boxes — received this month, expected hosting
 * revenue, and the current overdue balance — never summed together (a
 * received payment and an expected one aren't the same kind of number).
 * Reuses the app's own `Metric` card (label above a prominent value,
 * same border/padding/radius as every other summary tile in this app —
 * the Today dashboard, Sales, Leads, Review) rather than inventing new
 * box styling. "Received this month" is deliberately fixed to the real
 * current calendar month regardless of which month the calendar below
 * is displaying — `monthReport` is fetched once against that fixed
 * range, not against the calendar's own cursor. Everything else the
 * old 4-tile grid also showed (the website/hosting receipts split,
 * refunds, the full outstanding balance) stays in one native
 * `<details>` disclosure below the boxes — same "expandable details"
 * element `ClientMobileCard` already uses elsewhere in this app,
 * avoiding a fourth large summary card for secondary figures.
 */
function SummaryRow({
  monthReport,
  error,
  onRetry,
  currency,
  upcomingTabHref,
}: {
  monthReport: RevenueReport | null;
  error: string | null;
  onRetry: () => void;
  currency: string;
  upcomingTabHref: string;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} compact />;

  if (!monthReport) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryBoxSkeleton />
        <SummaryBoxSkeleton />
        <SummaryBoxSkeleton />
      </div>
    );
  }

  const isOverdue = monthReport.overdue_cents > 0;

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Received this month" value={formatMoney(monthReport.total_payments_received_cents, currency)} />
        <Metric
          label="Expected hosting revenue"
          value={formatMoney(monthReport.expected_mrr_cents, currency)}
          hint="Monthly"
        />
        {/* Restrained overdue emphasis: red text only, no filled
            background — matches every other card's neutral border/
            surface, distinguished the same understated way an overdue
            row already reads elsewhere on this page. */}
        <Metric
          label="Overdue"
          value={
            <span className={isOverdue ? "text-red-700 dark:text-red-400" : undefined}>
              {formatMoney(monthReport.overdue_cents, currency)}
            </span>
          }
          hint={isOverdue ? `${monthReport.overdue_count} overdue payment${monthReport.overdue_count === 1 ? "" : "s"}` : "None overdue"}
          href={upcomingTabHref}
        />
      </div>

      <details className="mt-2 text-xs text-fg-muted">
        <summary className="cursor-pointer select-none text-fg-subtle">Breakdown (this month)</summary>
        <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <p>
            Website payments received:{" "}
            <span className="tabular-nums text-fg">{formatMoney(monthReport.website_payments_received_cents, currency)}</span>
          </p>
          <p>
            Hosting payments received:{" "}
            <span className="tabular-nums text-fg">{formatMoney(monthReport.hosting_payments_received_cents, currency)}</span>
          </p>
          {monthReport.refunds_cents > 0 && (
            <p>
              Refunds:{" "}
              <span className="tabular-nums text-amber-700 dark:text-amber-400">
                −{formatMoney(monthReport.refunds_cents, currency)}
              </span>
            </p>
          )}
          <p>
            Outstanding balance (current, as of today):{" "}
            <Link href={upcomingTabHref} className="tabular-nums text-fg hover:underline">
              {formatMoney(monthReport.outstanding_balance_cents, currency)}
            </Link>
          </p>
        </div>
      </details>
    </div>
  );
}

// The exact shell every other summary box (`SummaryBoxSkeleton`/
// `Metric`) already uses — `rounded-md border border-border bg-surface
// px-4 py-3` — reused here verbatim so Today genuinely matches their
// dimensions and styling, not just a similar approximation. `w-full`
// (not a fixed pixel width) deliberately: this box now sits in its own
// cell of the same 3-column grid the Overdue box above it uses (see
// ClientsRevenueTab's own toolbar row), so filling its cell exactly is
// what makes its edges align with Overdue's at every viewport width,
// rather than a hardcoded width that could only ever coincidentally
// match a fluid grid column.
const TODAY_BOX_SHELL = "w-full rounded-md border border-border bg-surface px-4 py-3";

/** "17 Sep" — deliberately shorter than `formatDate`'s own "17 Sep
 * 2026" (used for the calendar's day-detail panel headings etc.): the
 * box already says "Today" right beside it, so the year would be the
 * one genuinely redundant part of a full date here. Kept local to this
 * file rather than added to `lib/format.ts` — nothing else in this app
 * currently wants a year-less date, so promoting it would be
 * speculative; easy to lift out later if a second caller shows up. */
function shortDateLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * "Today" summary box — payments received today and unpaid obligations
 * due today, independent of whichever month/week the calendar below is
 * currently displaying (its figures come from the fixed-range
 * `monthReport` and the full obligations list, never from `calCursor`
 * — see ClientsRevenueTab's own `receivedToday`/`displayDueToday`).
 * Same shell/type scale as the three summary boxes above (Metric's own
 * label/value tokens), organised as a header (date) over two right-
 * aligned amount rows over one quiet count+action footer — never
 * per-client detail, which stays in the day-detail panel this box
 * opens (see `openToday` in ClientsRevenueTab) — never a second,
 * competing popup. A genuine fetch failure shows a small retry
 * affordance instead of a blank or zero-looking box; a real "nothing
 * today" stays clickable, per spec, rather than going inert.
 */
function TodayBox({
  todayKey,
  receivedCount,
  receivedCents,
  dueCount,
  dueCents,
  currency,
  loading,
  error,
  onRetry,
  filtered,
  demoActive,
  onOpen,
}: {
  todayKey: string;
  receivedCount: number;
  receivedCents: number;
  dueCount: number;
  dueCents: number;
  currency: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  filtered: boolean;
  /** True when a dev-only demo entry is folded into `dueCount`/`dueCents` — see `demoObligationFor`. Never true in a production build. */
  demoActive: boolean;
  onOpen: () => void;
}) {
  const interactiveClass =
    "block text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none";

  if (error) {
    return (
      <button type="button" onClick={onRetry} className={`${TODAY_BOX_SHELL} ${interactiveClass}`}>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-muted">Today</span>
          <p className="text-sm text-fg-subtle">Couldn&apos;t load — tap to retry</p>
        </div>
      </button>
    );
  }

  if (loading) {
    // Mirrors the loaded state's own shape (header bar pair, two
    // full-width row bars, one footer bar) at the same `gap-1.5` rhythm
    // — a skeleton whose layout doesn't jump once real data lands.
    return (
      <div className={TODAY_BOX_SHELL}>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  const isEmpty = receivedCount === 0 && dueCount === 0;

  // The quiet footer's one job: a real count plus a nudge toward the
  // panel it opens — never both counts at once (the two rows above
  // already state each in full), and never "0 payments due" when
  // nothing's outstanding but something was received today.
  const footerText =
    dueCount > 0
      ? `${dueCount} payment${dueCount === 1 ? "" : "s"} due · View details`
      : `${receivedCount} payment${receivedCount === 1 ? "" : "s"} received · View details`;

  const ariaSummary = isEmpty
    ? "No activity today."
    : `Received ${formatMoney(receivedCents, currency)}. Due today ${formatMoney(dueCents, currency)}. ${footerText.replace(" · View details", "")}.`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Today, ${shortDateLabel(todayKey)}. ${ariaSummary}${filtered ? " Filtered by client." : ""}${demoActive ? " Includes a demo entry." : ""}`}
      className={`${TODAY_BOX_SHELL} ${interactiveClass}`}
    >
      {/* One consistent gap-1.5 rhythm for every visible section
          (header, rows, filtered note, footer) — a single declarative
          rule instead of each child carrying its own one-off mt-*,
          so the vertical spacing here can't quietly drift apart. */}
      <div className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-fg-muted">Today</span>
          <span className="text-xs text-fg-subtle">{shortDateLabel(todayKey)}</span>
        </span>

        {isEmpty ? (
          <p className="text-sm text-fg-subtle">No activity today.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-fg-muted">Received</span>
              <span className="tabular-nums text-lg font-semibold text-fg">{formatMoney(receivedCents, currency)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-fg-muted">
                Due today
                {demoActive && <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Demo</span>}
              </span>
              <span className="tabular-nums text-lg font-semibold text-fg">{formatMoney(dueCents, currency)}</span>
            </div>
          </div>
        )}

        {filtered && <p className="text-[11px] text-fg-subtle">Filtered by client</p>}

        {!isEmpty && <p className="text-[11px] text-fg-subtle">{footerText}</p>}
      </div>
    </button>
  );
}

const SEARCH_PLACEHOLDER: Record<RevenueSubTabId, string> = {
  payments: "Search client, method, reference…",
  upcoming: "Search client, project…",
  hosting: "Search client, website…",
};

/**
 * The Clients workspace's Revenue tab — the full Revenue experience,
 * moved here verbatim from the old standalone /dashboard/revenue page
 * (see docs/07_SESSION_LOG.md), then reorganised around Compact summary
 * → view switch → one toolbar → the active view, and now around a
 * shared payment calendar (Payments/Upcoming) instead of a plain list.
 * The calendar's cursor/grid mode live here, one level above both
 * views, so navigating the calendar survives switching between them.
 * The three summary boxes deliberately do NOT follow that navigation —
 * they're backed by their own `monthReport`, fetched once against the
 * real current calendar month — so paging the calendar to review a
 * past or future month never changes what "Received this month" means.
 */
export function ClientsRevenueTab() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const { activeTab, setTab } = useRevenueSubTab();

  // Seeded once from the URL (so a shared/bookmarked link opens on the
  // right month/week), then kept in sync with it on every navigation —
  // same "local state + immediate URL write" pattern the rest of this
  // page's filters already use, just for a Date instead of a string.
  const [calCursor, setCalCursorState] = useState<Date>(() => {
    const raw = searchParams.get("calCursor");
    if (raw) {
      const [y, m, d] = raw.split("-").map(Number);
      if (y && m && d) return new Date(y, m - 1, d);
    }
    return todayLocal();
  });
  const calGrid: CalendarGridMode = searchParams.get("calGrid") === "week" ? "week" : "month";

  function setCalCursor(next: Date) {
    setCalCursorState(next);
    router.replace(`${pathname}?${withParam(searchParams, "calCursor", toDateKey(next))}`, { scroll: false });
  }

  function setCalGrid(next: CalendarGridMode) {
    router.replace(`${pathname}?${withParam(searchParams, "calGrid", next === "month" ? null : next)}`, { scroll: false });
  }

  const { start, end } = useMemo(() => calendarPeriodBounds(calCursor, calGrid), [calCursor, calGrid]);

  // The real current calendar month — fixed for the life of this page
  // view, independent of `calCursor`. This is what the three summary
  // boxes read from, so navigating the calendar (to review a different
  // month's payments) never changes what "Received this month" means.
  // "Today" itself is always inside this range by construction, so the
  // Today box's "received today" figure can reuse the same fetch.
  const thisMonth = useMemo(() => calendarPeriodBounds(todayLocal(), "month"), []);
  const todayKey = useMemo(() => toDateKey(todayLocal()), []);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monthReport, setMonthReport] = useState<RevenueReport | null>(null);
  const [monthReportError, setMonthReportError] = useState<string | null>(null);
  // The Today box's other half — every unpaid obligation workspace-wide,
  // the same source UpcomingOverdueTab fetches for itself; a second,
  // independent fetch here rather than lifting ownership out of that
  // component, to keep this addition self-contained and its own
  // existing (verified) behaviour untouched.
  const [todayObligations, setTodayObligations] = useState<NextPaymentObligation[] | null>(null);
  const [todayObligationsError, setTodayObligationsError] = useState<string | null>(null);
  const [todayPaymentModal, setTodayPaymentModal] = useState<{
    obligation: NextPaymentObligation;
    agreement: WebsiteAgreement | null;
    hostingPlans: HostingPlan[];
  } | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [showTrends, setShowTrends] = useState(false);

  function loadReport() {
    api
      .getRevenueReport(start, end)
      .then((r) => {
        setError(null);
        setReport(r);
      })
      .catch(() => setError("Couldn't load the revenue report."));
  }

  function loadMonthReport() {
    api
      .getRevenueReport(thisMonth.start, thisMonth.end)
      .then((r) => {
        setMonthReportError(null);
        setMonthReport(r);
      })
      .catch(() => setMonthReportError("Couldn't load the revenue summary."));
  }

  function loadTodayObligations() {
    api
      .getWorkspaceObligations()
      .then((rows) => {
        setTodayObligationsError(null);
        setTodayObligations(rows);
      })
      .catch(() => setTodayObligationsError("Couldn't load today's obligations."));
  }

  useEffect(() => {
    api.getWorkspace().then(setWorkspace).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
  }, []);

  // Clears the previous range's figures immediately on a range change,
  // reacted to during render (comparing against the previous range)
  // rather than in the effect body — so a stale range's numbers never
  // linger under a new one while the fresh report is loading.
  const [prevRangeKey, setPrevRangeKey] = useState(`${start}:${end}`);
  if (prevRangeKey !== `${start}:${end}`) {
    setPrevRangeKey(`${start}:${end}`);
    setReport(null);
  }

  useEffect(loadReport, [start, end, dataVersion]);
  // Refreshed whenever a payment or hosting plan changes (dataVersion),
  // but never by calendar navigation — its own range is fixed above.
  useEffect(loadMonthReport, [dataVersion, thisMonth.start, thisMonth.end]);
  useEffect(loadTodayObligations, [dataVersion]);

  // Opening/closing an overlay (a day panel, a payment's detail, or the
  // Today box's own panel) is never a different view of the page —
  // excluding these params from the scroll key means the page's scroll
  // position survives a round trip through any of them, the same
  // reasoning ClientsOverviewTab's own `preview`-excluding scrollKey
  // already established.
  const scrollKey = useMemo(() => {
    let q = searchParams.toString();
    for (const key of ["day", "payment", "today"]) {
      q = withParam(new URLSearchParams(q), key, null);
    }
    return q;
  }, [searchParams]);
  useScrollRestoration(report !== null, scrollKey);

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  useDebouncedUrlSync("q", search);

  function onChanged(message: string) {
    setDataVersion((v) => v + 1);
    showToast(message);
  }

  // Central so a "Clear filters" click always lands correctly — the
  // search box's own local state (see useDebouncedUrlSync's one-
  // directional, never-read-back design) can only be reset from here,
  // not from a sub-tab reaching in and nulling `q` in the URL alone.
  // Deliberately leaves calCursor/calGrid/day alone — those are
  // navigation state, not filters.
  function clearFilters() {
    setSearch("");
    let query = searchParams.toString();
    for (const key of ["q", "kind", "status", "type", "client"]) {
      query = withParam(new URLSearchParams(query), key, null);
    }
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  const clientOptions = useMemo(() => clients.map((c) => ({ id: c.id, business_name: c.business_name })), [clients]);
  // Each sub-view supplies its own popover fields + chips; all three hooks
  // run every render (hooks can't be conditional), the active tab's is used.
  const paymentsFilters = usePaymentsFilters(clientOptions);
  const upcomingFilters = useUpcomingFilters(clientOptions);
  const hostingFilters = useHostingFilters();
  const filterUi = activeTab === "payments" ? paymentsFilters : activeTab === "upcoming" ? upcomingFilters : hostingFilters;

  const currency = workspace?.currency ?? "AUD";
  let upcomingHrefQuery = withParam(searchParams, "tab", "revenue");
  upcomingHrefQuery = withParam(new URLSearchParams(upcomingHrefQuery), "revenueTab", "upcoming");
  const upcomingTabHref = `${pathname}?${upcomingHrefQuery}`;

  // The same `?client=` filter Payments'/Upcoming's own "More filters"
  // panels already read/write — applied here too so the Today box's
  // figures stay consistent with whatever's currently filtered, rather
  // than silently ignoring an active filter.
  const clientFilter = searchParams.get("client") ?? "";

  const receivedToday = useMemo(
    () =>
      (monthReport?.transactions ?? []).filter(
        (tx) => tx.received_date === todayKey && !tx.voided && (!clientFilter || tx.client_id === clientFilter),
      ),
    [monthReport, todayKey, clientFilter],
  );
  const dueToday = useMemo(
    () =>
      (todayObligations ?? []).filter(
        (o) => o.due_date === todayKey && (!clientFilter || o.client_id === clientFilter),
      ),
    [todayObligations, todayKey, clientFilter],
  );
  const receivedTodayCents = useMemo(() => receivedToday.reduce((sum, tx) => sum + tx.net_cents, 0), [receivedToday]);

  // The dev-only demo entry (see `demoObligationFor`'s own docstring)
  // is combined ONLY here, at the display layer — `dueToday` above
  // (and `todayObligations`, the real fetched state it's derived from)
  // stay untouched, so nothing feeding an actual financial figure
  // anywhere else on this page can ever include it. `SHOW_TODAY_DEMO`
  // is `process.env.NODE_ENV === "development"` — always false in a
  // production build, so `demoObligationFor` is never called and this
  // branch never executes or renders there (verified directly against
  // a production build's own compiled output). To turn it off locally
  // without stopping the dev server, change this one constant.
  const displayDueToday = useMemo(
    () => (SHOW_TODAY_DEMO ? [...dueToday, demoObligationFor(todayKey)] : dueToday),
    [dueToday, todayKey],
  );
  const displayDueTodayCents = useMemo(() => displayDueToday.reduce((sum, o) => sum + o.amount_cents, 0), [displayDueToday]);

  // Both sources must have resolved before the box shows real figures —
  // showing "0 due" while the obligations fetch simply hasn't finished
  // yet would misreport unavailable data as a genuine zero.
  const todayLoading = !monthReport || !todayObligations;
  const todayError = monthReportError || todayObligationsError;

  function retryTodayBox() {
    if (monthReportError) loadMonthReport();
    if (todayObligationsError) loadTodayObligations();
  }

  const todayPanelOpen = searchParams.get("today") === "1";

  // Opening Today's own panel also clears `day`/`payment` defensively
  // (belt-and-suspenders — the full-viewport overlay either panel
  // renders already makes the two unreachable at once through the UI
  // itself) so a stray `?today=1&day=...` URL can never show two
  // overlays' worth of state in one panel.
  function openToday() {
    let query = searchParams.toString();
    query = withParam(new URLSearchParams(query), "today", "1");
    query = withParam(new URLSearchParams(query), "day", null);
    query = withParam(new URLSearchParams(query), "payment", null);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  function closeToday() {
    router.replace(`${pathname}?${withParam(searchParams, "today", null)}`, { scroll: false });
  }

  // "Details →" on one of Today's received payments hands off to the
  // exact same PaymentDetailPanel the Payments calendar's own entries
  // already open — switching to that sub-tab and setting `?payment=`
  // is how every other payment-details link on this page already
  // works, so this isn't a new panel, just the existing one's normal
  // trigger. Today's own panel closes in the same URL update.
  function openTodayTransaction(paymentId: string) {
    let query = searchParams.toString();
    query = withParam(new URLSearchParams(query), "revenueTab", null); // "payments" is the default, omitted
    query = withParam(new URLSearchParams(query), "payment", paymentId);
    query = withParam(new URLSearchParams(query), "today", null);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  // "Record Payment" on one of Today's due obligations reuses
  // RecordPaymentModal directly, in place — the exact same agreement/
  // hosting-plan fetch and submit UpcomingOverdueTab's own
  // handleRecordPayment already performs for the identical action
  // there, just triggered from this second call site (RecordPaymentModal
  // already has more than one independent caller elsewhere in this app
  // — RecordPaymentLauncher is another). Today's own panel stays open
  // underneath and updates itself once the payment lands (dataVersion
  // refresh), rather than being closed out from under the operator.
  // The dev-only demo entry is refused here explicitly, before any real
  // endpoint is ever called against its fake project id — "isolated
  // from live payment actions" means this guard, not just hoping a
  // fake id 404s harmlessly.
  async function handleTodayRecordPayment(o: NextPaymentObligation) {
    if (o.project_id === DEMO_PROJECT_ID) {
      showToast("This is a demo entry for review — no real payment can be recorded against it.");
      return;
    }
    const [agreement, hostingPlans] = await Promise.all([
      api.getAgreement(o.project_id).catch(() => null),
      api.listHostingPlans(o.project_id).catch(() => []),
    ]);
    setTodayPaymentModal({ obligation: o, agreement, hostingPlans });
  }

  const todayItems: DayDetailItem[] = useMemo(
    () => [
      ...receivedToday.map((tx) => ({ type: "transaction" as const, tx })),
      ...displayDueToday.map((o) => ({ type: "obligation" as const, o })),
    ],
    [receivedToday, displayDueToday],
  );

  return (
    <div>
      {/* 1. Compact summary — three distinct boxes, fixed to the real
          current month regardless of calendar navigation, everything
          else behind one expandable "Breakdown" disclosure. */}
      <SummaryRow
        monthReport={monthReport}
        error={monthReportError}
        onRetry={loadMonthReport}
        currency={currency}
        upcomingTabHref={upcomingTabHref}
      />

      {/* 2 & 3. Same 3-column grid template as SummaryRow above
          (`grid-cols-1 sm:grid-cols-3 gap-3`) — not a coincidentally
          similar width, but literally the same column math, so
          TodayBox's left/right edges are guaranteed identical to
          Overdue's regardless of viewport width, rather than two
          independently-computed layouts that only happen to look
          close. The toolbar controls (view switch, search, More
          filters, Clear filters — the same single-row grouping
          ClientsOverviewTab's own toolbar already established) span
          the first two columns; TodayBox occupies the third, exactly
          where Overdue sits above it. `items-start` overrides grid's
          own default row-stretch so TodayBox's height never pulls the
          shorter toolbar controls down to float mid-row (SummaryRow's
          own separate grid keeps its default stretch, unaffected —
          this is a different grid container). At `<sm:` both groups
          stack as separate full-width rows, same as SummaryRow's own
          boxes. Record Payment no longer lives here — it now sits in
          the calendar's own toolbar (see RevenueCalendar), right after
          the next ("→") arrow, alongside that calendar's own Today
          (navigation) button — moved, not duplicated. */}
      <div className="mt-5 grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
        <div className="space-y-3 sm:col-span-2">
          <RevenueSubTabBar active={activeTab} onChange={setTab} />

          <CommandBar
            search={
              <SearchInput
                placeholder={SEARCH_PLACEHOLDER[activeTab]}
                aria-label={SEARCH_PLACEHOLDER[activeTab]}
                value={search}
                onValueChange={setSearch}
              />
            }
            filters={
              <FilterPopover activeCount={filterUi.chips.length} onClearAll={clearFilters}>
                {filterUi.panel}
              </FilterPopover>
            }
            chips={filterUi.chips.length > 0 ? <FilterChips chips={filterUi.chips} onClearAll={clearFilters} /> : undefined}
          />
        </div>

        <TodayBox
          todayKey={todayKey}
          receivedCount={receivedToday.length}
          receivedCents={receivedTodayCents}
          dueCount={displayDueToday.length}
          dueCents={displayDueTodayCents}
          currency={currency}
          loading={todayLoading}
          error={todayError}
          onRetry={retryTodayBox}
          filtered={Boolean(clientFilter)}
          demoActive={SHOW_TODAY_DEMO}
          onOpen={openToday}
        />
      </div>

      {/* Trend chart — real content, but secondary to the calendar
          below it; collapsed behind one "View trends" control rather
          than always taking up space. Only meaningful for Payments,
          where the visible range is receipts, not obligations. */}
      {activeTab === "payments" && report && report.transactions.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowTrends((v) => !v)}
            aria-expanded={showTrends}
            className="text-sm text-fg-muted hover:text-fg hover:underline"
          >
            {showTrends ? "Hide trends" : "View trends"}
          </button>
          {showTrends && <ReceiptsTrendChart transactions={report.transactions} currency={currency} start={start} end={end} />}
        </div>
      )}

      <div key={activeTab} className="animate-fade-in mt-4">
        {activeTab === "payments" && (
          <PaymentsTab
            report={report}
            error={error}
            onRetry={loadReport}
            currency={currency}
            cursor={calCursor}
            grid={calGrid}
            onCursorChange={setCalCursor}
            onGridChange={setCalGrid}
            onChanged={() => onChanged("Payment updated")}
            onClearAll={clearFilters}
            onRecordPayment={() => setShowRecordPayment(true)}
          />
        )}
        {activeTab === "upcoming" && (
          <UpcomingOverdueTab
            currency={currency}
            cursor={calCursor}
            grid={calGrid}
            onCursorChange={setCalCursor}
            onGridChange={setCalGrid}
            dataVersion={dataVersion}
            onChanged={() => onChanged("Payment recorded")}
            onClearAll={clearFilters}
            onRecordPayment={() => setShowRecordPayment(true)}
          />
        )}
        {activeTab === "hosting" && (
          <HostingPlansTab
            currency={currency}
            dataVersion={dataVersion}
            onChanged={() => onChanged("Hosting plan updated")}
            onClearAll={clearFilters}
          />
        )}
      </div>

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

      {/* The Today box's own day-detail panel — the exact same
          component the calendar's own day cells open, just fed today's
          combined received+due items instead of one clicked date's.
          Mutually exclusive with the calendar's own per-tab panels via
          the URL (openToday/openDay/openPayment each clear the others'
          params on open), so this is never a second, competing popup. */}
      {todayPanelOpen && (
        <DayDetailPanel
          dateKey={todayKey}
          items={todayItems}
          currency={currency}
          onClose={closeToday}
          onOpenTransaction={openTodayTransaction}
          onRecordPayment={handleTodayRecordPayment}
        />
      )}

      {/* Stacks above Today's panel exactly as RecordPaymentModal
          already stacks above UpcomingOverdueTab's own day panel — same
          established precedent, same component, a second call site. */}
      {todayPaymentModal && (
        <RecordPaymentModal
          projectId={todayPaymentModal.obligation.project_id}
          agreement={todayPaymentModal.agreement}
          hostingPlans={todayPaymentModal.hostingPlans}
          currency={currency}
          initialAllocation={
            todayPaymentModal.obligation.website_agreement_id
              ? { type: "agreement", id: todayPaymentModal.obligation.website_agreement_id }
              : todayPaymentModal.obligation.hosting_charge_id
                ? { type: "hosting_charge", id: todayPaymentModal.obligation.hosting_charge_id }
                : undefined
          }
          initialAmountCents={todayPaymentModal.obligation.amount_cents}
          onClose={() => setTodayPaymentModal(null)}
          onSaved={() => {
            setTodayPaymentModal(null);
            onChanged("Payment recorded");
          }}
        />
      )}
    </div>
  );
}
