import { describe, expect, it } from "vitest";
import type { NextPaymentObligation, ProjectStage } from "../../../lib/api";
import type { AttentionCard, AttentionCardPayment } from "../../../lib/clients";
import { formatMoney } from "../../../lib/format";
import {
  NO_ACTION_NEEDED,
  clientCardBack,
  clientInitials,
  hostingPlansSummary,
  paymentLines,
  projectCountSummary,
  telHref,
  topAttentionItem,
} from "./clientCardSummary";

function payment(overrides: Partial<AttentionCardPayment> = {}): AttentionCardPayment {
  return {
    key: "k",
    amountCents: 120000,
    dueDate: "2026-09-01",
    daysOverdue: 12,
    kind: "website_balance",
    projectName: "Website",
    ...overrides,
  };
}

function attention(overrides: Partial<AttentionCard> = {}): AttentionCard {
  return {
    key: "c1",
    clientId: "c1",
    clientName: "Acme",
    contact: null,
    payments: [],
    requiredTasksOutstanding: 0,
    billingHref: "/billing",
    tasksHref: "/tasks",
    ...overrides,
  };
}

function obligation(overrides: Partial<NextPaymentObligation> = {}): NextPaymentObligation {
  return {
    kind: "hosting_charge",
    project_id: "p1",
    project_name: "Website",
    client_id: "c1",
    client_business_name: "Acme",
    amount_cents: 5000,
    due_date: "2026-10-09",
    is_overdue: false,
    days_relative: 7,
    website_agreement_id: null,
    hosting_charge_id: null,
    hosting_plan_id: null,
    scheduled: false,
    ...overrides,
  };
}

describe("clientInitials", () => {
  it("uses first and last word, or the first two letters of one word", () => {
    expect(clientInitials("Acme Plumbing Co")).toBe("AC");
    expect(clientInitials("acme")).toBe("AC");
    expect(clientInitials("  ")).toBe("?");
  });
  it("skips punctuation-only words", () => {
    expect(clientInitials("Acme —")).toBe("AC");
    expect(clientInitials("Smith & Co")).toBe("SC");
    expect(clientInitials("— —")).toBe("?");
  });
});

describe("telHref", () => {
  it("strips formatting but keeps a leading +", () => {
    expect(telHref("+61 (02) 9123-4567")).toBe("tel:+610291234567");
  });
  it("returns null when there is nothing dialable", () => {
    expect(telHref("n/a")).toBeNull();
  });
});

describe("topAttentionItem", () => {
  it("is null when the client needs no attention", () => {
    expect(topAttentionItem(null, "AUD")).toBeNull();
    expect(topAttentionItem(attention(), "AUD")).toBeNull();
  });

  it("puts a single overdue payment first and counts outstanding tasks as one more", () => {
    const item = topAttentionItem(attention({ payments: [payment()], requiredTasksOutstanding: 3 }), "AUD");
    expect(item).toEqual({ href: "/billing", headline: "Payment overdue by 12 days", detail: "$1,200 · Website balance", moreCount: 1 });
  });

  it("summarises several overdue payments rather than picking one", () => {
    const item = topAttentionItem(
      attention({ payments: [payment({ daysOverdue: 30 }), payment({ amountCents: 5000, daysOverdue: 2 })] }),
      "AUD",
    );
    expect(item).toEqual({ href: "/billing", headline: "2 payments overdue", detail: "$1,250 total · oldest 30 days", moreCount: 0 });
  });

  it("falls back to required tasks when nothing is overdue", () => {
    expect(topAttentionItem(attention({ requiredTasksOutstanding: 1 }), "AUD")).toEqual({
      href: "/tasks",
      headline: "1 required task outstanding",
      detail: null,
      moreCount: 0,
    });
  });
});

describe("paymentLines", () => {
  it("states plainly when nothing is scheduled", () => {
    expect(paymentLines(null, null, "AUD")).toEqual([{ tone: "none", primary: "No payment scheduled", secondary: "" }]);
  });

  it("shows an overdue balance and the next upcoming payment as separate lines", () => {
    const lines = paymentLines(attention({ payments: [payment(), payment({ daysOverdue: 40 })] }), obligation(), "AUD");
    expect(lines.map((l) => l.tone)).toEqual(["overdue", "upcoming"]);
    expect(lines[0]).toMatchObject({ primary: "$2,400 overdue", secondary: "2 payments · oldest 40 days" });
    expect(lines[1].primary).toMatch(/^\$50 · 9 Oct 2026$/);
    expect(lines[1].secondary).toBe("Monthly hosting · Due in 7 days");
  });

  it("handles an upcoming payment with no due date", () => {
    const [line] = paymentLines(null, obligation({ due_date: null, days_relative: null }), "AUD");
    expect(line).toEqual({ tone: "upcoming", primary: "$50", secondary: "Monthly hosting · Due date not set" });
  });
});

