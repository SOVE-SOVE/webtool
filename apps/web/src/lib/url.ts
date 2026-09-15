/**
 * Small helpers for building a query string from the current
 * `searchParams`, changing/removing one key while preserving the rest.
 * Used anywhere a list page needs to write filter/panel state into the
 * URL without clobbering params owned by other features (e.g. Leads'
 * `?preview=` alongside its existing `?tab=`/`?view=`).
 */
export function withParam(searchParams: URLSearchParams, key: string, value: string | null): string {
  const next = new URLSearchParams(searchParams.toString());
  if (value === null || value === "") next.delete(key);
  else next.set(key, value);
  return next.toString();
}

export function withoutParam(searchParams: URLSearchParams, key: string): string {
  return withParam(searchParams, key, null);
}
