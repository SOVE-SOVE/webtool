import { describe, expect, it } from "vitest";
import { formatAud, formatDate, timeAgo } from "./format";

const NOW = new Date("2026-08-24T12:00:00Z").getTime();

describe("formatAud", () => {
  it("renders an em dash for null/undefined", () => {
    expect(formatAud(null)).toBe("—");
    expect(formatAud(undefined)).toBe("—");
  });

  it("formats cents as whole dollars", () => {
    expect(formatAud(0)).toBe("$0");
    expect(formatAud(89900)).toBe("$899");
    expect(formatAud(129999)).toBe("$1,300");
  });
});

describe("timeAgo", () => {
  it("buckets by magnitude", () => {
    expect(timeAgo("2026-08-24T11:59:30Z", NOW)).toBe("just now");
    expect(timeAgo("2026-08-24T11:45:00Z", NOW)).toBe("15m ago");
    expect(timeAgo("2026-08-24T09:00:00Z", NOW)).toBe("3h ago");
    expect(timeAgo("2026-08-20T12:00:00Z", NOW)).toBe("4d ago");
  });

  it("never returns a negative duration for a future timestamp", () => {
    expect(timeAgo("2026-08-25T12:00:00Z", NOW)).toBe("just now");
  });
});

describe("formatDate", () => {
  it("renders a business date as day/short-month/year", () => {
    expect(formatDate("2026-09-15")).toBe("15 Sept 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
  });

  it("never shifts a day, regardless of the viewer's timezone offset", () => {
    // new Date("2026-01-01") (UTC-midnight parsing) is the classic trap —
    // a negative-UTC-offset viewer would see "31 Dec 2025" instead.
    // formatDate must parse Y/M/D directly to avoid that.
    expect(formatDate("2026-01-01")).not.toContain("2025");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
  });
});
