"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The old standalone Review Queue page, from before it merged with Map
 * Discovery into one Discovery workspace — kept as a redirect (not
 * deleted) so bookmarks and any external links keep working. This page
 * never had its own URL-synced filters/sort/search (all local state),
 * so there's nothing to preserve across the redirect.
 */
function ReviewRedirectInner() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/discovery/review");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function ReviewRedirect() {
  return (
    <Suspense fallback={null}>
      <ReviewRedirectInner />
    </Suspense>
  );
}
