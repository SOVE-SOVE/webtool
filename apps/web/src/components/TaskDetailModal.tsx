"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, api, type Task, type User } from "@/lib/api";
import { taskContextHref, taskContextKind, taskContextName } from "@/lib/tasks";
import { timeAgo } from "@/lib/format";
import { useToast } from "@/components/ui/ToastProvider";

/**
 * Secondary task detail, opened by clicking a row on the Tasks page. The
 * main list only ever shows title, project/lead and due-urgency — this
 * is where the rest (assignee, when it was created) lives, per the
 * redesign brief's "don't put every field on the main page."
 *
 * Only `done` and `assigned_user_id` are actually editable here because
 * that's all TaskUpdate accepts (see tasks/schemas.py) — title and due
 * date are set once at creation and aren't patchable yet, so they're
 * shown read-only rather than as a form that would silently no-op.
 */
export function TaskDetailModal({
  task,
  users,
  onClose,
  onChanged,
}: {
  task: Task;
  users: User[];
  onClose: () => void;
  onChanged: (updated: Task) => void;
}) {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleDone() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateTask(task.id, { done: !task.done });
      onChanged(updated);
      showToast(updated.done ? "Marked complete" : "Reopened");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update this task.");
    } finally {
      setBusy(false);
    }
  }

  async function changeAssignee(assignedUserId: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateTask(task.id, { assigned_user_id: assignedUserId || null });
      onChanged(updated);
      showToast(updated.assigned_user_name ? `Assigned to ${updated.assigned_user_name}` : "Unassigned");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reassign this task.");
    } finally {
      setBusy(false);
    }
  }

  const kind = taskContextKind(task);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-panel max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="task-detail-title" className={`text-base font-semibold text-fg ${task.done ? "line-through" : ""}`}>
            {task.title}
          </h2>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
              task.done ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-surface-subtle text-fg-muted"
            }`}
          >
            {task.done ? "Completed" : "Open"}
          </span>
        </div>

        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-fg-muted">{kind === "project" ? "Project" : "Lead"}</dt>
            <dd>
              <Link href={taskContextHref(task)} className="font-medium text-fg hover:underline">
                {taskContextName(task)}
              </Link>
            </dd>
          </div>

          <div className="flex items-center justify-between gap-3">
            <dt className="text-fg-muted">Due</dt>
            <dd className="text-fg">{task.due_at ? new Date(task.due_at).toLocaleDateString() : "No due date"}</dd>
          </div>

          <div className="flex items-center justify-between gap-3">
            <dt className="text-fg-muted">Assigned to</dt>
            <dd>
              <select
                value={task.assigned_user_id ?? ""}
                disabled={busy}
                onChange={(e) => changeAssignee(e.target.value)}
                className="rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </dd>
          </div>

          <div className="flex items-center justify-between gap-3">
            <dt className="text-fg-muted">Created</dt>
            <dd className="text-fg-subtle">{timeAgo(task.created_at)}</dd>
          </div>
        </dl>

        {error && <p className="text-error mt-3">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" disabled={busy} className="btn btn-primary" onClick={toggleDone}>
            {task.done ? "Reopen task" : "Mark complete"}
          </button>
        </div>
      </div>
    </div>
  );
}
