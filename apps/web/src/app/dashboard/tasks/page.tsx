"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { withParam } from "@/lib/url";

/**
 * Tasks now lives in the Today workspace's Tasks tab — this route is
 * kept, not deleted, so old links and bookmarks still land in the right
 * place. Any query params on the old URL are carried over (the tab is
 * always set to `tasks`), and it's a replace, so Back doesn't bounce
 * through this redirect. There was never a detail route under here.
 */
function TasksRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    router.replace(`/dashboard?${withParam(searchParams, "tab", "tasks")}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function TasksRedirect() {
  return (
    <Suspense fallback={null}>
      <TasksRedirectInner />
    </Suspense>
  );
}
