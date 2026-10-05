/**
 * "Is this Undo still the inverse of that one action?" — the pure checks
 * behind the Undo toasts. An Undo only ever sends the targeted inverse
 * (reopen that task; re-add that feature with its notes), never a stale
 * snapshot, and it stands down when the thing has changed again since.
 */

/**
 * Undoing a task's complete/reopen: only while the task is still in the
 * state that action left it in. If it has since been toggled again (here,
 * in another view, or it is gone), there is nothing of ours left to undo.
 */
export function taskUndoVerdict(
  current: { done: boolean } | null | undefined,
  /** The `done` value the action being undone produced. */
  resultingDone: boolean,
): { ok: true; restoreDone: boolean } | { ok: false; reason: string } {
  if (!current) return { ok: false, reason: "That task is no longer available." };
  if (current.done !== resultingDone) {
    return { ok: false, reason: "That task has changed since — nothing was undone." };
  }
  return { ok: true, restoreDone: !resultingDone };
}

/** Message + toast key for a task's done toggle. One key per task, so toggling it again retires the older Undo. */
export function taskDoneToast(task: { id: string; done: boolean }): { message: string; key: string } {
  return { message: task.done ? "Marked complete" : "Reopened", key: `task-done:${task.id}` };
}

/**
 * Undoing a requirement's removal by adding the same feature back with
 * the notes it carried. Declined when the feature is already back (a
 * re-add would be a server no-op and its notes are no longer ours to
 * write) or when a choice that can't coexist with it was made since.
 */
export function requirementRestoreVerdict({
  featureKey,
  currentKeys,
  conflicts,
}: {
  featureKey: string;
  /** Feature keys on the plan right now. */
  currentKeys: Iterable<string>;
  /** Features on the plan now that can't coexist with this one. */
  conflicts: string[];
}): { ok: true } | { ok: false; reason: "already-added" | "conflict" } {
  for (const key of currentKeys) {
    if (key === featureKey) return { ok: false, reason: "already-added" };
  }
  if (conflicts.length > 0) return { ok: false, reason: "conflict" };
  return { ok: true };
}
