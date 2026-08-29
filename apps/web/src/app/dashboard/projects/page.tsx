"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  PROJECT_STAGE_LABELS,
  PROJECT_STAGES,
  type Client,
  type Project,
  type ProjectStage,
  type User,
} from "@/lib/api";
import { filterProjects, UNASSIGNED } from "@/lib/filters";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";

function formatPrice(cents: number | null): string {
  return cents === null ? "—" : `$${(cents / 100).toLocaleString()}`;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
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
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setSaving(true);
    try {
      await api.createProject({ client_id: clientId, name, assigned_user_id: assignedUserId || undefined });
      setName("");
      setClientId("");
      setAssignedUserId("");
      setShowForm(false);
      load();
    } catch {
      setError("Couldn't create project.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStageChange(id: string, stage: ProjectStage) {
    await api.updateProject(id, { stage });
    load();
  }

  async function handleAssigneeChange(id: string, assigneeId: string) {
    await api.updateProject(id, { assigned_user_id: assigneeId || null });
    load();
  }

  const visibleProjects = useMemo(
    () =>
      projects === null
        ? null
        : filterProjects(projects, {
            search,
            stage: stageFilter,
            assignee: assigneeFilter,
            showFinished,
          }),
    [projects, search, stageFilter, assigneeFilter, showFinished],
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Projects"
        description="Delivery work for signed clients — from intake through to a live, handed-over site."
        actions={
          <button
            onClick={() => setShowForm((v) => !v)}
            disabled={clients.length === 0}
            className="btn btn-primary"
            title={clients.length === 0 ? "Add a client first" : undefined}
          >
            {showForm ? "Cancel" : "Add project"}
          </button>
        }
      />

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 max-w-2xl space-y-3 border border-border p-4">
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
            placeholder="Project name"
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
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? "Saving…" : "Save project"}
          </button>
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search project, client, package…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-md border border-border-strong px-3 py-1.5 text-sm"
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
        <div className="mt-4">
          <TableSkeleton rows={6} cols={7} />
        </div>
      )}

      {projects && projects.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No projects yet"
            description={
              clients.length === 0
                ? "Add a client first, then start a project for them."
                : "Start a project for an existing client, or convert a won lead from the Clients page."
            }
            action={
              clients.length > 0 ? (
                <button onClick={() => setShowForm(true)} className="btn btn-primary">
                  Add project
                </button>
              ) : undefined
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
        <>
          {/* Mobile: one card per project. */}
          <div className="mt-4 space-y-2 md:hidden">
            {visibleProjects.map((project) => (
              <div key={project.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/dashboard/projects/${project.id}`} className="font-medium text-fg hover:underline">
                      {project.name}
                    </Link>
                    <div className="text-xs text-fg-muted">
                      <Link href={`/dashboard/clients/${project.client_id}`} className="hover:underline">
                        {project.client_business_name}
                      </Link>
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-surface-subtle px-2 py-0.5 text-xs font-medium text-fg-muted">
                    {PROJECT_STAGE_LABELS[project.stage]}
                  </span>
                </div>
                <div className="mt-1.5 text-xs text-fg-muted">
                  {project.package ?? "No package"} · {formatPrice(project.price_cents)}
                  {project.deadline ? ` · due ${new Date(project.deadline).toLocaleDateString()}` : ""}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    value={project.stage}
                    onChange={(e) => handleStageChange(project.id, e.target.value as ProjectStage)}
                    className="input"
                  >
                    {PROJECT_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {PROJECT_STAGE_LABELS[stage]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={project.assigned_user_id ?? ""}
                    onChange={(e) => handleAssigneeChange(project.id, e.target.value)}
                    className="input"
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

          {/* Desktop/tablet: full table. */}
          <div className="table-shell mt-4 hidden md:block">
            <table className="table">
              <thead>
                <tr>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Current stage</th>
                  <th className="px-3 py-2">Package</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Deadline</th>
                  <th className="px-3 py-2">Assigned to</th>
                </tr>
              </thead>
              <tbody>
                {visibleProjects.map((project) => (
                  <tr key={project.id}>
                    <td className="px-3 py-2 font-medium text-fg">
                      <Link href={`/dashboard/projects/${project.id}`} className="hover:underline">
                        {project.name}
                      </Link>
                      {project.source_lead_id && (
                        <Link
                          href={`/dashboard/leads/${project.source_lead_id}`}
                          className="ml-2 text-xs font-normal text-fg-muted hover:underline"
                        >
                          from lead
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      <Link href={`/dashboard/clients/${project.client_id}`} className="hover:underline">
                        {project.client_business_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-surface-subtle px-2 py-0.5 text-xs font-medium text-fg-muted">
                          {PROJECT_STAGE_LABELS[project.stage]}
                        </span>
                        <select
                          value={project.stage}
                          onChange={(e) => handleStageChange(project.id, e.target.value as ProjectStage)}
                          className="rounded-md border border-border-strong px-2 py-1 text-sm"
                        >
                          {PROJECT_STAGES.map((stage) => (
                            <option key={stage} value={stage}>
                              {PROJECT_STAGE_LABELS[stage]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{project.package ?? "—"}</td>
                    <td className="px-3 py-2 text-fg-muted">{formatPrice(project.price_cents)}</td>
                    <td className="px-3 py-2 text-fg-muted">
                      {project.deadline ? new Date(project.deadline).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={project.assigned_user_id ?? ""}
                        onChange={(e) => handleAssigneeChange(project.id, e.target.value)}
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
