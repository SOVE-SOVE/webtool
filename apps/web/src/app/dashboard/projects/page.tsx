"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The Projects list moved into the shared Build workspace (Planning /
 * Projects switch — see docs/07_SESSION_LOG.md) — this route is kept,
 * not deleted, so old links and bookmarks still land in the right
 * place. Every existing param (search/stage/owner/assignee/sort/
 * finished/show/new, and the older ?view=live, which this new location
 * still translates into the Clients workspace's Websites tab) passes
 * through unchanged; only the path changes. Individual Projects
 * (`/dashboard/projects/{id}`) are untouched — this redirect is this
 * exact bare path only, a separate Next.js route from `[id]`.
 */
function ProjectsRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    router.replace(`/dashboard/build/projects?${searchParams.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function ProjectsRedirect() {
  return (
    <Suspense fallback={null}>
      <ProjectsRedirectInner />
    </Suspense>
  );
}
