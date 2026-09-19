"use client";

import { useEffect, useState } from "react";
import { diffChangedIds, snapshotStamps } from "./recentChanges";

/** How long a row stays flagged — just past the `.row-flash` animation. */
const FLASH_MS = 1600;

type Seen<T> = { rows: readonly T[] | null; resetKey: string | number; stamps: Map<string, string> | null };

/**
 * The ids of rows that were newly created or updated since the last time
 * `rows` changed — for a brief highlight (`.row-flash`) that settles on
 * its own. Nothing is flagged on first load, or when `resetKey` changes
 * (pass whatever swaps in a *different* dataset, e.g. an "include
 * archived" toggle, so its rows aren't mistaken for new ones).
 *
 * Give it the unfiltered dataset, never the filtered/sorted view.
 */
export function useRecentChanges<T>(
  rows: readonly T[] | null,
  getId: (row: T) => string,
  getStamp: (row: T) => string,
  resetKey: string | number = "",
): ReadonlySet<string> {
  const [seen, setSeen] = useState<Seen<T>>({ rows: null, resetKey, stamps: null });
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(() => new Set());

  // Derived during render (React's "adjust state when a prop changes"
  // pattern) rather than in an effect, so the flag lands in the same
  // commit as the new row — no un-highlighted first frame.
  if (rows !== seen.rows || resetKey !== seen.resetKey) {
    const reset = resetKey !== seen.resetKey;
    const next = rows ? diffChangedIds(reset ? null : seen.stamps, rows, getId, getStamp) : new Set<string>();
    setSeen({ rows, resetKey, stamps: rows ? snapshotStamps(rows, getId, getStamp) : seen.stamps });
    // Merge rather than replace: an unrelated refetch inside the flash
    // window must not cut a running highlight short, and a second change
    // must not drop the first row's.
    if (next.size > 0) setFlagged(reset ? next : new Set([...flagged, ...next]));
    else if (reset && flagged.size > 0) setFlagged(new Set());
  }

  useEffect(() => {
    if (flagged.size === 0) return;
    const t = setTimeout(() => setFlagged(new Set()), FLASH_MS);
    return () => clearTimeout(t);
  }, [flagged]);

  return flagged;
}
