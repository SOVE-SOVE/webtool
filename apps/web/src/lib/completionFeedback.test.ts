import { describe, expect, it } from "vitest";
import { completedByUser } from "./completionFeedback";

describe("completedByUser", () => {
  it("acknowledges an open task the user completed and the server confirmed", () => {
    expect(completedByUser({ wasDone: false, requestedDone: true, confirmedDone: true })).toBe(true);
  });

  it("stays quiet when the request failed", () => {
    expect(completedByUser({ wasDone: false, requestedDone: true, confirmedDone: null })).toBe(false);
  });

  it("stays quiet when the server didn't mark it complete", () => {
    expect(completedByUser({ wasDone: false, requestedDone: true, confirmedDone: false })).toBe(false);
  });

  it("stays quiet for a reopen", () => {
    expect(completedByUser({ wasDone: true, requestedDone: false, confirmedDone: false })).toBe(false);
  });

  it("stays quiet for a task that was already complete", () => {
    expect(completedByUser({ wasDone: true, requestedDone: true, confirmedDone: true })).toBe(false);
  });
});
