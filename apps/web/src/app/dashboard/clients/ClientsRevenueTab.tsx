"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { calendarPeriodBounds, isoToLocalDate, toDateKey, type CalendarGridMode } from "@/lib/calendarGrid";
import { formatMoney } from "@/lib/format";
import { withParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { useToast } from "@/components/ui/ToastProvider";
import { CompactSelect } from "@/components/ui/CompactSelect";
import { FilterChips, type FilterChip } from "@/components/ui/FilterChips";
import { FilterPopover } from "@/components/ui/FilterPopover";
import { SearchInput } from "@/components/ui/SearchInput";
import { ChevronDownIcon, SearchIcon } from "@/components/ui/ControlIcons";
import { Skeleton } from "@/components/ui/Skeleton";
import { RecordPaymentLauncher } from "@/components/billing/RecordPaymentLauncher";
import { RecordPaymentModal } from "@/components/billing/RecordPaymentModal";
import { useRevenueSubTab, type RevenueSubTabId } from "./useRevenueSubTab";
import { CALENDAR_GROUP_LABELS, DayDetailPanel, type DayDetailItem } from "./DayDetailPanel";
import { PaymentsTab, usePaymentsFilters } from "./PaymentsTab";
import { OVERDUE_SENTINEL, UpcomingOverdueTab, useUpcomingFilters } from "./UpcomingOverdueTab";
import { HostingPlansTab, useHostingFilters } from "./HostingPlansTab";
import { FOCUS_LABEL, FOCUS_SCOPE } from "./RevenueSummaryBoxes";
import { CalendarNav } from "./RevenueCalendar";
import { parseFocus, type RevenueFocus } from "./revenueVisuals";
import { RANGE_PRESETS, RANGE_PRESET_LABEL, type RangePreset, type WeekFlow } from "./revenueAnalytics";
import { useRevenueAnalyticsData } from "./useRevenueAnalyticsData";
import { RevenueAnalyticsGrid } from "./RevenueAnalyticsGrid";
import { rangeLabel } from "./revenueChartParts";
import { Tooltip } from "@/components/ui/Tooltip";

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
    <div role="tablist" className="inline-flex h-8 flex-wrap items-center rounded-lg bg-surface-subtle p-0.5 text-xs">
      {REVENUE_SUB_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`toggle-pill h-7 rounded-md px-3 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring ${
            active === tab.id ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// The same card shell and padding as the analytics metric cards. `w-full`:
// the box heads the Revenue summary row, so its edges align with the cards;
// it stretches to the row's height like they do.
const TODAY_BOX_SHELL = "flex w-full flex-col rounded-md border border-border bg-surface px-4 py-3";

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
 * Same shell/type scale as the Revenue summary cards below it,
 * organised as a header (date) over two right-
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
    "text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none";

  if (error) {
    return (
      <button type="button" onClick={onRetry} className={`${TODAY_BOX_SHELL} ${interactiveClass}`}>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-muted">Today</span>
          <p className="text-sm text-fg-muted">Couldn&apos;t load — tap to retry</p>
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

  // The quiet footer's one job: a real count — never both counts at once
  // (the two rows above already state each in full), and never "0
  // payments due" when nothing's outstanding but something was received
  // today. The chevron beside it marks the box as the way into the panel.
  const footerText =
    dueCount > 0
      ? `${dueCount} payment${dueCount === 1 ? "" : "s"} due`
      : `${receivedCount} payment${receivedCount === 1 ? "" : "s"} received`;

  const ariaSummary = isEmpty
    ? "No activity today."
    : `Received ${formatMoney(receivedCents, currency)}. Due today ${formatMoney(dueCents, currency)}. ${footerText}.`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Today, ${shortDateLabel(todayKey)}. ${ariaSummary}${filtered ? " Filtered by client." : ""}${demoActive ? " Includes a demo entry." : ""} View details.`}
      className={`${TODAY_BOX_SHELL} ${interactiveClass}`}
    >
      {/* One consistent gap-1.5 rhythm for every visible section
          (header, rows, filtered note, footer) — a single declarative
          rule instead of each child carrying its own one-off mt-*,
          so the vertical spacing here can't quietly drift apart. */}
      <div className="flex flex-1 flex-col gap-1.5">
        <span className="flex min-h-5 items-center justify-between gap-2 text-xs text-fg-muted">
          <span>Today</span>
          <span className="tabular-nums">{shortDateLabel(todayKey)}</span>
        </span>

        {isEmpty ? (
          <p className="text-sm text-fg-muted">No activity today.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-fg-muted">Received</span>
              <span className="tabular-nums text-lg font-semibold text-fg">{formatMoney(receivedCents, currency)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-fg-muted">
                Due
                {demoActive && <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted">Demo</span>}
              </span>
              <span className="tabular-nums text-lg font-semibold text-fg">{formatMoney(dueCents, currency)}</span>
            </div>
          </div>
        )}

        {filtered && <p className="text-xs text-fg-muted">Filtered by client</p>}

        <span className="mt-auto flex items-center justify-between gap-2 text-xs tabular-nums text-fg-muted">
          <span>{isEmpty ? "" : footerText}</span>
          <ChevronDownIcon aria-hidden="true" className="h-4 w-4 shrink-0 -rotate-90" />
        </span>
      </div>
    </button>
  );
}

/**
 * TodayBox's compact form, for the collapsed Revenue summary line — the
 * same figures, loading/error/demo semantics and `onOpen`/`onRetry`, as
 * one inline button, so Today stays reachable when the column is hidden.
 */
function TodayInline({
  receivedCents,
  dueCents,
  currency,
  loading,
  error,
  onRetry,
  filtered,
  demoActive,
  onOpen,
}: {
  receivedCents: number;
  dueCents: number;
  currency: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  filtered: boolean;
  demoActive: boolean;
  onOpen: () => void;
}) {
  const className =
    "-mx-1.5 inline-flex min-h-9 items-center rounded-md px-1.5 text-xs tabular-nums text-fg-muted transition-colors duration-fast ease-standard hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none";
  if (error) {
    return (
      <button type="button" onClick={onRetry} className={className}>
        Today: couldn&apos;t load — retry
      </button>
    );
  }
  if (loading) return <span className="text-xs text-fg-subtle">Today…</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Today: ${formatMoney(receivedCents, currency)} received, ${formatMoney(dueCents, currency)} due.${filtered ? " Filtered by client." : ""}${demoActive ? " Includes a demo entry." : ""} View details.`}
      className={className}
    >
      Today:&nbsp;<span className="font-medium text-fg">{formatMoney(receivedCents, currency)}</span>&nbsp;received ·&nbsp;
      <span className="font-medium text-fg">{formatMoney(dueCents, currency)}</span>&nbsp;due
      {demoActive && <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Demo</span>}
    </button>
  );
}

/**
 * Search that folds into an icon button so the calendar header stays one
 * compact row. Expanding grows the existing SearchInput out of the
 * button's own width and focuses it; collapsing (focus leaving it, or
 * Escape) keeps the text — the button then shows it, with a filled
 * "active" style, so a search in effect is never hidden. Only the
 * field's clear button, or deleting the text, clears a search.
 */
function ExpandableSearch({ value, onValueChange, placeholder }: { value: string; onValueChange: (v: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const refocusTrigger = useRef(false);
  // The trigger's width when it was activated — where the field grows from.
  const [fromWidth, setFromWidth] = useState<number | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (refocusTrigger.current) {
      refocusTrigger.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  const active = value.trim() !== "";
  if (!open) {
    return (
      <Tooltip label={active ? "" : "Search"}>
        <button
          ref={triggerRef}
          type="button"
          onClick={(e) => {
            setFromWidth(e.currentTarget.offsetWidth);
            setOpen(true);
          }}
          aria-expanded={false}
          aria-label={active ? `Search: ${value} (active). Edit search` : "Search"}
          // The full search text when the button shows it truncated; the plain icon gets the shared tooltip instead.
          title={active ? `Search: ${value}` : undefined}
          className={`control-btn max-w-[12rem] px-3 ${active ? "border-accent/50 bg-accent-soft" : ""}`}
        >
          <SearchIcon className={`h-4 w-4 shrink-0 ${active ? "text-fg" : "text-fg-muted"}`} />
          {active && <span className="truncate text-xs">{value}</span>}
        </button>
      </Tooltip>
    );
  }
  return (
    <div
      ref={rootRef}
      style={fromWidth ? ({ "--expand-from": `${fromWidth}px` } as CSSProperties) : undefined}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && rootRef.current?.contains(e.relatedTarget))) setOpen(false);
      }}
    >
      <SearchInput
        ref={inputRef}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onValueChange={onValueChange}
        onKeyDown={(e) => {
          // Escape folds the field back into the button and keeps the
          // text. preventDefault stops both SearchInput's own
          // clear-on-Escape and the browser's for type="search".
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            refocusTrigger.current = true;
            setOpen(false);
          }
        }}
        className="animate-expand-in h-8 w-52 overflow-hidden text-xs sm:w-60"
      />
    </div>
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
 * Above the calendar sits the analytics dashboard (RevenueAnalyticsGrid),
 * driven by its own date range (`?range=`, useRevenueAnalyticsData) — it
 * never follows calendar navigation, so paging the calendar never changes
 * a headline. Charts can move the calendar (to a week or month) and set
 * the Payments type filter; the active filters bar says so.
 */
export function ClientsRevenueTab() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const { activeTab, setTab } = useRevenueSubTab();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const analytics = useRevenueAnalyticsData(workspace, dataVersion);
  // Today in the WORKSPACE timezone — the same day the server's overdue
  // rule and the calendar's today marker use. The browser's own date can
  // be a day (or, at a month end, a month) away from it.
  const workspaceToday = analytics.today;

  // Seeded once from the URL (so a shared/bookmarked link opens on the
  // right month/week), then kept in sync with it on every navigation —
  // same "local state + immediate URL write" pattern the rest of this
  // page's filters already use, just for a Date instead of a string.
  // Without one, the calendar follows the workspace's today.
  const [calCursorState, setCalCursorState] = useState<Date | null>(() => {
    const raw = searchParams.get("calCursor");
    if (raw) {
      const [y, m, d] = raw.split("-").map(Number);
      if (y && m && d) return new Date(y, m - 1, d);
    }
    return null;
  });
  const calCursor = useMemo(() => calCursorState ?? isoToLocalDate(workspaceToday), [calCursorState, workspaceToday]);
  const calGrid: CalendarGridMode = searchParams.get("calGrid") === "week" ? "week" : "month";

  // Moving the calendar (←/→/Today) also clears a day/week selection in
  // the same URL write, so the breakdown follows the newly visible period
  // instead of pointing at dates that are no longer shown.
  function setCalCursor(next: Date) {
    setCalCursorState(next);
    let query = withParam(searchParams, "calCursor", toDateKey(next));
    query = withParam(new URLSearchParams(query), "day", null);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  function setCalGrid(next: CalendarGridMode) {
    router.replace(`${pathname}?${withParam(searchParams, "calGrid", next === "month" ? null : next)}`, { scroll: false });
  }

  const { start, end } = useMemo(() => calendarPeriodBounds(calCursor, calGrid), [calCursor, calGrid]);

  // The real current calendar month — fixed for the life of this page
  // view, independent of `calCursor` and of the analytics range. The
  // Today box reads "received today" from it ("today" is always inside
  // this range by construction, whichever analytics range is selected).
  const thisMonth = useMemo(() => calendarPeriodBounds(isoToLocalDate(workspaceToday), "month"), [workspaceToday]);
  const todayKey = workspaceToday;

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

  function loadMonthReport() {
    api
      .getRevenueReport(thisMonth.start, thisMonth.end)
      .then((r) => {
        setMonthReportError(null);
        setMonthReport(r);
      })
      .catch(() => setMonthReportError("Couldn't load today's payments."));
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
    for (const key of ["day", "payment", "today", "flowDay"]) {
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

  // Summary-box focus (`?focus=`) — narrows which records Payments/
  // Upcoming show (their own filtering reads it), never a headline.
  // Every change is ONE URL write, so the view switch, cursor move and
  // cleared overlays can't race each other.
  const focus = parseFocus(searchParams.get("focus"));

  function applyFocus(next: RevenueFocus | null, openDay?: string) {
    let query = withParam(searchParams, "focus", next);
    const set = (key: string, value: string | null) => {
      query = withParam(new URLSearchParams(query), key, value);
    };
    // Received → Payments ("payments" is the default, omitted), on the
    // current month; Hosting/Overdue → Upcoming, cursor unchanged.
    if (next) set("revenueTab", next === "received" ? null : "upcoming");
    if (next === "received") {
      const now = isoToLocalDate(workspaceToday);
      setCalCursorState(now);
      set("calCursor", toDateKey(now));
    }
    set("payment", null);
    set("today", null);
    set("day", openDay ?? null);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  function toggleFocus(f: RevenueFocus) {
    applyFocus(focus === f ? null : f);
  }

  // Upcoming's existing all-months overdue panel (its OVERDUE sentinel).
  function viewAllOverdue() {
    applyFocus("overdue", OVERDUE_SENTINEL);
  }

  // A focus only applies to its own view (received → Payments,
  // hosting/overdue → Upcoming); switching to a view it doesn't apply to
  // clears it in the same URL write, so a "Showing: …" state is never
  // left pointing at records that view doesn't filter.
  function changeTab(id: RevenueSubTabId) {
    const applies = focus === "received" ? id === "payments" : focus ? id === "upcoming" : true;
    if (applies) {
      setTab(id);
      return;
    }
    let query = withParam(searchParams, "revenueTab", id === "payments" ? null : id);
    query = withParam(new URLSearchParams(query), "focus", null);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  const focusApplies =
    focus !== null && (focus === "received" ? activeTab === "payments" : activeTab === "upcoming");

  // `?kind=` — the Payments view's own type filter, which the donut sets.
  const rawKind = searchParams.get("kind");
  const kind = rawKind === "website" || rawKind === "hosting" ? rawKind : null;
  const kindApplies = kind !== null && activeTab === "payments";
  const rangeText = rangeLabel(analytics.range.start, analytics.range.end);

  // Where a chart last moved the calendar — shown in the active filters
  // bar only while the calendar is still on that exact week/month.
  const [chartSelection, setChartSelection] = useState<{ key: string; grid: CalendarGridMode; label: string } | null>(null);
  const chartSelectionActive =
    chartSelection !== null && chartSelection.key === toDateKey(calCursor) && chartSelection.grid === calGrid && activeTab !== "hosting";

  const calendarRef = useRef<HTMLElement>(null);
  function revealCalendar() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    calendarRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  // One URL write per chart action: target view (a focus that doesn't
  // apply to it is cleared, as `changeTab` does), plus any extra params;
  // open overlays are closed so the calendar is what the user sees.
  function chartNavigate(view: RevenueSubTabId, params: Record<string, string | null>) {
    let query = withParam(searchParams, "revenueTab", view === "payments" ? null : view);
    const set = (key: string, value: string | null) => {
      query = withParam(new URLSearchParams(query), key, value);
    };
    const keepsFocus = focus === "received" ? view === "payments" : focus ? view === "upcoming" : true;
    if (!keepsFocus) set("focus", null);
    for (const [key, value] of Object.entries(params)) set(key, value);
    for (const key of ["day", "payment", "today", "flowDay"]) set(key, null);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  // Donut segment → Payments, filtered to that type (again = clear).
  function selectKind(next: "website" | "hosting") {
    chartNavigate("payments", { kind: kindApplies && kind === next ? null : next });
  }

  function moveCalendar(startKey: string, grid: CalendarGridMode, view: RevenueSubTabId, label: string) {
    setCalCursorState(isoToLocalDate(startKey));
    setChartSelection({ key: startKey, grid, label });
    chartNavigate(view, { calCursor: startKey, calGrid: grid === "month" ? null : grid });
    revealCalendar();
  }

  // Weekly cash flow → that week; Payments when the week only has
  // receipts, Upcoming when anything is still scheduled there.
  function openWeek(w: WeekFlow) {
    const scheduled = w.expectedCents + w.overdueCents + w.notInvoicedCents;
    const view: RevenueSubTabId = scheduled > 0 ? "upcoming" : w.receivedCents > 0 ? "payments" : activeTab;
    moveCalendar(w.weekStart, "week", view, `Week of ${rangeLabel(w.weekStart, w.weekStart)} · from Weekly cash flow`);
  }


  function clearChartSelection() {
    setChartSelection(null);
    if (calGrid === "week") setCalGrid("month");
  }

  // Reset clears search, every filter, the summary focus and a chart's
  // calendar label in one URL write; the calendar keeps its place.
  function resetAll() {
    setSearch("");
    setChartSelection(null);
    let query = searchParams.toString();
    for (const key of ["q", "kind", "status", "type", "client", "focus"]) {
      query = withParam(new URLSearchParams(query), key, null);
    }
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  // One chip row: the view's own filter chips (the donut's type filter
  // is Payments' "Type" chip), plus the summary focus and a chart's
  // calendar selection.
  const activeChips: FilterChip[] = [
    ...(focus && focusApplies ? [{ id: "focus", label: "Focus", value: FOCUS_LABEL[focus], onRemove: () => applyFocus(null) }] : []),
    ...filterUi.chips,
    ...(chartSelectionActive && chartSelection
      ? [{ id: "calendar", label: "Calendar", value: chartSelection.label, onRemove: clearChartSelection }]
      : []),
  ];
  const anyFilterActive = Boolean(search.trim()) || activeChips.length > 0;

  const flowDay = searchParams.get("flowDay");
  const flowDayItems: DayDetailItem[] = useMemo(() => {
    if (!flowDay) return [];
    const receipts = (report?.transactions ?? []).filter(
      (tx) => tx.received_date === flowDay && (!clientFilter || tx.client_id === clientFilter),
    );
    const outstanding = (todayObligations ?? []).filter(
      (o) => o.due_date === flowDay && (!clientFilter || o.client_id === clientFilter),
    );
    return [
      ...receipts.map((tx) => ({ type: "transaction" as const, tx })),
      ...outstanding.map((o) => ({ type: "obligation" as const, o })),
    ];
  }, [flowDay, report, todayObligations, clientFilter]);

  function closeFlowDay() {
    router.replace(`${pathname}?${withParam(searchParams, "flowDay", null)}`, { scroll: false });
  }

  function openFlowTransaction(paymentId: string) {
    let query = withParam(searchParams, "revenueTab", null); // "payments" is the default, omitted
    query = withParam(new URLSearchParams(query), "payment", paymentId);
    query = withParam(new URLSearchParams(query), "flowDay", null);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

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

  const todayProps = {
    receivedCents: receivedTodayCents,
    dueCents: displayDueTodayCents,
    currency,
    loading: todayLoading,
    error: todayError,
    onRetry: retryTodayBox,
    filtered: Boolean(clientFilter),
    demoActive: SHOW_TODAY_DEMO,
    onOpen: openToday,
  };
  const todayBox = (
    <TodayBox todayKey={todayKey} receivedCount={receivedToday.length} dueCount={displayDueToday.length} {...todayProps} />
  );

  return (
    <div>
      {/* Hosting has no analytics, so Today gets its own row above the
          controls — stacked, not beside them, since the box is taller than
          the control rows and would leave a void next to it. */}
      {activeTab === "hosting" && <div className="mb-4 w-full sm:w-[260px]">{todayBox}</div>}

      {/* 1. Analytics — Payments and Upcoming only (Hosting has its own
          plan table). Its heading row carries the Revenue summary toggle
          and the selected analytics period; Today heads the summary
          column. Outside the per-view block so switching between the two
          views doesn't remount it. */}
      {activeTab !== "hosting" && (
        <div className="mb-6">
          <RevenueAnalyticsGrid
            todayCard={todayBox}
            todayInline={<TodayInline {...todayProps} />}
            report={analytics.report}
            error={analytics.error}
            onRetry={analytics.reload}
            range={analytics.range}
            today={analytics.today}
            historyStart={analytics.historyStart}
            previous={analytics.previous}
            currency={currency}
            clientFilter={clientFilter || null}
            obligations={todayObligations}
            obligationsError={todayObligationsError}
            focus={focus}
            onToggleFocus={toggleFocus}
            onViewAllOverdue={viewAllOverdue}
            kind={kindApplies ? kind : null}
            onSelectKind={selectKind}
            onWeekClick={openWeek}
            rangeControl={
              // The analytics period — drives the charts and cards only
              // (the calendar keeps its own month/week navigation).
              <CompactSelect<RangePreset>
                aria-label={`Analytics date range: ${RANGE_PRESET_LABEL[analytics.preset]}, ${rangeText}`}
                prefix="Range"
                value={analytics.preset}
                onValueChange={analytics.setPreset}
                options={RANGE_PRESETS.map((p) => ({ value: p, label: RANGE_PRESET_LABEL[p] }))}
                className="w-auto"
              />
            }
          />
        </div>
      )}

      {/* 2. The calendar container — one rounded card holding the view
          switch + Record Payment, then the period navigation beside
          search / filters / reset, the active-filter chips, and the
          active view (calendar, or the Hosting table). The analytics
          Range control lives with the charts above, not here. */}
      <section
        ref={calendarRef}
        aria-labelledby={activeTab !== "hosting" ? "revenue-calendar-label revenue-calendar-heading" : undefined}
        aria-label={activeTab === "hosting" ? "Hosting plans" : undefined}
        className="card scroll-mt-4 p-3 sm:p-4"
      >
        {activeTab !== "hosting" && (
          <span id="revenue-calendar-label" className="sr-only">
            Revenue calendar,
          </span>
        )}
        {/* Row 1: view switch, then search / filters / reset / Record
            Payment together on the right (wrapping below the switch as one
            group when narrow). Row 2: period navigation. Every header
            control is 32px tall. */}
        <div className="flex flex-wrap items-center gap-2">
          <RevenueSubTabBar active={activeTab} onChange={changeTab} />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 [&_.control-btn]:h-8 [&_.control-btn]:px-2.5 [&_.control-btn]:text-xs">
            <ExpandableSearch placeholder={SEARCH_PLACEHOLDER[activeTab]} value={search} onValueChange={setSearch} />
            <FilterPopover activeCount={filterUi.chips.length} onClearAll={clearFilters} align="end">
              {filterUi.panel}
            </FilterPopover>
            {anyFilterActive && (
              <button type="button" onClick={resetAll} aria-label="Reset search and all filters" className="btn btn-ghost btn-sm h-8 px-2.5">
                Reset
              </button>
            )}
            {activeTab !== "hosting" && (
              <button type="button" onClick={() => setShowRecordPayment(true)} className="btn btn-primary btn-sm h-8 px-3">
                Record Payment
              </button>
            )}
          </div>
        </div>

        {activeTab !== "hosting" && (
          <div className="mt-2">
            <CalendarNav
              cursor={calCursor}
              grid={calGrid}
              onCursorChange={setCalCursor}
              onGridChange={setCalGrid}
              todayKey={analytics.today}
              headingId="revenue-calendar-heading"
              currency={currency}
            />
          </div>
        )}

        {/* What's narrowing the view — filter chips plus the summary
            focus and a chart's calendar selection, as one compact row. */}
        {activeChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <FilterChips chips={activeChips} />
            {focus && focusApplies && <span className="text-xs text-fg-muted">{FOCUS_SCOPE[focus]}</span>}
            {focus === "overdue" && focusApplies && (analytics.report?.overdue_count ?? 0) > 0 && (
              <button
                type="button"
                onClick={viewAllOverdue}
                className="rounded text-xs text-fg-muted hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                All overdue, across every month →
              </button>
            )}
          </div>
        )}

        <div key={activeTab} className="mt-4 animate-fade-in">
          {activeTab === "payments" && (
            <PaymentsTab
              report={report}
              error={error}
              onRetry={loadReport}
              currency={currency}
              cursor={calCursor}
              grid={calGrid}
              onChanged={() => onChanged("Payment updated")}
              onClearAll={clearFilters}
              obligations={todayObligations}
              obligationsError={todayObligationsError}
              onRecordObligation={handleTodayRecordPayment}
              todayKey={analytics.today}
            />
          )}
          {activeTab === "upcoming" && (
            <UpcomingOverdueTab
              currency={currency}
              cursor={calCursor}
              grid={calGrid}
              dataVersion={dataVersion}
              onChanged={() => onChanged("Payment recorded")}
              onClearAll={clearFilters}
              transactions={report?.transactions ?? null}
              transactionsError={error}
              onOpenTransaction={openFlowTransaction}
              todayKey={analytics.today}
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
      </section>

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

      {flowDay && (
        <DayDetailPanel
          dateKey={flowDay}
          items={flowDayItems}
          currency={currency}
          description="Payments received and amounts still outstanding on this date."
          groupLabels={CALENDAR_GROUP_LABELS}
          onClose={closeFlowDay}
          onOpenTransaction={openFlowTransaction}
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
