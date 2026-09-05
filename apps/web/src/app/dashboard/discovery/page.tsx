import { DiscoveryWorkspace } from "@/components/DiscoveryWorkspace";

/**
 * The one Discovery destination. `DiscoveryWorkspace` shows the search
 * controls, the map and the discovered-business results together, opened
 * against the most recent search. `/dashboard/discovery/[id]` renders the
 * same workspace deep-linked to one specific search.
 */
export default function DiscoveryPage() {
  return <DiscoveryWorkspace />;
}
