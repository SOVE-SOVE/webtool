import { describe, expect, it } from "vitest";
import { ringDashes, ringSeriesAt, type RingDashes } from "./breakdownRing";

const C = 240;
const GAP = 2;

/** The four boundaries, in drawing order. */
const edges = (d: RingDashes) => [d.received.start, d.received.start + d.received.length, d.overdue.start, d.overdue.start + d.overdue.length];

describe("ringDashes", () => {
  it("two segments: proportional, with the gap at both joins", () => {
    const d = ringDashes(7500, 2500, C, GAP);
    expect(d.received).toEqual({ start: 1, length: 178 });
    expect(d.overdue).toEqual({ start: 181, length: 58 });
    // The gap between the two, and across 12 o'clock.
    expect(d.overdue.start - (d.received.start + d.received.length)).toBe(GAP);
    expect(C - (d.overdue.start + d.overdue.length) + d.received.start).toBe(GAP);
  });

  it("single segment: the full ring, no gap", () => {
    expect(ringDashes(5000, 0, C, GAP)).toEqual({ received: { start: 0, length: C }, overdue: { start: C, length: 0 } });
    expect(ringDashes(0, 5000, C, GAP)).toEqual({ received: { start: 0, length: 0 }, overdue: { start: 0, length: C } });
  });

  it("zero: draws nothing", () => {
    const d = ringDashes(0, 0, C, GAP);
    expect(d.received.length).toBe(0);
    expect(d.overdue.length).toBe(0);
  });

  it("treats a negative amount as nothing to draw", () => {
    expect(ringDashes(-400, 5000, C, GAP)).toEqual(ringDashes(0, 5000, C, GAP));
    expect(ringDashes(-400, -1, C, GAP).overdue.length).toBe(0);
  });

  it("a tiny share still draws its minimum length", () => {
    const small = ringDashes(1, 1_000_000, C, GAP, 1.5);
    expect(small.received.length).toBeCloseTo(1.5);
    expect(small.overdue.length).toBeCloseTo(C - 1.5 - 2 * GAP);
    const other = ringDashes(1_000_000, 1, C, GAP, 1.5);
    expect(other.overdue.length).toBeCloseTo(1.5);
    expect(other.received.length + other.overdue.length).toBeCloseTo(C - 2 * GAP);
  });

  it("never draws a negative length when a share is smaller than the gap", () => {
    const d = ringDashes(1, 1_000_000, C, GAP);
    expect(d.received.length).toBeGreaterThanOrEqual(0);
    expect(d.overdue.length).toBeGreaterThan(0);
  });

  it("keeps its boundaries in order through a blend between any two states", () => {
    const states = [
      ringDashes(7500, 2500, C, GAP, 1.5),
      ringDashes(100, 9900, C, GAP, 1.5),
      ringDashes(5000, 0, C, GAP, 1.5),
      ringDashes(0, 5000, C, GAP, 1.5),
      ringDashes(1, 1_000_000, C, GAP, 1.5),
    ];
    for (const from of states) {
      for (const to of states) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const [r0, r1, o0, o1] = edges(from).map((v, i) => v + (edges(to)[i] - v) * t);
          expect(r0).toBeGreaterThanOrEqual(0);
          expect(r1).toBeGreaterThanOrEqual(r0);
          expect(o0).toBeGreaterThanOrEqual(r1 - 1e-9);
          expect(o1).toBeGreaterThanOrEqual(o0);
          expect(o1).toBeLessThanOrEqual(C + r0 + 1e-9);
        }
      }
    }
  });
});

describe("ringSeriesAt", () => {
  it("finds the series under a position, and nothing in a gap", () => {
    const d = ringDashes(7500, 2500, C, GAP);
    expect(ringSeriesAt(d, 90)).toBe("received");
    expect(ringSeriesAt(d, 200)).toBe("overdue");
    expect(ringSeriesAt(d, 180)).toBeNull();
    expect(ringSeriesAt(d, 0.5)).toBeNull();
  });

  it("a full ring is one series everywhere; a zero-length dash is never hit", () => {
    const received = ringDashes(5000, 0, C, GAP);
    expect(ringSeriesAt(received, 0)).toBe("received");
    expect(ringSeriesAt(received, C)).toBe("received");
    const overdue = ringDashes(0, 5000, C, GAP);
    expect(ringSeriesAt(overdue, 0)).toBe("overdue");
    expect(ringSeriesAt(ringDashes(0, 0, C, GAP), 10)).toBeNull();
  });
});
