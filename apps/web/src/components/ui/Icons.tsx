import type { IconName } from "@/lib/nav";

/**
 * The small line-icon set the sidebar uses. Inline SVG (no icon-library
 * dependency), 24px grid, `currentColor` stroke so they inherit the
 * nav link's colour and active state.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.25 9.75V20a1 1 0 0 0 1 1H9.5v-5.25a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21h3.25a1 1 0 0 0 1-1V9.75" />,
  tasks: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m4 6 1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v3M16 3v3" />
    </>
  ),
  discovery: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  review: (
    <>
      <path d="M9 4.5h6a1 1 0 0 1 1 1V6h1.5a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H8v-.5a1 1 0 0 1 1-1Z" />
      <path d="m8.5 13 2 2 4-4.5" />
    </>
  ),
  leads: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.7-3 2.9-4.5 5.5-4.5S13.8 16 14.5 19" />
      <path d="M16 6.5a2.75 2.75 0 0 1 0 5.5M17.5 18.5c-.3-2-1.2-3.2-2.5-4" />
    </>
  ),
  pipeline: (
    <>
      <rect x="3.5" y="4.5" width="5" height="15" rx="1" />
      <rect x="10" y="4.5" width="5" height="10" rx="1" />
      <rect x="16.5" y="4.5" width="4" height="7" rx="1" />
    </>
  ),
  sales: (
    <>
      <path d="M4 19h16" />
      <path d="m5 15 4-4 3 3 6-7" />
      <path d="M18 7h-3M18 7v3" />
    </>
  ),
  followups: (
    <>
      <path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 5 2 6.5 2 6.5H4.5s2-1.5 2-6.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  projects: (
    <>
      <path d="m13.5 6.5 4 4M3.5 20.5l1-4L15 6a2 2 0 0 1 3 0l.5.5a2 2 0 0 1 0 3L8 20l-4.5.5Z" />
    </>
  ),
  clients: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
};

export function NavIcon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
