/**
 * Geometry for the day-detail breakdown ring (DayDetailPanel): Received
 * and Overdue as two dashes on two full circles that are always there, so
 * a new selection only changes each dash's start and length — which CSS
 * can transition from wherever the dash currently is. Lengths are along
 * the circumference, clockwise from 12 o'clock.
 */

export type RingSeriesKey = "received" | "overdue";

export type RingDash = {
  /** Where the dash begins, along the circumference from 12 o'clock. */
  start: number;
  /** Its drawn length; 0 = this series draws nothing. */
  length: number;
};

export type RingDashes = Record<RingSeriesKey, RingDash>;

/**
 * The two dashes for a pair of amounts.
 *
 * - Both positive: Received then Overdue, clockwise, `gap` apart at both
 *   joins. A share too small to see still draws `minLength` (taken from
 *   the other dash) — a real amount never disappears.
 * - One positive: that series is the full ring, no gap; the other is a
 *   zero-length dash parked where it would grow from.
 * - Neither positive: nothing is drawn.
 *
 * Received always ends at or before Overdue's start, and Overdue at or
 * before the full circle, in every case — so a straight-line blend
 * between any two results never overlaps or opens a stray gap.
 */
export function ringDashes(receivedCents: number, overdueCents: number, circumference: number, gap: number, minLength = 0): RingDashes {
  const received = Math.max(0, receivedCents);
  const overdue = Math.max(0, overdueCents);
  const total = received + overdue;
  if (total <= 0) {
    return { received: { start: 0, length: 0 }, overdue: { start: circumference, length: 0 } };
  }
  if (overdue === 0) {
    return { received: { start: 0, length: circumference }, overdue: { start: circumference, length: 0 } };
  }
  if (received === 0) {
    return { received: { start: 0, length: 0 }, overdue: { start: 0, length: circumference } };
  }
  const smallest = Math.min(gap + minLength, circumference / 2);
  const receivedSweep = Math.min(Math.max((received / total) * circumference, smallest), circumference - smallest);
  return {
    received: { start: gap / 2, length: receivedSweep - gap },
    overdue: { start: receivedSweep + gap / 2, length: circumference - receivedSweep - gap },
  };
}

/** The series whose dash covers `position` (along the circumference from
 * 12 o'clock), or null in a gap — pointer hit-testing against the current
 * amounts, so a tooltip can never describe an earlier selection. */
export function ringSeriesAt(dashes: RingDashes, position: number): RingSeriesKey | null {
  for (const key of ["received", "overdue"] as const) {
    const { start, length } = dashes[key];
    if (length > 0 && position >= start && position <= start + length) return key;
  }
  return null;
}
