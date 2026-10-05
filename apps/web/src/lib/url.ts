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

/**
 * A short, display-only label for a website URL: just the host, minus a
 * leading "www." — "https://www.example.com.au/services?ref=gbp" →
 * "example.com.au". Never use it as an href; link to the original URL.
 * A scheme-less value ("example.com/about") is parsed as https so its
 * host still comes out; anything unparseable is returned trimmed, as-is,
 * rather than guessed at.
 */
export function displayDomain(url: string): string {
  const trimmed = url.trim();
  try {
    const host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
    return host.replace(/^www\./i, "") || trimmed;
  } catch {
    return trimmed;
  }
}
