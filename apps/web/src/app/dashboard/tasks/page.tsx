"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api, type Lead, type Project, type Task, type User } from "@/lib/api";
import {
  groupOpenTasksByUrgency,
  listTaskFilterOptions,
  taskContextHref,
  taskContextName,
  taskMatchesFilter,
  taskMatchesSearch,
  taskMatchesTab,
  taskUrgency,
  TASK_TABS,
  type TaskTab,
  type TaskUrgency,
} from "@/lib/tasks";
import { Disclosure } from "@/components/ui/Disclosure";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/ToastProvider";
import { NewTaskModal } from "@/components/NewTaskModal";
import { TaskDetailModal } from "@/components/TaskDetailModal";

// Same colour convention as DEADLINE_CLASS on the Projects page (see
// lib/projects.ts's deadlineStatus) — urgency, not a fabricated
// priority field, is what tells the operator "how important is this"
// here, since Task has no priority of its own (only Leads do).
const URGENCY_CLASS: Record<TaskUrgency, string> = {
  overdue: "text-red-700 dark:text-red-400",
  today: "text-amber-700 dark:text-amber-400",
  upcoming: "text-fg-muted",
  none: "text-fg-subtle",
};

const GROUP_LABEL: Record<"overdue" | "today" | "upcoming" | "noDueDate", string> = {
  overdue: "Overdue",
  today: "Due today",
  upcoming: "Upcoming",
  noDueDate: "No due date",
};

const GROUP_TONE: Record<"overdue" | "today" | "upcoming" | "noDueDate", string> = {
  overdue: URGENCY_CLASS.overdue,
  today: URGENCY_CLASS.today,
  upcoming: URGENCY_CLASS.upcoming,
  noDueDate: URGENCY_CLASS.none,
};

