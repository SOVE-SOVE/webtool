/**
 * Shared display formatting. These used to be copy-pasted per page
 * (`timeAgo` in the Overview and Sales dashboards, an ad-hoc AUD
 * `Intl.NumberFormat` in several places) — one definition here keeps
 * them consistent and unit-testable.
 */

const formattersByCurrency = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat {
  let formatter = formattersByCurrency.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: 0 });
    formattersByCurrency.set(currency, formatter);
  }
  return formatter;
}

/**
 * Cents → "$1,234" in the given ISO-4217 currency code (defaults to
 * AUD for call sites that don't yet have the workspace's configured
 * currency to hand). `null`/`undefined` renders as an em dash.
 */
export function formatMoney(cents: number | null | undefined, currency: string = "AUD"): string {
  return cents === null || cents === undefined ? "—" : formatterFor(currency).format(cents / 100);
}

/** @deprecated Use formatMoney(cents, workspaceCurrency) where the workspace currency is known. */
export function formatAud(cents: number | null | undefined): string {
  return formatMoney(cents, "AUD");
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

/**
 * "15 Sep 2026" from a "YYYY-MM-DD" business date (a payment's
 * received_date, a charge's due_date — a calendar day, not an instant).
 * Parses the Y/M/D components directly into the local-timezone `Date`
 * constructor rather than `new Date("YYYY-MM-DD")`, which JS parses as
 * UTC midnight and can therefore render as the *previous* day once
 * `toLocaleDateString` converts it back to a negative-UTC-offset
 * viewer's local time — exactly the kind of off-by-one financial date
 * bug this table formatting must not introduce.
 */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
