"use client";

import { useState } from "react";
import { ApiError, api, type Lead, type Project, type User } from "@/lib/api";

/**
 * Task creation for the Tasks page. Deliberately small: a task only has
 * a title, one parent (lead or project), an optional due date, and an
 * optional assignee — every field the API actually accepts (see
 * TaskCreate in api.ts). When opened with a fixed `project`, the parent
 * picker is skipped entirely — see the project detail page's own inline
 * "Add a task for this project" form for that flow, which this modal
 * doesn't replace.
 */
export function NewTaskModal({
  leads,
  projects,
  users,
  onClose,
  onCreated,
}: {
  leads: Lead[];
  projects: Project[];
  users: User[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [linkType, setLinkType] = useState<"project" | "lead">("project");
  const [linkId, setLinkId] = useState("");
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !linkId) return;
    setSaving(true);
    setError(null);
    try {
      await api.createTask({
        title: title.trim(),
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
        project_id: linkType === "project" ? linkId : undefined,
        lead_id: linkType === "lead" ? linkId : undefined,
        assigned_user_id: assignedUserId || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create this task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <form
        onSubmit={handleSubmit}
        className="modal-panel max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-task-title" className="section-title">
          New task
        </h2>

        <input
          autoFocus
          required
          placeholder="What needs doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input mt-4"
        />

        <div className="mt-3">
          <div className="flex rounded-md border border-border-strong p-0.5 text-sm">
            {(["project", "lead"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setLinkType(t);
                  setLinkId("");
                }}
                className={`flex-1 rounded px-2 py-1 ${
                  linkType === t ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"
                }`}
              >
                {t === "project" ? "Project" : "Lead"}
              </button>
            ))}
          </div>
          <select
            required
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            className="input mt-2"
            aria-label={linkType === "project" ? "Project" : "Lead"}
          >
            <option value="">{linkType === "project" ? "Select a project…" : "Select a lead…"}</option>
            {(linkType === "project" ? projects : leads).map((item) => (
              <option key={item.id} value={item.id}>
                {"business_name" in item ? item.business_name : item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="field-label text-xs">Due (optional)</label>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="input mt-1"
            />
          </div>
          <div>
            <label className="field-label text-xs">Assign to</label>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              className="input mt-1"
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

        {error && <p className="text-error mt-2">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !title.trim() || !linkId} className="btn btn-primary">
            {saving ? "Adding…" : "Add task"}
          </button>
        </div>
      </form>
    </div>
  );
}
