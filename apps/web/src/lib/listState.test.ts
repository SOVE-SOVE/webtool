import { describe, expect, it } from "vitest";
import { filteredEmptyCopy, listState } from "./listState";

describe("listState", () => {
  it("is loading until data arrives, never empty", () => {
    expect(listState({ loaded: false, error: false, visible: 0, filtersActive: false })).toBe("loading");
    expect(listState({ loaded: false, error: false, visible: 0, filtersActive: true })).toBe("loading");
  });

  it("is an error, not empty, when the first load fails", () => {
    expect(listState({ loaded: false, error: true, visible: 0, filtersActive: false })).toBe("error");
  });

  it("does not present a failed refetch as no records", () => {
    expect(listState({ loaded: true, error: true, visible: 0, filtersActive: false })).toBe("error");
    expect(listState({ loaded: true, error: true, visible: 0, filtersActive: true })).toBe("error");
  });

  it("keeps showing rows it already has when a refetch fails", () => {
    expect(listState({ loaded: true, error: true, visible: 3, filtersActive: false })).toBe("results");
  });

  it("is empty only when nothing is filtering", () => {
    expect(listState({ loaded: true, error: false, visible: 0, filtersActive: false })).toBe("empty");
  });

  it("is filtered-empty only when something is filtering", () => {
    expect(listState({ loaded: true, error: false, visible: 0, filtersActive: true })).toBe("filtered-empty");
  });

  it("shows results whenever there are rows", () => {
    expect(listState({ loaded: true, error: false, visible: 1, filtersActive: true })).toBe("results");
    expect(listState({ loaded: true, error: false, visible: 1, filtersActive: false })).toBe("results");
  });
});

describe("filteredEmptyCopy", () => {
  it("names the search term", () => {
    expect(filteredEmptyCopy({ noun: "clients", search: "  xyz ", filterCount: 0 })).toEqual({
      title: "No clients match “xyz”",
      description: undefined,
    });
  });

  it("mentions filters that are on alongside the search", () => {
    expect(filteredEmptyCopy({ noun: "leads", search: "xyz", filterCount: 1 }).description).toBe("1 filter is also applied.");
    expect(filteredEmptyCopy({ noun: "leads", search: "xyz", filterCount: 2 }).description).toBe("2 filters are also applied.");
  });

  it("falls back to the filters when there is no search", () => {
    expect(filteredEmptyCopy({ noun: "projects", search: "   ", filterCount: 2 })).toEqual({
      title: "No projects match these filters",
    });
  });

  it("shortens a very long search term", () => {
    const { title } = filteredEmptyCopy({ noun: "plans", search: "a".repeat(80), filterCount: 0 });
    expect(title).toBe(`No plans match “${"a".repeat(40)}…”`);
  });
});
