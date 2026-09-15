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
 * Manage has a single entry, Clients (`/dashboard/clients`) — the old
 * separate Live Websites and Revenue destinations were folded into it as
 * tabs (Overview/Websites/Revenue), so navigating client relationships,
 * live websites, hosting, and payments all happens in one workspace
 * rather than three sidebar entries pointing at overlapping data (see
 * docs/07_SESSION_LOG.md). The old routes still work — each redirects
 * into the corresponding Clients tab, preserving query params.
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
   * Custom active-state check for a link whose own route can also be
   * reached in a state that shouldn't light it up (Leads staying
   * inactive on its own `?tab=won` view, since that's conceptually
   * "Clients", not "Leads"). When present, this is checked in addition
   * to activePrefixes — the default path-prefix match on `href` is
   * skipped in favour of this predicate.
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
      // One destination — the Build workspace itself picks Planning vs.
      // Projects (remembers the last view; each keeps its own stable
      // /dashboard/build/planning and /dashboard/build/projects URL).
      // Detail pages stay at their original /dashboard/planning/{id} and
      // /dashboard/projects/{id} routes, so both are listed here too —
      // this one link stays highlighted from either.
      {
        href: "/dashboard/build",
        label: "Build",
        icon: "projects",
        activePrefixes: ["/dashboard/build", "/dashboard/planning", "/dashboard/projects"],
        countKey: "planningNeedsReview",
      },
    ],
  },
  {
    id: "manage",
    label: "Manage",
    links: [{ href: "/dashboard/clients", label: "Clients", icon: "clients" }],
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
 * The four primary destinations for the mobile bottom nav — the
 * workflow's main line (Today, Discover, Leads, Build). Everything else
 * (Clients, Sales, Follow-ups, Tasks, Calendar, Settings, Review queue)
 * lives behind "More".
 */
export const MOBILE_PRIMARY_HREFS = [
  "/dashboard",
  "/dashboard/discovery",
  "/dashboard/leads",
  "/dashboard/build",
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
