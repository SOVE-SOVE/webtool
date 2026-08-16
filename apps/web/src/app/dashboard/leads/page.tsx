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
      .then(setLeads)
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
    return <span className="ml-1 text-neutral-400">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function sortableHeader(key: SortKey, label: string) {
    return (
      <th className="px-3 py-2">
        <button
          onClick={() => toggleSort(key)}
          className="flex items-center font-medium uppercase tracking-wide hover:text-neutral-900"
        >
          {label}
          {sortIndicator(key)}
        </button>
      </th>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Leads</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          {showForm ? "Cancel" : "Add lead"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 grid max-w-2xl grid-cols-2 gap-3 border border-neutral-200 p-4">
          <input
            required
            placeholder="Business name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="col-span-2 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Suburb"
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <input
            placeholder="State"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as LeadPriority | "")}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
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
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
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
            className="col-span-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
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
          className="w-72 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LeadStatus | "")}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
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
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
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
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">Anyone assigned</option>
          <option value="__unassigned__">Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {visibleLeads && (
        <table className="mt-4 w-full border border-neutral-200 text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
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
          <tbody className="divide-y divide-neutral-200">
            {visibleLeads.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-neutral-500">
                  No leads match.
                </td>
              </tr>
            )}
            {visibleLeads.map((lead) => (
              <tr key={lead.id} className={lead.archived_at ? "opacity-50" : undefined}>
                <td className="px-3 py-2">
                  <Link
                    href={`/dashboard/leads/${lead.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {lead.business_name}
                  </Link>
                  {lead.industry && <div className="text-xs text-neutral-500">{lead.industry}</div>}
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  {[lead.suburb, lead.state].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={lead.status}
                    onChange={(e) => handleStatusChange(lead.id, e.target.value as LeadStatus)}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
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
                    className="w-16 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={lead.priority}
                    onChange={(e) => handlePriorityChange(lead.id, e.target.value as LeadPriority)}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  >
                    {LEAD_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-neutral-600">{lead.source ?? "—"}</td>
                <td className="px-3 py-2">
                  <select
                    value={lead.assigned_user_id ?? ""}
                    onChange={(e) => handleAssigneeChange(lead.id, e.target.value)}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
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
                    className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
                  >
                    {lead.archived_at ? "Unarchive" : "Archive"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
