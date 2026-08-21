import { describe, expect, it } from "vitest";
import { filterClients, filterProjects, UNASSIGNED, type ProjectFilters } from "./filters";
import type { Client, Project, ProjectStage } from "./api";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    client_id: "c1",
    client_business_name: "Riverside Plumbing",
    source_lead_id: null,
    name: "Riverside Plumbing website",
    stage: "design" as ProjectStage,
    package: null,
    price_cents: null,
    deadline: null,
    assigned_user_id: null,
    assigned_user_name: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as Project;
}

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: "c1",
    business_id: "b1",
    business_name: "Coastal Cafe",
    billing_email: null,
    contract_signed_at: null,
    assigned_user_id: null,
    assigned_user_name: null,
    project_count: 0,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as Client;
}

const NO_PROJECT_FILTERS: ProjectFilters = {
  search: "",
  stage: "",
  assignee: "",
  showFinished: false,
};

describe("filterProjects", () => {
  it("hides finished work by default so live projects aren't buried", () => {
    const rows = [
      project({ id: "live", stage: "design" }),
      project({ id: "done", stage: "complete" }),
      project({ id: "care", stage: "maintenance" }),
    ];

    expect(filterProjects(rows, NO_PROJECT_FILTERS).map((p) => p.id)).toEqual(["live"]);
  });

  it("includes finished work when asked", () => {
    const rows = [project({ id: "live" }), project({ id: "done", stage: "complete" })];

    expect(filterProjects(rows, { ...NO_PROJECT_FILTERS, showFinished: true })).toHaveLength(2);
  });

  it("an explicit stage filter overrides the hide-finished default", () => {
    const rows = [project({ id: "live" }), project({ id: "care", stage: "maintenance" })];

    const result = filterProjects(rows, { ...NO_PROJECT_FILTERS, stage: "maintenance" });
    expect(result.map((p) => p.id)).toEqual(["care"]);
  });

  it("searches the client name, not just the project name", () => {
    const rows = [
      project({ id: "a", name: "Site rebuild", client_business_name: "Coastal Cafe" }),
      project({ id: "b", name: "Site rebuild", client_business_name: "Riverside Plumbing" }),
    ];

    expect(filterProjects(rows, { ...NO_PROJECT_FILTERS, search: "coastal" }).map((p) => p.id)).toEqual(["a"]);
  });

  it("ignores case and surrounding whitespace in the query", () => {
    const rows = [project({ id: "a", name: "Riverside Plumbing website" })];

    expect(filterProjects(rows, { ...NO_PROJECT_FILTERS, search: "  PLUMBING " })).toHaveLength(1);
  });

  it("matches on package too", () => {
    const rows = [project({ id: "a", package: "Core" }), project({ id: "b", package: "Simple" })];

    expect(filterProjects(rows, { ...NO_PROJECT_FILTERS, search: "core" }).map((p) => p.id)).toEqual(["a"]);
  });

  it("filters to one assignee", () => {
    const rows = [
      project({ id: "mine", assigned_user_id: "u1" }),
      project({ id: "theirs", assigned_user_id: "u2" }),
      project({ id: "nobody", assigned_user_id: null }),
    ];

    expect(filterProjects(rows, { ...NO_PROJECT_FILTERS, assignee: "u1" }).map((p) => p.id)).toEqual(["mine"]);
  });

  it("filters to unassigned work", () => {
    const rows = [
      project({ id: "mine", assigned_user_id: "u1" }),
      project({ id: "nobody", assigned_user_id: null }),
    ];

    expect(filterProjects(rows, { ...NO_PROJECT_FILTERS, assignee: UNASSIGNED }).map((p) => p.id)).toEqual([
      "nobody",
    ]);
  });

  it("combines filters rather than picking one", () => {
    const rows = [
      project({ id: "a", client_business_name: "Coastal Cafe", assigned_user_id: "u1" }),
      project({ id: "b", client_business_name: "Coastal Cafe", assigned_user_id: "u2" }),
      project({ id: "c", client_business_name: "Riverside Plumbing", assigned_user_id: "u1" }),
    ];

    const result = filterProjects(rows, { ...NO_PROJECT_FILTERS, search: "coastal", assignee: "u1" });
    expect(result.map((p) => p.id)).toEqual(["a"]);
  });

  it("returns everything when nothing is filtered", () => {
    const rows = [project({ id: "a" }), project({ id: "b" })];
    expect(filterProjects(rows, NO_PROJECT_FILTERS)).toHaveLength(2);
  });
});

describe("filterClients", () => {
  it("searches business name and billing email", () => {
    const rows = [
      client({ id: "a", business_name: "Coastal Cafe", billing_email: "pay@coastal.example" }),
      client({ id: "b", business_name: "Riverside Plumbing", billing_email: "accounts@riverside.example" }),
    ];

    expect(filterClients(rows, { search: "riverside.example", assignee: "" }).map((c) => c.id)).toEqual(["b"]);
    expect(filterClients(rows, { search: "cafe", assignee: "" }).map((c) => c.id)).toEqual(["a"]);
  });

  it("tolerates a missing billing email", () => {
    const rows = [client({ id: "a", billing_email: null })];

    expect(filterClients(rows, { search: "coastal", assignee: "" })).toHaveLength(1);
    expect(filterClients(rows, { search: "nomatch", assignee: "" })).toHaveLength(0);
  });

  it("filters to unassigned clients", () => {
    const rows = [
      client({ id: "a", assigned_user_id: "u1" }),
      client({ id: "b", assigned_user_id: null }),
    ];

    expect(filterClients(rows, { search: "", assignee: UNASSIGNED }).map((c) => c.id)).toEqual(["b"]);
  });
});
