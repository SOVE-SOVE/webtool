/**
 * List-page filtering for Projects and Clients. Pure functions, kept out
 * of the page components so the behaviour operators actually rely on
 * (find a project by client name, hide finished work, see what's
 * unassigned) is unit-testable without a DOM.
 */

import type { Client, DiscoveredBusiness, Project, ProjectStage } from "@/lib/api";

export const UNASSIGNED = "__unassigned__";

// The two post-launch stages — see ProjectStage in the API.
export const FINISHED_STAGES: ProjectStage[] = ["maintenance", "complete"];

function matchesSearch(fields: (string | null | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => !!field && field.toLowerCase().includes(q));
}

function matchesAssignee(assignedUserId: string | null, filter: string): boolean {
  if (!filter) return true;
  if (filter === UNASSIGNED) return assignedUserId === null;
  return assignedUserId === filter;
}

export type ProjectFilters = {
  search: string;
  stage: ProjectStage | "";
  assignee: string;
  showFinished: boolean;
};

export function filterProjects(projects: Project[], filters: ProjectFilters): Project[] {
  return projects.filter((project) => {
    // An explicit stage filter wins outright: asking for "maintenance"
    // shouldn't return nothing just because "show finished" is off.
    if (filters.stage) {
      if (project.stage !== filters.stage) return false;
    } else if (!filters.showFinished && FINISHED_STAGES.includes(project.stage)) {
      return false;
    }
    if (!matchesAssignee(project.assigned_user_id, filters.assignee)) return false;
    return matchesSearch([project.name, project.client_business_name, project.package], filters.search);
  });
}

export type ClientFilters = {
  search: string;
  assignee: string;
};

export function filterClients(clients: Client[], filters: ClientFilters): Client[] {
  return clients.filter((client) => {
    if (!matchesAssignee(client.assigned_user_id, filters.assignee)) return false;
    return matchesSearch([client.business_name, client.billing_email], filters.search);
  });
}

// Results filtering for the Lead Discovery search page — the same list
// the map draws its markers from, so filtering the table filters the map.
export type DiscoveredBusinessFilters = {
  search: string;
  website: "" | "has" | "no";
  mappedOnly: boolean;
};

export type LocatedBusiness = DiscoveredBusiness & { latitude: number; longitude: number };

export function hasCoordinates(business: DiscoveredBusiness): business is LocatedBusiness {
  return typeof business.latitude === "number" && typeof business.longitude === "number";
}

export function filterDiscoveredBusinesses(
  businesses: DiscoveredBusiness[],
  filters: DiscoveredBusinessFilters,
): DiscoveredBusiness[] {
  return businesses.filter((business) => {
    if (filters.website === "has" && business.website_status !== "found") return false;
    if (filters.website === "no" && business.website_status !== "none") return false;
    if (filters.mappedOnly && !hasCoordinates(business)) return false;
    return matchesSearch(
      [business.name, business.industry, business.address, business.suburb, business.website_url],
      filters.search,
    );
  });
}
