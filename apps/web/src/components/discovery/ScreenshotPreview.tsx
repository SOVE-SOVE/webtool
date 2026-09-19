"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Discovery-stage research doesn't capture screenshots — the only
 * screenshot a discovered business can ever have is the one Planning
 * captures of its existing site, once the business has been imported as
 * a Lead and that Lead has a Planning workspace. So: business →
 * `imported_lead_id` → `Lead.planning_id` → the lightweight thumbnail
 * route. Anything short of that (not imported, no planning, no capture,
 * image 404s) resolves to `src: null`, and the review brief renders the
 * compact "not captured yet" line rather than a tall empty box.
 *
 * Nothing is fetched for a business that hasn't been imported.
 */
export function useDiscoveryScreenshot(importedLeadId: string | null): {
  src: string | null;
  /** Wire to the `<img onError>`: the thumbnail route 404s when nothing was captured. */
  markFailed: () => void;
} {
  const [planningId, setPlanningId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!importedLeadId) return;
    let alive = true;
    api
      .getLead(importedLeadId)
      .then((lead) => alive && setPlanningId(lead.planning_id))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [importedLeadId]);

  return {
    src: importedLeadId && planningId && !failed ? api.planningScreenshotUrl(planningId) : null,
    markFailed: () => setFailed(true),
  };
}

export const SCREENSHOT_UNAVAILABLE_TEXT =
  "Discovery-stage research doesn’t capture screenshots — they’re generated later, once this business becomes a Lead and moves into Planning.";

export function ScreenshotsBody({ src, onError }: { src: string | null; onError: () => void }) {
  if (!src) return <p className="text-sm text-fg-subtle">{SCREENSHOT_UNAVAILABLE_TEXT}</p>;
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API route, not an optimizable static asset */}
      <img
        src={src}
        alt="Screenshot of the business's existing website"
        onError={onError}
        className="w-full rounded-md border border-border"
      />
      <p className="mt-2 text-xs text-fg-subtle">Captured by Planning from the business&rsquo;s existing website.</p>
    </div>
  );
}
