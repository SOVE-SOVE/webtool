import { describe, expect, it } from "vitest";
import {
  beginBurstSave,
  beginLatestSave,
  deriveSaveStatus,
  hasNewerEdits,
  IDLE_LATEST_SAVE,
  IDLE_SAVE_BURST,
  resetLatestSave,
  settleBurstSave,
  settleLatestSave,
  touchLatestSave,
} from "./saveStatus";

describe("deriveSaveStatus", () => {
  it("shows Saved only when nothing is in flight and nothing newer is unsaved", () => {
    expect(deriveSaveStatus({ saving: false, outcome: "saved", dirty: false })).toBe("saved");
    expect(deriveSaveStatus({ saving: false, outcome: "saved", dirty: true })).toBe("dirty");
    expect(deriveSaveStatus({ saving: true, outcome: "saved", dirty: false })).toBe("saving");
  });

  it("keeps a failure visible even though the edit is still unsaved", () => {
    expect(deriveSaveStatus({ saving: false, outcome: "error", dirty: true })).toBe("error");
    expect(deriveSaveStatus({ saving: false, outcome: "error", dirty: false })).toBe("error");
  });

  it("is idle or dirty before anything was saved", () => {
    expect(deriveSaveStatus({ saving: false, outcome: "none", dirty: false })).toBe("idle");
    expect(deriveSaveStatus({ saving: false, outcome: "none", dirty: true })).toBe("dirty");
  });
});

describe("LatestSave", () => {
  it("goes saving -> saved for a single confirmed request", () => {
    const started = beginLatestSave(IDLE_LATEST_SAVE);
    expect(started.saving).toBe(true);
    expect(started.outcome).toBe("none");
    const done = settleLatestSave(started, started.latest, true);
    expect(done).toMatchObject({ saving: false, outcome: "saved" });
  });

  it("ignores an older request that resolves after a newer one started", () => {
    const first = beginLatestSave(IDLE_LATEST_SAVE);
    const second = beginLatestSave(first);
    const afterStale = settleLatestSave(second, first.latest, true);
    expect(afterStale).toBe(second);
    expect(afterStale.saving).toBe(true);
    // ...and an older failure can't replace the newer request's result.
    const done = settleLatestSave(second, second.latest, true);
    expect(settleLatestSave(done, first.latest, false)).toBe(done);
  });

  it("ignores a request that belonged to a record the editor has left", () => {
    const started = beginLatestSave(IDLE_LATEST_SAVE);
    const moved = resetLatestSave(started);
    expect(moved).toMatchObject({ saving: false, outcome: "none" });
    expect(settleLatestSave(moved, started.latest, true)).toBe(moved);
    expect(settleLatestSave(moved, started.latest, false)).toBe(moved);
  });

  it("keeps a failure until the operator edits or saves again", () => {
    const started = beginLatestSave(IDLE_LATEST_SAVE);
    const failed = settleLatestSave(started, started.latest, false);
    expect(failed.outcome).toBe("error");
    expect(touchLatestSave(failed).outcome).toBe("none");
    expect(beginLatestSave(failed).outcome).toBe("none");
  });

  it("an edit never hides a request that's still running", () => {
    const started = beginLatestSave(IDLE_LATEST_SAVE);
    expect(touchLatestSave(started).saving).toBe(true);
  });

  it("knows when the operator kept editing after the request was sent", () => {
    const edited = touchLatestSave(IDLE_LATEST_SAVE);
    const started = beginLatestSave(edited);
    expect(hasNewerEdits(started)).toBe(false);
    const typedDuringSave = touchLatestSave(started);
    const done = settleLatestSave(typedDuringSave, started.latest, true);
    expect(hasNewerEdits(done)).toBe(true);
    // The indicator must not read Saved for that newer, unsent edit.
    expect(deriveSaveStatus({ saving: done.saving, outcome: done.outcome, dirty: hasNewerEdits(done) })).toBe("dirty");
  });
});

describe("SaveBurst", () => {
  const status = (b: typeof IDLE_SAVE_BURST) => deriveSaveStatus({ saving: b.pending > 0, outcome: b.outcome, dirty: false });

  it("stays on saving until every overlapping request has settled", () => {
    let b = beginBurstSave(IDLE_SAVE_BURST);
    b = beginBurstSave(b);
    b = settleBurstSave(b, true);
    expect(status(b)).toBe("saving");
    b = settleBurstSave(b, true);
    expect(status(b)).toBe("saved");
  });

  it("reports the failure when any request in the run failed, whatever the order", () => {
    let b = beginBurstSave(beginBurstSave(IDLE_SAVE_BURST));
    b = settleBurstSave(b, false);
    expect(status(b)).toBe("saving");
    b = settleBurstSave(b, true);
    expect(status(b)).toBe("error");

    let c = beginBurstSave(beginBurstSave(IDLE_SAVE_BURST));
    c = settleBurstSave(settleBurstSave(c, true), false);
    expect(status(c)).toBe("error");
  });

  it("a failure followed by nothing stays a failure", () => {
    const b = settleBurstSave(beginBurstSave(IDLE_SAVE_BURST), false);
    expect(status(b)).toBe("error");
  });

  it("a new action from rest starts a fresh run", () => {
    const failed = settleBurstSave(beginBurstSave(IDLE_SAVE_BURST), false);
    const retry = beginBurstSave(failed);
    expect(status(retry)).toBe("saving");
    expect(status(settleBurstSave(retry, true))).toBe("saved");
  });
});
