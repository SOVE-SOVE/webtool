/**
 * Which rows are genuinely new, or changed, since the previous snapshot
 * of the same dataset — the input to the brief "just changed" highlight.
 *
 * `previous` maps id → a version stamp (typically `updated_at`). A row
 * is reported when its id wasn't in `previous`, or its stamp differs. A
 * `null` previous snapshot means "first load": nothing is reported, so a
 * page never lights up every row on initial render.
 *
 * Always call this with the *unfiltered* dataset, so a filter or sort
 * change (which only reveals rows already loaded) is never mistaken for
 * a new row.
 */
export function diffChangedIds<T>(
  previous: ReadonlyMap<string, string> | null,
  rows: readonly T[],
  getId: (row: T) => string,
  getStamp: (row: T) => string,
): Set<string> {
  const changed = new Set<string>();
  if (!previous) return changed;
  for (const row of rows) {
    const id = getId(row);
    if (previous.get(id) !== getStamp(row)) changed.add(id);
  }
  return changed;
}

/** id → stamp snapshot of `rows`, the `previous` input for the next diff. */
export function snapshotStamps<T>(
  rows: readonly T[],
  getId: (row: T) => string,
  getStamp: (row: T) => string,
): Map<string, string> {
  return new Map(rows.map((row) => [getId(row), getStamp(row)]));
}
