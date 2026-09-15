"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type ActivityItem,
  type Client,
  type ClientChecklistSummary,
  type NextPaymentObligation,
  type Project,
  type RevenueHostingPlan,
  type Task,
  type TodayBillingSnapshot,
  type User,
} from "@/lib/api";
import { filterClients, LIVE_STAGES, UNASSIGNED } from "@/lib/filters";
import {
  activeProjectCount,
  buildAttentionCards,
  clientRowMatchesFilters,
  clientTone,
  currentProject,
  liveWebsiteCount,
  mostRecentActivity,
  projectsForClient,
  CLIENT_STATUS_LABEL,
  type ClientTone,
  type OverviewFilters,
} from "@/lib/clients";
import { relativeObligationLabel } from "@/lib/billing";
import { nextOpenTask } from "@/lib/projects";
import { formatMoney } from "@/lib/format";
import { withParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { useDensity } from "@/lib/useDensity";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import {
  CLIENT_COLUMN_DEFAULTS,
  CLIENT_COLUMN_LABELS,
  useClientColumns,
  type ClientColumnKey,
} from "@/lib/useClientColumns";
import { ClientStatusBadge } from "@/components/ClientStatusBadge";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { DensityToggle } from "@/components/ui/DensityToggle";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric, MetricGrid } from "@/components/ui/Metric";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { WebsitesField, HostingField, NextPaymentField, NextTaskField, type EnrichedClient } from "./ClientRowFields";
import { ClientPreviewPanel } from "./ClientPreviewPanel";
import { AttentionCards, AttentionCardsSkeleton } from "./AttentionCards";

/** One shared source for the table's density → vertical-padding mapping, so the header row and body rows can never drift apart (they previously did — the header was stuck at a fixed py-2 while body rows shrank in Compact). */
function rowPadY(density: "comfortable" | "compact"): string {
  return density === "compact" ? "py-1.5" : "py-3";
}

// ---------------------------------------------------------------------------
// Small shared row-level controls
// ---------------------------------------------------------------------------

/** Compact, click-to-open control for a real, actionable issue — never a full-row warning background. Overdue payment takes precedence over an outstanding-required-tasks issue when a row has both, matching how buildOverviewAttentionItems orders the aggregate list. */
function AttentionIndicator({ row, currency }: { row: EnrichedClient; currency: string }) {
  const overdue = row.nextPayment?.is_overdue ?? false;
  const blocked = !overdue && row.requiredOutstanding > 0;
  if (!overdue && !blocked) return null;

  const label = overdue
    ? `Overdue payment — ${formatMoney(row.nextPayment!.amount_cents, currency)}, ${relativeObligationLabel(row.nextPayment!)}`
    : `${row.requiredOutstanding} required task${row.requiredOutstanding === 1 ? "" : "s"} outstanding`;
  const href = overdue ? `/dashboard/clients/${row.client.id}?tab=billing` : `/dashboard/clients/${row.client.id}?tab=tasks`;

  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-2 w-2" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
      </svg>
    </Link>
  );
}

/** Eye icon — the explicit, always-visible quick-preview trigger, distinct from the "⋯" menu (which navigates away; this opens a panel without leaving the list). */
function PreviewButton({ client, onOpen }: { client: Client; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`Quick preview of ${client.business_name}`}
      className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true">
        <path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" />
        <circle cx="10" cy="10" r="2" />
      </svg>
    </button>
  );
}

/** Row-level "⋯" menu — every real, already-existing shortcut into that client's own record. No Archive here: Client has no archive concept anywhere in this codebase (see ClientHeader's own SecondaryActionMenu), so none is fabricated. */
function RowActionsMenu({ client }: { client: Client }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`More actions for ${client.business_name}`}
        className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
      >
        ⋯
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            aria-hidden="true"
          />
          <span className="absolute right-0 z-20 mt-1 block w-40 rounded-md border border-border bg-surface py-1 shadow-lg">
            <Link href={`/dashboard/clients/${client.id}`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              Open Client
            </Link>
            <Link href={`/dashboard/clients/${client.id}?tab=billing`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              Billing
            </Link>
            <Link href={`/dashboard/clients/${client.id}?tab=details`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              Edit details
            </Link>
          </span>
        </>
      )}
    </span>
  );
}

