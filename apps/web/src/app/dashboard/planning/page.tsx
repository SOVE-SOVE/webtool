"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The Planning list moved into the shared Build workspace (Planning /
 * Projects switch — see docs/07_SESSION_LOG.md) — this route is kept,
 * not deleted, so old links and bookmarks still land in the right
 * place. Every existing param (search/status/mode/sort/transferred/
 * show) passes through unchanged; only the path changes. Individual
 * Planning workspaces (`/dashboard/planning/{id}`) are untouched — this
 * redirect is this exact bare path only, a separate Next.js route from
 * `[id]`.
 */
function PlanningRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    router.replace(`/dashboard/build/planning?${searchParams.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function PlanningRedirect() {
  return (
    <Suspense fallback={null}>
      <PlanningRedirectInner />
    </Suspense>
  );
}
