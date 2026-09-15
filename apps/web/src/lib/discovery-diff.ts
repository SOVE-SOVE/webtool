/**
 * Which of `rows` weren't in `previousIds` — used to fade in genuinely
 * new Discovery results without replaying the animation for rows that
 * were already on screen (a poll tick, a filter/sort change, or a
 * re-render of the same search).
 */
export function diffNewIds(previousIds: Set<string>, rows: { id: string }[]): Set<string> {
  const fresh = new Set<string>();
  for (const row of rows) {
    if (!previousIds.has(row.id)) fresh.add(row.id);
  }
  return fresh;
}
