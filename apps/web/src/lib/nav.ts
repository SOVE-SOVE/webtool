/**
 * The dashboard sidebar's structure, kept as data (not JSX) so it can be
 * unit-tested and reused (breadcrumbs, a command palette) later.
 *
 * Grouped into the five plain-language stages a web-design business
 * actually moves through — HOME, FIND, SELL, BUILD, SETTINGS — rather
 * than CRM jargon, so someone who has never used a CRM can tell at a
 * glance what each link is for (see docs/05_DECISIONS.md UX pass).
 *
 * Nothing is deleted: Pipeline, Review and Clients are still first-class
 * routes, surfaced as `secondary` links under the primary concept they
 * belong to (Pipeline is a view of Leads, Review is a view of Discovery,
 * Clients are won accounts you build for).
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
  | "projects"
  | "clients"
  | "settings";

export type NavLink = {
  href: string;
  label: string;
  icon: IconName;
  /** Rendered smaller and indented — a sub-view of the primary link above it. */
  secondary?: boolean;
  /** Extra path prefixes that should also mark this link active. */
  activePrefixes?: string[];
};

export type NavSection = {
  id: string;
  label: string;
  links: NavLink[];
};

/** The single top link, above the grouped sections. */
export const HOME_LINK: NavLink = { href: "/dashboard", label: "Overview", icon: "home" };

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "home",
    label: "Home",
    links: [
      { href: "/dashboard/tasks", label: "Tasks", icon: "tasks" },
      { href: "/dashboard/calendar", label: "Calendar", icon: "calendar" },
    ],
  },
  {
    id: "find",
    label: "Find",
    links: [
      {
        href: "/dashboard/discovery",
        label: "Discovery",
        icon: "discovery",
      },
      {
        href: "/dashboard/review",
        label: "Review queue",
        icon: "review",
        secondary: true,
        activePrefixes: ["/dashboard/discovered-businesses"],
      },
      {
        href: "/dashboard/leads",
        label: "Leads",
        icon: "leads",
        // The Pipeline board and the Clients list are now the "Board"
        // view and the "Won" tab of this page — their routes still work
        // (they redirect here), they're just not separate nav items.
        activePrefixes: ["/dashboard/pipeline", "/dashboard/clients"],
      },
    ],
  },
  {
    id: "sell",
    label: "Sell",
    links: [
      { href: "/dashboard/sales", label: "Sales", icon: "sales" },
      { href: "/dashboard/follow-ups", label: "Follow-ups", icon: "followups" },
    ],
  },
  {
    id: "build",
    label: "Build",
    links: [{ href: "/dashboard/projects", label: "Projects", icon: "projects" }],
  },
];

export const SETTINGS_LINK: NavLink = { href: "/dashboard/settings", label: "Settings", icon: "settings" };

/** Every route the sidebar can reach — handy for tests and route audits. */
export const ALL_NAV_HREFS: string[] = [
  HOME_LINK.href,
  ...NAV_SECTIONS.flatMap((s) => s.links.map((l) => l.href)),
  SETTINGS_LINK.href,
];

export function isNavLinkActive(pathname: string, link: NavLink): boolean {
  if (link.href === "/dashboard") return pathname === "/dashboard";
  if (pathname === link.href || pathname.startsWith(`${link.href}/`)) return true;
  return (link.activePrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
