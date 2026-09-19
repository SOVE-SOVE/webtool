"use client";

import { useEffect, useId, useState } from "react";
import { api, type DiscoveredBusiness, type Meeting } from "@/lib/api";
import { TaskScheduleCalendar } from "@/components/TaskScheduleCalendar";
import { hasReviewLinks, leadScheduleEvents, reviewLinks } from "@/lib/leadSchedule";
import { clientScheduleEvents, clientScope, type ScheduleEvent } from "@/lib/taskSchedule";

type Schedule =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; linked: false }
  | { status: "ready"; linked: true; hasClient: boolean; leadEvents: ScheduleEvent[]; clientEvents: ScheduleEvent[] };

/**
 * The review page's "Schedule" card: a compact month calendar of what's
 * dated against this business — its lead's tasks, meetings, reminders and
 * follow-ups (amber), and its linked client's calendar (blue).
 *
 * A business in the review queue is usually *not* in the CRM yet, so it
 * has no lead and nothing to schedule; that case renders instantly with an
 * explanatory note and makes no requests. It only loads anything once it's
 * tied to a lead or client (`imported_lead_id`, or `duplicate_of_business_id`
 * pointing at one already in the workspace). See lib/leadSchedule.ts.
 *
 * Mount with `key` covering `business.id` and `imported_lead_id` — importing
 * the lead from this page changes what it links to, and the load state is
 * only ever advanced by the effect.
 */
export function LeadScheduleCard({ business }: { business: DiscoveredBusiness }) {
  const { imported_lead_id: importedLeadId, duplicate_of_business_id: duplicateOfBusinessId } = business;
  const headingId = useId();
  const mightLink = importedLeadId !== null || duplicateOfBusinessId !== null;
  const [schedule, setSchedule] = useState<Schedule>(
    mightLink ? { status: "loading" } : { status: "ready", linked: false },
  );

  useEffect(() => {
    if (!mightLink) return;
    let cancelled = false;
    (async () => {
      try {
        const [leads, clients] = await Promise.all([
          api.listLeads({ includeArchived: true }),
          duplicateOfBusinessId !== null ? api.listClients() : Promise.resolve([]),
        ]);
        const links = reviewLinks(
          { imported_lead_id: importedLeadId, duplicate_of_business_id: duplicateOfBusinessId },
          leads,
          clients,
        );
        if (!hasReviewLinks(links)) {
          if (!cancelled) setSchedule({ status: "ready", linked: false });
          return;
        }

        const [tasks, followUps, projects] = await Promise.all([
          api.listTasks(),
          links.leadIds.length > 0 ? api.listFollowUps() : Promise.resolve(null),
          links.clientIds.length > 0 ? api.listProjects() : Promise.resolve([]),
        ]);

        // Each client's projects and originating leads, merged. The lead's
        // own meetings can appear in both feeds; ids collapse them later.
        const scope = { projectIds: new Set<string>(), leadIds: new Set<string>() };
        for (const clientId of links.clientIds) {
          const s = clientScope(clientId, projects);
          s.projectIds.forEach((id) => scope.projectIds.add(id));
          s.leadIds.forEach((id) => scope.leadIds.add(id));
        }

        // Fetch each project's / lead's meetings once, even when both the
        // lead side and the client side need them.
        const cache = new Map<string, Promise<Meeting[]>>();
        const meetingsFor = (kind: "lead" | "project", id: string) => {
          const key = `${kind}:${id}`;
          if (!cache.has(key)) {
            cache.set(key, api.listMeetings(kind === "lead" ? { leadId: id } : { projectId: id }));
          }
          return cache.get(key)!;
        };
        const [leadMeetings, clientMeetings] = await Promise.all([
          Promise.all([
            ...links.leadIds.map((id) => meetingsFor("lead", id)),
            ...links.prospectProjectIds.map((id) => meetingsFor("project", id)),
          ]).then((lists) => lists.flat()),
          Promise.all([
            ...[...scope.projectIds].map((id) => meetingsFor("project", id)),
            ...[...scope.leadIds].map((id) => meetingsFor("lead", id)),
          ]).then((lists) => lists.flat()),
        ]);

        const leadEvents = leadScheduleEvents({
          leadIds: links.leadIds,
          projectIds: links.prospectProjectIds,
          tasks,
          meetings: leadMeetings,
          followUps: followUps ? [...followUps.overdue, ...followUps.due_today, ...followUps.upcoming] : [],
        });
        const clientEvents = clientScheduleEvents({
          scope: { projectIds: [...scope.projectIds], leadIds: [...scope.leadIds] },
          tasks,
          meetings: clientMeetings,
        });
        if (!cancelled) {
          setSchedule({ status: "ready", linked: true, hasClient: links.clientIds.length > 0, leadEvents, clientEvents });
        }
      } catch {
        if (!cancelled) setSchedule({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mightLink, importedLeadId, duplicateOfBusinessId]);

  const linked = schedule.status === "ready" && schedule.linked;
  const leadEvents = linked ? schedule.leadEvents : [];
  const clientEvents = linked ? schedule.clientEvents : [];

  let note: string | null = null;
  if (schedule.status === "loading") note = "Loading schedule…";
  else if (schedule.status === "error") note = "Couldn't load the schedule.";
  else if (!schedule.linked) note = "Not in the CRM yet, so there's no lead or client schedule to show.";
  else if (leadEvents.length === 0 && clientEvents.length === 0) note = "Nothing scheduled for this lead yet.";

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-sm font-semibold text-fg">
        Schedule
      </h2>
      <TaskScheduleCalendar
        className="mt-2"
        taskEvents={leadEvents}
        clientEvents={clientEvents}
        taskLabel="Lead"
        clientLabel="Client calendar"
        showClientLegend={linked && schedule.hasClient}
      />
      {note && (
        <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
