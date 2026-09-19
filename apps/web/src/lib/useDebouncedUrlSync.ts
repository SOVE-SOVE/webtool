"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { withParam } from "@/lib/url";

/**
 * One-directional (state → URL) debounced sync for a free-text filter
 * field — deliberately NOT read back from `searchParams` after the
 * initial mount (callers seed their own `useState` from the URL once,
 * lazily), so a slow/out-of-order debounced `replace` can never
 * "correct" the input mid-keystroke. Keeps the URL shareable/
 * back-button-safe without fighting the field the user is actively
 * typing into.
 *
 * The write merges into the *latest* `searchParams` (via a ref), not the
 * ones captured when the timer was armed: otherwise a "Clear filters"
 * that removes other params in the same click would have them put back
 * 400ms later by this stale write.
 */
export function useDebouncedUrlSync(paramKey: string, value: string, opts?: { delayMs?: number }): void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const delayMs = opts?.delayMs ?? 400;
  const latestParams = useRef(searchParams);
  useEffect(() => {
    latestParams.current = searchParams;
  });

  useEffect(() => {
    const id = setTimeout(() => {
      router.replace(`${pathname}?${withParam(latestParams.current, paramKey, value || null)}`, { scroll: false });
    }, delayMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
