/**
 * Renders nothing of its own — `DiscoveryLayout` (the parent layout)
 * owns and permanently mounts the actual Map Discovery content, keyed
 * off the URL rather than this page's own render. This file exists only
 * so `/dashboard/discovery/map` is a real, directly-navigable route.
 */
export default function DiscoveryMapPage() {
  return null;
}
