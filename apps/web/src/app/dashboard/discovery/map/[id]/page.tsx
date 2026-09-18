/**
 * Renders nothing of its own — see `discovery/map/page.tsx`. The
 * `[id]` param is read by the shared `DiscoveryLayout` via `useParams()`
 * to deep-link `DiscoveryWorkspace` to this specific search. This file
 * exists only so `/dashboard/discovery/map/{searchId}` is a real,
 * directly-navigable, bookmarkable route.
 */
export default function DiscoveryMapSearchPage() {
  return null;
}
