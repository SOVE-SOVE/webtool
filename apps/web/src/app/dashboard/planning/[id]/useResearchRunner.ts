"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Planning } from "@/lib/api";
import {
  EMPTY_SESSION,
  computeResearchOps,
  nextResearchOp,
  summariseResearch,
  type ResearchOpId,
  type ResearchSessionState,
} from "./researchRun";

/**
 * Drives "Analyse business": one click works through whatever research
 * is still missing (see researchRun.ts), in order, reusing everything
 * already successful. The website audit is the one background job — the
 * chain simply pauses while it runs (page.tsx's existing poll keeps
 * `planning` fresh) and carries on once it settles, as long as this step
 * stays open; leaving and coming back offers "Continue" for what's left.
 *
 * Duplicate requests: `inFlight` is a ref, not state, so a second click
 * in the same tick is refused before React re-renders the disabled
 * button; the audit additionally has the backend's own pending-job guard.
 * A failure stops the chain — `retry(id)` re-runs only that operation,
 * then continues with anything still missing.
 */
export function useResearchRunner(planning: Planning, onUpdated: (p: Planning) => void) {
  const [session, setSession] = useState<ResearchSessionState>(EMPTY_SESSION);
  const [active, setActive] = useState(false);
  const [busyOp, setBusyOp] = useState<ResearchOpId | null>(null);
  const inFlight = useRef(false);
  // Hard stop against loops: within one run (one click of the primary
  // action, or one Retry) each operation is started at most once. If an
  // operation "succeeds" but its result still doesn't show as done, the
  // chain stops rather than calling (possibly paid) services again.
  // The ref is the synchronous guard inside runOp; the state mirrors it
  // for render-time decisions (refs can't be read during render).
  const attempted = useRef<Set<ResearchOpId>>(new Set());
  const [attemptedIds, setAttemptedIds] = useState<ResearchOpId[]>([]);

  const ops = computeResearchOps(planning, session);
  const progress = summariseResearch(ops);

  async function runOp(id: ResearchOpId): Promise<boolean> {
    if (inFlight.current || attempted.current.has(id)) return false;
    inFlight.current = true;
    attempted.current.add(id);
    setAttemptedIds([...attempted.current]);
    setBusyOp(id);
    setSession((s) => ({
      errors: { ...s.errors, [id]: undefined },
      unavailable: { ...s.unavailable, [id]: undefined },
    }));
    try {
      let updated: Planning;
      switch (id) {
        case "audit":
          updated = await api.analysePlanning(planning.id);
          break;
        case "websitePlan":
          updated = await api.generateWebsitePlan(planning.id);
          break;
        case "reviews":
          updated = await api.runReviewInsights(planning.id);
          // The backend records nothing when there's no review data to
          // use at all — mark it unavailable for this session rather
          // than offering the same call again forever.
          if (updated.review_insights_generated_at === null) {
            setSession((s) => ({ ...s, unavailable: { ...s.unavailable, reviews: true } }));
          }
          break;
        case "recommendations":
          updated = await api.generateRecommendations(planning.id);
          break;
        case "details":
          updated = await api.refreshAssetsChecklist(planning.id);
          break;
      }
      onUpdated(updated);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "This step didn't finish.";
      setSession((s) => ({ ...s, errors: { ...s.errors, [id]: message } }));
      setActive(false);
      return false;
    } finally {
      inFlight.current = false;
      setBusyOp(null);
    }
  }

  // The chain is "live" only while the run was requested AND there's
  // still something it can do — derived, never reset from inside the
  // effect. `runToken` re-arms the effect for a fresh start/retry even
  // when `active` was already true from an earlier, finished run.
  const candidate = nextResearchOp(ops);
  const next = candidate !== null && !attemptedIds.includes(candidate) ? candidate : null;
  const chainLive = active && (next !== null || progress.running);
  const [runToken, setRunToken] = useState(0);

  // Whenever `planning` (or this session's state) changes while the chain
  // is live, start the next missing operation. While the audit job runs,
  // it waits — the page's poll brings the update that moves it on.
  useEffect(() => {
    if (!chainLive || inFlight.current || progress.running || next === null) return;
    void runOp(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainLive, next, planning, session, busyOp, runToken]);

  function start() {
    if (inFlight.current || chainLive) return;
    attempted.current = new Set();
    setAttemptedIds([]);
    setActive(true);
    setRunToken((t) => t + 1);
  }

  function retry(id: ResearchOpId) {
    if (inFlight.current) return;
    attempted.current = new Set();
    setAttemptedIds([]);
    void runOp(id).then((ok) => {
      if (ok) {
        setActive(true);
        setRunToken((t) => t + 1);
      }
    });
  }

  return { ops, progress, active: chainLive || busyOp !== null, busyOp, start, retry };
}
