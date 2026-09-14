/**
 * The dashboard sidebar's structure, kept as data (not JSX) so it can be
 * unit-tested and reused (breadcrumbs, a command palette, the mobile
 * bottom nav) later.
 *
 * Grouped into the six stages of the real operating workflow — WORKSPACE,
 * DISCOVER, SALES, BUILD, MANAGE, SYSTEM — so the sidebar reads as "where
 * am I in the business", not a CRM feature list (docs/05_DECISIONS.md UX
 * pass). Nothing is deleted: Tasks, Calendar, Sales and Follow-ups are
 * still first-class routes, surfaced as `secondary` links under the
 * primary concept they belong to.
 *
 * Live Websites reuses Projects (filtered to its finished/live stages)
 * rather than a new page — see the `isActive` predicate below, which is
 * how two sidebar links can point at the same base route without both
 * lighting up together. Clients is its own real route/page backed by the
 * Client API (`/dashboard/clients`) — it used to be a view over Leads'
 * "Won" tab, but a client is a distinct entity from a lead (see
 * docs/05_DECISIONS.md), so it gets its own destination.
 */

export type IconName =
  | "home"
  | "tasks"
  | "calendar"
  | "discovery"
  | "review"
  | "leads"
  | "pipeline"
  | "sales"
  | "followups"
  | "planning"
  | "projects"
  | "clients"
  | "live"
  | "settings";

export type NavLink = {
  href: string;
  label: string;
  icon: IconName;
  /** Rendered smaller and indented — a sub-view of the primary link above it. */
  secondary?: boolean;
  /** Extra path prefixes that should also mark this link active (a real route this link's destination redirects from, or a detail page under it). */
  activePrefixes?: string[];
  /**
   * Custom active-state check for a link that shares a base pathname with
   * a sibling link, distinguished only by a query string (Leads vs
   * Clients, Projects vs Live Websites). When present, this is checked in
   * addition to activePrefixes — the default path-prefix match on `href`
   * is skipped in favour of this predicate.
   */
  isActive?: (pathname: string, search: URLSearchParams) => boolean;
  /** Small workspace count badge — e.g. items waiting for review. Omitted (undefined) shows nothing; 0 is shown as "0" only when explicitly passed. */
  countKey?: "reviewQueue" | "planningNeedsReview";
};

export type NavSection = {
  id: string;
  label: string;
  links: NavLink[];
};

const onLeads = (pathname: string) => pathname === "/dashboard/leads" || pathname.startsWith("/dashboard/leads/");
const onProjects = (pathname: string) => pathname === "/dashboard/projects" || pathname.startsWith("/dashboard/projects/");

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "workspace",
    label: "Workspace",
    links: [
      { href: "/dashboard", label: "Today", icon: "home" },
      { href: "/dashboard/tasks", label: "Tasks", icon: "tasks", secondary: true },
      { href: "/dashboard/calendar", label: "Calendar", icon: "calendar", secondary: true },
    ],
  },
  {
    id: "discover",
    label: "Discover",
    links: [
      { href: "/dashboard/discovery", label: "Map Discovery", icon: "discovery" },
      {
        href: "/dashboard/review",
        label: "Review queue",
        icon: "review",
        secondary: true,
        activePrefixes: ["/dashboard/discovered-businesses"],
        countKey: "reviewQueue",
      },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    links: [
      {
        href: "/dashboard/leads",
        label: "Leads",
        icon: "leads",
        activePrefixes: ["/dashboard/pipeline"],
        isActive: (pathname, search) => onLeads(pathname) && search.get("tab") !== "won",
      },
      { href: "/dashboard/sales", label: "Sales", icon: "sales", secondary: true },
      { href: "/dashboard/follow-ups", label: "Follow-ups", icon: "followups", secondary: true },
    ],
  },
  {
    id: "build",
    label: "Build",
    links: [
      // Planning before Projects: this is the order the work actually
      // happens in (understand the site, then build the new one).
      { href: "/dashboard/planning", label: "Planning", icon: "planning", countKey: "planningNeedsReview" },
      {
        href: "/dashboard/projects",
        label: "Projects",
        icon: "projects",
        isActive: (pathname, search) => onProjects(pathname) && search.get("view") !== "live",
      },
    ],
  },
  {
    id: "manage",
    label: "Manage",
    links: [
      { href: "/dashboard/clients", label: "Clients", icon: "clients" },
      {
        href: "/dashboard/projects?view=live",
        label: "Live Websites",
        icon: "live",
        isActive: (pathname, search) => pathname === "/dashboard/projects" && search.get("view") === "live",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    links: [{ href: "/dashboard/settings", label: "Settings", icon: "settings" }],
  },
];

/** Every route the sidebar can reach — handy for tests and route audits. */
export const ALL_NAV_HREFS: string[] = NAV_SECTIONS.flatMap((s) => s.links.map((l) => l.href));

/**
 * The five primary destinations for the mobile bottom nav — the
 * workflow's main line (Today, Discover, Leads, Planning, Projects).
 * Everything else (Clients, Live Websites, Sales, Follow-ups, Tasks,
 * Calendar, Settings, Review queue) lives behind "More".
 */
export const MOBILE_PRIMARY_HREFS = [
  "/dashboard",
  "/dashboard/discovery",
  "/dashboard/leads",
  "/dashboard/planning",
  "/dashboard/projects",
] as const;

export function isNavLinkActive(pathname: string, search: URLSearchParams, link: NavLink): boolean {
  const prefixMatch = (link.activePrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (prefixMatch) return true;
  if (link.isActive) return link.isActive(pathname, search);
  if (link.href === "/dashboard") return pathname === "/dashboard";
  const linkPath = link.href.split("?")[0];
  return pathname === linkPath || pathname.startsWith(`${linkPath}/`);
}
