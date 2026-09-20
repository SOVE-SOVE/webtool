import { describe, expect, it } from "vitest";
import { formatWinRate, winRateRing } from "./winRate";

describe("formatWinRate", () => {
  it("shows a whole percent, exactly as the dashboard always has", () => {
    expect(formatWinRate(62)).toBe("62%");
    expect(formatWinRate(61.538)).toBe("62%");
    expect(formatWinRate(0)).toBe("0%");
    expect(formatWinRate(100)).toBe("100%");
  });

  it("shows a dash when nothing has been decided yet", () => {
    expect(formatWinRate(null)).toBe("—");
  });
});

describe("winRateRing", () => {
  const r = 26;
  const c = 2 * Math.PI * r;

  it("fills the arc in proportion to the rate", () => {
    expect(winRateRing(50, r).dash).toBeCloseTo(c / 2);
    expect(winRateRing(25, r).dash).toBeCloseTo(c / 4);
    expect(winRateRing(50, r).circumference).toBeCloseTo(c);
  });

  it("is a full ring at 100% and draws nothing at 0% or null", () => {
    expect(winRateRing(100, r)).toMatchObject({ filled: true });
    expect(winRateRing(100, r).dash).toBeCloseTo(c);
    expect(winRateRing(0, r).filled).toBe(false);
    expect(winRateRing(null, r).filled).toBe(false);
  });

  it("clamps out-of-range values", () => {
    expect(winRateRing(140, r).dash).toBeCloseTo(c);
    expect(winRateRing(-5, r)).toMatchObject({ dash: 0, filled: false });
  });
});
