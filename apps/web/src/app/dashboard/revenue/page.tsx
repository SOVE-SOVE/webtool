"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The Revenue experience moved into the Clients workspace's Revenue tab
 * (see docs/07_SESSION_LOG.md) — this route is kept, not deleted, so
 * old links and bookmarks still land in the right place. Translates
 * this page's own `tab` param (its Payments/Upcoming & Overdue/Hosting
 * Plans sub-tabs) into the new `revenueTab` param, since `tab` now
 * belongs to the Clients workspace's own three top-level tabs; every
 * other param (period/start/end/q/kind/status/sort/payment) passes
 * through unchanged.
 */
function RevenueRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    const oldTab = next.get("tab");
    next.set("tab", "revenue");
    if (oldTab && oldTab !== "payments") {
      next.set("revenueTab", oldTab);
    } else {
      next.delete("revenueTab");
    }
    router.replace(`/dashboard/clients?${next.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function RevenueRedirect() {
  return (
    <Suspense fallback={null}>
      <RevenueRedirectInner />
    </Suspense>
  );
}
