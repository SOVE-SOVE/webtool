"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DelayedSectionLoading } from "@/components/ui/SectionLoadingIndicator";
import { getLastBuildView } from "./lastView";

/**
 * A bare /dashboard/build visit (no explicit view — the sidebar's Build
 * link points here) picks up wherever the operator left off: the last
 * view they were on, restored to that view's own last-known URL
 * (search/filters/sort/pagination — the same string each view writes
 * to `wdos-list-return:<view>` on every render), or that view's bare
 * route if nothing's been saved yet (e.g. a brand-new session). An
 * explicit link to /dashboard/build/planning or /dashboard/build/
 * projects always opens exactly that view — this redirect only fires
 * on the bare path.
 */
function BuildRedirectInner() {
  const router = useRouter();

  useEffect(() => {
    const view = getLastBuildView();
    const saved = sessionStorage.getItem(`wdos-list-return:${view}`);
    router.replace(saved || `/dashboard/build/${view}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <DelayedSectionLoading icon="projects" label="Loading Build…" />;
}

export default function BuildRedirect() {
  return (
    <Suspense fallback={<DelayedSectionLoading icon="projects" label="Loading Build…" />}>
      <BuildRedirectInner />
    </Suspense>
  );
}
