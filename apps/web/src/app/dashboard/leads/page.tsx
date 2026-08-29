"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  type Lead,
  type LeadPriority,
  type LeadStatus,
  type User,
} from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";

type SortKey = "business_name" | "status" | "score" | "priority" | "updated_at";
type SortDir = "asc" | "desc";

const PRIORITY_ORDER: Record<LeadPriority, number> = { low: 0, medium: 1, high: 2 };

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [suburb, setSuburb] = useState("");
  const [state, setState] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState<LeadPriority | "">("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "">("");
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
  }

  useEffect(load, [showArchived]);

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

  async function handleStatusChange(id: string, status: LeadStatus) {
    await api.updateLead(id, { status });
    load();
  }

  async function handlePriorityChange(id: string, priority: LeadPriority) {
    await api.updateLead(id, { priority });
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
    if (lead.archived_at) {
      await api.unarchiveLead(lead.id);
    } else {
      await api.archiveLead(lead.id);
    }
    load();
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const visibleLeads = useMemo(() => {
    if (!leads) return null;
    const q = search.trim().toLowerCase();
    const filtered = leads.filter((lead) => {
      if (statusFilter && lead.status !== statusFilter) return false;
      if (priorityFilter && lead.priority !== priorityFilter) return false;
      if (assigneeFilter === "__unassigned__" && lead.assigned_user_id !== null) return false;
      if (assigneeFilter && assigneeFilter !== "__unassigned__" && lead.assigned_user_id !== assigneeFilter)
        return false;
      if (!q) return true;
      return [lead.business_name, lead.industry, lead.suburb, lead.source, lead.notes]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q));
    });

    const sorted = [...filtered].sort((a, b) => {
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
  }, [leads, search, statusFilter, priorityFilter, assigneeFilter, sortKey, sortDir]);

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

  return (
    <div className="p-6">
      <PageHeader
        title="Leads"
        description="Every business you're pursuing, from first contact to a signed client."
        actions={
          <button onClick={() => setShowForm((v) => !v)} className="btn btn-primary">
            {showForm ? "Cancel" : "Add lead"}
          </button>
        }
      />

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 grid max-w-2xl grid-cols-1 sm:grid-cols-2 gap-3 border border-border p-4">
          <input
            required
            placeholder="Business name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="col-span-2 rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Suburb"
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <input
            placeholder="State"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as LeadPriority | "")}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          >
            <option value="">Medium priority</option>
            {LEAD_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={assignedUserId}
            onChange={(e) => setAssignedUserId(e.target.value)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving}
            className="col-span-2 btn btn-primary"
          >
            {saving ? "Saving…" : "Save lead"}
          </button>
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search business, industry, suburb, source, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-md border border-border-strong px-3 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LeadStatus | "")}
          className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as LeadPriority | "")}
          className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
        >
          <option value="">All priorities</option>
          {LEAD_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
        >
          <option value="">Anyone assigned</option>
          <option value="__unassigned__">Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

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

      {visibleLeads && leads && leads.length > 0 && visibleLeads.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No leads match"
            description="Try a different search or clear the filters above."
            action={
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("");
                  setPriorityFilter("");
                  setAssigneeFilter("");
                }}
                className="btn btn-secondary btn-sm"
              >
                Clear filters
              </button>
            }
          />
        </div>
      )}

      {visibleLeads && visibleLeads.length > 0 && (
        <>
          {/* Mobile: one card per lead, same actions as the table. */}
          <div className="mt-4 space-y-2 md:hidden">
            {visibleLeads.map((lead) => (
              <div
                key={lead.id}
                className={`card p-3 ${lead.archived_at ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/dashboard/leads/${lead.id}`} className="font-medium text-fg hover:underline">
                      {lead.business_name}
                    </Link>
                    <div className="text-xs text-fg-muted">
                      {[lead.industry, [lead.suburb, lead.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <button
                    onClick={() => handleArchiveToggle(lead)}
                    className="shrink-0 text-xs text-fg-muted hover:text-fg hover:underline"
                  >
                    {lead.archived_at ? "Unarchive" : "Archive"}
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    value={lead.status}
                    onChange={(e) => handleStatusChange(lead.id, e.target.value as LeadStatus)}
                    className="input"
                  >
                    {LEAD_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                  <select
                    value={lead.priority}
                    onChange={(e) => handlePriorityChange(lead.id, e.target.value as LeadPriority)}
                    className="input"
                  >
                    {LEAD_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p} priority
                      </option>
                    ))}
                  </select>
                  <select
                    value={lead.assigned_user_id ?? ""}
                    onChange={(e) => handleAssigneeChange(lead.id, e.target.value)}
                    className="input col-span-2"
                  >
                    <option value="">Unassigned</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop/tablet: full sortable table. */}
          <div className="table-shell mt-4 hidden md:block">
            <table className="table">
              <thead>
                <tr>
                  {sortableHeader("business_name", "Business")}
                  <th className="px-3 py-2">Location</th>
                  {sortableHeader("status", "Status")}
                  {sortableHeader("score", "Score")}
                  {sortableHeader("priority", "Priority")}
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Assigned to</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleLeads.map((lead) => (
                  <tr key={lead.id} className={lead.archived_at ? "opacity-50" : undefined}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/dashboard/leads/${lead.id}`}
                        className="font-medium text-fg hover:underline"
                      >
                        {lead.business_name}
                      </Link>
                      {lead.industry && <div className="text-xs text-fg-muted">{lead.industry}</div>}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {[lead.suburb, lead.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={lead.status}
                        onChange={(e) => handleStatusChange(lead.id, e.target.value as LeadStatus)}
                        className="rounded-md border border-border-strong px-2 py-1 text-sm"
                      >
                        {LEAD_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        defaultValue={lead.score ?? ""}
                        onBlur={(e) => handleScoreChange(lead.id, e.target.value)}
                        className="w-16 rounded-md border border-border-strong px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={lead.priority}
                        onChange={(e) => handlePriorityChange(lead.id, e.target.value as LeadPriority)}
                        className="rounded-md border border-border-strong px-2 py-1 text-sm"
                      >
                        {LEAD_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{lead.source ?? "—"}</td>
                    <td className="px-3 py-2">
                      <select
                        value={lead.assigned_user_id ?? ""}
                        onChange={(e) => handleAssigneeChange(lead.id, e.target.value)}
                        className="rounded-md border border-border-strong px-2 py-1 text-sm"
                      >
                        <option value="">Unassigned</option>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name}
                          </option>
                        ))}
                      </select>
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
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
