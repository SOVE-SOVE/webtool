import { describe, expect, it } from "vitest";
import { diffNewIds } from "./discovery-diff";

describe("diffNewIds", () => {
  it("returns ids not present in the previous set", () => {
    const fresh = diffNewIds(new Set(["a", "b"]), [{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(fresh).toEqual(new Set(["c"]));
  });

  it("treats every row as new when the previous set is empty", () => {
    const fresh = diffNewIds(new Set(), [{ id: "a" }, { id: "b" }]);
    expect(fresh).toEqual(new Set(["a", "b"]));
  });

  it("returns an empty set when nothing is new", () => {
    const fresh = diffNewIds(new Set(["a", "b"]), [{ id: "a" }, { id: "b" }]);
    expect(fresh.size).toBe(0);
  });
});
