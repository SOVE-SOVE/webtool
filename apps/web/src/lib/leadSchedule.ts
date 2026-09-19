/**
 * Pure logic behind the review page's Schedule card: which leads and
 * clients a discovered business is tied to, and the dated items on the
 * lead side. The client side reuses `clientScope` / `clientScheduleEvents`
 * from taskSchedule.ts.
 *
 * A discovered business only *has* a schedule once it's tied to something
 * in the CRM — it isn't a Lead until it's imported. It can be tied two
 * ways: `imported_lead_id` (imported from this very review), or
 * `duplicate_of_business_id` (it's the same business as one already in the
 * workspace, which may be a Lead, a Client, or both).
 */

import type { Client, DiscoveredBusiness, FollowUp, Lead, Meeting, Task } from "./api";
import type { ScheduleEvent } from "./taskSchedule";

type LeadLike = Pick<Lead, "id" | "business_id" | "client_id" | "prospect_project">;
type ClientLike = Pick<Client, "id" | "business_id">;

export type ReviewLinks = {
  leadIds: string[];
  /** The linked leads' own prospect (pre-client) projects. */
  prospectProjectIds: string[];
  clientIds: string[];
};

/**
 * Everything in the CRM this discovered business is tied to. Empty arrays
 * throughout means nothing is linked — callers use that to skip fetching.
 */
export function reviewLinks(
  business: Pick<DiscoveredBusiness, "imported_lead_id" | "duplicate_of_business_id">,
  leads: LeadLike[],
  clients: ClientLike[],
): ReviewLinks {
  const linkedLeads = leads.filter(
    (l) =>
      l.id === business.imported_lead_id ||
      (business.duplicate_of_business_id !== null && l.business_id === business.duplicate_of_business_id),
  );
  const clientIds = new Set<string>();
  for (const l of linkedLeads) if (l.client_id) clientIds.add(l.client_id);
  for (const c of clients) {
    if (business.duplicate_of_business_id !== null && c.business_id === business.duplicate_of_business_id) {
      clientIds.add(c.id);
    }
  }
  return {
    leadIds: linkedLeads.map((l) => l.id),
    prospectProjectIds: linkedLeads.flatMap((l) => (l.prospect_project ? [l.prospect_project.id] : [])),
    clientIds: [...clientIds],
  };
}

/** Whether there is anything at all to load for these links. */
export function hasReviewLinks(links: ReviewLinks): boolean {
  return links.leadIds.length > 0 || links.clientIds.length > 0;
}

/**
 * The lead-side schedule: due dates of open tasks filed under the leads
 * (or their prospect projects), their non-cancelled meetings, any
 * unacknowledged meeting reminders, and pending follow-ups. Reminders are
 * only ever attached to meetings in this app, and follow-ups only to
 * leads — there is no free-standing reminder record. Ids match the ones
 * `clientScheduleEvents` uses for the same tasks/meetings, so an item
 * arriving from both feeds collapses to one.
 */
export function leadScheduleEvents({
  leadIds,
  projectIds,
  tasks,
  meetings,
  followUps,
}: {
  leadIds: string[];
  projectIds: string[];
  tasks: Pick<Task, "id" | "title" | "done" | "due_at" | "project_id" | "lead_id">[];
  meetings: Pick<Meeting, "id" | "title" | "status" | "scheduled_at" | "reminders">[];
  followUps: Pick<FollowUp, "id" | "lead_id" | "due_date" | "suggested_next_action" | "status">[];
}): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];
  const seen = new Set<string>();
  const push = (event: ScheduleEvent) => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    events.push(event);
  };

  for (const t of tasks) {
    if (t.done || !t.due_at) continue;
    const inScope =
      (t.lead_id !== null && leadIds.includes(t.lead_id)) ||
      (t.project_id !== null && projectIds.includes(t.project_id));
    if (inScope) push({ id: `task:${t.id}`, title: `Due: ${t.title}`, at: t.due_at });
  }
  for (const m of meetings) {
    if (m.status === "cancelled") continue;
    push({ id: `meeting:${m.id}`, title: m.title, at: m.scheduled_at });
    for (const r of m.reminders) {
      if (r.acknowledged_at) continue;
      push({ id: `reminder:${r.id}`, title: `Reminder: ${r.note?.trim() || m.title}`, at: r.remind_at });
    }
  }
  for (const f of followUps) {
    if (f.status !== "pending" || !leadIds.includes(f.lead_id)) continue;
    push({ id: `followup:${f.id}`, title: `Follow-up: ${f.suggested_next_action}`, at: f.due_date });
  }
  return events;
}
