"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The Leads list moved into the shared Sales workspace (Leads / Sales
 * Pipeline / Follow-ups switch — see docs/07_SESSION_LOG.md) — this
 * route is kept, not deleted, so old links and bookmarks still land in
 * the right place. Every existing param (search/tab/view/website/new/
 * archived/preview) passes through unchanged; only the path changes.
 * The Leads detail route (`/dashboard/leads/{id}`) is untouched — this
 * redirect is this exact bare path only, a separate Next.js route from
 * `[id]`.
 */
function LeadsRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    router.replace(`/dashboard/sales/leads?${searchParams.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function LeadsRedirect() {
  return (
    <Suspense fallback={null}>
      <LeadsRedirectInner />
    </Suspense>
  );
}