/** Show/hide the table's secondary columns, persisted per-operator (useClientColumns → localStorage). Client and the actions column are never toggleable — "essential" per the spec. */
function ColumnsMenu({
  columns,
  onChange,
}: {
  columns: Record<ClientColumnKey, boolean>;
  onChange: (next: Record<ClientColumnKey, boolean>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="btn btn-secondary btn-sm"
      >
        Columns
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-surface py-1 shadow-lg">
            {(Object.keys(CLIENT_COLUMN_DEFAULTS) as ClientColumnKey[]).map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-fg hover:bg-surface-hover"
              >
                <input
                  type="checkbox"
                  checked={columns[key]}
                  onChange={(e) => onChange({ ...columns, [key]: e.target.checked })}
                />
                {CLIENT_COLUMN_LABELS[key]}
              </label>
            ))}
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => {
                  onChange(CLIENT_COLUMN_DEFAULTS);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                Reset to default
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Desktop table row
// ---------------------------------------------------------------------------

function ClientTableRow({
  row,
  currency,
  density,
  columns,
  isPreviewOpen,
  onOpenPreview,
}: {
  row: EnrichedClient;
  currency: string;
  density: "comfortable" | "compact";
  columns: Record<ClientColumnKey, boolean>;
  isPreviewOpen: boolean;
  onOpenPreview: () => void;
}) {
  const { client, tone, project } = row;
  const padY = rowPadY(density);
  // The sticky Client cell needs its own explicit background (a sticky
  // element sits outside the row's normal paint order, so the row's own
  // bg wouldn't reliably show through while scrolled) — `group-hover`
  // keeps it in sync with the row's hover state, and the persistent
  // preview-open tint overrides both while this row's panel is open.
  const stickyBg = isPreviewOpen ? "bg-accent/5" : "bg-surface group-hover:bg-surface-hover";
  return (
    <tr className={`group align-top ${isPreviewOpen ? "bg-accent/5" : ""}`}>
      <td className={`sticky left-0 z-10 ${padY} pr-4 ${stickyBg}`}>
        <div className="flex items-start gap-1.5">
          <Link
            href={`/dashboard/clients/${client.id}`}
            title={client.business_name}
            className="block max-w-[15rem] truncate font-medium text-fg hover:underline"
          >
            {client.business_name}
          </Link>
          <AttentionIndicator row={row} currency={currency} />
        </div>
        <span className="block truncate text-xs text-fg-muted">{client.billing_email ?? "No contact on file"}</span>
        <span className="mt-1 flex items-center gap-1.5">
          <ClientStatusBadge tone={tone} />
          {project && <ProjectStatusBadge project={project} />}
        </span>
      </td>
      {columns.websites && (
        <td className={`${padY} pr-4 text-sm`}>
          <WebsitesField row={row} />
        </td>
      )}
      {columns.hosting && (
        <td className={`${padY} pr-4 text-sm`}>
          <HostingField row={row} currency={currency} />
        </td>
      )}
      {columns.nextPayment && (
        <td className={`${padY} pr-4 text-sm`}>
          <NextPaymentField row={row} currency={currency} />
        </td>
      )}
      {columns.nextTask && (
        <td className={`${padY} pr-4 text-sm`}>
          <NextTaskField row={row} />
        </td>
      )}
      <td className={`${padY} text-right`}>
        <span className="inline-flex items-center gap-1">
          <PreviewButton client={client} onOpen={onOpenPreview} />
          <RowActionsMenu client={client} />
        </span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Mobile card — name/status/next-task up front, everything else behind a
// disclosure, per the spec's explicit "prioritise business name, attention
// status, and next action" mobile requirement (not just a scrolled table).
// ---------------------------------------------------------------------------

function ClientMobileCard({
  row,
  currency,
  onOpenPreview,
}: {
  row: EnrichedClient;
  currency: string;
  onOpenPreview: () => void;
}) {
  const { client, tone, project } = row;
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Link href={`/dashboard/clients/${client.id}`} className="min-w-0 truncate font-medium text-fg hover:underline">
            {client.business_name}
          </Link>
          <AttentionIndicator row={row} currency={currency} />
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <ClientStatusBadge tone={tone} />
          <PreviewButton client={client} onOpen={onOpenPreview} />
        </span>
      </div>
      <div className="mt-1 text-xs text-fg-muted">
        <NextTaskField row={row} />
      </div>
      {project && (
        <div className="mt-1.5">
          <ProjectStatusBadge project={project} />
        </div>
      )}
      <details className="mt-2 text-xs text-fg-muted">
        <summary className="cursor-pointer select-none text-fg-subtle">More details</summary>
        <div className="mt-2 space-y-1.5">
          <p>{client.billing_email ?? "No contact on file"}</p>
          <p>
            <span className="text-fg-subtle">Websites: </span>
            <WebsitesField row={row} />
          </p>
          <p>
            <span className="text-fg-subtle">Hosting: </span>
            <HostingField row={row} currency={currency} />
          </p>
          <p>
            <span className="text-fg-subtle">Next payment: </span>
            <NextPaymentField row={row} currency={currency} />
          </p>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function ClientsOverviewTab({ currency }: { currency: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [density, setDensity] = useDensity();
  const [columns, setColumns] = useClientColumns();

  const [clients, setClients] = useState<Client[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [hostingPlans, setHostingPlans] = useState<RevenueHostingPlan[]>([]);
  const [obligations, setObligations] = useState<NextPaymentObligation[]>([]);
  const [checklistSummaries, setChecklistSummaries] = useState<ClientChecklistSummary[]>([]);
  const [billingSnapshot, setBillingSnapshot] = useState<TodayBillingSnapshot | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<ClientTone | "">("");
  const [hostingFilter, setHostingFilter] = useState<OverviewFilters["hosting"]>("");
  const [paymentFilter, setPaymentFilter] = useState<OverviewFilters["payment"]>("");
  const [attentionFilter, setAttentionFilter] = useState<OverviewFilters["attention"]>("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  useDebouncedUrlSync("search", search);

  function updateParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value)}`, { scroll: false });
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const status = searchParams.get("clientStatus");
    setStatusFilter(status && status in CLIENT_STATUS_LABEL ? (status as ClientTone) : "");
    const hosting = searchParams.get("hosting");
    setHostingFilter(hosting === "active" ? "active" : "");
    const payment = searchParams.get("payment");
    setPaymentFilter(payment === "overdue" ? "overdue" : "");
    const attention = searchParams.get("attention");
    setAttentionFilter(attention === "required_tasks" ? "required_tasks" : "");
    setAssigneeFilter(searchParams.get("assignee") ?? "");
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const previewId = searchParams.get("preview");

  function openPreview(clientId: string) {
    router.push(`${pathname}?${withParam(searchParams, "preview", clientId)}`, { scroll: false });
  }

  function closePreview() {
    router.push(`${pathname}?${withParam(searchParams, "preview", null)}`, { scroll: false });
  }

  const [showAdd, setShowAdd] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .listClients()
      .then((rows) => {
        setError(null);
        setClients(rows);
      })
      .catch(() => setError("Couldn't load clients."));
    api.listProjects().then(setProjects).catch(() => {});
    api.listTasks().then(setTasks).catch(() => {});
    api.listActivity().then(setActivity).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api.listAllHostingPlans().then(setHostingPlans).catch(() => {});
    api.getWorkspaceObligations().then(setObligations).catch(() => {});
    api.listChecklistSummaries().then(setChecklistSummaries).catch(() => {});
    api
      .getTodayBillingSnapshot()
      .then((s) => {
        setBillingError(null);
        setBillingSnapshot(s);
      })
      .catch(() => setBillingError("Couldn't load the revenue summary."));
  }

  useEffect(load, []);

  // Opening/closing the quick-preview panel is an overlay action, not a
  // different view of the list — excluding `preview` from the scroll
  // key means the list's scroll position survives a round trip through
  // "Open Client →" even when the preview happened to be open at the
  // moment of leaving (otherwise that trip's saved position lives under
  // a `...&preview=<id>` bucket that a plain filtered URL never wrote
  // to, so returning finds nothing and resets to the top).
  const scrollKey = withParam(searchParams, "preview", null);
  useScrollRestoration(clients !== null, scrollKey);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api.createClient({ business_name: businessName, billing_email: billingEmail || undefined });
      setBusinessName("");
      setBillingEmail("");
      setShowAdd(false);
      router.push(`/dashboard/clients/${created.id}`);
    } catch {
      setError("Couldn't add that client.");
      setSaving(false);
    }
  }

  const rows = useMemo<EnrichedClient[]>(() => {
    if (!clients) return [];
    return clients.map((client) => {
      const clientProjects = projectsForClient(projects, client.id);
      const project = currentProject(clientProjects);
      const nextTask = project ? nextOpenTask(tasks, project.id) : null;
      const lastActivityItem = mostRecentActivity(activity, client, clientProjects);
      const clientObligations = obligations
        .filter((o) => o.client_id === client.id)
        .sort((a, b) => ((a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : 1));
      const summary = checklistSummaries.find((s) => s.client_id === client.id);
      return {
        client,
        tone: clientTone(clientProjects),
        project,
        activeProjects: activeProjectCount(clientProjects),
        liveProjects: clientProjects.filter((p) => LIVE_STAGES.includes(p.stage)),
        allProjects: clientProjects,
        nextTask,
        lastActivity: lastActivityItem?.created_at ?? null,
        hostingPlans: hostingPlans.filter((p) => p.client_id === client.id),
        nextPayment: clientObligations[0] ?? null,
        requiredOutstanding: summary ? summary.total - summary.completed : 0,
      };
    });
  }, [clients, projects, tasks, activity, hostingPlans, obligations, checklistSummaries]);

  const activeClientCount = useMemo(() => rows.filter((r) => r.tone === "active").length, [rows]);
  const liveWebsiteTotal = useMemo(() => liveWebsiteCount(projects), [projects]);

  const attentionCards = useMemo(
    () => buildAttentionCards(obligations.filter((o) => o.is_overdue), checklistSummaries, clients ?? []),
    [obligations, checklistSummaries, clients],
  );

  const activeFilterCount = [search, statusFilter, hostingFilter, paymentFilter, attentionFilter, assigneeFilter].filter(
    Boolean,
  ).length;

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setHostingFilter("");
    setPaymentFilter("");
    setAttentionFilter("");
    setAssigneeFilter("");
    // Clearing filters is about the *filters*, not display preferences —
    // density/columns are untouched, and `preview` (if a panel happens
    // to be open) is preserved too, only the filter/search params go.
    let query = searchParams.toString();
    for (const key of ["search", "clientStatus", "hosting", "payment", "attention", "assignee"]) {
      query = withParam(new URLSearchParams(query), key, null);
    }
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  const visibleRows = useMemo(() => {
    if (!clients) return null;
    const bySearchAndAssignee = filterClients(clients, { search, assignee: assigneeFilter });
    const allowed = new Set(bySearchAndAssignee.map((c) => c.id));
    return rows
      .filter((row) => allowed.has(row.client.id))
      .filter((row) =>
        clientRowMatchesFilters(
          {
            tone: row.tone,
            hostingPlans: row.hostingPlans,
            nextPaymentOverdue: row.nextPayment?.is_overdue ?? false,
            requiredOutstanding: row.requiredOutstanding,
          },
          { status: statusFilter, hosting: hostingFilter, payment: paymentFilter, attention: attentionFilter },
        ),
      )
      .sort((a, b) => {
        const aKey = a.lastActivity ?? a.client.created_at;
        const bKey = b.lastActivity ?? b.client.created_at;
        return aKey < bKey ? 1 : -1;
      });
  }, [clients, rows, search, assigneeFilter, statusFilter, hostingFilter, paymentFilter, attentionFilter]);

  // A client can vanish from the current result set between the preview
  // being opened and this render (a filter change, a reload racing a
  // deletion elsewhere) — look it up defensively and simply don't render
  // the panel if it's gone, rather than crashing on a stale reference.
  const previewRow = previewId ? (rows.find((r) => r.client.id === previewId) ?? null) : null;
  const headerPadY = rowPadY(density);

  return (
    <div>
      {/* Compact summary strip — client-workspace figures first (Active
          clients, Live websites), then the two Revenue figures most
          relevant to "what needs attention" here; the full receipts
          breakdown lives on the Revenue tab, not duplicated here. */}
      {billingError ? (
        <ErrorState message={billingError} onRetry={load} compact />
      ) : (
        <MetricGrid className="sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-4">
          {!clients || !billingSnapshot
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-md border border-border bg-surface px-4 py-3">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-2 h-6 w-14" />
                </div>
              ))
            : [
                <Metric
                  key="active"
                  label="Active clients"
                  value={activeClientCount}
                  href={`${pathname}?${withParam(searchParams, "clientStatus", "active")}`}
                />,
                <Metric
                  key="live"
                  label="Live websites"
                  value={liveWebsiteTotal}
                  href="/dashboard/clients?tab=websites"
                />,
                <Metric
                  key="mrr"
                  label="Expected monthly hosting revenue"
                  value={formatMoney(billingSnapshot.expected_mrr_cents, currency)}
                  hint="Expected — not money received"
                  href="/dashboard/clients?tab=revenue&revenueTab=hosting"
                />,
                <Metric
                  key="overdue"
                  label="Overdue balance"
                  value={formatMoney(billingSnapshot.overdue_cents, currency)}
                  hint={
                    billingSnapshot.overdue_client_count > 0
                      ? `${billingSnapshot.overdue_client_count} client${billingSnapshot.overdue_client_count === 1 ? "" : "s"}`
                      : "No clients overdue"
                  }
                  href="/dashboard/clients?tab=revenue&revenueTab=upcoming"
                />,
              ]}
        </MetricGrid>
      )}

      {/* Needs attention — one card per client, grouping every overdue
          payment and their required-tasks-outstanding count together
          (see buildAttentionCards). Each row's own small
          AttentionIndicator dot shows the same underlying signal for a
          different purpose (spot it in place while browsing the list,
          vs. scan the whole workspace here) — neither is a redundant
          copy of the other's UI. */}
      {!clients ? <AttentionCardsSkeleton /> : <AttentionCards cards={attentionCards} projects={projects} />}

      {showAdd && (
        <form onSubmit={handleCreate} className="mt-6 flex max-w-2xl flex-wrap items-end gap-2 rounded-md border border-border p-4">
          <div className="w-full text-xs text-fg-muted">
            For a client with no lead to convert — a referral, or a deal made outside the pipeline.
          </div>
          <input
            required
            placeholder="Business name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="input flex-1"
          />
          <input
            placeholder="Billing email (optional)"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            className="input flex-1"
          />
          <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
            {saving ? "Saving…" : "Save client"}
          </button>
        </form>
      )}

      {/* Search + filters, directly above the list, with the one primary
          action (Add Client) aligned alongside rather than under a
          redundant second "Clients" heading. */}
      {clients && clients.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-56"
          />
          <select
            value={statusFilter}
            onChange={(e) => {
              const next = e.target.value as ClientTone | "";
              setStatusFilter(next);
              updateParam("clientStatus", next || null);
            }}
            className="input w-auto"
            aria-label="Filter by status"
          >
            <option value="">Any status</option>
            {(Object.keys(CLIENT_STATUS_LABEL) as ClientTone[]).map((tone) => (
              <option key={tone} value={tone}>
                {CLIENT_STATUS_LABEL[tone]}
              </option>
            ))}
          </select>
          <select
            value={hostingFilter}
            onChange={(e) => {
              const next = e.target.value as OverviewFilters["hosting"];
              setHostingFilter(next);
              updateParam("hosting", next || null);
            }}
            className="input w-auto"
            aria-label="Filter by hosting"
          >
            <option value="">Any hosting</option>
            <option value="active">Active hosting</option>
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => {
              const next = e.target.value as OverviewFilters["payment"];
              setPaymentFilter(next);
              updateParam("payment", next || null);
            }}
            className="input w-auto"
            aria-label="Filter by payment status"
          >
            <option value="">Any payment status</option>
            <option value="overdue">Overdue payment</option>
          </select>
          <select
            value={attentionFilter}
            onChange={(e) => {
              const next = e.target.value as OverviewFilters["attention"];
              setAttentionFilter(next);
              updateParam("attention", next || null);
            }}
            className="input w-auto"
            aria-label="Filter by tasks needing attention"
          >
            <option value="">Any tasks</option>
            <option value="required_tasks">Required tasks outstanding</option>
          </select>
          <select
            value={assigneeFilter}
            onChange={(e) => {
              setAssigneeFilter(e.target.value);
              updateParam("assignee", e.target.value || null);
            }}
            className="input w-auto"
            aria-label="Filter by assignee"
          >
            <option value="">Anyone assigned</option>
            <option value={UNASSIGNED}>Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="text-sm text-fg-muted hover:text-fg hover:underline">
              Clear filters
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Table-only controls — mobile always uses the card list below, where column visibility and density don't apply. */}
            <span className="hidden items-center gap-2 sm:flex">
              <ColumnsMenu columns={columns} onChange={setColumns} />
              <DensityToggle density={density} onChange={setDensity} />
            </span>
            <button onClick={() => setShowAdd((v) => !v)} className="btn btn-primary btn-sm">
              {showAdd ? "Cancel" : "+ Add Client"}
            </button>
          </div>
        </div>
      )}

      {clients && clients.length > 0 && visibleRows && (
        <p className="mt-2 text-xs text-fg-muted">
          {visibleRows.length} of {clients.length} client{clients.length === 1 ? "" : "s"}
        </p>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!clients && !error && (
        <div className="mt-4">
          <TableSkeleton rows={6} cols={6} />
        </div>
      )}

      {clients && clients.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No clients yet"
            description="Once you add your first client — or convert a won lead — they'll appear here."
            action={
              <button onClick={() => setShowAdd(true)} className="btn btn-primary">
                + Add Client
              </button>
            }
          />
        </div>
      )}

      {visibleRows && clients && clients.length > 0 && visibleRows.length === 0 && (
        <div className="mt-4">
          <EmptyState title="No clients found" description="Try adjusting your search or filters." action={
            <button onClick={clearFilters} className="btn btn-secondary btn-sm">
              Clear filters
            </button>
          } />
        </div>
      )}

      {visibleRows && visibleRows.length > 0 && (
        <>
          <div className="table-shell mt-3 hidden sm:block">
            <table className="table">
              <thead>
                <tr>
                  {/* Header padding tracks the same density as the body
                      rows below (py-1.5/py-2.5) — previously fixed at
                      py-2 regardless of density, so Compact rows visibly
                      out-tightened their own header. */}
                  <th className={`sticky left-0 z-10 bg-surface-subtle px-3 ${headerPadY}`}>Client</th>
                  {columns.websites && <th className={`px-3 ${headerPadY}`}>Websites</th>}
                  {columns.hosting && <th className={`px-3 ${headerPadY}`}>Hosting</th>}
                  {columns.nextPayment && <th className={`px-3 ${headerPadY}`}>Next payment</th>}
                  {columns.nextTask && <th className={`px-3 ${headerPadY}`}>Next task</th>}
                  <th className={`px-3 ${headerPadY}`}></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <ClientTableRow
                    key={row.client.id}
                    row={row}
                    currency={currency}
                    density={density}
                    columns={columns}
                    isPreviewOpen={previewId === row.client.id}
                    onOpenPreview={() => openPreview(row.client.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 space-y-2 sm:hidden">
            {visibleRows.map((row) => (
              <ClientMobileCard
                key={row.client.id}
                row={row}
                currency={currency}
                onOpenPreview={() => openPreview(row.client.id)}
              />
            ))}
          </div>
        </>
      )}

      {previewRow && <ClientPreviewPanel row={previewRow} currency={currency} onClose={closePreview} />}
    </div>
  );
}
