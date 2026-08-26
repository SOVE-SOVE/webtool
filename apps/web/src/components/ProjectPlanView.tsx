"use client";

import { useState } from "react";
import { api, type PlanStage, type ProjectPlan, type Task, type User } from "@/lib/api";

const STATUS_LABELS: Record<PlanStage["status"], string> = {
  pending: "Pending",
  in_progress: "In progress",
  done: "Done",
};

function StageTasks({
  stage,
  tasks,
  users,
  onTasksChanged,
}: {
  stage: PlanStage;
  tasks: Task[];
  users: User[];
  onTasksChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.createTask({ title, project_id: stage.project_id, stage: stage.stage });
      setTitle("");
      onTasksChanged();
    } finally {
      setSaving(false);
    }
  }

  async function toggle(task: Task) {
    await api.updateTask(task.id, { done: !task.done });
    onTasksChanged();
  }

  async function reassign(task: Task, userId: string) {
    await api.updateTask(task.id, { assigned_user_id: userId || null });
    onTasksChanged();
  }

  return (
    <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
      {tasks.length === 0 && <p className="text-sm text-neutral-500">No tasks yet.</p>}
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={task.done} onChange={() => toggle(task)} />
          <span className={`flex-1 ${task.done ? "text-neutral-400 line-through" : "text-neutral-800"}`}>
            {task.title}
          </span>
          <select
            value={task.assigned_user_id ?? ""}
            onChange={(e) => reassign(task, e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      ))}
      <form onSubmit={handleAdd} className="flex gap-2 pt-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}

function StageRow({
  stage,
  users,
  tasks,
  onStageChanged,
  onTasksChanged,
}: {
  stage: PlanStage;
  users: User[];
  tasks: Task[];
  onStageChanged: (s: PlanStage) => void;
  onTasksChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDueChange(value: string) {
    setSaving(true);
    setError(null);
    try {
      onStageChanged(await api.updatePlanStage(stage.id, { due_at: value || null }));
    } catch {
      setError("Couldn't update the due date.");
    } finally {
      setSaving(false);
    }
  }

  async function handleResponsibleChange(userId: string) {
    setSaving(true);
    setError(null);
    try {
      onStageChanged(await api.updatePlanStage(stage.id, { responsible_user_id: userId || null }));
    } catch {
      setError("Couldn't update the responsible person.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: PlanStage["status"]) {
    setSaving(true);
    setError(null);
    try {
      onStageChanged(await api.updatePlanStage(stage.id, { status }));
    } catch {
      setError("Couldn't update the status.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    setSaving(true);
    setError(null);
    try {
      onStageChanged(await api.approvePlanStage(stage.id));
    } catch {
      setError("Couldn't approve this stage.");
    } finally {
      setSaving(false);
    }
  }

  const statusColor =
    stage.status === "done"
      ? "bg-emerald-100 text-emerald-800"
      : stage.status === "in_progress"
        ? "bg-amber-100 text-amber-800"
        : "bg-neutral-100 text-neutral-600";

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => setExpanded((v) => !v)} className="flex flex-1 items-center gap-2 text-left">
          <span className="text-sm font-medium text-neutral-900">
            {expanded ? "▾" : "▸"} {stage.label}
          </span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColor}`}>
            {STATUS_LABELS[stage.status]}
          </span>
          {stage.requires_approval && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                stage.approved ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {stage.approved ? "Approved" : "Needs approval"}
            </span>
          )}
          {stage.task_count > 0 && (
            <span className="text-xs text-neutral-500">
              {stage.tasks_done}/{stage.task_count} tasks
            </span>
          )}
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={stage.status}
            onChange={(e) => handleStatusChange(e.target.value as PlanStage["status"])}
            disabled={saving}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
          >
            {(Object.keys(STATUS_LABELS) as PlanStage["status"][]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={stage.due_at ?? ""}
            onChange={(e) => handleDueChange(e.target.value)}
            disabled={saving}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
          />
          <select
            value={stage.responsible_user_id ?? ""}
            onChange={(e) => handleResponsibleChange(e.target.value)}
            disabled={saving}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          {stage.requires_approval && !stage.approved && (
            <button
              onClick={handleApprove}
              disabled={saving}
              className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Approve
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {stage.approved && stage.approved_by_user_name && (
        <p className="mt-1 text-xs text-neutral-400">
          Approved by {stage.approved_by_user_name}
          {stage.approved_at ? ` · ${new Date(stage.approved_at).toLocaleString()}` : ""}
        </p>
      )}

      {expanded && <StageTasks stage={stage} tasks={tasks} users={users} onTasksChanged={onTasksChanged} />}
    </li>
  );
}

export function ProjectPlanView({
  plan,
  tasks,
  users,
  onChange,
  onTasksChanged,
}: {
  plan: ProjectPlan;
  tasks: Task[];
  users: User[];
  onChange: (plan: ProjectPlan) => void;
  onTasksChanged: () => void;
}) {
  function handleStageChanged(updated: PlanStage) {
    onChange({ ...plan, stages: plan.stages.map((s) => (s.id === updated.id ? updated : s)) });
  }

  if (plan.stages.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        The project workspace — stages, tasks, deadlines, responsibilities, and approval points — is created
        automatically once the brief is approved.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-200 border border-neutral-200 px-3">
      {plan.stages.map((stage) => (
        <StageRow
          key={stage.id}
          stage={stage}
          users={users}
          tasks={tasks.filter((t) => t.stage === stage.stage)}
          onStageChanged={handleStageChanged}
          onTasksChanged={onTasksChanged}
        />
      ))}
    </ul>
  );
}
