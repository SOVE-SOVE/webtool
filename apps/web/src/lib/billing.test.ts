import { describe, expect, it } from "vitest";
import { groupObligations, obligationKey, relativeObligationLabel } from "./billing";
import type { NextPaymentObligation } from "./api";

function obligation(overrides: Partial<NextPaymentObligation> = {}): NextPaymentObligation {
  return {
    kind: "hosting_charge",
    project_id: "p1",
    project_name: "Acme Site",
    client_id: "c1",
    client_business_name: "Acme Co",
    amount_cents: 5000,
    due_date: "2026-09-10",
    is_overdue: false,
    days_relative: 3,
    website_agreement_id: null,
    hosting_charge_id: "hc1",
    hosting_plan_id: "hp1",
    scheduled: false,
    ...overrides,
  };
}

describe("obligationKey", () => {
  it("is stable across two calls for the same obligation", () => {
    const o = obligation();
    expect(obligationKey(o)).toBe(obligationKey(obligation()));
  });

  it("distinguishes an issued charge from a scheduled projection for the same plan", () => {
    const issued = obligation({ hosting_charge_id: "hc1", scheduled: false });
    const scheduled = obligation({ hosting_charge_id: null, scheduled: true });
    expect(obligationKey(issued)).not.toBe(obligationKey(scheduled));
  });

  it("distinguishes a website obligation from a hosting obligation on the same project", () => {
    const website = obligation({ website_agreement_id: "wa1", hosting_charge_id: null, hosting_plan_id: null });
    const hosting = obligation({ website_agreement_id: null, hosting_charge_id: "hc1", hosting_plan_id: "hp1" });
    expect(obligationKey(website)).not.toBe(obligationKey(hosting));
  });
});

describe("relativeObligationLabel", () => {
  it("labels a due-date-not-set obligation distinctly from zero-days-relative", () => {
    expect(relativeObligationLabel(obligation({ due_date: null, days_relative: null }))).toBe("Due date not set");
  });

  it("labels overdue vs due-today vs due-in-N-days distinctly", () => {
    expect(relativeObligationLabel(obligation({ is_overdue: true, days_relative: -4 }))).toBe("Overdue by 4 days");
    expect(relativeObligationLabel(obligation({ is_overdue: false, days_relative: 0 }))).toBe("Due today");
    expect(relativeObligationLabel(obligation({ is_overdue: false, days_relative: 5 }))).toBe("Due in 5 days");
  });
});

describe("groupObligations", () => {
  it("places every obligation in exactly one group", () => {
    const rows = [
      obligation({ hosting_charge_id: "a", is_overdue: true, days_relative: -2, due_date: "2026-09-01" }),
      obligation({ hosting_charge_id: "b", is_overdue: false, days_relative: 0, due_date: "2026-09-05" }),
      obligation({ hosting_charge_id: "c", is_overdue: false, days_relative: 3, due_date: "2026-09-08" }),
      obligation({ hosting_charge_id: "d", is_overdue: false, days_relative: 20, due_date: "2026-09-25" }),
      obligation({ hosting_charge_id: "e", due_date: null, days_relative: null, is_overdue: false }),
    ];
    const groups = groupObligations(rows);
    const total = Object.values(groups).reduce((sum, g) => sum + g.length, 0);
    expect(total).toBe(rows.length);
    expect(groups.overdue).toHaveLength(1);
    expect(groups.due_today).toHaveLength(1);
    expect(groups.next_7_days).toHaveLength(1);
    expect(groups.later).toHaveLength(1);
    expect(groups.no_due_date).toHaveLength(1);
  });
});
