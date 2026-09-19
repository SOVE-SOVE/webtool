/**
 * The dashboard sidebar's structure, kept as data (not JSX) so it can be
 * unit-tested and reused (breadcrumbs, a command palette, the mobile
 * bottom nav) later.
 *
 * Grouped into the six stages of the real operating workflow — WORKSPACE,
 * DISCOVER, SALES, BUILD, MANAGE, SYSTEM — so the sidebar reads as "where
 * am I in the business", not a CRM feature list (docs/05_DECISIONS.md UX
 * pass).
 *
 * Workspace has a single entry, Today (`/dashboard`) — the old separate
 * Tasks and Calendar destinations were folded into it as tabs
 * (Overview/Tasks/Calendar, `?tab=tasks` / `?tab=calendar`), the same
 * pattern Clients/Sales/Discovery use (see docs/07_SESSION_LOG.md). The
 * old `/dashboard/tasks` and `/dashboard/calendar` routes still work —
 * each redirects into the corresponding Today tab.
 *
 * Discover has a single entry, Discovery (`/dashboard/discovery`) — the
 * old separate Map Discovery and Review queue destinations were folded
 * into it as tabs (Map Discovery/Review Queue) behind one shared header
 * and switch, the same pattern Sales/Build/Clients already use (see
 * docs/07_SESSION_LOG.md). The old routes still work — `/dashboard/
 * review` and `/dashboard/discovery/{searchId}` each redirect into the
 * corresponding Discovery tab, preserving query params.
 *
 * Sales has a single entry, Sales (`/dashboard/sales`) — the old
 * separate Leads, Sales, and Follow-ups destinations were folded into
 * it as views (Leads/Sales Pipeline/Follow-ups) behind one shared
 * header and switch, the same pattern Build already uses for
 * Planning/Projects (see docs/07_SESSION_LOG.md). The old routes still
 * work — each redirects into the corresponding Sales view, preserving
 * query params.
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

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "workspace",
    label: "Workspace",
    links: [
      { href: "/dashboard", label: "Today", icon: "home" },
    ],
  },
  {
    id: "discover",
    label: "Discover",
    links: [
      // One destination — the Discovery workspace itself picks Map
      // Discovery vs. Review Queue (remembers the last view; each keeps
      // its own stable /dashboard/discovery/map and
      // /dashboard/discovery/review URL). A specific search stays
      // reachable at /dashboard/discovery/map/{searchId}; the old bare
      // /dashboard/discovery/{searchId} and /dashboard/review routes
      // still redirect here, so both are listed here too — this one
      // link stays highlighted from either, and from a discovered-
      // business detail page.
      {
        href: "/dashboard/discovery",
        label: "Discovery",
        icon: "discovery",
        activePrefixes: ["/dashboard/discovery", "/dashboard/review", "/dashboard/discovered-businesses"],
        countKey: "reviewQueue",
      },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    links: [
      // One destination — the Sales workspace itself picks Leads vs.
      // Sales Pipeline vs. Follow-ups (remembers the last view; each
      // keeps its own stable /dashboard/sales/leads,
      // /dashboard/sales/pipeline, /dashboard/sales/follow-ups URL).
      // The Leads detail page stays at its original
      // /dashboard/leads/{id} route and the old bare /dashboard/leads,
      // /dashboard/follow-ups, /dashboard/pipeline routes still
      // redirect here, so all four are listed here too — this one link
      // stays highlighted from any of them.
      {
        href: "/dashboard/sales",
        label: "Sales",
        icon: "sales",
        activePrefixes: [
          "/dashboard/sales",
          "/dashboard/leads",
          "/dashboard/follow-ups",
          "/dashboard/pipeline",
        ],
      },
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
 * The five primary destinations the redesigned sidebar shows as its
 * flat top-level list (no section headings, no nesting) — one per
 * workflow section, in workflow order: Today, Discovery, Sales, Build,
 * Clients. Derived from NAV_SECTIONS rather than hand-listed so it can
 * never drift from the section data above: excludes the System section
 * (Settings — rendered in the sidebar footer, see FOOTER_NAV_LINKS) and
 * any `secondary` link (none today).
 */
export const PRIMARY_NAV_LINKS: NavLink[] = NAV_SECTIONS.filter((s) => s.id !== "system").flatMap((s) =>
  s.links.filter((l) => !l.secondary),
);

/** The System section's links — rendered in the sidebar footer. */
export const FOOTER_NAV_LINKS: NavLink[] = NAV_SECTIONS.find((s) => s.id === "system")?.links ?? [];

/**
 * The four primary destinations for the mobile bottom nav — the
 * workflow's main line (Today, Discover, Sales, Build). Everything else
 * (Clients, Settings) lives behind
 * the drawer's "More" button.
 */
export const MOBILE_PRIMARY_HREFS = [
  "/dashboard",
  "/dashboard/discovery",
  "/dashboard/sales",
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
