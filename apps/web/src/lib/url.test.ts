import { describe, expect, it } from "vitest";
import { withParam, withoutParam } from "./url";

describe("withParam", () => {
  it("adds a new param while preserving existing ones", () => {
    const sp = new URLSearchParams("tab=won");
    expect(withParam(sp, "preview", "abc")).toBe("tab=won&preview=abc");
  });

  it("overwrites an existing param", () => {
    const sp = new URLSearchParams("tab=won&view=board");
    expect(withParam(sp, "tab", "lost")).toBe("tab=lost&view=board");
  });

  it("removes the param when value is null", () => {
    const sp = new URLSearchParams("tab=won&view=board");
    expect(withParam(sp, "tab", null)).toBe("view=board");
  });

  it("removes the param when value is an empty string", () => {
    const sp = new URLSearchParams("tab=won&view=board");
    expect(withParam(sp, "tab", "")).toBe("view=board");
  });

  it("does not mutate the input searchParams", () => {
    const sp = new URLSearchParams("tab=won");
    withParam(sp, "tab", "lost");
    expect(sp.get("tab")).toBe("won");
  });
});

describe("withoutParam", () => {
  it("removes just the named param", () => {
    const sp = new URLSearchParams("tab=won&preview=abc");
    expect(withoutParam(sp, "preview")).toBe("tab=won");
  });

  it("is a no-op when the param isn't present", () => {
    const sp = new URLSearchParams("tab=won");
    expect(withoutParam(sp, "preview")).toBe("tab=won");
  });
});
