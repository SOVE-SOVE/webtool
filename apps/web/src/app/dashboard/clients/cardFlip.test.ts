import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFlipController,
  faceExposure,
  flipReducer,
  HOVER_FLIP_MS,
  INITIAL_FLIP_STATE,
  LEAVE_GRACE_MS,
  nextMenuIndex,
  pendingTimer,
  type FlipState,
} from "./cardFlip";

function setup(initial: Partial<FlipState> = {}) {
  const onChange = vi.fn();
  const c = createFlipController({ onChange, initial: { ...INITIAL_FLIP_STATE, hoverEnabled: true, ...initial } });
  return { c, onChange, face: () => c.getState().face };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("card flip controller", () => {
  it("does not flip on a quick pass-through", () => {
    const { c, face } = setup();
    c.dispatch({ type: "pointerEnter" });
    vi.advanceTimersByTime(HOVER_FLIP_MS - 100);
    c.dispatch({ type: "pointerLeave" });
    vi.advanceTimersByTime(HOVER_FLIP_MS * 2);
    expect(face()).toBe("front");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flips after a deliberate hover", () => {
    const { c, face } = setup();
    c.dispatch({ type: "pointerEnter" });
    vi.advanceTimersByTime(HOVER_FLIP_MS);
    expect(face()).toBe("back");
    expect(c.getState().explicit).toBe(false);
  });

  it("never auto-flips without hover capability (touch)", () => {
    const { c, face } = setup({ hoverEnabled: false });
    c.dispatch({ type: "pointerEnter" });
    vi.advanceTimersByTime(HOVER_FLIP_MS * 3);
    expect(face()).toBe("front");
  });

  it("returns to the front after leave + grace, and re-entering within the grace keeps the back", () => {
    const { c, face } = setup();
    c.dispatch({ type: "pointerEnter" });
    vi.advanceTimersByTime(HOVER_FLIP_MS);
    c.dispatch({ type: "pointerLeave" });
    vi.advanceTimersByTime(LEAVE_GRACE_MS - 50);
    c.dispatch({ type: "pointerEnter" });
    vi.advanceTimersByTime(LEAVE_GRACE_MS * 2);
    expect(face()).toBe("back");
    c.dispatch({ type: "pointerLeave" });
    vi.advanceTimersByTime(LEAVE_GRACE_MS);
    expect(face()).toBe("front");
  });

  it("keeps a hover-opened back while focus is inside, then returns once focus leaves", () => {
    const { c, face } = setup();
    c.dispatch({ type: "pointerEnter" });
    vi.advanceTimersByTime(HOVER_FLIP_MS);
    c.dispatch({ type: "focusIn" });
    c.dispatch({ type: "pointerLeave" });
    vi.advanceTimersByTime(LEAVE_GRACE_MS * 3);
    expect(face()).toBe("back");
    c.dispatch({ type: "focusOut" });
    vi.advanceTimersByTime(LEAVE_GRACE_MS);
    expect(face()).toBe("front");
  });

  it("keeps explicitly opened details through pointer leave", () => {
    const { c, face } = setup();
    c.dispatch({ type: "pointerEnter" });
    c.dispatch({ type: "details" });
    c.dispatch({ type: "pointerLeave" });
    vi.advanceTimersByTime(LEAVE_GRACE_MS * 5);
    expect(face()).toBe("back");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("suppresses hover auto-flip after an explicit Back until the pointer leaves and re-enters", () => {
    const { c, face } = setup();
    c.dispatch({ type: "pointerEnter" });
    c.dispatch({ type: "details" });
    c.dispatch({ type: "back" });
    vi.advanceTimersByTime(HOVER_FLIP_MS * 3);
    expect(face()).toBe("front");
    c.dispatch({ type: "pointerLeave" });
    c.dispatch({ type: "pointerEnter" });
    vi.advanceTimersByTime(HOVER_FLIP_MS);
    expect(face()).toBe("back");
  });

  it("is blocked by an open menu, a press in progress, or focus on a front control", () => {
    for (const block of [{ type: "menu", open: true }, { type: "press", down: true }, { type: "focusIn" }] as const) {
      const { c, face } = setup();
      c.dispatch(block);
      c.dispatch({ type: "pointerEnter" });
      vi.advanceTimersByTime(HOVER_FLIP_MS * 3);
      expect(face()).toBe("front");
      c.dispatch({ type: "pointerLeave" });
    }
  });

  it("restarts the full hover delay once the menu closes", () => {
    const { c, face } = setup();
    c.dispatch({ type: "pointerEnter" });
    vi.advanceTimersByTime(HOVER_FLIP_MS - 100);
    c.dispatch({ type: "menu", open: true });
    vi.advanceTimersByTime(HOVER_FLIP_MS);
    c.dispatch({ type: "menu", open: false });
    vi.advanceTimersByTime(HOVER_FLIP_MS - 1);
    expect(face()).toBe("front");
    vi.advanceTimersByTime(1);
    expect(face()).toBe("back");
  });

  it("clears its timer on dispose (unmount) and ignores later events", () => {
    const { c, onChange } = setup();
    c.dispatch({ type: "pointerEnter" });
    expect(vi.getTimerCount()).toBe(1);
    onChange.mockClear();
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(HOVER_FLIP_MS * 3);
    c.dispatch({ type: "details" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("flipReducer", () => {
  it("ignores a stale timer whose condition no longer holds", () => {
    const s = { ...INITIAL_FLIP_STATE, hoverEnabled: true, hovering: false };
    expect(flipReducer(s, { type: "hoverTimer" })).toBe(s);
    expect(pendingTimer(s)).toBeNull();
  });
});

describe("faceExposure", () => {
  it("hides the inactive face from AT and keyboard immediately, but keeps it painted while turning", () => {
    expect(faceExposure(false, true)).toEqual({ inert: true, ariaHidden: true, invisible: false });
    expect(faceExposure(false, false)).toEqual({ inert: true, ariaHidden: true, invisible: true });
  });
  it("fully exposes the shown face", () => {
    expect(faceExposure(true, true)).toEqual({ inert: false, ariaHidden: false, invisible: false });
    expect(faceExposure(true, false)).toEqual({ inert: false, ariaHidden: false, invisible: false });
  });
});

describe("nextMenuIndex", () => {
  it("wraps in both directions and starts from the matching end", () => {
    expect(nextMenuIndex(2, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(0, 3, "ArrowUp")).toBe(2);
    expect(nextMenuIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(-1, 3, "ArrowUp")).toBe(2);
    expect(nextMenuIndex(0, 0, "ArrowDown")).toBe(-1);
  });
});
