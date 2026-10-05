/**
 * Which of the five things a list region should be showing. One decision
 * shared by the list pages (Leads, Planning, Projects, Clients, Review
 * Queue, Discovery results) so "nothing exists", "nothing matches",
 * "still loading" and "couldn't load" never get mistaken for one another.
 *
 *  - `loading`         no data has arrived yet (first load).
 *  - `error`           there is nothing trustworthy to show: the load
 *                      failed, or it failed on a refetch and the rows
 *                      still held are empty — an empty message there would
 *                      present a failure as "no records".
 *  - `empty`           loaded, and nothing is hidden by a search or filter.
 *                      `total` says whether that is "none exist" (0) or
 *                      "some exist, but this view leaves them out by
 *                      default" (> 0) — the page words the two apart.
 *  - `filtered-empty`  loaded, and the current search/filters hide every
 *                      record. Only ever with `filtersActive`, so a "Clear
 *                      filters" action can't appear with nothing to clear.
 *  - `results`         there are rows to show (an error from a refetch is
 *                      shown as a banner above them by the page).
 */
export type ListState = "loading" | "error" | "empty" | "filtered-empty" | "results";

export function listState({
  loaded,
  error,
  visible,
  filtersActive,
}: {
  /** Data for this list has arrived at least once. */
  loaded: boolean;
  /** The latest load failed. */
  error: boolean;
  /** Rows left after the current search/filters/view. */
  visible: number;
  /** A search term or filter the user can clear is narrowing the list. */
  filtersActive: boolean;
}): ListState {
  if (!loaded) return error ? "error" : "loading";
  if (visible > 0) return "results";
  if (error) return "error";
  return filtersActive ? "filtered-empty" : "empty";
}

/** Longest search term quoted back in an empty-state title. */
const QUOTED_SEARCH_MAX = 40;

/**
 * Title + (optional) one-sentence description for a `filtered-empty`
 * list, naming what is doing the filtering: the search term when there
 * is one, otherwise the filters.
 */
export function filteredEmptyCopy({
  noun,
  search,
  filterCount,
}: {
  /** Plural, lower-case: "clients", "leads". */
  noun: string;
  search: string;
  /** Active filters other than the search. */
  filterCount: number;
}): { title: string; description?: string } {
  const term = search.trim();
  if (!term) return { title: `No ${noun} match these filters` };
  const quoted = term.length > QUOTED_SEARCH_MAX ? `${term.slice(0, QUOTED_SEARCH_MAX).trimEnd()}…` : term;
  return {
    title: `No ${noun} match “${quoted}”`,
    description:
      filterCount > 0 ? `${filterCount} filter${filterCount === 1 ? " is" : "s are"} also applied.` : undefined,
  };
}
