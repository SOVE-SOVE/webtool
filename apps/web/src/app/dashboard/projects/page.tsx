"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  PROJECT_STAGE_LABELS,
  PROJECT_STAGES,
  type Client,
  type Project,
  type ProjectStage,
  type Task,
  type User,
} from "@/lib/api";
import { filterProjects, UNASSIGNED } from "@/lib/filters";
import { deadlineStatus, nextOpenTask, stageProgress } from "@/lib/projects";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";

function formatPrice(cents: number | null): string | null {
  return cents === null ? null : `$${(cents / 100).toLocaleString()}`;
}

const DEADLINE_CLASS = {
  overdue: "text-red-700 dark:text-red-400",
  soon: "text-amber-700 dark:text-amber-400",
  ok: "text-fg-muted",
  none: "text-fg-subtle",
} as const;

function ProjectCard({ project, nextTask }: { project: Project; nextTask: Task | null }) {
  const dl = deadlineStatus(project.deadline);
  const price = formatPrice(project.price_cents);
  return (
    <Link
      href={`/dashboard/projects/${project.id}`}
      className="flex flex-col rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-2">
        <ProjectStatusBadge project={project} />
        <span className={`text-xs ${DEADLINE_CLASS[dl]}`}>
          {project.deadline
            ? `${dl === "overdue" ? "Overdue " : "Due "}${new Date(project.deadline).toLocaleDateString()}`
            : "No deadline"}
        </span>
      </div>

      <p className="mt-2 truncate font-medium text-fg">{project.name}</p>
      <p className="truncate text-xs text-fg-muted">{project.client_business_name}</p>

      <div className="mt-3">
        <ProgressBar
          value={stageProgress(project.stage)}
          label={`${stageProgress(project.stage)}% · ${PROJECT_STAGE_LABELS[project.stage]}`}
        />
      </div>

      <p className="mt-2 min-w-0 truncate text-xs text-fg-muted">
        <span className="text-fg-subtle">Next: </span>
        {nextTask ? nextTask.title : "No open tasks"}
      </p>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs text-fg-muted">
        <span className="truncate">
          {[project.package, price].filter(Boolean).join(" · ") || "No package"}
        </span>
        <span className="shrink-0 text-fg-subtle">{project.assigned_user_name ?? "Unassigned"}</span>
      </div>
    </Link>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<ProjectStage | "">("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [showFinished, setShowFinished] = useState(false);

  function load() {
    api
      .listProjects()
      .then((rows) => {
        setError(null);
        setProjects(rows);
      })
      .catch(() => setError("Couldn't load projects."));
    api.listClients().then(setClients).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api.listTasks().then(setTasks).catch(() => {});
  }

  useEffect(load, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).has("new")) setShowForm(true);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setSaving(true);
    try {
      const created = await api.createProject({
        client_id: clientId,
        name,
        assigned_user_id: assignedUserId || undefined,
      });
      // Land the user inside the new project rather than back on the list —
      // the detailed brief is an optional enrichment step from here, not a
      // barrier that had to be cleared before the project could exist.
      router.push(`/dashboard/projects/${created.id}?created=1`);
    } catch {
      setError("Couldn't create project.");
      setSaving(false);
    }
  }

  const visibleProjects = useMemo(
    () =>
      projects === null
        ? null
        : filterProjects(projects, { search, stage: stageFilter, assignee: assigneeFilter, showFinished }),
    [projects, search, stageFilter, assigneeFilter, showFinished],
  );

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Projects"
        description="Websites in production for signed clients — where each one is, and what needs to happen next."
        actions={
          <button
            onClick={() => setShowForm((v) => !v)}
            disabled={clients.length === 0}
            className="btn btn-primary"
            title={clients.length === 0 ? "Convert a lead to a client first" : undefined}
          >
            {showForm ? "Cancel" : "New project"}
          </button>
        }
      />

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 max-w-xl space-y-3 rounded-md border border-border p-4">
          <select
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm"
          >
            <option value="">Select a client…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.business_name}
              </option>
            ))}
          </select>
          <input
            required
            placeholder="Project name (e.g. “Riverside Plumbing Website”)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />
          <select
            value={assignedUserId}
            onChange={(e) => setAssignedUserId(e.target.value)}
            className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Saving…" : "Create project"}
          </button>
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search project, client, package…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-60 rounded-md border border-border-strong px-3 py-1.5 text-sm"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as ProjectStage | "")}
          className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
        >
          <option value="">All stages</option>
          {PROJECT_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {PROJECT_STAGE_LABELS[stage]}
            </option>
          ))}
        </select>
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="rounded-md border border-border-strong px-2 py-1.5 text-sm"
        >
          <option value="">Anyone assigned</option>
          <option value={UNASSIGNED}>Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={showFinished}
            onChange={(e) => setShowFinished(e.target.checked)}
            disabled={stageFilter !== ""}
          />
          Show finished
        </label>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!projects && !error && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-md border border-border bg-surface p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-3 h-4 w-2/3" />
              <Skeleton className="mt-3 h-1.5 w-full" />
            </div>
          ))}
        </div>
      )}

      {projects && projects.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No projects yet"
            description={
              clients.length === 0
                ? "Projects are for signed clients. Convert a won lead first (Leads → Won)."
                : "Start a project for a client, or it's created automatically when you convert a won lead."
            }
            action={
              clients.length > 0 ? (
                <button onClick={() => setShowForm(true)} className="btn btn-primary">
                  New project
                </button>
              ) : (
                <Link href="/dashboard/leads?tab=won" className="btn btn-primary">
                  Go to Leads
                </Link>
              )
            }
          />
        </div>
      )}

      {visibleProjects && projects && projects.length > 0 && visibleProjects.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No projects match"
            description="Try a different search or clear the filters above."
            action={
              <button
                onClick={() => {
                  setSearch("");
                  setStageFilter("");
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

      {visibleProjects && visibleProjects.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => (
            <ProjectCard key={project.id} project={project} nextTask={nextOpenTask(tasks, project.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
