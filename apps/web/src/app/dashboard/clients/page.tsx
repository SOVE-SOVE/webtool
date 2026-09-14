"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  PROJECT_STAGE_LABELS,
  type ActivityItem,
  type Client,
  type Project,
  type Task,
  type User,
} from "@/lib/api";
import { filterClients, UNASSIGNED } from "@/lib/filters";
import {
  clientNextAction,
  clientTone,
  currentProject,
  mostRecentActivity,
  openTaskCount,
  projectsForClient,
  CLIENT_STATUS_LABEL,
  type ClientTone,
} from "@/lib/clients";
import { deadlineStatus, nextOpenTask } from "@/lib/projects";
import { timeAgo } from "@/lib/format";
import { ClientStatusBadge } from "@/components/ClientStatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

type EnrichedClient = {
  client: Client;
  tone: ClientTone;
  project: Project | null;
  nextAction: string;
  openTasks: number;
  lastActivity: string | null;
  overdue: boolean;
};

function ClientCard({ row }: { row: EnrichedClient }) {
  const { client, tone, project, nextAction, openTasks, lastActivity } = row;
  return (
    <Link
      href={`/dashboard/clients/${client.id}`}
      className="flex flex-col rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-2">
        <ClientStatusBadge tone={tone} />
        <span className="text-xs text-fg-subtle">
          {lastActivity ? `Active ${timeAgo(lastActivity)}` : "No activity yet"}
        </span>
      </div>

      <p className="mt-2 truncate font-medium text-fg">{client.business_name}</p>
      <p className="truncate text-xs text-fg-muted">
        {project ? `${project.name} · ${PROJECT_STAGE_LABELS[project.stage]}` : "No project yet"}
      </p>

      <p className="mt-2 min-w-0 truncate text-xs text-fg-muted">
        <span className="text-fg-subtle">Next: </span>
        {nextAction}
      </p>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs text-fg-muted">
        <span className="truncate">
          {openTasks > 0 ? `${openTasks} open task${openTasks === 1 ? "" : "s"}` : (client.assigned_user_name ?? "Unassigned")}
        </span>
        <span className="shrink-0 font-medium text-fg">View client →</span>
      </div>
    </Link>
  );
}

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClientTone | "">("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

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
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api.createClient({ business_name: businessName, billing_email: billingEmail || undefined });
      setBusinessName("");
      setBillingEmail("");
      setShowAdd(false);
      // Land inside the new client, same as Projects does for a new project —
      // there's immediately somewhere useful to go (start intake).
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
      return {
        client,
        tone: clientTone(clientProjects),
        project,
        nextAction: clientNextAction(project, nextTask?.title ?? null),
        openTasks: openTaskCount(tasks, project?.id ?? null),
        lastActivity: lastActivityItem?.created_at ?? null,
        overdue: project ? deadlineStatus(project.deadline) === "overdue" : false,
      };
    });
  }, [clients, projects, tasks, activity]);

  const summary = useMemo(() => {
    const counts = { onboarding: 0, active: 0, complete: 0 };
    let attention = 0;
    for (const row of rows) {
      counts[row.tone] += 1;
      if (row.overdue) attention += 1;
    }
    return { total: rows.length, ...counts, attention };
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!clients) return null;
    const bySearchAndAssignee = filterClients(clients, { search, assignee: assigneeFilter });
    const allowed = new Set(bySearchAndAssignee.map((c) => c.id));
    return rows
      .filter((row) => allowed.has(row.client.id))
      .filter((row) => !statusFilter || row.tone === statusFilter)
      .sort((a, b) => {
        const aKey = a.lastActivity ?? a.client.created_at;
        const bKey = b.lastActivity ?? b.client.created_at;
        return aKey < bKey ? 1 : -1;
      });
  }, [clients, rows, search, assigneeFilter, statusFilter]);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Clients"
        description="Who you're delivering for, and what's happening with each one."
        actions={
          <button onClick={() => setShowAdd((v) => !v)} className="btn btn-primary">
            {showAdd ? "Cancel" : "+ Add Client"}
          </button>
        }
      />

      {showAdd && (
        <form onSubmit={handleCreate} className="mt-4 flex max-w-2xl flex-wrap items-end gap-2 rounded-md border border-border p-4">
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

      {clients && clients.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          <span>
            <strong className="font-semibold text-fg">{summary.total}</strong> Clients
          </span>
          <span className="text-fg-subtle">·</span>
          <span>
            <strong className="font-semibold text-fg">{summary.active}</strong> Active
          </span>
          <span className="text-fg-subtle">·</span>
          <span>
            <strong className="font-semibold text-fg">{summary.onboarding}</strong> Onboarding
          </span>
          {summary.attention > 0 && (
            <>
              <span className="text-fg-subtle">·</span>
              <span className="text-amber-700 dark:text-amber-400">
                <strong className="font-semibold">{summary.attention}</strong> Need attention
              </span>
            </>
          )}
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-60"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ClientTone | "")}
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
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
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
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!clients && !error && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-md border border-border bg-surface p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-3 h-4 w-2/3" />
              <Skeleton className="mt-3 h-3 w-1/2" />
            </div>
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

      {visibleRows && clients && clients.length > 0 && visibleRows.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No clients found"
            description="Try adjusting your search or filters."
            action={
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("");
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

      {visibleRows && visibleRows.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleRows.map((row) => (
            <ClientCard key={row.client.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
