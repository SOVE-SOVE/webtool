"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api,
  PROJECT_STAGE_LABELS,
  PROJECT_STAGES,
  type Client,
  type Project,
  type ProjectStage,
  type User,
} from "@/lib/api";

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

  function load() {
    api
      .listProjects()
      .then(setProjects)
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Projects</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          disabled={clients.length === 0}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          title={clients.length === 0 ? "Add a client first" : undefined}
        >
          {showForm ? "Cancel" : "Add project"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 max-w-2xl space-y-3 border border-neutral-200 p-4">
          <select
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
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
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <select
            value={assignedUserId}
            onChange={(e) => setAssignedUserId(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
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
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save project"}
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {projects && (
        <table className="mt-6 w-full border border-neutral-200 text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
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
          <tbody className="divide-y divide-neutral-200">
            {projects.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                  No projects yet.
                </td>
              </tr>
            )}
            {projects.map((project) => (
              <tr key={project.id}>
                <td className="px-3 py-2 font-medium text-neutral-900">
                  {project.name}
                  {project.source_lead_id && (
                    <Link
                      href={`/dashboard/leads/${project.source_lead_id}`}
                      className="ml-2 text-xs font-normal text-neutral-500 hover:underline"
                    >
                      from lead
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  <Link href={`/dashboard/clients/${project.client_id}`} className="hover:underline">
                    {project.client_business_name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                      {PROJECT_STAGE_LABELS[project.stage]}
                    </span>
                    <select
                      value={project.stage}
                      onChange={(e) => handleStageChange(project.id, e.target.value as ProjectStage)}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                    >
                      {PROJECT_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {PROJECT_STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-3 py-2 text-neutral-600">{project.package ?? "—"}</td>
                <td className="px-3 py-2 text-neutral-600">{formatPrice(project.price_cents)}</td>
                <td className="px-3 py-2 text-neutral-600">
                  {project.deadline ? new Date(project.deadline).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={project.assigned_user_id ?? ""}
                    onChange={(e) => handleAssigneeChange(project.id, e.target.value)}
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
