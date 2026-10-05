"use client";

import { useCallback, useEffect, useRef } from "react";
import { ApiError, api, type Task } from "@/lib/api";
import { useToast } from "@/components/ui/ToastProvider";
import { taskDoneToast, taskUndoVerdict } from "./undo";

/**
 * The "Marked complete" / "Reopened" toast for a task's done toggle, with
 * Undo. Undo sends only the opposite `done` for that one task (the same
 * PATCH the toggle itself uses — it touches nothing else on the task, so a
 * later reassignment is left alone) and stands down if the task has been
 * toggled again since. It never plays the completion acknowledgement: that
 * is for a completion the user makes (see lib/completionFeedback.ts), not
 * for taking one back.
 *
 * `getTask` returns the task as the screen currently knows it; `onRestored`
 * receives the server's answer, exactly like the toggle's own success path.
 */
export function useTaskDoneToast(
  getTask: (id: string) => Pick<Task, "done"> | null | undefined,
  onRestored: (task: Task) => void,
) {
  const showToast = useToast();
  const latest = useRef({ getTask, onRestored });
  useEffect(() => {
    latest.current = { getTask, onRestored };
  });

  return useCallback(
    (updated: Task) => {
      const { message, key } = taskDoneToast(updated);
      showToast(message, {
        key,
        action: {
          label: "Undo",
          onAction: async () => {
            const verdict = taskUndoVerdict(latest.current.getTask(updated.id), updated.done);
            if (!verdict.ok) throw new Error(verdict.reason);
            let restored: Task;
            try {
              restored = await api.updateTask(updated.id, { done: verdict.restoreDone });
            } catch (err) {
              throw new Error(err instanceof ApiError ? err.message : "Couldn't undo — the task is unchanged.");
            }
            latest.current.onRestored(restored);
            return restored.done ? "Undone — task complete again" : "Undone — task reopened";
          },
        },
      });
    },
    [showToast],
  );
}
