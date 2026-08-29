/**
 * Shared display formatting. These used to be copy-pasted per page
 * (`timeAgo` in the Overview and Sales dashboards, an ad-hoc AUD
 * `Intl.NumberFormat` in several places) — one definition here keeps
 * them consistent and unit-testable.
 */

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

/** Cents → "$1,234". `null`/`undefined` renders as an em dash. */
export function formatAud(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : AUD.format(cents / 100);
}

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
