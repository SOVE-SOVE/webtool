"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, type ActivityItem, type ChecklistItem, type StageChecklistItem, type User } from "@/lib/api";
import { AnimatedHeight } from "@/components/ui/AnimatedHeight";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { AssigneeAvatar } from "./AssigneeAvatar";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Checkbox } from "@/components/ui/Checkbox";

// ChecklistItem and StageChecklistItem are structurally identical (same
// ownership/blocked/required/review-version/notes fields) — this
// component is the "one consistent task system" both checklist pages
// share, parameterized only by plain async callbacks so it has no idea
// which backend system it's talking to (docs/05_DECISIONS.md).
type TaskItem = ChecklistItem | StageChecklistItem;

type ProgressPart = { completed: number; total: number; pct: number | null };
type Progress = { required: ProgressPart; optional: ProgressPart };
type NextAction<T> = { kind: "task"; item: T } | { kind: "blocked"; items: T[] } | { kind: "done" };

type UpdatePatch = {
  status?: "pending" | "complete" | "not_required" | "blocked";
  assigned_user_id?: string | null;
  blocked_reason?: string;
  note?: string;
};

function progressLabel(progress: Progress): string {
  const { required, optional } = progress;
  if (required.total === 0 && optional.total === 0) return "No applicable tasks — nothing to track here.";
  const requiredText = `Required: ${required.completed} of ${required.total} complete`;
  if (optional.total === 0) return requiredText;
  return `${requiredText} · Optional: ${optional.completed} of ${optional.total}`;
}

function CompletedByText({ item }: { item: TaskItem }) {
  if (item.status === "needs_review") {
    return <span className="text-amber-700 dark:text-amber-400">Needs review — {item.needs_review_reason}</span>;
  }
  if (item.status === "blocked") {
    return <span className="text-error">Blocked — {item.blocked_reason}</span>;
  }
  if (!item.completed_by) return null;
  if (item.status === "not_required") {
    return item.completed_by.type === "system" ? (
      <span className="text-fg-subtle">Marked not required</span>
    ) : (
      <span className="text-fg-subtle">Marked not required by {item.completed_by.name ?? "a teammate"}</span>
    );
  }
  if (item.completed_by.type === "system") {
    return (
      <span className="text-fg-subtle">
        Automatically completed{item.completed_by.via ? ` — ${item.completed_by.via}` : ""}
      </span>
    );
  }
  return <span className="text-fg-subtle">Marked done by {item.completed_by.name ?? "a teammate"}</span>;
}

