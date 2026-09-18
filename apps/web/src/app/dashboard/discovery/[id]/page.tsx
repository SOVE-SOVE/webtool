"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * The old permalink to one discovery search, from before Map Discovery
 * and Review Queue merged into one Discovery workspace — kept as a
 * redirect (not deleted) so bookmarked search URLs and any stored
 * `discovery_search` activity links keep working. Forwards to the same
 * search under its new home, `/dashboard/discovery/map/{id}`.
 */
function DiscoverySearchRedirectInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  useEffect(() => {
    router.replace(`/dashboard/discovery/map/${params.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function DiscoverySearchRedirect() {
  return (
    <Suspense fallback={null}>
      <DiscoverySearchRedirectInner />
    </Suspense>
  );
}
