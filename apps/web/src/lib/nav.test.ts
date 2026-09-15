import { describe, expect, it } from "vitest";
import { ALL_NAV_HREFS, MOBILE_PRIMARY_HREFS, NAV_SECTIONS, isNavLinkActive } from "./nav";

function link(href: string) {
  const found = NAV_SECTIONS.flatMap((s) => s.links).find((l) => l.href === href);
  if (!found) throw new Error(`no nav link for ${href}`);
  return found;
}

function q(query = ""): URLSearchParams {
  return new URLSearchParams(query);
}

describe("nav config", () => {
  it("has the six workflow groups in order", () => {
    expect(NAV_SECTIONS.map((s) => s.id)).toEqual(["workspace", "discover", "sales", "build", "manage", "system"]);
  });

  it("routes to no duplicate hrefs", () => {
    expect(new Set(ALL_NAV_HREFS).size).toBe(ALL_NAV_HREFS.length);
  });

  it("keeps Review, Sales, Follow-ups, Tasks and Calendar in the sidebar", () => {
    for (const href of [
      "/dashboard/review",
      "/dashboard/sales",
      "/dashboard/follow-ups",
      "/dashboard/tasks",
      "/dashboard/calendar",
    ]) {
      expect(ALL_NAV_HREFS).toContain(href);
    }
  });

  it("folds Planning and Projects into a single Build entry — no separate landing-page links, and no redundant second 'Build' link alongside it", () => {
    const build = NAV_SECTIONS.find((s) => s.id === "build")!;
    expect(build.links.map((l) => l.label)).toEqual(["Build"]);
    expect(build.links[0].href).toBe("/dashboard/build");
  });

  it("Manage has a single entry, Clients — Live Websites and Revenue folded into its tabs", () => {
    const manage = NAV_SECTIONS.find((s) => s.id === "manage")!;
    expect(manage.links.map((l) => l.label)).toEqual(["Clients"]);
    expect(ALL_NAV_HREFS).not.toContain("/dashboard/revenue");
    expect(ALL_NAV_HREFS).not.toContain("/dashboard/projects?view=live");
  });

  it("folds Pipeline into Leads (its route redirects, so it's not a separate nav item)", () => {
    expect(ALL_NAV_HREFS).not.toContain("/dashboard/pipeline");
    expect(isNavLinkActive("/dashboard/pipeline", q(), link("/dashboard/leads"))).toBe(true);
  });

  it("every href's path is under /dashboard", () => {
    for (const href of ALL_NAV_HREFS) expect(href.split("?")[0].startsWith("/dashboard")).toBe(true);
  });

  it("the mobile bottom nav's four primary hrefs all resolve to a real nav link", () => {
    for (const href of MOBILE_PRIMARY_HREFS) expect(ALL_NAV_HREFS).toContain(href);
    expect(MOBILE_PRIMARY_HREFS).toHaveLength(4);
  });
});

describe("isNavLinkActive", () => {
  it("matches Today only on an exact path", () => {
    expect(isNavLinkActive("/dashboard", q(), link("/dashboard"))).toBe(true);
    expect(isNavLinkActive("/dashboard/leads", q(), link("/dashboard"))).toBe(false);
  });

  it("matches a section link on its own subtree", () => {
    const clients = link("/dashboard/clients");
    expect(isNavLinkActive("/dashboard/clients", q(), clients)).toBe(true);
    expect(isNavLinkActive("/dashboard/clients/abc123", q(), clients)).toBe(true);
    expect(isNavLinkActive("/dashboard/clients-archive", q(), clients)).toBe(false);
  });

  it("Build lights up on either view, either's own detail pages, and the bare redirect route — never on an unrelated path", () => {
    const build = link("/dashboard/build");
    expect(isNavLinkActive("/dashboard/build", q(), build)).toBe(true);
    expect(isNavLinkActive("/dashboard/build/planning", q(), build)).toBe(true);
    expect(isNavLinkActive("/dashboard/build/projects", q(), build)).toBe(true);
    expect(isNavLinkActive("/dashboard/planning/abc123", q(), build)).toBe(true);
    expect(isNavLinkActive("/dashboard/projects/abc123", q(), build)).toBe(true);
    expect(isNavLinkActive("/dashboard/leads", q(), build)).toBe(false);
  });

  it("honours activePrefixes (Review lights up on a discovered-business page)", () => {
    const review = link("/dashboard/review");
    expect(isNavLinkActive("/dashboard/discovered-businesses/xyz", q(), review)).toBe(true);
    expect(isNavLinkActive("/dashboard/discovery", q(), review)).toBe(false);
  });

  it("does not confuse Map Discovery with Review's discovered-business pages", () => {
    const discovery = link("/dashboard/discovery");
    expect(isNavLinkActive("/dashboard/discovered-businesses/xyz", q(), discovery)).toBe(false);
  });

  it("Leads is active on the leads list and a lead detail page", () => {
    const leads = link("/dashboard/leads");
    expect(isNavLinkActive("/dashboard/leads", q(), leads)).toBe(true);
    expect(isNavLinkActive("/dashboard/leads/abc123", q(), leads)).toBe(true);
  });

  it("Clients is its own route, active on the list and a client detail page", () => {
    const clients = link("/dashboard/clients");
    expect(isNavLinkActive("/dashboard/clients", q(), clients)).toBe(true);
    expect(isNavLinkActive("/dashboard/clients/xyz", q(), clients)).toBe(true);
    expect(isNavLinkActive("/dashboard/leads", q(), clients)).toBe(false);
  });

  it("Clients stays active across all three of its own tabs (Overview/Websites/Revenue)", () => {
    const clients = link("/dashboard/clients");
    for (const tab of ["", "overview", "websites", "revenue"]) {
      expect(isNavLinkActive("/dashboard/clients", q(tab ? `tab=${tab}` : ""), clients)).toBe(true);
    }
  });

  it("Settings is a standalone link", () => {
    expect(isNavLinkActive("/dashboard/settings", q(), link("/dashboard/settings"))).toBe(true);
  });
});
