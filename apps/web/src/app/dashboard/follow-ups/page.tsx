"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The Follow-ups queue moved into the shared Sales workspace (Leads /
 * Sales Pipeline / Follow-ups switch — see docs/07_SESSION_LOG.md) —
 * this route is kept, not deleted, so old links and bookmarks still
 * land in the right place. This page never read any query params, so
 * unlike the Leads/Planning redirects this one needs neither
 * `useSearchParams()` nor a `Suspense` boundary.
 */
export default function FollowUpsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/sales/follow-ups");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
