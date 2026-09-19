import { describe, expect, it } from "vitest";
import { hasReviewLinks, leadScheduleEvents, reviewLinks } from "./leadSchedule";
import { clientScheduleEvents, indexScheduleByDay } from "./taskSchedule";

const leads = [
  { id: "l-imported", business_id: "b1", client_id: null, prospect_project: { id: "pp1", name: "P", stage: "intake" as const } },
  { id: "l-dup", business_id: "b-existing", client_id: "c-lead", prospect_project: null },
  { id: "l-other", business_id: "b-other", client_id: "c-other", prospect_project: null },
];
const clients = [
  { id: "c-existing", business_id: "b-existing" },
  { id: "c-other", business_id: "b-other" },
];

describe("reviewLinks", () => {
  it("links nothing for a business that isn't in the CRM", () => {
    const links = reviewLinks({ imported_lead_id: null, duplicate_of_business_id: null }, leads, clients);
    expect(links).toEqual({ leadIds: [], prospectProjectIds: [], clientIds: [] });
    expect(hasReviewLinks(links)).toBe(false);
  });

  it("links the lead it was imported as, plus that lead's prospect project", () => {
    const links = reviewLinks({ imported_lead_id: "l-imported", duplicate_of_business_id: null }, leads, clients);
    expect(links.leadIds).toEqual(["l-imported"]);
    expect(links.prospectProjectIds).toEqual(["pp1"]);
    expect(links.clientIds).toEqual([]);
    expect(hasReviewLinks(links)).toBe(true);
  });

  it("links an existing lead and client for a duplicate of a known business", () => {
    const links = reviewLinks({ imported_lead_id: null, duplicate_of_business_id: "b-existing" }, leads, clients);
    expect(links.leadIds).toEqual(["l-dup"]);
    // c-lead comes from the lead's own client_id, c-existing from the Client row.
    expect(links.clientIds.sort()).toEqual(["c-existing", "c-lead"]);
  });

  it("links a client even when the duplicate business has no lead", () => {
    const links = reviewLinks({ imported_lead_id: null, duplicate_of_business_id: "b-other" }, [], clients);
    expect(links).toEqual({ leadIds: [], prospectProjectIds: [], clientIds: ["c-other"] });
    expect(hasReviewLinks(links)).toBe(true);
  });
});

describe("leadScheduleEvents", () => {
  const base = {
    leadIds: ["l1"],
    projectIds: ["pp1"],
  };
  const task = (over: Record<string, unknown>) => ({
    id: "t",
    title: "Task",
    done: false,
    due_at: "2026-09-21T00:00:00Z",
    project_id: null,
    lead_id: "l1",
    ...over,
  });

  it("collects open task due dates, meetings, live reminders and pending follow-ups", () => {
    const events = leadScheduleEvents({
      ...base,
      tasks: [
        task({ id: "t1", title: "Call back" }),
        task({ id: "t2", lead_id: null, project_id: "pp1", title: "Scope" }),
        task({ id: "t3", lead_id: "someone-else" }),
        task({ id: "t4", done: true }),
        task({ id: "t5", due_at: null }),
      ],
      meetings: [
        {
          id: "m1",
          title: "Intro call",
          status: "scheduled",
          scheduled_at: "2026-09-22T10:00:00Z",
          reminders: [
            { id: "r1", remind_at: "2026-09-22T09:00:00Z", channel: "in_app", note: null, acknowledged_at: null, created_at: "" },
            { id: "r2", remind_at: "2026-09-21T09:00:00Z", channel: "in_app", note: "old", acknowledged_at: "2026-09-21T09:05:00Z", created_at: "" },
          ],
        },
        { id: "m2", title: "Cancelled", status: "cancelled", scheduled_at: "2026-09-23T10:00:00Z", reminders: [] },
      ],
      followUps: [
        { id: "f1", lead_id: "l1", due_date: "2026-09-25", suggested_next_action: "Send proposal", status: "pending" },
        { id: "f2", lead_id: "l1", due_date: "2026-09-26", suggested_next_action: "Done already", status: "done" },
        { id: "f3", lead_id: "l-x", due_date: "2026-09-27", suggested_next_action: "Not ours", status: "pending" },
      ],
    });
    expect(events.map((e) => e.id)).toEqual([
      "task:t1",
      "task:t2",
      "meeting:m1",
      "reminder:r1",
      "followup:f1",
    ]);
    expect(events.find((e) => e.id === "reminder:r1")?.title).toBe("Reminder: Intro call");
    expect(events.find((e) => e.id === "followup:f1")?.title).toBe("Follow-up: Send proposal");
  });

  it("uses a reminder's own note as its title when it has one", () => {
    const [, reminder] = leadScheduleEvents({
      ...base,
      tasks: [],
      followUps: [],
      meetings: [
        {
          id: "m1",
          title: "Intro call",
          status: "scheduled",
          scheduled_at: "2026-09-22T10:00:00Z",
          reminders: [{ id: "r1", remind_at: "2026-09-22T09:00:00Z", channel: "in_app", note: "Bring the audit", acknowledged_at: null, created_at: "" }],
        },
      ],
    });
    expect(reminder.title).toBe("Reminder: Bring the audit");
  });

  it("collapses with the client feed so a shared meeting or task is marked once", () => {
    const lead = leadScheduleEvents({
      ...base,
      tasks: [task({ id: "t1", title: "Call back" })],
      meetings: [{ id: "m1", title: "Intro call", status: "scheduled", scheduled_at: "2026-09-22T10:00:00Z", reminders: [] }],
      followUps: [],
    });
    const client = clientScheduleEvents({
      scope: { projectIds: ["p1"], leadIds: ["l1"] },
      tasks: [task({ id: "t1", title: "Call back" })],
      meetings: [{ id: "m1", title: "Intro call", status: "scheduled", scheduled_at: "2026-09-22T10:00:00Z" }],
    });
    const byDay = indexScheduleByDay(lead, client);
    const all = [...byDay.values()];
    expect(all.flatMap((d) => d.task)).toHaveLength(2);
    expect(all.flatMap((d) => d.client)).toHaveLength(0);
  });
});
