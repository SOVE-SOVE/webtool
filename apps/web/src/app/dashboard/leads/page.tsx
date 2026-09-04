"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  LEAD_PRIORITIES,
  type Lead,
  type LeadPriority,
  type LeadStatus,
  type PipelineStage,
  type User,
} from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { LeadsBoard } from "@/components/LeadsBoard";
import {
  isLeadTab,
  LEAD_TABS,
  leadMatchesTab,
  leadNextAction,
  type LeadTab,
} from "@/lib/leads";

type ViewMode = "table" | "board";
type WebsiteFilter = "" | "has" | "none";

function nextFollowUpByLead(
  buckets:
    | {
        overdue: { lead_id: string; due_date: string }[];
        due_today: { lead_id: string; due_date: string }[];
        upcoming: { lead_id: string; due_date: string }[];
      }
    | null,
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
  const [stages, setStages] = useState<PipelineStage[] | null>(null);
  const [followUpMap, setFollowUpMap] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<LeadTab>("all");
  const [view, setView] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [websiteFilter, setWebsiteFilter] = useState<WebsiteFilter>("");
  const [showArchived, setShowArchived] = useState(false);

  // Manual entry — the secondary path. Discovery → approve is how leads
  // normally arrive; these forms stay available but tucked away.
  const [showAdd, setShowAdd] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [suburb, setSuburb] = useState("");
  const [state, setState] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState<LeadPriority | "">("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [saving, setSaving] = useState(false);

  const [clientBusinessName, setClientBusinessName] = useState("");
  const [clientBillingEmail, setClientBillingEmail] = useState("");
  const [savingClient, setSavingClient] = useState(false);

  function load() {
    api
      .listLeads({ includeArchived: showArchived })
      .then((rows) => {
        setError(null);
        setLeads(rows);
      })
      .catch(() => setError("Couldn't load leads."));
    api.listUsers().then(setUsers).catch(() => {});
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
    if (params.has("new")) setShowAdd(true);
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
      setShowAdd(false);
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
      setShowAdd(false);
      load();
    } catch {
      setError("Couldn't add that client.");
    } finally {
      setSavingClient(false);
    }
  }

  // Also the board's drag-to-restage handler.
  async function handleStatusChange(id: string, status: LeadStatus) {
    await api.updateLead(id, { status });
    load();
  }

  const filteredLeads = useMemo(() => {
    if (!leads) return null;
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (view === "table" && !leadMatchesTab(lead, tab)) return false;
      if (websiteFilter === "has" && !lead.website_url) return false;
      if (websiteFilter === "none" && lead.website_url) return false;
      if (!q) return true;
      return [lead.business_name, lead.industry, lead.suburb, lead.source, lead.notes, lead.business_email]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q));
    });
  }, [leads, view, tab, search, websiteFilter]);

  const visibleLeads = useMemo(() => {
    if (!filteredLeads) return null;
    return [...filteredLeads].sort((a, b) => {
      // Archived sink to the bottom; otherwise most recently touched first.
      if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [filteredLeads]);

  const boardLeads = useMemo(
    () => (filteredLeads ?? []).filter((l) => !l.archived_at),
    [filteredLeads],
  );

  const tabCounts = useMemo(() => {
    const counts = new Map<LeadTab, number>();
    for (const t of LEAD_TABS) {
      counts.set(
        t.id,
        (leads ?? []).filter((l) => !l.archived_at && leadMatchesTab(l, t.id)).length,
      );
    }
    return counts;
  }, [leads]);

  const viewToggle = (
    <div className="flex rounded-md border border-border-strong p-0.5 text-sm">
      <button
        onClick={() => setView("table")}
        className={`rounded px-2 py-1 ${view === "table" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
      >
        List
      </button>
      <button
        onClick={() => setView("board")}
        className={`rounded px-2 py-1 ${view === "board" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
      >
        Board
      </button>
    </div>
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Leads"
        description="The businesses you're pursuing — where each one is, and what to do next. New leads arrive automatically when you approve a business in Discovery."
        actions={viewToggle}
      />

      {/* Controls: search + status + website + archived (list view only) */}
      {view === "table" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            placeholder="Search business, industry, suburb, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <select
            value={tab}
            onChange={(e) => setTab(e.target.value as LeadTab)}
            className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
            aria-label="Filter by status"
          >
            {LEAD_TABS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({tabCounts.get(t.id) ?? 0})
              </option>
            ))}
          </select>
          <select
            value={websiteFilter}
            onChange={(e) => setWebsiteFilter(e.target.value as WebsiteFilter)}
            className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
            aria-label="Filter by website"
          >
            <option value="">Any website</option>
            <option value="has">Has a website</option>
            <option value="none">No website</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-fg-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!leads && !error && (
        <div className="mt-4">
          <TableSkeleton rows={6} cols={5} />
        </div>
      )}

      {leads && leads.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No leads yet"
            description="Run a Discovery search and approve a business — it becomes a lead here automatically. Or add one by hand below."
            action={
              <Link href="/dashboard/discovery" className="btn btn-primary">
                Go to Discovery
              </Link>
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

      {/* List view — empty after filtering */}
      {view === "table" && visibleLeads && leads && leads.length > 0 && visibleLeads.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No leads match"
            description="Try a different status, search, or clear the filters above."
            action={
              <button
                onClick={() => {
                  setSearch("");
                  setWebsiteFilter("");
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
              <Link
                key={lead.id}
                href={`/dashboard/leads/${lead.id}`}
                className={`card block p-3 ${lead.archived_at ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-fg">{lead.business_name}</div>
                    <div className="text-xs text-fg-muted">
                      {[lead.industry, [lead.suburb, lead.state].filter(Boolean).join(", ")]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </div>
                  <LeadStatusBadge status={lead.status} className="shrink-0" />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
                  <span>{lead.website_url ? "Has a website" : "No website"}</span>
                  <span className="text-fg">{leadNextAction(lead, followUpMap.get(lead.id))}</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="table-shell mt-4 hidden md:block">
            <table className="table">
              <thead>
                <tr>
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">Website</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Next</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleLeads.map((lead) => (
                  <tr key={lead.id} className={lead.archived_at ? "opacity-50" : undefined}>
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/leads/${lead.id}`} className="font-medium text-fg hover:underline">
                        {lead.business_name}
                      </Link>
                      <div className="max-w-[260px] truncate text-xs text-fg-muted">
                        {[lead.industry, [lead.suburb, lead.state].filter(Boolean).join(", ")]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm text-fg-muted">
                      {lead.website_url ? "Has a website" : "No website"}
                    </td>
                    <td className="px-3 py-2">
                      <LeadStatusBadge status={lead.status} />
                    </td>
                    <td className="px-3 py-2 text-sm text-fg">
                      {leadNextAction(lead, followUpMap.get(lead.id))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/dashboard/leads/${lead.id}`}
                        className="text-sm font-medium text-fg hover:underline"
                      >
                        Open lead →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Manual entry — secondary */}
      <div className="mt-6">
        <button onClick={() => setShowAdd((v) => !v)} className="btn btn-ghost btn-sm">
          {showAdd ? "Cancel" : "Add a lead manually"}
        </button>

        {showAdd && (
          <div className="mt-3 max-w-2xl space-y-4">
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 border border-border p-4 sm:grid-cols-2">
              <input required placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm sm:col-span-2" />
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

            <form onSubmit={handleCreateClient} className="flex flex-wrap items-end gap-2 border border-border p-4">
              <div className="w-full text-xs text-fg-muted">Already signed, no lead to track? Add the client directly.</div>
              <input required placeholder="Business name" value={clientBusinessName} onChange={(e) => setClientBusinessName(e.target.value)} className="flex-1 rounded-md border border-border-strong px-3 py-1.5 text-sm" />
              <input placeholder="Billing email (optional)" value={clientBillingEmail} onChange={(e) => setClientBillingEmail(e.target.value)} className="flex-1 rounded-md border border-border-strong px-3 py-1.5 text-sm" />
              <button type="submit" disabled={savingClient} className="btn btn-secondary btn-sm">
                {savingClient ? "Saving…" : "Add client"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
