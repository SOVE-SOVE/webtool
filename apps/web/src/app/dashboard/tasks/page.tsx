"use client";

import { useEffect, useState } from "react";
import { api, type Lead, type Project, type Task, type User } from "@/lib/api";
import { ErrorState } from "@/components/ui/ErrorState";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [linkType, setLinkType] = useState<"lead" | "project">("lead");
  const [linkId, setLinkId] = useState("");
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .listTasks()
      .then((rows) => {
        setError(null);
        setTasks(rows);
      })
      .catch(() => setError("Couldn't load tasks."));
    api.listLeads().then(setLeads).catch(() => {});
    api.listProjects().then(setProjects).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!linkId) return;
    setSaving(true);
    try {
      await api.createTask({
        title,
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
        lead_id: linkType === "lead" ? linkId : undefined,
        project_id: linkType === "project" ? linkId : undefined,
        assigned_user_id: assignedUserId || undefined,
      });
      setTitle("");
      setDueAt("");
      setLinkId("");
      setAssignedUserId("");
      setShowForm(false);
      load();
    } catch {
      setError("Couldn't create task.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, done: boolean) {
    await api.updateTask(id, { done });
    load();
  }

  async function handleAssigneeChange(id: string, assigneeId: string) {
    await api.updateTask(id, { assigned_user_id: assigneeId || null });
    load();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">Tasks</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary"
        >
          {showForm ? "Cancel" : "Add task"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 max-w-2xl space-y-3 border border-border p-4">
          <input
            required
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm"
          />

          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={linkType === "lead"}
                onChange={() => {
                  setLinkType("lead");
                  setLinkId("");
                }}
              />
              Lead
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={linkType === "project"}
                onChange={() => {
                  setLinkType("project");
                  setLinkId("");
                }}
              />
              Project
            </label>
          </div>

          <select
            required
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm"
          >
            <option value="">{linkType === "lead" ? "Select a lead…" : "Select a project…"}</option>
            {(linkType === "lead" ? leads : projects).map((item) => (
              <option key={item.id} value={item.id}>
                {"business_name" in item ? item.business_name : item.name}
              </option>
            ))}
          </select>

          <div>
            <label className="text-xs text-fg-muted">Due (optional)</label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-border-strong px-3 py-1.5 text-sm"
            />
          </div>

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
            {saving ? "Saving…" : "Save task"}
          </button>
        </form>
      )}

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {tasks && (
        <table className="mt-6 w-full border border-border text-left text-sm">
          <thead className="bg-surface-subtle text-xs uppercase text-fg-muted">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Context</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Assigned to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tasks.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-fg-muted">
                  No tasks yet.
                </td>
              </tr>
            )}
            {tasks.map((task) => (
              <tr key={task.id} className={task.done ? "text-fg-subtle" : undefined}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={(e) => handleToggle(task.id, e.target.checked)}
                  />
                </td>
                <td className={`px-3 py-2 ${task.done ? "line-through" : "font-medium text-fg"}`}>
                  {task.title}
                </td>
                <td className="px-3 py-2 text-fg-muted">{task.context}</td>
                <td className="px-3 py-2 text-fg-muted">
                  {task.due_at ? new Date(task.due_at).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={task.assigned_user_id ?? ""}
                    onChange={(e) => handleAssigneeChange(task.id, e.target.value)}
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
      )}
    </div>
  );
}
