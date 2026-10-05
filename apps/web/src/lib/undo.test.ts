import { describe, expect, it } from "vitest";
import { requirementRestoreVerdict, taskDoneToast, taskUndoVerdict } from "./undo";

describe("taskUndoVerdict", () => {
  it("reopens a task that is still complete from that action", () => {
    expect(taskUndoVerdict({ done: true }, true)).toEqual({ ok: true, restoreDone: false });
  });

  it("re-completes a task that is still open from that reopen", () => {
    expect(taskUndoVerdict({ done: false }, false)).toEqual({ ok: true, restoreDone: true });
  });

  it("stands down when the task was toggled again since", () => {
    expect(taskUndoVerdict({ done: false }, true).ok).toBe(false);
    expect(taskUndoVerdict({ done: true }, false).ok).toBe(false);
  });

  it("stands down when the task is gone", () => {
    expect(taskUndoVerdict(null, true).ok).toBe(false);
    expect(taskUndoVerdict(undefined, true).ok).toBe(false);
  });
});

describe("taskDoneToast", () => {
  it("uses one key per task, whichever way it was toggled", () => {
    expect(taskDoneToast({ id: "a", done: true })).toEqual({ message: "Marked complete", key: "task-done:a" });
    expect(taskDoneToast({ id: "a", done: false })).toEqual({ message: "Reopened", key: "task-done:a" });
  });
});

describe("requirementRestoreVerdict", () => {
  it("allows restoring a feature that is still off the plan", () => {
    expect(requirementRestoreVerdict({ featureKey: "gallery", currentKeys: ["services"], conflicts: [] })).toEqual({ ok: true });
  });

  it("declines when the feature was added back by hand", () => {
    expect(requirementRestoreVerdict({ featureKey: "gallery", currentKeys: new Set(["gallery"]), conflicts: [] })).toEqual({
      ok: false,
      reason: "already-added",
    });
  });

  it("declines when a choice that can't coexist was made since", () => {
    expect(
      requirementRestoreVerdict({ featureKey: "style_dark", currentKeys: ["style_light"], conflicts: ["style_light"] }),
    ).toEqual({ ok: false, reason: "conflict" });
  });
});