function NextActionSummary<T extends TaskItem>({ nextAction }: { nextAction: NextAction<T> }) {
  if (nextAction.kind === "done") {
    return <p className="text-sm text-fg-muted">All set — nothing left here right now.</p>;
  }
  if (nextAction.kind === "blocked") {
    return (
      <div className="space-y-1 rounded-md border border-error/30 bg-error/5 p-2.5">
        <p className="text-sm font-medium text-error">Every remaining required task is blocked:</p>
        <ul className="space-y-1">
          {nextAction.items.map((item) => (
            <li key={item.id} className="text-xs text-fg-muted">
              <span className="font-medium text-fg">{item.title}</span>
              {item.assigned_user_name && <> · {item.assigned_user_name}</>}
              {" — "}
              {item.blocked_reason}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const item = nextAction.item;
  return (
    <p className="text-sm text-fg">
      Next: <span className="font-medium">{item.title}</span>
      {item.assigned_user_name && <span className="text-fg-muted"> · {item.assigned_user_name}</span>}
      {item.link && (
        <a href={item.link.href} className="ml-2 text-fg-muted hover:text-fg hover:underline">
          {item.link.label} →
        </a>
      )}
    </p>
  );
}

function AddTaskRow({ users, onAdd }: { users: User[]; onAdd: (title: string, assignedUserId: string | null) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(title.trim(), assignee || null);
      setTitle("");
      setAssignee("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that task.");
    } finally {
      setSaving(false);
    }
  }

  if (!adding) {
    return (
      <button type="button" onClick={() => setAdding(true)} className="text-xs font-medium text-fg-muted hover:text-fg hover:underline">
        + Add task
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Task title"
          className="input min-w-0 flex-1"
        />
        <Select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="input w-auto"
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <button type="button" onClick={handleAdd} disabled={saving} className="btn btn-secondary btn-sm">
          {saving ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => setAdding(false)} className="text-xs text-fg-muted hover:underline">
          Cancel
        </button>
      </div>
      {error && <p className="text-error">{error}</p>}
    </div>
  );
}

/**
 * One progress bar + next-action summary + task list — shared by the
 * Client Setup & Delivery checklist and every Stage Checklist panel.
 * Reordering swaps order_index with the adjacent CUSTOM task only
 * (defaults keep a fixed position — docs/05_DECISIONS.md).
 */
export function TaskChecklistList<T extends TaskItem, R>({
  items,
  progress,
  nextAction,
  users,
  updateItem,
  addItem,
  reorderItems,
  removeItem,
  fetchHistory,
  onUpdated,
}: {
  items: T[];
  progress: Progress;
  nextAction: NextAction<T>;
  users: User[];
  updateItem: (itemId: string, patch: UpdatePatch) => Promise<R>;
  addItem: (title: string, assignedUserId: string | null) => Promise<R>;
  reorderItems: (pairs: { id: string; order_index: number }[]) => Promise<R>;
  removeItem: (itemId: string) => Promise<R>;
  fetchHistory: (itemId: string) => Promise<ActivityItem[]>;
  onUpdated: (result: R) => void;
}) {
  const [reorderError, setReorderError] = useState<string | null>(null);
  const ordered = [...items].sort((a, b) => a.order_index - b.order_index);
  const customIndices = ordered.map((i, idx) => (!i.is_default ? idx : -1)).filter((idx) => idx !== -1);

  async function moveCustom(idx: number, delta: number) {
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= ordered.length) return;
    const a = ordered[idx];
    const b = ordered[targetIdx];
    setReorderError(null);
    try {
      onUpdated(
        await reorderItems([
          { id: a.id, order_index: b.order_index },
          { id: b.id, order_index: a.order_index },
        ]),
      );
    } catch (err) {
      setReorderError(err instanceof ApiError ? err.message : "Couldn't reorder that task.");
    }
  }

  return (
    <div className="space-y-3">
      <ProgressBar value={progress.required.pct ?? 0} label={progressLabel(progress)} valueText={progressLabel(progress)} />

      <NextActionSummary nextAction={nextAction} />

      {reorderError && <p className="text-error">{reorderError}</p>}

      <ul className="space-y-1.5">
        {ordered.map((item, idx) => {
          const posAmongCustom = customIndices.indexOf(idx);
          return (
            <TaskRow
              key={item.id}
              item={item}
              users={users}
              isFirstCustom={posAmongCustom <= 0}
              isLastCustom={posAmongCustom === -1 || posAmongCustom === customIndices.length - 1}
              onMove={(delta) => moveCustom(idx, delta)}
              updateItem={updateItem}
              removeItem={removeItem}
              fetchHistory={fetchHistory}
              onUpdated={onUpdated}
            />
          );
        })}
      </ul>

      <AddTaskRow
        users={users}
        onAdd={async (title, assignedUserId) => {
          onUpdated(await addItem(title, assignedUserId));
        }}
      />
    </div>
  );
}

function TaskRow<T extends TaskItem, R>({
  item,
  users,
  isFirstCustom,
  isLastCustom,
  onMove,
  updateItem,
  removeItem,
  fetchHistory,
  onUpdated,
}: {
  item: T;
  users: User[];
  isFirstCustom: boolean;
  isLastCustom: boolean;
  onMove: (delta: number) => void;
  updateItem: (itemId: string, patch: UpdatePatch) => Promise<R>;
  removeItem: (itemId: string) => Promise<R>;
  fetchHistory: (itemId: string) => Promise<ActivityItem[]>;
  onUpdated: (result: R) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<ActivityItem[] | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [note, setNote] = useState("");

  // Optimistic status: shown immediately on toggle, cleared once the
  // server confirms (via the fresh `item` the parent then passes down)
  // or on failure — where clearing it just falls back to the real,
  // unchanged `item.status`, i.e. a rollback.
  const [optimisticStatus, setOptimisticStatus] = useState<TaskItem["status"] | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (completionTimeout.current) clearTimeout(completionTimeout.current);
    };
  }, []);

  const effectiveStatus = optimisticStatus ?? item.status;
  // The completion-icon pop should only play on an actual status
  // change, not on first mount/page load — tracked by comparing against
  // the previous render's status (React's documented way to react to a
  // changed value during render) rather than a mount-detecting effect.
  const [prevEffectiveStatus, setPrevEffectiveStatus] = useState(effectiveStatus);
  const justChangedStatus = effectiveStatus !== prevEffectiveStatus;
  if (justChangedStatus) setPrevEffectiveStatus(effectiveStatus);
  const isAutomatic = item.completion_mode === "automatic";
  const isNotRequired = effectiveStatus === "not_required";
  const isComplete = effectiveStatus === "complete";
  const isBlocked = effectiveStatus === "blocked";
  const needsReview = effectiveStatus === "needs_review";

  async function loadHistory() {
    try {
      setHistory(await fetchHistory(item.id));
    } catch {
      setHistory([]);
    }
  }

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && history === null) void loadHistory();
  }

  async function setStatus(status: "pending" | "complete" | "not_required") {
    setOptimisticStatus(status);
    if (status === "complete") {
      setJustCompleted(true);
      if (completionTimeout.current) clearTimeout(completionTimeout.current);
      completionTimeout.current = setTimeout(() => setJustCompleted(false), 700);
    }
    setBusy(true);
    setError(null);
    try {
      onUpdated(await updateItem(item.id, { status }));
      setOptimisticStatus(null);
      if (expanded) void loadHistory();
    } catch (err) {
      setOptimisticStatus(null);
      setJustCompleted(false);
      setError(err instanceof ApiError ? err.message : "Couldn't update that task.");
    } finally {
      setBusy(false);
    }
  }

  async function submitBlock() {
    if (!blockReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onUpdated(await updateItem(item.id, { status: "blocked", blocked_reason: blockReason.trim() }));
      setBlocking(false);
      setBlockReason("");
      if (expanded) void loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't block that task.");
    } finally {
      setBusy(false);
    }
  }

  async function reassign(userId: string) {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await updateItem(item.id, { assigned_user_id: userId || null }));
      if (expanded) void loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reassign that task.");
    } finally {
      setBusy(false);
    }
  }

  async function submitNote() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onUpdated(await updateItem(item.id, { note: note.trim() }));
      setNote("");
      if (expanded) void loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that note.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await removeItem(item.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that task.");
      setBusy(false);
    }
  }

  return (
    <li
      className={`rounded-md border transition-colors duration-[var(--duration-base)] ease-standard ${
        justCompleted ? "bg-emerald-50 dark:bg-emerald-500/10" : ""
      } ${isBlocked ? "border-error/40" : needsReview ? "border-amber-300 dark:border-amber-500/40" : "border-border"}`}
    >
      <div className="flex flex-col gap-1.5 p-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {isAutomatic ? (
            <span
              key={effectiveStatus}
              aria-hidden="true"
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                justChangedStatus ? "animate-checkbox-pop" : ""
              } ${
                isNotRequired || isBlocked
                  ? "bg-surface-subtle text-fg-subtle"
                  : isComplete
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                    : "border border-border-strong text-fg-subtle"
              }`}
            >
              {isNotRequired ? "–" : isBlocked ? "!" : isComplete ? "✓" : "○"}
            </span>
          ) : (
            <Checkbox
              checked={isComplete || needsReview}
              disabled={busy || isNotRequired || isBlocked}
              onChange={() => setStatus(isComplete || needsReview ? "pending" : "complete")}
              aria-label={item.title}
              className="checkbox-pop-on-check mt-0.5 h-4 w-4 shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-sm ${isNotRequired ? "text-fg-subtle line-through" : "text-fg"}`}>
              {item.title}
              {isAutomatic && (
                <span className="ml-1.5 rounded bg-surface-subtle px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                  Auto
                </span>
              )}
              {!item.is_required && (
                <span className="ml-1.5 rounded bg-surface-subtle px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                  Optional
                </span>
              )}
              {isBlocked && (
                <span className="ml-1.5 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-800 dark:bg-red-500/15 dark:text-red-300">
                  Blocked
                </span>
              )}
              {needsReview && (
                <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  Needs review
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs">
              <CompletedByText item={item} />
              {item.link && !isNotRequired && !isBlocked && (
                <a href={item.link.href} className="ml-2 text-fg-muted hover:text-fg hover:underline">
                  {item.link.label} →
                </a>
              )}
            </p>
            {error && <p className="mt-1 text-error">{error}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
          {item.assigned_user_name && <AssigneeAvatar name={item.assigned_user_name} />}
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse "${item.title}"` : `Expand "${item.title}"`}
            className="rounded px-1 text-fg-subtle transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover hover:text-fg"
          >
            <span
              aria-hidden="true"
              className={`inline-block transition-transform duration-[var(--duration-fast)] ease-standard motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
            >
              ▸
            </span>
          </button>
        </div>
      </div>

      <AnimatedHeight open={expanded}>
        <div className="space-y-3 border-t border-border p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-fg-muted" htmlFor={`assignee-${item.id}`}>
              Assigned to
            </label>
            <Select
              id={`assignee-${item.id}`}
              value={item.assigned_user_id ?? ""}
              onChange={(e) => reassign(e.target.value)}
              disabled={busy}
              className="input w-auto"
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>

          {isBlocked ? (
            <div className="space-y-1.5">
              <p className="text-xs text-fg-muted">Blocked — {item.blocked_reason}</p>
              <button type="button" onClick={() => setStatus("pending")} disabled={busy} className="btn btn-secondary btn-sm">
                Unblock
              </button>
            </div>
          ) : (
            !isComplete &&
            !isNotRequired &&
            (blocking ? (
              <div className="space-y-1.5">
                <Textarea
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Why is this blocked? e.g. Waiting for approved business photos."
                  rows={2}
                  className="input"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={submitBlock}
                    disabled={busy || !blockReason.trim()}
                    className="btn btn-secondary btn-sm"
                  >
                    Mark blocked
                  </button>
                  <button type="button" onClick={() => setBlocking(false)} className="text-xs text-fg-muted hover:underline">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setBlocking(true)}
                disabled={busy}
                className="text-xs text-fg-muted hover:text-fg hover:underline"
              >
                Mark blocked
              </button>
            ))
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            {!item.is_default && (
              <>
                <button type="button" disabled={busy || isFirstCustom} onClick={() => onMove(-1)} className="disabled:opacity-30">
                  ↑ Move up
                </button>
                <button type="button" disabled={busy || isLastCustom} onClick={() => onMove(1)} className="disabled:opacity-30">
                  ↓ Move down
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy || isBlocked}
              onClick={() => setStatus(isNotRequired ? "pending" : "not_required")}
              className="hover:text-fg hover:underline"
            >
              {isNotRequired ? "Mark required" : "Not required"}
            </button>
            {!item.is_default && (
              <button type="button" disabled={busy} onClick={remove} className="text-fg-subtle hover:text-error hover:underline">
                Remove
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-fg-muted" htmlFor={`note-${item.id}`}>
              Add a note
            </label>
            <div className="flex items-center gap-2">
              <Input
                id={`note-${item.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitNote()}
                placeholder="Optional note"
                className="input min-w-0 flex-1"
              />
              <button type="button" onClick={submitNote} disabled={busy || !note.trim()} className="btn btn-secondary btn-sm">
                Save
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-fg-muted">History</p>
            {history === null ? (
              <p className="text-xs text-fg-subtle">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-fg-subtle">No activity yet.</p>
            ) : (
              <ul className="space-y-1">
                {history.map((entry) => (
                  <li key={entry.id} className="text-xs text-fg-subtle">
                    <span className="text-fg-muted">{new Date(entry.created_at).toLocaleString()}</span>
                    {" — "}
                    {entry.summary ?? entry.action}
                    {entry.user_name && <span className="text-fg-subtle"> ({entry.user_name})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </AnimatedHeight>
    </li>
  );
}
