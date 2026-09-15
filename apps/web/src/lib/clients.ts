/**
 * Pure helpers for the Clients directory + detail view — status, current
 * project, and "what's next" — kept out of the page components so they're
 * unit-testable (same pattern as leads.ts / projects.ts).
 *
 * `Client` itself has no status column (see
 * apps/api/app/modules/clients/models.py) — every row is, by definition,
 * either a won-lead conversion or a manually added referral, so there is
 * no "lead"/"lost" state to represent here. What a client's card should
 * show as "status" is derived from their project(s), the same way
 * `projectTone` derives a badge from `ProjectStage` — no new backend
 * concept invented.
 */

// Relative imports (not "@/lib/…") so this stays runnable under vitest,
// which has no path-alias config — same as projects.ts / api.test.ts.
import type { ActivityItem, Client, ClientChecklistSummary, NextPaymentObligation, Project, Task } from "./api";
import { FINISHED_STAGES, LIVE_STAGES } from "./filters";

export function projectsForClient(projects: Project[], clientId: string): Project[] {
  return projects.filter((p) => p.client_id === clientId);
}

/** How many of a client's projects are actually live on the internet — the Clients Overview row's "websites" count. */
export function liveWebsiteCount(clientProjects: Project[]): number {
  return clientProjects.filter((p) => LIVE_STAGES.includes(p.stage)).length;
}

/** How many of a client's projects are still in production — the Clients Overview row's "active projects" count. */
export function activeProjectCount(clientProjects: Project[]): number {
  return clientProjects.filter((p) => !FINISHED_STAGES.includes(p.stage)).length;
}

export type ClientTone = "onboarding" | "active" | "complete";

export const CLIENT_STATUS_LABEL: Record<ClientTone, string> = {
  onboarding: "Onboarding",
  active: "Active",
  complete: "Complete",
};

/**
 * onboarding = no project started yet (converted/added but intake hasn't
 * begun); active = at least one project still in production; complete =
 * every project has reached a finished stage (deployed/maintenance sit in
 * the "live" tone on Projects, but for a client relationship that's still
 * ongoing delivery — only maintenance/complete count as "wrapped up" here,
 * matching FINISHED_STAGES already used by the Projects page).
 */
export function clientTone(clientProjects: Project[]): ClientTone {
  if (clientProjects.length === 0) return "onboarding";
  if (clientProjects.every((p) => FINISHED_STAGES.includes(p.stage))) return "complete";
  return "active";
}

/** The project to headline on a client's card/overview: the one still in
 *  production if there is one, else the most recently touched. */
export function currentProject(clientProjects: Project[]): Project | null {
  const active = [...clientProjects]
    .filter((p) => !FINISHED_STAGES.includes(p.stage))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
  if (active) return active;
  return [...clientProjects].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] ?? null;
}

/** One short line: what to do next for this client. */
export function clientNextAction(project: Project | null, nextTaskTitle: string | null): string {
  if (!project) return "Start intake";
  return nextTaskTitle ?? "No open tasks";
}

/** Most recent activity row across a client's own log and its project(s). */
export function mostRecentActivity(
  activity: ActivityItem[],
  client: Pick<Client, "id">,
  clientProjects: Project[],
): ActivityItem | null {
  const projectIds = new Set(clientProjects.map((p) => p.id));
  const relevant = activity.filter(
    (a) =>
      (a.entity_type === "client" && a.entity_id === client.id) ||
      (a.entity_type === "project" && projectIds.has(a.entity_id)),
  );
  return relevant.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
}

export function openTaskCount(tasks: Task[], projectId: string | null): number {
  if (!projectId) return 0;
  return tasks.filter((t) => t.project_id === projectId && !t.done).length;
}

// ---- Overview tab list filters ----
//
// A deliberately small, narrow-typed input shape (not the full
// EnrichedClient row) so this stays testable without constructing every
// related entity — same reasoning as the functions above.

export type OverviewFilters = {
  status: ClientTone | "";
  hosting: "" | "active";
  payment: "" | "overdue";
  attention: "" | "required_tasks";
};

export const NO_OVERVIEW_FILTERS: OverviewFilters = { status: "", hosting: "", payment: "", attention: "" };

export function clientRowMatchesFilters(
  row: {
    tone: ClientTone;
    hostingPlans: { status: string }[];
    nextPaymentOverdue: boolean;
    requiredOutstanding: number;
  },
  filters: OverviewFilters,
): boolean {
  if (filters.status && row.tone !== filters.status) return false;
  if (filters.hosting === "active" && !row.hostingPlans.some((p) => p.status === "active")) return false;
  if (filters.payment === "overdue" && !row.nextPaymentOverdue) return false;
  if (filters.attention === "required_tasks" && row.requiredOutstanding <= 0) return false;
  return true;
}

