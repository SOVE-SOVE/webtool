import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleDelayedShow, visibleOnActiveChange } from "./delayedVisible";

describe("visibleOnActiveChange", () => {
  it("hides immediately once active goes false, regardless of current visibility", () => {
    expect(visibleOnActiveChange(false, true)).toBe(false);
    expect(visibleOnActiveChange(false, false)).toBe(false);
  });

  it("leaves visibility exactly as it was while active stays true — no minimum display timer lives here", () => {
    expect(visibleOnActiveChange(true, true)).toBe(true);
    expect(visibleOnActiveChange(true, false)).toBe(false);
  });
});

describe("scheduleDelayedShow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never shows before the delay elapses (a fast load never flashes it)", () => {
    const onShow = vi.fn();
    scheduleDelayedShow(150, onShow);
    vi.advanceTimersByTime(149);
    expect(onShow).not.toHaveBeenCalled();
  });

  it("shows exactly once the delay elapses", () => {
    const onShow = vi.fn();
    scheduleDelayedShow(150, onShow);
    vi.advanceTimersByTime(150);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("never shows if cancelled before the delay elapses — even once that much real time later passes", () => {
    const onShow = vi.fn();
    const cancel = scheduleDelayedShow(150, onShow);
    vi.advanceTimersByTime(100);
    cancel(); // the hook's effect cleanup: active went false, delayMs changed, or the component unmounted
    vi.advanceTimersByTime(10_000);
    expect(onShow).not.toHaveBeenCalled();
  });

  it("cancelling after it already fired is a harmless no-op", () => {
    const onShow = vi.fn();
    const cancel = scheduleDelayedShow(150, onShow);
    vi.advanceTimersByTime(150);
    expect(onShow).toHaveBeenCalledTimes(1);
    cancel();
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("each call is independent — rescheduling (a changed delayMs) does not affect an earlier schedule's own cancel", () => {
    const first = vi.fn();
    const second = vi.fn();
    const cancelFirst = scheduleDelayedShow(150, first);
    cancelFirst();
    scheduleDelayedShow(150, second);
    vi.advanceTimersByTime(150);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
