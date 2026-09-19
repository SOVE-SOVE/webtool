import { describe, expect, it } from "vitest";
import { diffChangedIds, snapshotStamps } from "./recentChanges";

type Row = { id: string; updated_at: string };
const id = (r: Row) => r.id;
const stamp = (r: Row) => r.updated_at;
const a: Row = { id: "a", updated_at: "1" };
const b: Row = { id: "b", updated_at: "1" };

describe("diffChangedIds", () => {
  it("reports nothing on first load (no previous snapshot)", () => {
    expect(diffChangedIds(null, [a, b], id, stamp).size).toBe(0);
  });

  it("reports nothing when the dataset is unchanged (e.g. a poll tick)", () => {
    const prev = snapshotStamps([a, b], id, stamp);
    expect(diffChangedIds(prev, [a, b], id, stamp).size).toBe(0);
  });

  it("reports a newly added row", () => {
    const prev = snapshotStamps([a], id, stamp);
    expect([...diffChangedIds(prev, [a, b], id, stamp)]).toEqual(["b"]);
  });

  it("reports an updated row but not its unchanged neighbours", () => {
    const prev = snapshotStamps([a, b], id, stamp);
    const a2 = { ...a, updated_at: "2" };
    expect([...diffChangedIds(prev, [a2, b], id, stamp)]).toEqual(["a"]);
  });

  it("does not report a removed row", () => {
    const prev = snapshotStamps([a, b], id, stamp);
    expect(diffChangedIds(prev, [a], id, stamp).size).toBe(0);
  });
});
