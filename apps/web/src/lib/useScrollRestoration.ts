"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Remembers window scroll position per exact URL (pathname+querystring)
 * in sessionStorage — the app's first sessionStorage usage, chosen over
 * localStorage because this is ephemeral per-tab presentation state,
 * not a persistent preference. Restores only once `ready` becomes
 * true (i.e. the list's own data has finished loading) — restoring
 * before data loads would land on the wrong spot against a shorter
 * skeleton page. Since filters are URL-synced, switching tabs/filters
 * naturally gets its own remembered scroll position for free (the key
 * includes the querystring).
 *
 * `keyOverride` lets a caller substitute its own key (still combined
 * with pathname) instead of the raw querystring — for a page whose URL
 * carries an overlay-only param (a preview/detail panel's `?preview=`
 * or `?payment=`, say) that shouldn't fragment the *list's* scroll
 * memory into a separate bucket per open/closed panel. Omit it to keep
 * the default full-querystring behaviour.
 */
export function useScrollRestoration(ready: boolean, keyOverride?: string): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = `wdos-scroll:${pathname}?${keyOverride ?? searchParams.toString()}`;
  const restoredRef = useRef(false);

  useEffect(() => {
    restoredRef.current = false;
  }, [key]);

  useEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const saved = sessionStorage.getItem(key);
    if (saved) window.scrollTo(0, Number(saved));
  }, [ready, key]);

  useEffect(() => {
    let raf: number | null = null;
    function onScroll() {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        sessionStorage.setItem(key, String(window.scrollY));
        raf = null;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
      sessionStorage.setItem(key, String(window.scrollY));
    };
  }, [key]);
}
