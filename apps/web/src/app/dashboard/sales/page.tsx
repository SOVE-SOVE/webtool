"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getLastSalesView } from "./lastView";

/**
 * A bare /dashboard/sales visit (no explicit view — the sidebar's Sales
 * link points here) picks up wherever the operator left off: the last
 * view they were on, restored to that view's own last-known URL
 * (search/filters/sort/pagination — the same string each view writes
 * to `wdos-list-return:<view>` on every render), or that view's bare
 * route if nothing's been saved yet (e.g. a brand-new session). An
 * explicit link to /dashboard/sales/leads, /dashboard/sales/pipeline,
 * or /dashboard/sales/follow-ups always opens exactly that view — this
 * redirect only fires on the bare path. Exact mirror of
 * dashboard/build/page.tsx's own redirect for the same reason.
 *
 * This bare path used to render the Sales analytics dashboard directly
 * — that content moved to /dashboard/sales/pipeline (see
 * docs/07_SESSION_LOG.md); this URL is now purely the workspace's own
 * entry point, same role /dashboard/build already has.
 */
function SalesRedirectInner() {
  const router = useRouter();

  useEffect(() => {
    const view = getLastSalesView();
    const saved = sessionStorage.getItem(`wdos-list-return:${view}`);
    router.replace(saved || `/dashboard/sales/${view}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function SalesRedirect() {
  return (
    <Suspense fallback={null}>
      <SalesRedirectInner />
    </Suspense>
  );
}
