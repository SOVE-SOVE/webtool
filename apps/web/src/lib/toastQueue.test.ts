import { describe, expect, it } from "vitest";
import {
  actionResultToast,
  claimAction,
  isToastActionShortcut,
  newestActionToast,
  normaliseToastOptions,
  pauseTimer,
  pushToast,
  removeToast,
  resumeTimer,
  startTimer,
  timerDelay,
  TOAST_ACTION_DURATION_MS,
  TOAST_DURATION_MS,
  toastDuration,
  type ToastEntry,
} from "./toastQueue";

function toast(id: number, extra: Partial<ToastEntry> = {}): ToastEntry {
  return { id, message: `m${id}`, tone: "success", duration: TOAST_DURATION_MS, ...extra };
}
const undo = { label: "Undo", onAction: () => {} };

describe("toast options", () => {
  it("keeps the old (message, tone) call working", () => {
    expect(normaliseToastOptions()).toEqual({});
    expect(normaliseToastOptions("error")).toEqual({ tone: "error" });
    expect(normaliseToastOptions({ tone: "error", key: "k" })).toEqual({ tone: "error", key: "k" });
  });

  it("gives a plain toast its usual 4s and an actionable one longer", () => {
    expect(toastDuration({})).toBe(4000);
    expect(toastDuration({ action: undo })).toBe(TOAST_ACTION_DURATION_MS);
    expect(TOAST_ACTION_DURATION_MS).toBeGreaterThanOrEqual(6000);
    expect(TOAST_ACTION_DURATION_MS).toBeLessThanOrEqual(8000);
  });

  it("honours an explicit duration and ignores a nonsensical one", () => {
    expect(toastDuration({ duration: 1500 })).toBe(1500);
    expect(toastDuration({ duration: 0, action: undo })).toBe(TOAST_ACTION_DURATION_MS);
  });
});

describe("toast stack", () => {
  it("stacks newest last", () => {
    expect(pushToast([toast(1)], toast(2)).map((t) => t.id)).toEqual([1, 2]);
  });

  it("replaces an older toast about the same thing", () => {
    const stack = [toast(1, { key: "task-done:a", action: undo }), toast(2, { key: "task-done:b", action: undo })];
    expect(pushToast(stack, toast(3, { key: "task-done:a", action: undo })).map((t) => t.id)).toEqual([2, 3]);
  });

  it("never replaces unkeyed toasts", () => {
    expect(pushToast([toast(1), toast(2)], toast(3)).map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("drops the oldest beyond the limit", () => {
    expect(pushToast([toast(1), toast(2), toast(3)], toast(4)).map((t) => t.id)).toEqual([2, 3, 4]);
  });

  it("removes by id and returns the same stack when the id is gone", () => {
    const stack = [toast(1), toast(2)];
    expect(removeToast(stack, 1).map((t) => t.id)).toEqual([2]);
    expect(removeToast(stack, 9)).toBe(stack);
  });

  it("finds the newest toast that still has an action", () => {
    expect(newestActionToast([toast(1, { action: undo }), toast(2, { action: undo }), toast(3)])?.id).toBe(2);
    expect(newestActionToast([toast(1)])).toBeNull();
  });
});

describe("toast timer", () => {
  it("counts down while running", () => {
    const t = startTimer(7000, 1000);
    expect(timerDelay(t, 1000)).toBe(7000);
    expect(timerDelay(t, 3000)).toBe(5000);
    expect(timerDelay(t, 99000)).toBe(0);
  });

  it("holds what is left while paused, and carries on from there", () => {
    const paused = pauseTimer(startTimer(7000, 0), 2000);
    expect(paused).toEqual({ remaining: 5000, startedAt: null });
    expect(timerDelay(paused, 60000)).toBeNull();
    const resumed = resumeTimer(paused, 60000);
    expect(timerDelay(resumed, 60000)).toBe(5000);
    expect(timerDelay(resumed, 61000)).toBe(4000);
  });

  it("ignores a second pause or resume", () => {
    const paused = pauseTimer(startTimer(7000, 0), 2000);
    expect(pauseTimer(paused, 5000)).toBe(paused);
    const running = startTimer(7000, 0);
    expect(resumeTimer(running, 3000)).toBe(running);
  });
});

describe("toast action", () => {
  it("runs once however many times it is pressed", () => {
    const claimed = new Set<number>();
    expect(claimAction(claimed, 1)).toBe(true);
    expect(claimAction(claimed, 1)).toBe(false);
    expect(claimAction(claimed, 2)).toBe(true);
  });

  it("reports success, with the handler's own message when it gives one", () => {
    expect(actionResultToast({ ok: true, message: undefined })).toEqual({ message: "Restored", tone: "success" });
    expect(actionResultToast({ ok: true, message: "Reopened" })).toEqual({ message: "Reopened", tone: "success" });
  });

  it("reports a failure as an error, saying why when it knows", () => {
    expect(actionResultToast({ ok: false, error: new Error("That task has changed since.") })).toEqual({
      message: "That task has changed since.",
      tone: "error",
    });
    expect(actionResultToast({ ok: false, error: "nope" })).toEqual({ message: "Couldn't undo that.", tone: "error" });
  });
});

describe("isToastActionShortcut", () => {
  const z = { key: "z", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

  it("is Ctrl+Z or Cmd+Z outside a text field", () => {
    expect(isToastActionShortcut({ ...z, ctrlKey: true }, false)).toBe(true);
    expect(isToastActionShortcut({ ...z, metaKey: true, key: "Z" }, false)).toBe(true);
  });

  it("leaves the browser's own text undo alone while typing", () => {
    expect(isToastActionShortcut({ ...z, metaKey: true }, true)).toBe(false);
  });

  it("is nothing else", () => {
    expect(isToastActionShortcut(z, false)).toBe(false);
    expect(isToastActionShortcut({ ...z, metaKey: true, shiftKey: true }, false)).toBe(false);
    expect(isToastActionShortcut({ ...z, ctrlKey: true, altKey: true }, false)).toBe(false);
    expect(isToastActionShortcut({ ...z, ctrlKey: true, key: "y" }, false)).toBe(false);
  });
});