function dueLabel(task: Task, urgency: TaskUrgency): string | null {
  if (!task.due_at) return null;
  const date = new Date(task.due_at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (urgency === "overdue") return `Overdue · ${date}`;
  if (urgency === "today") return "Due today";
  return `Due ${date}`;
}

function TaskRow({ task, onToggle, onOpen }: { task: Task; onToggle: () => void; onOpen: () => void }) {
  const urgency = taskUrgency(task);
  const label = dueLabel(task, urgency);
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-hover cursor-pointer"
    >
      <input
        type="checkbox"
        checked={task.done}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
        aria-label={task.done ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
        className="mt-1 h-4 w-4 shrink-0 accent-fg"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${task.done ? "text-fg-muted line-through" : "text-fg"}`}>
          {task.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-fg-muted">
          <Link
            href={taskContextHref(task)}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-fg hover:underline"
          >
            {taskContextName(task)}
          </Link>
          {task.assigned_user_name && <span> · {task.assigned_user_name}</span>}
        </p>
      </div>
      {label && !task.done && (
        <span className={`mt-1 shrink-0 text-xs font-medium ${URGENCY_CLASS[urgency]}`}>{label}</span>
      )}
    </li>
  );
}

export default function TasksPage() {
  const showToast = useToast();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<TaskTab>("open");
  const [search, setSearch] = useState("");
  const [filterKey, setFilterKey] = useState("");

  const [showNewTask, setShowNewTask] = useState(false);
  const [detailTask, setDetailTask] = useState<Task | null>(null);

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

  function updateTaskInState(updated: Task) {
    setTasks((prev) => (prev ? prev.map((t) => (t.id === updated.id ? updated : t)) : prev));
    setDetailTask((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  async function handleToggle(task: Task) {
    try {
      const updated = await api.updateTask(task.id, { done: !task.done });
      updateTaskInState(updated);
      showToast(updated.done ? "Marked complete" : "Reopened");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Couldn't update this task.", "error");
    }
  }

  const filterOptions = useMemo(() => listTaskFilterOptions(tasks ?? []), [tasks]);

  const filteredTasks = useMemo(() => {
    if (!tasks) return null;
    return tasks.filter(
      (t) => taskMatchesTab(t, tab) && taskMatchesFilter(t, filterKey) && taskMatchesSearch(t, search),
    );
  }, [tasks, tab, filterKey, search]);

  const groups = useMemo(
    () => groupOpenTasksByUrgency(tab === "done" ? [] : (filteredTasks ?? [])),
    [filteredTasks, tab],
  );

  const completedTasks = useMemo(() => {
    if (!filteredTasks) return [];
    return filteredTasks
      .filter((t) => t.done)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [filteredTasks]);

  const openGroupEntries = (["overdue", "today", "upcoming", "noDueDate"] as const).filter(
    (key) => groups[key].length > 0,
  );
  const hasOpenWork = openGroupEntries.length > 0;
  const hasAnyFilters = search.trim() !== "" || filterKey !== "";

  function clearFilters() {
    setSearch("");
    setFilterKey("");
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Tasks"
        description="Everything that needs doing, across every lead and project."
        actions={
          <button onClick={() => setShowNewTask(true)} className="btn btn-primary">
            New task
          </button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-border-strong p-0.5 text-sm">
          {TASK_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded px-3 py-1 ${
                tab === t.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
          <input
            placeholder="Search tasks or projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full sm:w-56"
          />
          {filterOptions.length > 1 && (
            <select
              value={filterKey}
              onChange={(e) => setFilterKey(e.target.value)}
              className="input w-auto"
              aria-label="Filter by project or lead"
            >
              <option value="">All projects &amp; leads</option>
              {filterOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!tasks && !error && (
        <div className="mt-4">
          <ListSkeleton rows={5} />
        </div>
      )}

      {tasks && tasks.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No tasks yet"
            description="Add a task for a lead or project to start building your work queue."
            action={
              <button onClick={() => setShowNewTask(true)} className="btn btn-primary">
                Add your first task
              </button>
            }
          />
        </div>
      )}

      {tasks && tasks.length > 0 && filteredTasks && filteredTasks.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title={hasAnyFilters ? "No tasks match your filters" : "Nothing here"}
            description={hasAnyFilters ? "Try a different search or clear the filters above." : undefined}
            action={
              hasAnyFilters ? (
                <button onClick={clearFilters} className="btn btn-secondary">
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      {tasks && tasks.length > 0 && filteredTasks && filteredTasks.length > 0 && (
        <div className="mt-4 space-y-4">
          {tab !== "done" && (
            <div className="card overflow-hidden">
              {!hasOpenWork && (
                <EmptyState compact title="All caught up" description="No open tasks match this view." />
              )}
              {openGroupEntries.map((key, i) => (
                <div key={key} className={i > 0 ? "border-t border-border" : undefined}>
                  <div
                    className={`flex items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wide ${GROUP_TONE[key]}`}
                  >
                    <span>{GROUP_LABEL[key]}</span>
                    <span className="text-fg-subtle">{groups[key].length}</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {groups[key].map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onToggle={() => handleToggle(task)}
                        onOpen={() => setDetailTask(task)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {completedTasks.length > 0 && tab === "all" && (
            <Disclosure
              title="Completed"
              badge={<span className="text-xs text-fg-subtle">{completedTasks.length}</span>}
            >
              <ul className="-m-4 divide-y divide-border">
                {completedTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => handleToggle(task)}
                    onOpen={() => setDetailTask(task)}
                  />
                ))}
              </ul>
            </Disclosure>
          )}

          {tab === "done" && (
            <div className="card overflow-hidden">
              <ul className="divide-y divide-border">
                {completedTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => handleToggle(task)}
                    onOpen={() => setDetailTask(task)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {showNewTask && (
        <NewTaskModal
          leads={leads}
          projects={projects}
          users={users}
          onClose={() => setShowNewTask(false)}
          onCreated={() => {
            setShowNewTask(false);
            showToast("Task added");
            load();
          }}
        />
      )}

      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          users={users}
          onClose={() => setDetailTask(null)}
          onChanged={updateTaskInState}
        />
      )}
    </div>
  );
}
