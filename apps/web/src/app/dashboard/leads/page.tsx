"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  PROJECT_STAGE_LABELS,
  type Client,
  type Lead,
  type LeadPriority,
  type LeadStatus,
  type PipelineStage,
  type Project,
  type User,
} from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { LeadsBoard } from "@/components/LeadsBoard";
import { FINISHED_STAGES } from "@/lib/filters";
import { countLeadsByTab, isLeadTab, LEAD_TABS, leadMatchesTab, type LeadTab } from "@/lib/leads";

type SortKey = "business_name" | "status" | "score" | "priority" | "updated_at";
type SortDir = "asc" | "desc";
type ViewMode = "table" | "board";

const PRIORITY_ORDER: Record<LeadPriority, number> = { low: 0, medium: 1, high: 2 };

function nextFollowUpByLead(
  buckets: { overdue: { lead_id: string; due_date: string }[]; due_today: { lead_id: string; due_date: string }[]; upcoming: { lead_id: string; due_date: string }[] } | null,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!buckets) return map;
  for (const f of [...buckets.overdue, ...buckets.due_today, ...buckets.upcoming]) {
    const cur = map.get(f.lead_id);
    if (!cur || f.due_date < cur) map.set(f.lead_id, f.due_date);
  }
  return map;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stages, setStages] = useState<PipelineStage[] | null>(null);
  const [followUpMap, setFollowUpMap] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<LeadTab>("all");
  const [view, setView] = useState<ViewMode>("table");

  const [showForm, setShowForm] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [suburb, setSuburb] = useState("");
  const [state, setState] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState<LeadPriority | "">("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [saving, setSaving] = useState(false);

  // "Add client without a lead" — the referral path that used to live on
  // the standalone Clients page. Kept here on the Won tab.
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientBusinessName, setClientBusinessName] = useState("");
  const [clientBillingEmail, setClientBillingEmail] = useState("");
  const [savingClient, setSavingClient] = useState(false);

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<LeadPriority | "">("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function load() {
    api
      .listLeads({ includeArchived: showArchived })
      .then((rows) => {
        setError(null);
        setLeads(rows);
      })
      .catch(() => setError("Couldn't load leads."));
    api.listUsers().then(setUsers).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
    api.listProjects().then(setProjects).catch(() => {});
    api.listPipelineStages().then(setStages).catch(() => {});
    api.listFollowUps().then((b) => setFollowUpMap(nextFollowUpByLead(b))).catch(() => {});
  }

  useEffect(load, [showArchived]);

  // View/tab can be deep-linked (?view=board from the old Pipeline route,
  // ?tab=won from the old Clients route, ?new=1 from a quick action).
  // Deferred to an effect so SSR markup matches the first client render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("new")) setShowForm(true);
    if (params.get("view") === "board") setView("board");
    const t = params.get("tab");
    if (isLeadTab(t)) setTab(t);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createLead({
        business_name: businessName,
        industry: industry || undefined,
        suburb: suburb || undefined,
        state: state || undefined,
        source: source || undefined,
        priority: priority || undefined,
        assigned_user_id: assignedUserId || undefined,
      });
      setBusinessName("");
      setIndustry("");
      setSuburb("");
      setState("");
      setSource("");
      setPriority("");
      setAssignedUserId("");
      setShowForm(false);
      load();
    } catch {
      setError("Couldn't create lead.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    setSavingClient(true);
    try {
      await api.createClient({
        business_name: clientBusinessName,
        billing_email: clientBillingEmail || undefined,
      });
      setClientBusinessName("");
      setClientBillingEmail("");
      setShowClientForm(false);
      load();
    } catch {
      setError("Couldn't add that client.");
    } finally {
      setSavingClient(false);
    }
  }

  async function handleStatusChange(id: string, status: LeadStatus) {
    await api.updateLead(id, { status });
    load();
  }
  async function handlePriorityChange(id: string, p: LeadPriority) {
    await api.updateLead(id, { priority: p });
    load();
  }
  async function handleScoreChange(id: string, score: string) {
    const parsed = score === "" ? undefined : Number(score);
    if (parsed !== undefined && Number.isNaN(parsed)) return;
    await api.updateLead(id, { score: parsed });
    load();
  }
  async function handleAssigneeChange(id: string, assigneeId: string) {
    await api.updateLead(id, { assigned_user_id: assigneeId || null });
    load();
  }
  async function handleArchiveToggle(lead: Lead) {
    if (lead.archived_at) await api.unarchiveLead(lead.id);
    else await api.archiveLead(lead.id);
    load();
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const clientByBusinessId = useMemo(
    () => new Map(clients.map((c) => [c.business_id, c])),
    [clients],
  );
  const projectsByClientId = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of projects) {
      const list = map.get(p.client_id) ?? [];
      list.push(p);
      map.set(p.client_id, list);
    }
    return map;
  }, [projects]);

  function conversionFor(lead: Lead): { client: Client; project: Project | null } | null {
    const client = clientByBusinessId.get(lead.business_id);
    if (!client) return null;
    const list = projectsByClientId.get(client.id) ?? [];
    const active = list.find((p) => !FINISHED_STAGES.includes(p.stage));
    const project =
      active ??
      [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ??
      null;
    return { client, project };
  }

  const tabCounts = useMemo(() => countLeadsByTab(leads ?? []), [leads]);

  const filteredLeads = useMemo(() => {
    if (!leads) return null;
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (view === "table" && !leadMatchesTab(lead, tab)) return false;
      if (priorityFilter && lead.priority !== priorityFilter) return false;
      if (assigneeFilter === "__unassigned__" && lead.assigned_user_id !== null) return false;
      if (assigneeFilter && assigneeFilter !== "__unassigned__" && lead.assigned_user_id !== assigneeFilter)
        return false;
      if (!q) return true;
      return [lead.business_name, lead.industry, lead.suburb, lead.source, lead.notes, lead.business_email]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q));
    });
  }, [leads, view, tab, search, priorityFilter, assigneeFilter]);

  const visibleLeads = useMemo(() => {
    if (!filteredLeads) return null;
    const sorted = [...filteredLeads].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "business_name":
          cmp = a.business_name.localeCompare(b.business_name);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "score":
          cmp = (a.score ?? -1) - (b.score ?? -1);
          break;
        case "priority":
          cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
          break;
        case "updated_at":
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredLeads, sortKey, sortDir]);

  const boardLeads = useMemo(
    () => (filteredLeads ?? []).filter((l) => !l.archived_at),
    [filteredLeads],
  );

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return null;
    return <span className="ml-1 text-fg-subtle">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }
  function sortableHeader(key: SortKey, label: string) {
    return (
      <th className="px-3 py-2">
        <button
          onClick={() => toggleSort(key)}
          className="flex items-center font-medium uppercase tracking-wide hover:text-fg"
        >
          {label}
          {sortIndicator(key)}
        </button>
      </th>
    );
  }

  const inputCls = "rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm";
  const cellSelect = "rounded-md border border-border-strong bg-surface px-2 py-1 text-sm";

  function ConversionCell({ lead }: { lead: Lead }) {
    const conv = conversionFor(lead);
    if (!conv) {
      return lead.status === "won" ? (
        <span className="text-xs text-fg-subtle">Not converted</span>
      ) : (
        <span className="text-fg-subtle">—</span>
      );
    }
    return (
      <div className="text-xs">
        <Link href={`/dashboard/clients/${conv.client.id}`} className="text-fg hover:underline">
          Client ↗
        </Link>
        {conv.project && (
          <>
            {" · "}
            <Link href={`/dashboard/projects/${conv.project.id}`} className="text-fg-muted hover:underline">
              {PROJECT_STAGE_LABELS[conv.project.stage]}
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Leads"
        description="Every business you're pursuing, from first contact through to a signed client and a live project."
        actions={
          <button onClick={() => setShowForm((v) => !v)} className="btn btn-primary">
            {showForm ? "Cancel" : "Add lead"}
          </button>
        }
      />

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 grid max-w-2xl grid-cols-1 gap-3 border border-border p-4 sm:grid-cols-2">
          <input required placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="col-span-1 rounded-md border border-border-strong px-3 py-1.5 text-sm sm:col-span-2" />
          <input placeholder="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm" />
          <input placeholder="Source" value={source} onChange={(e) => setSource(e.target.value)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm" />
          <input placeholder="Suburb" value={suburb} onChange={(e) => setSuburb(e.target.value)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm" />
          <input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm" />
          <select value={priority} onChange={(e) => setPriority(e.target.value as LeadPriority | "")} className="rounded-md border border-border-strong px-3 py-1.5 text-sm">
            <option value="">Medium priority</option>
            {LEAD_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm">
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button type="submit" disabled={saving} className="btn btn-primary sm:col-span-2">
            {saving ? "Saving…" : "Save lead"}
          </button>
        </form>
      )}

      {/* Lifecycle tabs (table view only) */}
      {view === "table" && (
        <div className="mt-4 flex flex-wrap gap-1 border-b border-border">
          {LEAD_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                tab === t.id
                  ? "border-fg font-medium text-fg"
                  : "border-transparent text-fg-muted hover:text-fg"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-fg-subtle">{tabCounts[t.id]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Controls: view toggle + filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border-strong p-0.5 text-sm">
          <button
            onClick={() => setView("table")}
            className={`rounded px-2 py-1 ${view === "table" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
          >
            Table
          </button>
          <button
            onClick={() => setView("board")}
            className={`rounded px-2 py-1 ${view === "board" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
          >
            Board
          </button>
        </div>
        <input
          placeholder="Search business, industry, suburb, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-border-strong px-3 py-1.5 text-sm"
        />
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as LeadPriority | "")} className={inputCls}>
          <option value="">All priorities</option>
          {LEAD_PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className={inputCls}>
          <option value="">Anyone assigned</option>
          <option value="__unassigned__">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        {view === "table" && (
          <label className="flex items-center gap-1.5 text-sm text-fg-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        )}
        {view === "table" && tab === "won" && (
          <button onClick={() => setShowClientForm((v) => !v)} className="ml-auto text-xs text-fg-muted hover:text-fg hover:underline">
            {showClientForm ? "Cancel" : "Add client without a lead"}
          </button>
        )}
      </div>

      {showClientForm && (
        <form onSubmit={handleCreateClient} className="mt-3 flex max-w-xl flex-wrap items-end gap-2 border border-border p-3">
          <input required placeholder="Business name" value={clientBusinessName} onChange={(e) => setClientBusinessName(e.target.value)} className="flex-1 rounded-md border border-border-strong px-3 py-1.5 text-sm" />
          <input placeholder="Billing email (optional)" value={clientBillingEmail} onChange={(e) => setClientBillingEmail(e.target.value)} className="flex-1 rounded-md border border-border-strong px-3 py-1.5 text-sm" />
          <button type="submit" disabled={savingClient} className="btn btn-primary btn-sm">
            {savingClient ? "Saving…" : "Add client"}
          </button>
        </form>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!leads && !error && (
        <div className="mt-4">
          <TableSkeleton rows={6} cols={7} />
        </div>
      )}

      {leads && leads.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No leads yet"
            description="Add your first lead, or run a Discovery search to find businesses to reach out to."
            action={
              <button onClick={() => setShowForm(true)} className="btn btn-primary">
                Add lead
              </button>
            }
          />
        </div>
      )}

      {/* Board view */}
      {view === "board" && leads && leads.length > 0 && (
        <div className="mt-4">
          {stages === null ? (
            <div className="flex gap-3 overflow-x-auto pb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex w-64 shrink-0 flex-col gap-2 rounded-md border border-border p-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ))}
            </div>
          ) : (
            <LeadsBoard leads={boardLeads} stages={stages} onMove={handleStatusChange} />
          )}
        </div>
      )}

      {/* Table view */}
      {view === "table" && visibleLeads && leads && leads.length > 0 && visibleLeads.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No leads match"
            description="Try a different tab, search, or clear the filters above."
            action={
              <button
                onClick={() => {
                  setSearch("");
                  setPriorityFilter("");
                  setAssigneeFilter("");
                  setTab("all");
                }}
                className="btn btn-secondary btn-sm"
              >
                Clear filters
              </button>
            }
          />
        </div>
      )}

      {view === "table" && visibleLeads && visibleLeads.length > 0 && (
        <>
          {/* Mobile cards */}
          <div className="mt-4 space-y-2 md:hidden">
            {visibleLeads.map((lead) => (
              <div key={lead.id} className={`card p-3 ${lead.archived_at ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/dashboard/leads/${lead.id}`} className="font-medium text-fg hover:underline">
                      {lead.business_name}
                    </Link>
                    <div className="text-xs text-fg-muted">
                      {[lead.industry, lead.business_email ?? lead.business_phone].filter(Boolean).join(" · ") || "—"}
                    </div>
                    {followUpMap.get(lead.id) && (
                      <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                        Follow up {new Date(followUpMap.get(lead.id)!).toLocaleDateString()}
                      </div>
                    )}
                    <div className="mt-0.5"><ConversionCell lead={lead} /></div>
                  </div>
                  <button
                    onClick={() => handleArchiveToggle(lead)}
                    className="shrink-0 text-xs text-fg-muted hover:text-fg hover:underline"
                  >
                    {lead.archived_at ? "Unarchive" : "Archive"}
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                  <select value={lead.status} onChange={(e) => handleStatusChange(lead.id, e.target.value as LeadStatus)} className="input">
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace("_", " ")}</option>
                    ))}
                  </select>
                  <select value={lead.priority} onChange={(e) => handlePriorityChange(lead.id, e.target.value as LeadPriority)} className="input">
                    {LEAD_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p} priority</option>
                    ))}
                  </select>
                  <select
                    value={lead.assigned_user_id ?? ""}
                    onChange={(e) => handleAssigneeChange(lead.id, e.target.value)}
                    className="input min-[420px]:col-span-2"
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="table-shell mt-4 hidden md:block">
            <table className="table">
              <thead>
                <tr>
                  {sortableHeader("business_name", "Business")}
                  {sortableHeader("status", "Status")}
                  {sortableHeader("score", "Score")}
                  {sortableHeader("priority", "Priority")}
                  <th className="px-3 py-2">Next follow-up</th>
                  <th className="px-3 py-2">Assigned to</th>
                  <th className="px-3 py-2">Client / project</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleLeads.map((lead) => {
                  const nextFollowUp = followUpMap.get(lead.id);
                  return (
                    <tr key={lead.id} className={lead.archived_at ? "opacity-50" : undefined}>
                      <td className="px-3 py-2">
                        <Link href={`/dashboard/leads/${lead.id}`} className="font-medium text-fg hover:underline">
                          {lead.business_name}
                        </Link>
                        <div className="max-w-[240px] truncate text-xs text-fg-muted">
                          {[lead.industry, [lead.suburb, lead.state].filter(Boolean).join(", ")]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <select value={lead.status} onChange={(e) => handleStatusChange(lead.id, e.target.value as LeadStatus)} className={cellSelect}>
                          {LEAD_STATUSES.map((s) => (
                            <option key={s} value={s}>{s.replace("_", " ")}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          defaultValue={lead.score ?? ""}
                          onBlur={(e) => handleScoreChange(lead.id, e.target.value)}
                          className="w-16 rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select value={lead.priority} onChange={(e) => handlePriorityChange(lead.id, e.target.value as LeadPriority)} className={cellSelect}>
                          {LEAD_PRIORITIES.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {nextFollowUp ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            {new Date(nextFollowUp).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={lead.assigned_user_id ?? ""}
                          onChange={(e) => handleAssigneeChange(lead.id, e.target.value)}
                          className={cellSelect}
                        >
                          <option value="">Unassigned</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <ConversionCell lead={lead} />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => handleArchiveToggle(lead)}
                          className="text-xs text-fg-muted hover:text-fg hover:underline"
                        >
                          {lead.archived_at ? "Unarchive" : "Archive"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
