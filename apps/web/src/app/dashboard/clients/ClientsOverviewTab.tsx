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
import { nextOpenTask } from "@/lib/projects";
import { withParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ClientCard, ClientCardSkeleton } from "./ClientCard";
import { ClientPreviewPanel } from "./ClientPreviewPanel";
import type { EnrichedClient } from "./ClientRowFields";

type ClientView = "all" | "attention";
type SortBy = "recent" | "name" | "payment";

const SORT_LABEL: Record<SortBy, string> = {
  recent: "Most recent activity",
  name: "Business name (A–Z)",
  payment: "Next payment date",
};

/** Segmented "All clients / Needs attention" switch — filters the one
 * client grid below rather than adding a second render of the same
 * clients, so a client can never appear twice in the current results. */
function ViewSwitch({ active, onChange }: { active: ClientView; onChange: (next: ClientView) => void }) {
  return (
    <div className="flex rounded-md border border-border-strong p-0.5 text-sm" role="group" aria-label="Client view">
      <button
        type="button"
        onClick={() => onChange("all")}
        aria-current={active === "all" ? "true" : undefined}
        className={`rounded px-2 py-1 ${active === "all" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
      >
        All clients
      </button>
      <button
        type="button"
        onClick={() => onChange("attention")}
        aria-current={active === "attention" ? "true" : undefined}
        className={`rounded px-2 py-1 ${active === "attention" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
      >
        Needs attention
      </button>
    </div>
  );
}

/** Secondary filters, sort, and assignee — kept out of the main toolbar
 * row so the primary controls (search, view switch, Add Client) stay
 * aligned and uncluttered. Client has no archive concept anywhere in
 * this codebase (no `archived_at`, no archive endpoint), so unlike
 * Leads/Planning this panel has nothing to show for "archived" — every
 * client `listClients()` returns is already the complete, current set. */
function MoreFiltersMenu({
  statusFilter,
  onStatusChange,
  hostingFilter,
  onHostingChange,
  paymentFilter,
  onPaymentChange,
  attentionFilter,
  onAttentionChange,
  assigneeFilter,
  onAssigneeChange,
  users,
  sortBy,
  onSortChange,
  activeCount,
  onClear,
}: {
  statusFilter: ClientTone | "";
  onStatusChange: (v: ClientTone | "") => void;
  hostingFilter: OverviewFilters["hosting"];
  onHostingChange: (v: OverviewFilters["hosting"]) => void;
  paymentFilter: OverviewFilters["payment"];
  onPaymentChange: (v: OverviewFilters["payment"]) => void;
  attentionFilter: OverviewFilters["attention"];
  onAttentionChange: (v: OverviewFilters["attention"]) => void;
  assigneeFilter: string;
  onAssigneeChange: (v: string) => void;
  users: User[];
  sortBy: SortBy;
  onSortChange: (v: SortBy) => void;
  activeCount: number;
  onClear: () => void;
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
        More filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-border bg-surface p-3 shadow-lg">
            <div className="space-y-2.5">
              <label className="block text-xs text-fg-muted">
                Status
                <Select
                  value={statusFilter}
                  onChange={(e) => onStatusChange(e.target.value as ClientTone | "")}
                  className="input mt-1 w-full"
                >
                  <option value="">Any status</option>
                  {(Object.keys(CLIENT_STATUS_LABEL) as ClientTone[]).map((t) => (
                    <option key={t} value={t}>
                      {CLIENT_STATUS_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-xs text-fg-muted">
                Hosting
                <Select
                  value={hostingFilter}
                  onChange={(e) => onHostingChange(e.target.value as OverviewFilters["hosting"])}
                  className="input mt-1 w-full"
                >
                  <option value="">Any hosting</option>
                  <option value="active">Active hosting</option>
                </Select>
              </label>
              <label className="block text-xs text-fg-muted">
                Payment status
                <Select
                  value={paymentFilter}
                  onChange={(e) => onPaymentChange(e.target.value as OverviewFilters["payment"])}
                  className="input mt-1 w-full"
                >
                  <option value="">Any payment status</option>
                  <option value="overdue">Overdue payment</option>
                </Select>
              </label>
              <label className="block text-xs text-fg-muted">
                Tasks
                <Select
                  value={attentionFilter}
                  onChange={(e) => onAttentionChange(e.target.value as OverviewFilters["attention"])}
                  className="input mt-1 w-full"
                >
                  <option value="">Any tasks</option>
                  <option value="required_tasks">Required tasks outstanding</option>
                </Select>
              </label>
              <label className="block text-xs text-fg-muted">
                Assigned to
                <Select value={assigneeFilter} onChange={(e) => onAssigneeChange(e.target.value)} className="input mt-1 w-full">
                  <option value="">Anyone assigned</option>
                  <option value={UNASSIGNED}>Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-xs text-fg-muted">
                Sort by
                <Select value={sortBy} onChange={(e) => onSortChange(e.target.value as SortBy)} className="input mt-1 w-full">
                  {(Object.keys(SORT_LABEL) as SortBy[]).map((s) => (
                    <option key={s} value={s}>
                      {SORT_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="mt-3 block w-full rounded px-1 py-1 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                Clear filters
              </button>
            )}
          </div>
        </>
      )}
    </span>
  );
}

export function ClientsOverviewTab({ currency }: { currency: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [clients, setClients] = useState<Client[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [hostingPlans, setHostingPlans] = useState<RevenueHostingPlan[]>([]);
  const [obligations, setObligations] = useState<NextPaymentObligation[]>([]);
  const [checklistSummaries, setChecklistSummaries] = useState<ClientChecklistSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<ClientTone | "">("");
  const [hostingFilter, setHostingFilter] = useState<OverviewFilters["hosting"]>("");
  const [paymentFilter, setPaymentFilter] = useState<OverviewFilters["payment"]>("");
  const [attentionFilter, setAttentionFilter] = useState<OverviewFilters["attention"]>("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [view, setViewState] = useState<ClientView>("all");
  const [sortBy, setSortByState] = useState<SortBy>("recent");

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
    setViewState(searchParams.get("view") === "attention" ? "attention" : "all");
    const sort = searchParams.get("sort");
    setSortByState(sort === "name" || sort === "payment" ? sort : "recent");
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function setView(next: ClientView) {
    updateParam("view", next === "attention" ? "attention" : null);
  }

  function setSortBy(next: SortBy) {
    updateParam("sort", next === "recent" ? null : next);
  }

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
  }

  useEffect(load, []);

  // Opening/closing the quick-preview panel is an overlay action, not a
  // different view of the grid — excluding `preview` from the scroll
  // key means the grid's scroll position survives a round trip through
  // "Open Client →" even when the preview happened to be open at the
  // moment of leaving.
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

  // Every overdue obligation + outstanding-required-task count, grouped
  // one card per client — the same "existing attention rules" data
  // source the old table's per-row indicator and the old separate
  // "Needs attention" row both already read from. Keyed by clientId so
  // it can be joined straight onto this grid's rows; a clientless
  // (prospect) project's own card has no Client row here to join onto,
  // so it's excluded rather than silently dropped elsewhere.
  const attentionCards = useMemo(
    () => buildAttentionCards(obligations.filter((o) => o.is_overdue), checklistSummaries, clients ?? []),
    [obligations, checklistSummaries, clients],
  );
  const attentionByClientId = useMemo(
    () => new Map(attentionCards.filter((c) => c.clientId).map((c) => [c.clientId as string, c])),
    [attentionCards],
  );
  const attentionClientCount = attentionByClientId.size;

  const activeFilterCount = [statusFilter, hostingFilter, paymentFilter, attentionFilter, assigneeFilter, sortBy !== "recent"].filter(
    Boolean,
  ).length;

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setHostingFilter("");
    setPaymentFilter("");
    setAttentionFilter("");
    setAssigneeFilter("");
    setSortByState("recent");
    // Clearing filters is about the *filters*, not the view switch or
    // display preferences — `view`/`preview` (if a panel happens to be
    // open) are preserved too, only the filter/search/sort params go.
    let query = searchParams.toString();
    for (const key of ["search", "clientStatus", "hosting", "payment", "attention", "assignee", "sort"]) {
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
      .filter((row) => view !== "attention" || attentionByClientId.has(row.client.id))
      .sort((a, b) => {
        if (sortBy === "name") return a.client.business_name.localeCompare(b.client.business_name);
        if (sortBy === "payment") {
          const aDate = a.nextPayment?.due_date ?? "9999";
          const bDate = b.nextPayment?.due_date ?? "9999";
          return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
        }
        const aKey = a.lastActivity ?? a.client.created_at;
        const bKey = b.lastActivity ?? b.client.created_at;
        return aKey < bKey ? 1 : -1;
      });
  }, [clients, rows, search, assigneeFilter, statusFilter, hostingFilter, paymentFilter, attentionFilter, view, attentionByClientId, sortBy]);

  // A client can vanish from the current result set between the preview
  // being opened and this render (a filter change, a reload racing a
  // deletion elsewhere) — look it up defensively and simply don't render
  // the panel if it's gone, rather than crashing on a stale reference.
  const previewRow = previewId ? (rows.find((r) => r.client.id === previewId) ?? null) : null;

  return (
    <div>
      {/* Compact summary — one restrained line, not a grid of tiles.
          Detailed financial totals (expected revenue, overdue balance)
          live on the Revenue tab, not duplicated here. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {!clients ? (
          <>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-36" />
          </>
        ) : (
          <>
            <Link href={`${pathname}?${withParam(searchParams, "clientStatus", "active")}`} className="text-fg-muted hover:text-fg hover:underline">
              <span className="font-semibold tabular-nums text-fg">{activeClientCount}</span> active client
              {activeClientCount === 1 ? "" : "s"}
            </Link>
            <span className="text-fg-subtle" aria-hidden="true">
              ·
            </span>
            <Link href="/dashboard/clients?tab=websites" className="text-fg-muted hover:text-fg hover:underline">
              <span className="font-semibold tabular-nums text-fg">{liveWebsiteTotal}</span> live website
              {liveWebsiteTotal === 1 ? "" : "s"}
            </Link>
            <span className="text-fg-subtle" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              onClick={() => setView("attention")}
              className={`hover:underline ${attentionClientCount > 0 ? "text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300" : "text-fg-muted hover:text-fg"}`}
            >
              <span className="font-semibold tabular-nums">{attentionClientCount}</span> client
              {attentionClientCount === 1 ? "" : "s"} needing attention
            </button>
          </>
        )}
      </div>

      {showAdd && (
        <form onSubmit={handleCreate} className="mt-6 flex max-w-2xl flex-wrap items-end gap-2 rounded-md border border-border p-4">
          <div className="w-full text-xs text-fg-muted">
            For a client with no lead to convert — a referral, or a deal made outside the pipeline.
          </div>
          <Input
            required
            placeholder="Business name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="input flex-1"
          />
          <Input
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

      {/* One toolbar: search, the All clients/Needs attention switch,
          More filters, and Add Client — aligned in a single row, no
          second filter bar underneath. */}
      {clients && clients.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-56"
          />
          <ViewSwitch active={view} onChange={setView} />
          <MoreFiltersMenu
            statusFilter={statusFilter}
            onStatusChange={(v) => {
              setStatusFilter(v);
              updateParam("clientStatus", v || null);
            }}
            hostingFilter={hostingFilter}
            onHostingChange={(v) => {
              setHostingFilter(v);
              updateParam("hosting", v || null);
            }}
            paymentFilter={paymentFilter}
            onPaymentChange={(v) => {
              setPaymentFilter(v);
              updateParam("payment", v || null);
            }}
            attentionFilter={attentionFilter}
            onAttentionChange={(v) => {
              setAttentionFilter(v);
              updateParam("attention", v || null);
            }}
            assigneeFilter={assigneeFilter}
            onAssigneeChange={(v) => {
              setAssigneeFilter(v);
              updateParam("assignee", v || null);
            }}
            users={users}
            sortBy={sortBy}
            onSortChange={setSortBy}
            activeCount={activeFilterCount}
            onClear={clearFilters}
          />
          {(search || activeFilterCount > 0) && (
            <button onClick={clearFilters} className="text-sm text-fg-muted hover:text-fg hover:underline">
              Clear filters
            </button>
          )}

          <button onClick={() => setShowAdd((v) => !v)} className="btn btn-primary btn-sm ml-auto">
            {showAdd ? "Cancel" : "+ Add Client"}
          </button>
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
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ClientCardSkeleton key={i} />
          ))}
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

      {visibleRows && clients && clients.length > 0 && visibleRows.length === 0 && view === "attention" && (
        <div className="mt-4">
          <EmptyState
            title="No clients need attention"
            description="Every client is caught up — no overdue payments or outstanding required tasks right now."
            action={
              (search || activeFilterCount > 0) && (
                <button onClick={clearFilters} className="btn btn-secondary btn-sm">
                  Clear filters
                </button>
              )
            }
          />
        </div>
      )}

      {visibleRows && clients && clients.length > 0 && visibleRows.length === 0 && view === "all" && (
        <div className="mt-4">
          <EmptyState
            title="No clients found"
            description="Try adjusting your search or filters."
            action={
              <button onClick={clearFilters} className="btn btn-secondary btn-sm">
                Clear filters
              </button>
            }
          />
        </div>
      )}

      {visibleRows && visibleRows.length > 0 && (
        <div className="animate-fade-in mt-3 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {visibleRows.map((row) => {
            const card = attentionByClientId.get(row.client.id);
            const issueCount = card ? card.payments.length + (card.requiredTasksOutstanding > 0 ? 1 : 0) : 0;
            return (
              <ClientCard
                key={row.client.id}
                row={row}
                currency={currency}
                issueCount={issueCount}
                isPreviewOpen={previewId === row.client.id}
                onOpenPreview={() => openPreview(row.client.id)}
              />
            );
          })}
        </div>
      )}

      {previewRow && <ClientPreviewPanel row={previewRow} currency={currency} onClose={closePreview} />}
    </div>
  );
}
