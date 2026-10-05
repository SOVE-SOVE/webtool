import { describe, expect, it, vi } from "vitest";
import { copyAnnouncement, copyOutcome, writeClipboard } from "./copyFeedback";

describe("writeClipboard", () => {
  it("passes the full value and resolves true once the write resolves", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    await expect(writeClipboard("https://example.com.au/path?x=1", { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.com.au/path?x=1");
  });

  it("calls writeText synchronously, inside the caller's gesture", () => {
    const writeText = vi.fn(() => Promise.resolve());
    void writeClipboard("a@b.co", { writeText });
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("resolves false when the write is rejected", async () => {
    await expect(writeClipboard("x", { writeText: () => Promise.reject(new Error("denied")) })).resolves.toBe(false);
  });

  it("resolves false when writeText throws", async () => {
    const clipboard = {
      writeText: () => {
        throw new Error("no gesture");
      },
    };
    await expect(writeClipboard("x", clipboard)).resolves.toBe(false);
  });

  it("resolves false when the Clipboard API is unavailable", async () => {
    await expect(writeClipboard("x", undefined)).resolves.toBe(false);
    await expect(writeClipboard("x", null)).resolves.toBe(false);
    await expect(writeClipboard("x", {} as never)).resolves.toBe(false);
  });
});

describe("copyOutcome", () => {
  it("reports the latest attempt's result", () => {
    expect(copyOutcome(true, 2, 2)).toBe("copied");
    expect(copyOutcome(false, 2, 2)).toBe("failed");
  });

  it("ignores a write a newer click or an unmount superseded", () => {
    expect(copyOutcome(true, 1, 2)).toBeNull();
    expect(copyOutcome(false, 1, 2)).toBeNull();
  });
});

describe("copyAnnouncement", () => {
  it("says nothing while idle", () => {
    expect(copyAnnouncement("idle")).toBe("");
    expect(copyAnnouncement("copied")).toBe("Copied");
    expect(copyAnnouncement("failed")).toBe("Couldn't copy");
  });
});
