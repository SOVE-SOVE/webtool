import { describe, expect, it } from "vitest";
import {
  activeProjectCount,
  buildAttentionCards,
  clientNextAction,
  clientRowMatchesFilters,
  clientTone,
  currentProject,
  liveWebsiteCount,
  mostRecentActivity,
  NO_OVERVIEW_FILTERS,
  openTaskCount,
  projectsForClient,
} from "./clients";
import type { ActivityItem, ClientChecklistSummary, NextPaymentObligation, Project, ProjectStage } from "./api";

function obligation(overrides: Partial<NextPaymentObligation> & { client_id: string | null }): NextPaymentObligation {
  return {
    kind: "website_balance",
    project_id: "p1",
    project_name: "Website",
    client_business_name: "Acme",
    amount_cents: 10000,
    due_date: "2026-08-01",
    is_overdue: true,
    days_relative: -3,
    website_agreement_id: null,
    hosting_charge_id: null,
    hosting_plan_id: null,
    scheduled: false,
    ...overrides,
  };
}

function checklistSummary(overrides: Partial<ClientChecklistSummary> & { client_id: string }): ClientChecklistSummary {
  return { completed: 0, total: 0, pct: null, ...overrides };
}

function project(overrides: Partial<Project> & { id: string; client_id: string; stage: ProjectStage }): Project {
  return {
    business_id: "b1",
    client_business_name: "Acme",
    source_lead_id: null,
    name: "Website",
    package: null,
    price_cents: null,
    deadline: null,
    build_direction: null,
    assigned_user_id: null,
    assigned_user_name: null,
    delivered_at: null,
    delivered_by_user_name: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityItem> & { id: string }): ActivityItem {
  return {
    user_id: null,
    user_name: null,
    entity_type: "client",
    entity_id: "c1",
    action: "created",
    summary: null,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("projectsForClient", () => {
  it("filters to the given client", () => {
    const rows = [
      project({ id: "p1", client_id: "c1", stage: "design" }),
      project({ id: "p2", client_id: "c2", stage: "design" }),
    ];
    expect(projectsForClient(rows, "c1").map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("clientTone", () => {
  it("is onboarding with no projects", () => {
    expect(clientTone([])).toBe("onboarding");
  });

  it("is active with any unfinished project", () => {
    expect(clientTone([project({ id: "p1", client_id: "c1", stage: "design" })])).toBe("active");
  });

  it("is complete only when every project is finished", () => {
    expect(clientTone([project({ id: "p1", client_id: "c1", stage: "maintenance" })])).toBe("complete");
    expect(
      clientTone([
        project({ id: "p1", client_id: "c1", stage: "complete" }),
        project({ id: "p2", client_id: "c1", stage: "design" }),
      ]),
    ).toBe("active");
  });
});

describe("currentProject", () => {
  it("returns null with no projects", () => {
    expect(currentProject([])).toBeNull();
  });

  it("prefers the unfinished project over a finished one", () => {
    const finished = project({ id: "p1", client_id: "c1", stage: "complete", updated_at: "2026-08-05T00:00:00Z" });
    const active = project({ id: "p2", client_id: "c1", stage: "design", updated_at: "2026-08-01T00:00:00Z" });
    expect(currentProject([finished, active])?.id).toBe("p2");
  });

  it("falls back to the most recently updated finished project", () => {
    const older = project({ id: "p1", client_id: "c1", stage: "complete", updated_at: "2026-08-01T00:00:00Z" });
    const newer = project({ id: "p2", client_id: "c1", stage: "maintenance", updated_at: "2026-08-05T00:00:00Z" });
    expect(currentProject([older, newer])?.id).toBe("p2");
  });
});

describe("clientNextAction", () => {
  it("asks to start intake with no project", () => {
    expect(clientNextAction(null, null)).toBe("Start intake");
  });

  it("surfaces the next open task title", () => {
    const p = project({ id: "p1", client_id: "c1", stage: "design" });
    expect(clientNextAction(p, "Send revised homepage")).toBe("Send revised homepage");
  });

  it("says there are no open tasks otherwise", () => {
    const p = project({ id: "p1", client_id: "c1", stage: "design" });
    expect(clientNextAction(p, null)).toBe("No open tasks");
  });
});

describe("mostRecentActivity", () => {
  it("matches the client's own activity and its projects', nothing else", () => {
    const rows = [
      activity({ id: "a1", entity_type: "client", entity_id: "c1", created_at: "2026-08-01T00:00:00Z" }),
      activity({ id: "a2", entity_type: "project", entity_id: "p1", created_at: "2026-08-05T00:00:00Z" }),
      activity({ id: "a3", entity_type: "lead", entity_id: "l1", created_at: "2026-08-09T00:00:00Z" }),
      activity({ id: "a4", entity_type: "client", entity_id: "other-client", created_at: "2026-08-10T00:00:00Z" }),
    ];
    const result = mostRecentActivity(rows, { id: "c1" }, [project({ id: "p1", client_id: "c1", stage: "design" })]);
    expect(result?.id).toBe("a2");
  });

  it("returns null when nothing matches", () => {
    expect(mostRecentActivity([], { id: "c1" }, [])).toBeNull();
  });
});

describe("openTaskCount", () => {
  it("counts only undone tasks on the given project", () => {
    const tasks = [
      { id: "t1", title: "A", done: false, due_at: null, project_id: "p1", lead_id: null, assigned_user_id: null, assigned_user_name: null, context: "", created_at: "" },
      { id: "t2", title: "B", done: true, due_at: null, project_id: "p1", lead_id: null, assigned_user_id: null, assigned_user_name: null, context: "", created_at: "" },
      { id: "t3", title: "C", done: false, due_at: null, project_id: "p2", lead_id: null, assigned_user_id: null, assigned_user_name: null, context: "", created_at: "" },
    ];
    expect(openTaskCount(tasks, "p1")).toBe(1);
  });

  it("is 0 with no project", () => {
    expect(openTaskCount([], null)).toBe(0);
  });
});

describe("liveWebsiteCount", () => {
  it("counts only deployed/maintenance/complete projects", () => {
    const rows = [
      project({ id: "p1", client_id: "c1", stage: "deployed" }),
      project({ id: "p2", client_id: "c1", stage: "maintenance" }),
      project({ id: "p3", client_id: "c1", stage: "complete" }),
      project({ id: "p4", client_id: "c1", stage: "design" }),
    ];
    expect(liveWebsiteCount(rows)).toBe(3);
  });

  it("is 0 for a client with no live projects", () => {
    expect(liveWebsiteCount([project({ id: "p1", client_id: "c1", stage: "intake" })])).toBe(0);
    expect(liveWebsiteCount([])).toBe(0);
  });
});

describe("activeProjectCount", () => {
  it("counts only projects still in production", () => {
    const rows = [
      project({ id: "p1", client_id: "c1", stage: "design" }),
      project({ id: "p2", client_id: "c1", stage: "deployed" }),
      project({ id: "p3", client_id: "c1", stage: "maintenance" }),
      project({ id: "p4", client_id: "c1", stage: "complete" }),
    ];
    expect(activeProjectCount(rows)).toBe(2);
  });
});

describe("clientRowMatchesFilters", () => {
  const baseRow = { tone: "active" as const, hostingPlans: [], nextPaymentOverdue: false, requiredOutstanding: 0 };

  it("passes everything through with no filters set", () => {
    expect(clientRowMatchesFilters(baseRow, NO_OVERVIEW_FILTERS)).toBe(true);
  });

  it("filters by relationship status", () => {
    expect(clientRowMatchesFilters(baseRow, { ...NO_OVERVIEW_FILTERS, status: "active" })).toBe(true);
    expect(clientRowMatchesFilters(baseRow, { ...NO_OVERVIEW_FILTERS, status: "complete" })).toBe(false);
  });

  it("filters to clients with at least one active hosting plan", () => {
    expect(clientRowMatchesFilters(baseRow, { ...NO_OVERVIEW_FILTERS, hosting: "active" })).toBe(false);
    const withHosting = { ...baseRow, hostingPlans: [{ status: "paused" }] };
    expect(clientRowMatchesFilters(withHosting, { ...NO_OVERVIEW_FILTERS, hosting: "active" })).toBe(false);
    const withActiveHosting = { ...baseRow, hostingPlans: [{ status: "paused" }, { status: "active" }] };
    expect(clientRowMatchesFilters(withActiveHosting, { ...NO_OVERVIEW_FILTERS, hosting: "active" })).toBe(true);
  });

  it("filters to clients with an overdue payment", () => {
    expect(clientRowMatchesFilters(baseRow, { ...NO_OVERVIEW_FILTERS, payment: "overdue" })).toBe(false);
    expect(
      clientRowMatchesFilters({ ...baseRow, nextPaymentOverdue: true }, { ...NO_OVERVIEW_FILTERS, payment: "overdue" }),
    ).toBe(true);
  });

  it("filters to clients with outstanding required tasks", () => {
    expect(clientRowMatchesFilters(baseRow, { ...NO_OVERVIEW_FILTERS, attention: "required_tasks" })).toBe(false);
    expect(
      clientRowMatchesFilters(
        { ...baseRow, requiredOutstanding: 2 },
        { ...NO_OVERVIEW_FILTERS, attention: "required_tasks" },
      ),
    ).toBe(true);
  });

  it("combines filters (AND, not OR)", () => {
    const row = { tone: "active" as const, hostingPlans: [{ status: "active" }], nextPaymentOverdue: true, requiredOutstanding: 0 };
    expect(clientRowMatchesFilters(row, { status: "active", hosting: "active", payment: "overdue", attention: "" })).toBe(true);
    expect(clientRowMatchesFilters(row, { status: "complete", hosting: "active", payment: "overdue", attention: "" })).toBe(
      false,
    );
  });
});

describe("buildAttentionCards", () => {
  it("groups every overdue obligation for one client into a single card, not one card per charge", () => {
    const cards = buildAttentionCards(
      [
        obligation({ client_id: "c1", project_id: "p1", due_date: "2026-08-10", amount_cents: 5000, days_relative: -1 }),
        obligation({ client_id: "c1", project_id: "p2", due_date: "2026-08-01", amount_cents: 20000, days_relative: -10 }),
      ],
      [],
      [{ id: "c1", business_name: "Acme", billing_email: "billing@acme.test" }],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].clientId).toBe("c1");
    expect(cards[0].contact).toBe("billing@acme.test");
    expect(cards[0].payments).toHaveLength(2);
    // Sorted earliest-due first within the card.
    expect(cards[0].payments.map((p) => p.amountCents)).toEqual([20000, 5000]);
  });

  it("treats a clientless (prospect) overdue project as its own card, not merged with a real client", () => {
    const cards = buildAttentionCards(
      [obligation({ client_id: null, client_business_name: null, project_id: "p1" })],
      [],
      [],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ clientId: null, clientName: "No client (prospect)" });
  });

  it("adds a required-tasks count only when there's real outstanding work, using the client's name", () => {
    const cards = buildAttentionCards(
      [],
      [
        checklistSummary({ client_id: "c1", completed: 2, total: 2 }),
        checklistSummary({ client_id: "c2", completed: 1, total: 3 }),
      ],
      [
        { id: "c1", business_name: "Fully Done Co", billing_email: null },
        { id: "c2", business_name: "Behind Co", billing_email: null },
      ],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ clientId: "c2", clientName: "Behind Co", requiredTasksOutstanding: 2 });
  });

  it("combines an overdue payment and required tasks for the same client into one card, not two", () => {
    const cards = buildAttentionCards(
      [obligation({ client_id: "c1", project_id: "p1" })],
      [checklistSummary({ client_id: "c1", completed: 0, total: 1 })],
      [{ id: "c1", business_name: "Acme", billing_email: null }],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].payments).toHaveLength(1);
    expect(cards[0].requiredTasksOutstanding).toBe(1);
  });

  it("orders cards by earliest overdue due date, task-only cards last", () => {
    const cards = buildAttentionCards(
      [obligation({ client_id: "c1", project_id: "p1", due_date: "2026-08-20", client_business_name: "Later Overdue Co" })],
      [checklistSummary({ client_id: "c2", completed: 0, total: 1 })],
      [
        { id: "c1", business_name: "Later Overdue Co", billing_email: null },
        { id: "c2", business_name: "Tasks Only Co", billing_email: null },
      ],
    );
    expect(cards.map((c) => c.clientName)).toEqual(["Later Overdue Co", "Tasks Only Co"]);
  });
});
