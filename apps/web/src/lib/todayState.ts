"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Browsing state for the Today workspace's Tasks and Calendar tabs
 * (search, filter, sub-tab, calendar month), kept in the URL so it
 * survives leaving Today for a linked Lead/Client/Project page and
 * pressing Back — the page remounts from the URL — and so a copied link
 * opens the same view. Params are namespaced (`tq`, `tf`, `tt`, `cm`) so
 * they can sit alongside `?tab=` without colliding with it.
 */

/** Returns `search` with each update applied — `null`/`""` removes the key, everything else is preserved. */
export function applyQueryUpdates(search: string, updates: Record<string, string | null>): string {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  return next.toString();
}

/** `2026-09` for the month containing `d`. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** First day of the month named by a `YYYY-MM` key, or null if it isn't one. */
export function parseMonthKey(key: string | null): Date | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null;
}

/** Keeps `value` only if it's one of `allowed`, else `fallback` — a hand-edited or stale URL can't put a view in an impossible state. */
export function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * A piece of view state mirrored into one URL param. Starts from the URL,
 * writes changes back with `history.replaceState` (no history entry, no
 * server round trip — so it's safe on every keystroke; Next syncs
 * `useSearchParams` with it), and re-reads the URL on Back/Forward
 * (`popstate`), since the tab stays mounted while the URL moves under it.
 * A value equal to `fallback` is omitted so URLs stay clean.
 */
export function useUrlState(key: string, fallback: string): [string, (value: string) => void] {
  const pathname = usePathname();
  const initial = useSearchParams().get(key) ?? fallback;
  const [value, setLocal] = useState(initial);

  useEffect(() => {
    const onPop = () => setLocal(new URLSearchParams(window.location.search).get(key) ?? fallback);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [key, fallback]);

  function setValue(next: string) {
    setLocal(next);
    const query = applyQueryUpdates(window.location.search, { [key]: next === fallback ? null : next });
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }

  return [value, setValue];
}
