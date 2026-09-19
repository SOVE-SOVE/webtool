"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  api,
  LEAD_PRIORITIES,
  type ClientChecklistSummary,
  type Lead,
  type LeadPriority,
  type LeadStatus,
  type PipelineStage,
  type User,
} from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Metric } from "@/components/ui/Metric";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { SoftSwap } from "@/components/ui/SoftSwap";
import { useRecentChanges } from "@/lib/useRecentChanges";
import { useToast } from "@/components/ui/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { LeadPriorityBadge, LeadStatusBadge } from "@/components/LeadStatusBadge";
import { LeadsBoard } from "@/components/LeadsBoard";
import { LeadPreviewPanel } from "@/components/leads/LeadPreviewPanel";
import { withParam, withoutParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CommandBar } from "@/components/ui/CommandBar";
import { CompactSelect, SortSelect } from "@/components/ui/CompactSelect";
import { FilterChips, type FilterChip } from "@/components/ui/FilterChips";
import { FilterField, FilterPopover, FilterToggle } from "@/components/ui/FilterPopover";
import { SearchInput } from "@/components/ui/SearchInput";
import {
  isLeadTab,
  LEAD_SORT_LABEL,
  LEAD_SORTS,
  LEAD_TABS,
  leadMatchesTab,
  leadNextAction,
  type LeadSort,
  type LeadTab,
  sortLeads,
} from "@/lib/leads";

type ViewMode = "table" | "board";
type WebsiteFilter = "" | "has" | "none";
type PriorityFilter = "" | LeadPriority;

const PRIORITY_LABEL: Record<LeadPriority, string> = { low: "Low priority", medium: "Medium priority", high: "High priority" };

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

// This lead has an active Planning workspace — a relationship-status
// signal (still just a Lead) shown alongside, never instead of, its
// LeadStatusBadge (docs/05_DECISIONS.md: relationship status and
// website-development progress are tracked separately).
function InPlanningBadge() {
  return <Badge tone="info">In Planning</Badge>;
}

// A won lead with no client yet (client_id null) shows nothing here —
// today's plain "Convert to a client" next-action text already covers
// that case, so this stays quiet rather than showing an empty bar.
function ChecklistProgressCell({
  clientId,
  summary,
  className = "",
}: {
  clientId: string | null;
  summary: ClientChecklistSummary | undefined;
  className?: string;
}) {
  if (!clientId || !summary) return null;
  return (
    <Link href={`/dashboard/clients/${clientId}`} className={`block w-full ${className}`}>
      <ProgressBar value={summary.pct ?? 0} label={`${summary.completed} of ${summary.total} · ${summary.pct ?? 0}%`} />
    </Link>
  );
}

