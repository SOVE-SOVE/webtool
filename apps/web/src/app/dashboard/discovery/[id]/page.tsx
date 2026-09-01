"use client";

import { useParams } from "next/navigation";
import { DiscoveryWorkspace } from "@/components/DiscoveryWorkspace";

/**
 * A permalink to one discovery search. Renders the same single Discovery
 * workspace as `/dashboard/discovery`, just opened on this search — so
 * links from the discovered-business detail page and any bookmarked
 * search URLs keep working after the workspace was unified.
 */
export default function DiscoverySearchPage() {
  const params = useParams<{ id: string }>();
  return <DiscoveryWorkspace initialSearchId={params.id} />;
}