// ---- Overview tab "Needs attention" ----

export type AttentionCardPayment = {
  key: string;
  amountCents: number;
  dueDate: string | null;
  daysOverdue: number;
  kind: NextPaymentObligation["kind"];
  projectName: string;
};

/**
 * One client's full attention picture — every overdue obligation
 * (not just the earliest, unlike the old flat list) plus a required-
 * tasks-outstanding count, grouped so the client appears as exactly
 * one card regardless of how many issues they have. `clientId` is null
 * only for a clientless (prospect) project's own overdue charge — that
 * still gets its own card, keyed by project instead of client, rather
 * than being silently dropped or merged into an unrelated card.
 */
export type AttentionCard = {
  key: string;
  clientId: string | null;
  clientName: string;
  contact: string | null;
  payments: AttentionCardPayment[];
  requiredTasksOutstanding: number;
  billingHref: string;
  tasksHref: string;
};

/**
 * Groups the same two signals the old flat list used (overdue
 * obligations, required-task-outstanding counts) into one card per
 * client. "Client feedback awaiting review" is deliberately not
 * included in what determines *which* clients get a card — there is no
 * workspace-wide feedback endpoint, only a per-project one, and using
 * it to decide card membership here would mean fetching every client's
 * every project's feedback up front, exactly the slow per-row request
 * pattern this page avoids. A card's own expanded detail (built
 * separately, on demand, once a card that already exists for a
 * payment/task reason is opened) is where feedback can still surface —
 * see ClientsOverviewTab's lazy per-card fetch.
 */
export function buildAttentionCards(
  overdueObligations: Pick<
    NextPaymentObligation,
    | "client_id"
    | "client_business_name"
    | "amount_cents"
    | "days_relative"
    | "due_date"
    | "project_id"
    | "project_name"
    | "kind"
    | "website_agreement_id"
    | "hosting_charge_id"
    | "hosting_plan_id"
  >[],
  checklistSummaries: ClientChecklistSummary[],
  clients: Pick<Client, "id" | "business_name" | "billing_email">[],
): AttentionCard[] {
  const cardsByKey = new Map<string, AttentionCard>();
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  function cardFor(clientId: string | null, projectId: string, clientName: string, contact: string | null): AttentionCard {
    const key = clientId ?? `no-client:${projectId}`;
    let card = cardsByKey.get(key);
    if (!card) {
      card = {
        key,
        clientId,
        clientName,
        contact,
        payments: [],
        requiredTasksOutstanding: 0,
        billingHref: clientId
          ? `/dashboard/clients/${clientId}?tab=billing`
          : "/dashboard/clients?tab=revenue&revenueTab=upcoming",
        tasksHref: clientId ? `/dashboard/clients/${clientId}?tab=tasks` : "/dashboard/clients?tab=revenue&revenueTab=upcoming",
      };
      cardsByKey.set(key, card);
    }
    return card;
  }

  for (const o of overdueObligations) {
    const client = o.client_id ? clientsById.get(o.client_id) : undefined;
    const card = cardFor(o.client_id, o.project_id, o.client_business_name ?? "No client (prospect)", client?.billing_email ?? null);
    card.payments.push({
      key: `${o.website_agreement_id ?? ""}${o.hosting_charge_id ?? ""}${o.hosting_plan_id ?? ""}`,
      amountCents: o.amount_cents,
      dueDate: o.due_date,
      daysOverdue: Math.abs(o.days_relative ?? 0),
      kind: o.kind,
      projectName: o.project_name,
    });
  }

  for (const s of checklistSummaries) {
    const outstanding = s.total - s.completed;
    if (outstanding <= 0) continue;
    const client = clientsById.get(s.client_id);
    if (!client) continue;
    const card = cardFor(s.client_id, "", client.business_name, client.billing_email);
    card.requiredTasksOutstanding = outstanding;
  }

  for (const card of cardsByKey.values()) {
    card.payments.sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1));
  }

  // Most urgent first: earliest overdue due date, task-only cards last.
  return [...cardsByKey.values()].sort((a, b) => {
    const aDate = a.payments[0]?.dueDate ?? "9999";
    const bDate = b.payments[0]?.dueDate ?? "9999";
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });
}