// One lead, as a compact grid card — replaces the old full-width table row.
// Every column from the former table (business/website/status/next/setup
// progress/open client/archive) is kept, just laid out densely instead of
// spread across a viewport-wide row. Mirrors the Clients page's ClientCard
// density (rounded-md border p-3, stacked fields, bordered footer row).
function LeadCard({
  lead,
  nextAction,
  checklistSummary,
  archivingId,
  onArchive,
  onRestore,
  onPreview,
  flash,
}: {
  flash?: boolean;
  lead: Lead;
  nextAction: string;
  checklistSummary: ClientChecklistSummary | undefined;
  archivingId: string | null;
  onArchive: (lead: Lead) => void;
  onRestore: (lead: Lead) => void;
  onPreview: (lead: Lead) => void;
}) {
  return (
    <div className={`card p-3 ${lead.archived_at ? "opacity-50" : ""} ${flash ? "row-flash" : ""}`}>
      <Link href={`/dashboard/leads/${lead.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{lead.business_name}</div>
            <div className="truncate text-xs text-fg-muted">
              {[lead.industry, [lead.suburb, lead.state].filter(Boolean).join(", ")]
                .filter(Boolean)
                .join(" · ") || "—"}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {lead.planning_id && <InPlanningBadge />}
            <LeadStatusBadge status={lead.status} />
            <LeadPriorityBadge priority={lead.priority} score={lead.score} />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
          <span>{lead.website_url ? "Has a website" : "No website"}</span>
          <span className="truncate text-fg">{nextAction}</span>
        </div>
      </Link>
      <ChecklistProgressCell clientId={lead.client_id} summary={checklistSummary} className="mt-2" />
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onPreview(lead)}
            title="Quick preview"
            className="text-xs text-fg-muted hover:text-fg hover:underline"
          >
            Preview
          </button>
          {lead.client_id && (
            <Link href={`/dashboard/clients/${lead.client_id}`} className="text-xs text-fg-muted hover:text-fg hover:underline">
              Open client →
            </Link>
          )}
        </span>
        {lead.archived_at ? (
          <button
            type="button"
            onClick={() => onRestore(lead)}
            disabled={archivingId === lead.id}
            className="text-xs font-medium text-fg hover:underline disabled:opacity-50"
          >
            {archivingId === lead.id ? "Restoring…" : "Restore"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onArchive(lead)}
            disabled={archivingId === lead.id}
            className="text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
          >
            {archivingId === lead.id ? "Archiving…" : "Archive"}
          </button>
        )}
      </div>
    </div>
  );
}

// useSearchParams() needs a Suspense-boundary ancestor for Next's static
// generation — see the default export below. It's also what makes the
// deep-linked state below correctly reset navigating between two
// query-variants of this same page (Leads <-> Clients) without a full
// remount, which a one-time mount effect reading window.location.search
// cannot do.
function LeadsPageInner() {
  const confirm = useConfirm();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [stages, setStages] = useState<PipelineStage[] | null>(null);
  const [followUpMap, setFollowUpMap] = useState<Map<string, string>>(new Map());
  const [checklistSummaries, setChecklistSummaries] = useState<Map<string, ClientChecklistSummary>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<LeadTab>("all");
  const [view, setView] = useState<ViewMode>("table");
  // Seeded once from the URL (safe here — this page is client-only
  // behind its own Suspense boundary) then only ever written back to
  // the URL one-directionally via useDebouncedUrlSync below, never
  // read back — avoids the URL "correcting" the field mid-keystroke.
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [websiteFilter, setWebsiteFilter] = useState<WebsiteFilter>("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("");
  const [sort, setSort] = useState<LeadSort>("updated");
  const [showArchived, setShowArchived] = useState(false);

  useDebouncedUrlSync("search", search);

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
    api
      .listChecklistSummaries()
      .then((rows) => setChecklistSummaries(new Map(rows.map((r) => [r.client_id, r]))))
      .catch(() => {});
    api.listFollowUps().then((b) => setFollowUpMap(nextFollowUpByLead(b))).catch(() => {});
  }

  useEffect(load, [showArchived]);

  // View/tab can be deep-linked (?view=board from the Pipeline route,
  // ?tab=won from the Clients nav item, ?new=1 from a quick action) —
  // re-derived (not just seeded once) so it resets correctly navigating
  // away, e.g. Clients -> Leads reusing the same page component with no
  // remount in between.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setShowAdd(searchParams.has("new"));
    setView(searchParams.get("view") === "board" ? "board" : "table");
    const w = searchParams.get("website");
    setWebsiteFilter(w === "has" || w === "none" ? w : "");
    setShowArchived(searchParams.has("archived"));
    const t = searchParams.get("tab");
    setTab(isLeadTab(t) ? t : "all");
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Lets the detail page's back-link return to this exact list state
  // (filters/tab/search/scroll) instead of a bare URL.
  useEffect(() => {
    sessionStorage.setItem("wdos-list-return:leads", `${pathname}?${searchParams.toString()}`);
  }, [pathname, searchParams]);

  useScrollRestoration(leads !== null);

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

  async function handleArchiveLead(lead: Lead) {
    const ok = await confirm({
      title: `Archive ${lead.business_name}?`,
      description:
        "The lead will be removed from the active Leads list and workflow counts, but nothing is deleted — its " +
        "history, any client, and any project stay exactly as they are. You can restore it later from \"Show " +
        "archived\".",
      confirmLabel: "Archive lead",
      danger: true,
    });
    if (!ok) return;

    setArchivingId(lead.id);
    try {
      await api.archiveLead(lead.id);
      load();
      showToast(`${lead.business_name} archived.`);
    } catch {
      showToast(`Couldn't archive ${lead.business_name}.`, "error");
    } finally {
      setArchivingId(null);
    }
  }

  async function handleRestoreLead(lead: Lead) {
    setArchivingId(lead.id);
    try {
      await api.unarchiveLead(lead.id);
      load();
      showToast(`${lead.business_name} restored.`);
    } catch {
      showToast(`Couldn't restore ${lead.business_name}.`, "error");
    } finally {
      setArchivingId(null);
    }
  }

  const filteredLeads = useMemo(() => {
    if (!leads) return null;
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (view === "table" && !leadMatchesTab(lead, tab)) return false;
      if (websiteFilter === "has" && !lead.website_url) return false;
      if (websiteFilter === "none" && lead.website_url) return false;
      if (priorityFilter && lead.priority !== priorityFilter) return false;
      if (!q) return true;
      return [lead.business_name, lead.industry, lead.suburb, lead.source, lead.notes, lead.business_email]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q));
    });
  }, [leads, view, tab, search, websiteFilter, priorityFilter]);

  const visibleLeads = useMemo(() => {
    if (!filteredLeads) return null;
    return sortLeads(filteredLeads, sort, followUpMap);
  }, [filteredLeads, sort, followUpMap]);

  // Cards for leads created/updated since the last load flash briefly.
  // Watches the unfiltered set; re-baselines when "archived" toggles.
  const recentLeadIds = useRecentChanges(leads, (l) => l.id, (l) => l.updated_at, showArchived ? "archived" : "active");

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

  // Looked up in the full `leads` array (not the filtered/visible one) so
  // a deep-linked or restored preview still opens even if the current
  // tab/search would otherwise hide that row.
  const previewId = searchParams.get("preview");
  const previewLead = previewId ? (leads?.find((l) => l.id === previewId) ?? null) : null;

  function openPreview(leadId: string) {
    router.push(`${pathname}?${withParam(searchParams, "preview", leadId)}`);
  }
  function closePreview() {
    router.push(`${pathname}?${withoutParam(searchParams, "preview")}`);
  }

  // Writes the same value into both local state and the URL from one
  // call site, so the existing searchParams->state read-effect above
  // (which re-fires on our own `replace`) only ever re-sets state to a
  // value it already holds — no update-loop risk.
  function updateParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value)}`, { scroll: false });
  }

  // Top-of-page "what's worth my attention" summary — active (non-archived,
  // non-converted) leads only, so a stale or already-won lead doesn't
  // inflate these counts. Mirrors the Sales Pipeline view's metrics row.
  const summary = useMemo(() => {
    const active = (leads ?? []).filter((l) => !l.archived_at && l.client_id == null);
    return {
      active: active.length,
      highPriority: active.filter((l) => l.priority === "high").length,
      needsFollowUp: active.filter((l) => followUpMap.has(l.id)).length,
      noWebsite: active.filter((l) => !l.website_url).length,
    };
  }, [leads, followUpMap]);

  function changeTab(next: LeadTab) {
    setTab(next);
    updateParam("tab", next === "all" ? null : next);
  }
  function changeWebsite(next: WebsiteFilter) {
    setWebsiteFilter(next);
    updateParam("website", next || null);
  }
  function changeShowArchived(next: boolean) {
    setShowArchived(next);
    updateParam("archived", next ? "1" : null);
  }

  // Clears every filter in one go — including the URL-backed ones, in a
  // single replace(): clearing them one updateParam() at a time would
  // each start from the same stale searchParams and undo one another.
  function clearAllFilters() {
    setSearch("");
    setTab("all");
    setWebsiteFilter("");
    setPriorityFilter("");
    setShowArchived(false);
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["search", "tab", "website", "archived"]) params.delete(key);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  // The secondary criteria living in the Filters popover, as removable chips.
  const filterChips: FilterChip[] = [];
  if (tab !== "all") {
    filterChips.push({
      id: "tab",
      label: "Status",
      value: LEAD_TABS.find((t) => t.id === tab)?.label ?? tab,
      onRemove: () => changeTab("all"),
    });
  }
  if (priorityFilter) {
    filterChips.push({
      id: "priority",
      label: "Priority",
      value: PRIORITY_LABEL[priorityFilter],
      onRemove: () => setPriorityFilter(""),
    });
  }
  if (websiteFilter) {
    filterChips.push({
      id: "website",
      label: "Website",
      value: websiteFilter === "has" ? "Has a website" : "No website",
      onRemove: () => changeWebsite(""),
    });
  }
  if (showArchived) {
    filterChips.push({ id: "archived", label: "Archived", value: "Included", onRemove: () => changeShowArchived(false) });
  }

  const viewToggle = (
    <div className="flex rounded-md border border-border-strong p-0.5 text-sm">
      <button
        onClick={() => {
          setView("table");
          updateParam("view", null);
        }}
        className={`toggle-pill rounded px-2 py-1 ${view === "table" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
      >
        List
      </button>
      <button
        onClick={() => {
          setView("board");
          updateParam("view", "board");
        }}
        className={`toggle-pill rounded px-2 py-1 ${view === "board" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
      >
        Board
      </button>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">
          The businesses you&apos;re pursuing — where each one is, and what to do next. New leads arrive automatically
          when you approve a business in Discovery.
        </p>
        {viewToggle}
      </div>

      {/* At-a-glance: active pipeline size and where the commercial value /
          urgency is, before scanning the list itself — same idea as the
          Sales Pipeline metrics row. */}
      {leads && leads.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Active leads" value={summary.active} />
          <Metric label="High priority" value={summary.highPriority} hint="chase these first" />
          <Metric label="Needs follow-up" value={summary.needsFollowUp} href="/dashboard/sales/follow-ups" />
          <Metric label="No website" value={summary.noWebsite} hint="strongest pitch" />
        </div>
      )}

      {/* Command bar (list view only): Search + Filters + Sort, with the
          active filters as removable chips underneath. */}
      {view === "table" && (
        <CommandBar
          className="mt-4"
          search={
            <SearchInput
              placeholder="Search business, industry, suburb, email…"
              aria-label="Search leads"
              value={search}
              onValueChange={setSearch}
            />
          }
          filters={
            <FilterPopover activeCount={filterChips.length} onClearAll={clearAllFilters}>
              <FilterField label="Status">
                <CompactSelect
                  aria-label="Filter by status"
                  value={tab}
                  onValueChange={changeTab}
                  options={LEAD_TABS.map((t) => ({ value: t.id, label: `${t.label} (${tabCounts.get(t.id) ?? 0})` }))}
                />
              </FilterField>
              <FilterField label="Priority">
                <CompactSelect
                  aria-label="Filter by priority"
                  value={priorityFilter}
                  onValueChange={setPriorityFilter}
                  options={[
                    { value: "", label: "Any priority" },
                    ...LEAD_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
                  ]}
                />
              </FilterField>
              <FilterField label="Website">
                <CompactSelect
                  aria-label="Filter by website"
                  value={websiteFilter}
                  onValueChange={changeWebsite}
                  options={[
                    { value: "", label: "Any website" },
                    { value: "has", label: "Has a website" },
                    { value: "none", label: "No website" },
                  ]}
                />
              </FilterField>
              <FilterToggle
                label="Show archived"
                hint="Include archived leads in the list"
                checked={showArchived}
                onChange={changeShowArchived}
              />
            </FilterPopover>
          }
          sort={
            <SortSelect
              aria-label="Sort leads"
              value={sort}
              onValueChange={setSort}
              options={LEAD_SORTS.map((s) => ({ value: s, label: LEAD_SORT_LABEL[s] }))}
            />
          }
          chips={filterChips.length > 0 ? <FilterChips chips={filterChips} onClearAll={clearAllFilters} /> : undefined}
        />
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!leads && !error && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
              <Skeleton className="mt-3 h-3 w-full" />
            </div>
          ))}
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
            <LeadsBoard leads={boardLeads} stages={stages} onMove={handleStatusChange} recentIds={recentLeadIds} />
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
              <button onClick={clearAllFilters} className="btn btn-secondary btn-sm">
                Clear filters
              </button>
            }
          />
        </div>
      )}

      {view === "table" && visibleLeads && visibleLeads.length > 0 && (
        <SoftSwap
          signature={`${tab}|${websiteFilter}|${priorityFilter}|${sort}`}
          className="animate-fade-in mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        >
          {visibleLeads.map((lead) => (
            <LeadCard
              key={lead.id}
              flash={recentLeadIds.has(lead.id)}
              lead={lead}
              nextAction={leadNextAction(lead, followUpMap.get(lead.id))}
              checklistSummary={lead.client_id ? checklistSummaries.get(lead.client_id) : undefined}
              archivingId={archivingId}
              onArchive={handleArchiveLead}
              onRestore={handleRestoreLead}
              onPreview={(l) => openPreview(l.id)}
            />
          ))}
        </SoftSwap>
      )}

      {/* Manual entry — secondary */}
      <div className="mt-6">
        <button onClick={() => setShowAdd((v) => !v)} className="btn btn-ghost btn-sm">
          {showAdd ? "Cancel" : "Add a lead manually"}
        </button>

        {showAdd && (
          <div className="mt-3 max-w-2xl space-y-4">
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 border border-border p-4 sm:grid-cols-2">
              <Input required placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="input sm:col-span-2" />
              <Input placeholder="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className="input" />
              <Input placeholder="Source" value={source} onChange={(e) => setSource(e.target.value)} className="input" />
              <Input placeholder="Suburb" value={suburb} onChange={(e) => setSuburb(e.target.value)} className="input" />
              <Input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} className="input" />
              <Select value={priority} onChange={(e) => setPriority(e.target.value as LeadPriority | "")} className="input">
                <option value="">Medium priority</option>
                {LEAD_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
              <Select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} className="input">
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
              <button type="submit" disabled={saving} className="btn btn-primary sm:col-span-2">
                {saving ? "Saving…" : "Save lead"}
              </button>
            </form>

            <form onSubmit={handleCreateClient} className="flex flex-wrap items-end gap-2 border border-border p-4">
              <div className="w-full text-xs text-fg-muted">Already signed, no lead to track? Add the client directly.</div>
              <Input required placeholder="Business name" value={clientBusinessName} onChange={(e) => setClientBusinessName(e.target.value)} className="input flex-1" />
              <Input placeholder="Billing email (optional)" value={clientBillingEmail} onChange={(e) => setClientBillingEmail(e.target.value)} className="input flex-1" />
              <button type="submit" disabled={savingClient} className="btn btn-secondary btn-sm">
                {savingClient ? "Saving…" : "Add client"}
              </button>
            </form>
          </div>
        )}
      </div>

      {previewId &&
        (previewLead ? (
          <LeadPreviewPanel lead={previewLead} onClose={closePreview} />
        ) : leads === null ? null : (
          <div className="side-panel-overlay" onClick={closePreview}>
            <div className="side-panel items-center justify-center p-6 text-center" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-fg-muted">This lead is no longer available.</p>
              <button type="button" onClick={closePreview} className="btn btn-secondary btn-sm mt-3">
                Close
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}

export default function SalesLeadsPage() {
  return (
    <Suspense fallback={<div />}>
      <LeadsPageInner />
    </Suspense>
  );
}
