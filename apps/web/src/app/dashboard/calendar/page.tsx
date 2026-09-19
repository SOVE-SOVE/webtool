"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { withParam } from "@/lib/url";

/**
 * Calendar now lives in the Today workspace's Calendar tab — this route is
 * kept, not deleted, so old links and bookmarks still land in the right
 * place. Any query params on the old URL are carried over (the tab is
 * always set to `calendar`), and it's a replace, so Back doesn't bounce
 * through this redirect. There was never a detail route under here.
 */
function CalendarRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    router.replace(`/dashboard?${withParam(searchParams, "tab", "calendar")}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function CalendarRedirect() {
  return (
    <Suspense fallback={null}>
      <CalendarRedirectInner />
    </Suspense>
  );
}
