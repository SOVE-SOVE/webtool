import { describe, expect, it } from "vitest";
import { ALL_NAV_HREFS, HOME_LINK, isNavLinkActive, NAV_SECTIONS, SETTINGS_LINK } from "./nav";

describe("nav config", () => {
  it("has the five approved groups in order", () => {
    expect(NAV_SECTIONS.map((s) => s.id)).toEqual(["home", "find", "sell", "build"]);
  });

  it("routes to no duplicate hrefs", () => {
    expect(new Set(ALL_NAV_HREFS).size).toBe(ALL_NAV_HREFS.length);
  });

  it("keeps Review in the sidebar", () => {
    expect(ALL_NAV_HREFS).toContain("/dashboard/review");
  });

  it("folds Pipeline and Clients into Leads (routes redirect, so not separate nav items)", () => {
    expect(ALL_NAV_HREFS).not.toContain("/dashboard/pipeline");
    expect(ALL_NAV_HREFS).not.toContain("/dashboard/clients");
    const leads = NAV_SECTIONS.flatMap((s) => s.links).find((l) => l.href === "/dashboard/leads")!;
    expect(isNavLinkActive("/dashboard/pipeline", leads)).toBe(true);
    expect(isNavLinkActive("/dashboard/clients/abc123", leads)).toBe(true);
  });

  it("every href is under /dashboard", () => {
    for (const href of ALL_NAV_HREFS) expect(href.startsWith("/dashboard")).toBe(true);
  });
});

describe("isNavLinkActive", () => {
  it("matches Overview only on an exact path", () => {
    expect(isNavLinkActive("/dashboard", HOME_LINK)).toBe(true);
    expect(isNavLinkActive("/dashboard/leads", HOME_LINK)).toBe(false);
  });

  it("matches a section link on its own subtree", () => {
    const leads = NAV_SECTIONS.flatMap((s) => s.links).find((l) => l.href === "/dashboard/leads")!;
    expect(isNavLinkActive("/dashboard/leads", leads)).toBe(true);
    expect(isNavLinkActive("/dashboard/leads/abc123", leads)).toBe(true);
    expect(isNavLinkActive("/dashboard/leads-archive", leads)).toBe(false);
  });

  it("honours activePrefixes (Review lights up on a discovered-business page)", () => {
    const review = NAV_SECTIONS.flatMap((s) => s.links).find((l) => l.href === "/dashboard/review")!;
    expect(isNavLinkActive("/dashboard/discovered-businesses/xyz", review)).toBe(true);
    expect(isNavLinkActive("/dashboard/discovery", review)).toBe(false);
  });

  it("does not confuse /dashboard/discovery with /dashboard/discovered-businesses", () => {
    const discovery = NAV_SECTIONS.flatMap((s) => s.links).find((l) => l.href === "/dashboard/discovery")!;
    expect(isNavLinkActive("/dashboard/discovered-businesses/xyz", discovery)).toBe(false);
  });

  it("Settings is a standalone link", () => {
    expect(isNavLinkActive("/dashboard/settings", SETTINGS_LINK)).toBe(true);
  });
});
