"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type Task, type User } from "@/lib/api";
import { taskContextHref, taskContextKind, taskContextName } from "@/lib/tasks";
import { timeAgo } from "@/lib/format";
import { useToast } from "@/components/ui/ToastProvider";
import { useEscapeToClose } from "@/components/ui/useEscapeToClose";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { CompletionCheck } from "@/components/ui/CompletionCheck";
import { completedByUser } from "@/lib/completionFeedback";
import { useCompletionCelebration } from "@/lib/useCompletionCelebration";
import { useTaskDoneToast } from "@/lib/useTaskDoneToast";
import { TaskScheduleSection } from "@/components/TaskScheduleSection";

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
  tasks = [],
  onClose,
  onChanged,
}: {
  task: Task;
  users: User[];
  /** Every task on the page — lets the schedule show the linked client's other due dates. */
  tasks?: Task[];
  onClose: () => void;
  onChanged: (updated: Task) => void;
}) {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { celebratingId, celebrate, settle } = useCompletionCelebration();

  useEscapeToClose(onClose);

  // The task as last seen here — what an Undo pressed after this toggle
  // checks itself against (see useTaskDoneToast).
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);
  const showTaskDoneToast = useTaskDoneToast((id) => (taskRef.current.id === id ? taskRef.current : null), onChanged);

  async function toggleDone() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateTask(task.id, { done: !task.done });
      onChanged(updated);
      if (completedByUser({ wasDone: task.done, requestedDone: !task.done, confirmedDone: updated.done })) {
        celebrate(updated.id);
      }
      showTaskDoneToast(updated);
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
        className="modal-panel max-h-[calc(100dvh-2rem)] max-w-sm overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="task-detail-title" className={`text-base font-semibold text-fg ${task.done ? "line-through" : ""}`}>
            {task.title}
          </h2>
          <Badge tone={task.done ? "success" : "muted"} className="shrink-0">
            {/* The tick draws in only for a completion made here, just now;
                an already-completed task shows it static. */}
            {task.done && (
              <CompletionCheck animate={celebratingId === task.id} onAnimationEnd={settle} className="-mt-px mr-1 align-middle" />
            )}
            {task.done ? "Completed" : "Open"}
          </Badge>
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
              <Select
                value={task.assigned_user_id ?? ""}
                disabled={busy}
                onChange={(e) => changeAssignee(e.target.value)}
                className="input w-auto"
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </dd>
          </div>

          <div className="flex items-center justify-between gap-3">
            <dt className="text-fg-muted">Created</dt>
            <dd className="text-fg-subtle">{timeAgo(task.created_at)}</dd>
          </div>
        </dl>

        <TaskScheduleSection key={task.id} task={task} tasks={tasks} />

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
