import { describe, expect, it } from "vitest";
import { countText, initialCountSwap, nextCountSwap, settleCountSwap } from "./countSwap";

describe("countText", () => {
  it("keeps zero and strings, and treats null/undefined as not loaded", () => {
    expect(countText(0)).toBe("0");
    expect(countText(12)).toBe("12");
    expect(countText("99+")).toBe("99+");
    expect(countText(null)).toBeNull();
    expect(countText(undefined)).toBeNull();
  });
});

describe("count swap", () => {
  it("shows the first value directly, with nothing outgoing", () => {
    expect(initialCountSwap("20")).toEqual({ current: "20", outgoing: null, swaps: 0 });
  });

  it("does not animate a placeholder turning into the first real value", () => {
    const loaded = nextCountSwap(initialCountSwap(null), "20");
    expect(loaded).toEqual({ current: "20", outgoing: null, swaps: 0 });
  });

  it("follows the value directly while the caller says it is still settling", () => {
    const partial = nextCountSwap(initialCountSwap("0"), "7", false);
    expect(partial).toEqual({ current: "7", outgoing: null, swaps: 0 });
    expect(nextCountSwap(partial, "22", false)).toEqual({ current: "22", outgoing: null, swaps: 0 });
    // …and swaps as usual once it has.
    expect(nextCountSwap(nextCountSwap(partial, "22", false), "23", true)).toEqual({ current: "23", outgoing: "22", swaps: 1 });
  });

  it("returns the same state when the value is unchanged", () => {
    const state = initialCountSwap("20");
    expect(nextCountSwap(state, "20")).toBe(state);
  });

  it("swaps from the shown value straight to the new one", () => {
    expect(nextCountSwap(initialCountSwap("20"), "23")).toEqual({ current: "23", outgoing: "20", swaps: 1 });
  });

  it("settles rapid changes on the latest value without a queue", () => {
    let state = initialCountSwap("1");
    for (const v of ["2", "3", "4"]) state = nextCountSwap(state, v);
    expect(state).toEqual({ current: "4", outgoing: "3", swaps: 3 });
  });

  it("drops the outgoing value when the count goes away", () => {
    const mid = nextCountSwap(initialCountSwap("1"), "2");
    expect(nextCountSwap(mid, null)).toEqual({ current: null, outgoing: null, swaps: 1 });
  });

  it("clears the outgoing value once its own exit ends", () => {
    const mid = nextCountSwap(initialCountSwap("1"), "2");
    expect(settleCountSwap(mid, 1)).toEqual({ current: "2", outgoing: null, swaps: 1 });
  });

  it("ignores an exit that a later swap superseded", () => {
    const later = nextCountSwap(nextCountSwap(initialCountSwap("1"), "2"), "3");
    expect(settleCountSwap(later, 1)).toBe(later);
    const settled = initialCountSwap("1");
    expect(settleCountSwap(settled, 0)).toBe(settled);
  });
});
