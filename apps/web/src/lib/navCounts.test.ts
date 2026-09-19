import { describe, expect, it } from "vitest";
import { waitingInReviewQueue } from "./navCounts";

describe("waitingInReviewQueue", () => {
  it("counts needs-review plus approved, not decided states", () => {
    expect(
      waitingInReviewQueue({ all: 40, needs_review: 12, approved: 3, imported: 20, rejected: 4, archived: 1 }),
    ).toBe(15);
  });
  it("treats missing tabs as zero", () => {
    expect(waitingInReviewQueue({})).toBe(0);
  });
});
