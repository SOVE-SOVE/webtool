/**
 * List-page filtering for Projects and Clients. Pure functions, kept out
 * of the page components so the behaviour operators actually rely on
 * (find a project by client name, hide finished work, see what's
 * unassigned) is unit-testable without a DOM.
 */

import type { Client, DiscoveredBusiness, InstagramWebsiteStatus, Project, ProjectStage } from "@/lib/api";

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

// A business's most recent Instagram post within this many days counts
// as "active recently" — see the activeRecentlyOnly filter below. A
// fixed, documented threshold rather than a free-form day picker, to
// keep the filter row simple; change this one constant if 30 days turns
// out to be the wrong bar.
export const ACTIVE_RECENTLY_DAYS = 30;

// Results filtering for the Lead Discovery search page — the same list
// the map draws its markers from, so filtering the table filters the map.
export type DiscoveredBusinessFilters = {
  search: string;
  website: "" | "has" | "no";
  mappedOnly: boolean;
  // Phase 1 of Instagram Discovery — each is a no-op unless the operator
  // has actually turned it on / picked a value, so these never affect
  // non-Instagram (Brave/Places) results.
  instagramStatus: "" | InstagramWebsiteStatus;
  contactableOnly: boolean;
  activeRecentlyOnly: boolean;
  minFollowers: number | null;
};

export type LocatedBusiness = DiscoveredBusiness & { latitude: number; longitude: number };

export function hasCoordinates(business: DiscoveredBusiness): business is LocatedBusiness {
  return typeof business.latitude === "number" && typeof business.longitude === "number";
}

export function filterDiscoveredBusinesses(
  businesses: DiscoveredBusiness[],
  filters: DiscoveredBusinessFilters,
): DiscoveredBusiness[] {
  const activeRecentlyCutoff = Date.now() - ACTIVE_RECENTLY_DAYS * 24 * 60 * 60 * 1000;
  return businesses.filter((business) => {
    if (filters.website === "has" && business.website_status !== "found") return false;
    if (filters.website === "no" && business.website_status !== "none") return false;
    if (filters.mappedOnly && !hasCoordinates(business)) return false;
    if (filters.instagramStatus && business.instagram_website_status !== filters.instagramStatus) return false;
    if (filters.contactableOnly && !business.phone && !business.email) return false;
    if (filters.activeRecentlyOnly) {
      if (!business.instagram_last_post_at) return false;
      if (new Date(business.instagram_last_post_at).getTime() < activeRecentlyCutoff) return false;
    }
    if (filters.minFollowers !== null) {
      if (business.instagram_follower_count === null) return false;
      if (business.instagram_follower_count < filters.minFollowers) return false;
    }
    return matchesSearch(
      [business.name, business.industry, business.address, business.suburb, business.website_url, business.instagram_handle],
      filters.search,
    );
  });
}

// In-person prospecting sort. "discovered" is the provider's own
// relevance order (untouched). "no-website" surfaces the businesses most
// likely to need a new site; "score" reuses the existing opportunity
// score — no competing ranking of our own.
export type DiscoverySort = "discovered" | "no-website" | "score";

const WEBSITE_RANK: Record<DiscoveredBusiness["website_status"], number> = {
  none: 0,
  unknown: 1,
  found: 2,
};

export function sortDiscoveredBusinesses(
  businesses: DiscoveredBusiness[],
  sort: DiscoverySort,
): DiscoveredBusiness[] {
  if (sort === "discovered") return businesses;
  const withIndex = businesses.map((b, i) => ({ b, i }));
  withIndex.sort((x, y) => {
    if (sort === "no-website") {
      const d = WEBSITE_RANK[x.b.website_status] - WEBSITE_RANK[y.b.website_status];
      if (d !== 0) return d;
    } else {
      const d = (y.b.opportunity_score ?? -1) - (x.b.opportunity_score ?? -1);
      if (d !== 0) return d;
    }
    return x.i - y.i; // stable: keep discovery order within a tier
  });
  return withIndex.map((w) => w.b);
}