describe("projectCountSummary", () => {
  const p = (stage: ProjectStage) => ({ stage });
  it("is null for zero or one project", () => {
    expect(projectCountSummary([])).toBeNull();
    expect(projectCountSummary([p("design")])).toBeNull();
  });
  it("splits live from in-progress and omits empty parts", () => {
    expect(projectCountSummary([p("deployed"), p("complete"), p("design")])).toBe("3 projects · 2 live · 1 in progress");
    expect(projectCountSummary([p("design"), p("qa")])).toBe("2 projects · 2 in progress");
  });
});

describe("hostingPlansSummary", () => {
  it("counts active plans and totals only their fees", () => {
    expect(
      hostingPlansSummary(
        [
          { status: "active", monthly_fee_cents: 3000 },
          { status: "active", monthly_fee_cents: 2000 },
          { status: "cancelled", monthly_fee_cents: 9900 },
        ],
        "AUD",
      ),
    ).toBe("3 plans · 2 active · $50/mo");
    expect(hostingPlansSummary([{ status: "paused", monthly_fee_cents: 3000 }, { status: "cancelled", monthly_fee_cents: 1 }], "AUD")).toBe(
      "2 plans · 0 active",
    );
  });
});

describe("clientCardBack — the minimal back face", () => {
  const proj = (name: string, stage: ProjectStage, delivered_at: string | null = null) => ({ name, stage, delivered_at });

  it("no issues: client status, quiet 'No action needed'", () => {
    expect(clientCardBack({ tone: "active", allProjects: [proj("Main Site", "design")] }, null, "AUD")).toEqual({
      statusLabel: "Active",
      projectSummary: "Main Site · Design",
      message: NO_ACTION_NEEDED,
      attention: false,
    });
  });

  it("a client with no projects", () => {
    expect(clientCardBack({ tone: "onboarding", allProjects: [] }, null, "AUD")).toMatchObject({
      statusLabel: "Onboarding",
      projectSummary: "No projects yet",
    });
  });

  it("a single project names it with its own status (Delivered when delivered)", () => {
    expect(clientCardBack({ tone: "complete", allProjects: [proj("Site", "complete", "2026-05-01")] }, null, "AUD").projectSummary).toBe(
      "Site · Delivered",
    );
  });

  it("several projects in mixed states: an honest split, never one invented stage", () => {
    const back = clientCardBack(
      { tone: "active", allProjects: [proj("A", "deployed"), proj("B", "qa"), proj("C", "intake")] },
      null,
      "AUD",
    );
    expect(back.projectSummary).toBe("3 projects · 1 live · 2 in progress");
    expect(back.projectSummary).not.toMatch(/QA|Intake|Deployed/);
  });

  it("one overdue payment: the issue with its amount, as one line", () => {
    const back = clientCardBack({ tone: "active", allProjects: [] }, attention({ payments: [payment()] }), "AUD");
    expect(back).toMatchObject({ attention: true, message: `Payment overdue by 12 days — ${formatMoney(120000, "AUD")}.` });
  });

  it("several overdue payments are summarised, not picked", () => {
    const back = clientCardBack(
      { tone: "active", allProjects: [] },
      attention({ payments: [payment({ amountCents: 1000, daysOverdue: 3 }), payment({ amountCents: 2000, daysOverdue: 30 })] }),
      "AUD",
    );
    expect(back.message).toBe(`2 payments overdue — ${formatMoney(3000, "AUD")} total.`);
  });

  it("overdue payment outranks outstanding required tasks — only one message, no '+1 more'", () => {
    const back = clientCardBack({ tone: "active", allProjects: [] }, attention({ payments: [payment()], requiredTasksOutstanding: 4 }), "AUD");
    expect(back.message).toMatch(/^Payment overdue/);
    expect(back.message).not.toMatch(/task|more/);
  });

  it("required tasks outstanding when nothing is overdue", () => {
    expect(clientCardBack({ tone: "active", allProjects: [] }, attention({ requiredTasksOutstanding: 1 }), "AUD")).toMatchObject({
      attention: true,
      message: "1 required task outstanding.",
    });
  });

  it("an attention card with nothing left in it is quiet", () => {
    expect(clientCardBack({ tone: "active", allProjects: [] }, attention(), "AUD")).toMatchObject({ attention: false, message: NO_ACTION_NEEDED });
  });
});
