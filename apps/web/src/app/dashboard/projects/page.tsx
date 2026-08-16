"use client";

import { useEffect, useState } from "react";
import { api, PROJECT_STAGES, type Client, type Project, type ProjectStage } from "@/lib/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setError("Couldn't load projects."));
    api.listClients().then(setClients).catch(() => {});
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setSaving(true);
    try {
      await api.createProject({ client_id: clientId, name });
      setName("");
      setClientId("");
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
              <th className="px-3 py-2">Stage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {projects.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-neutral-500">
                  No projects yet.
                </td>
              </tr>
            )}
            {projects.map((project) => (
              <tr key={project.id}>
                <td className="px-3 py-2 font-medium text-neutral-900">{project.name}</td>
                <td className="px-3 py-2 text-neutral-600">{project.client_business_name}</td>
                <td className="px-3 py-2">
                  <select
                    value={project.stage}
                    onChange={(e) => handleStageChange(project.id, e.target.value as ProjectStage)}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  >
                    {PROJECT_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage.replace("_", " ")}
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
