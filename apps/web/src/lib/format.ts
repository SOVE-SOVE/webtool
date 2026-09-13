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

/** "Sunday, 13 September" — the Today page's header date line. */
export function formatLongDate(d: Date = new Date()): string {
  return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}

/** "2:00 pm" — same-day event time, for Today's schedule. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

/** "2026-09-13" — the calendar API's date-key format (local calendar day, not UTC). */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
