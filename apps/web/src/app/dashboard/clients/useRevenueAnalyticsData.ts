"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, type RevenueReport, type Workspace } from "@/lib/api";
import { withParam } from "@/lib/url";
import {
  parseRangePreset,
  previousPeriod,
  resolveRange,
  todayInTimeZone,
  type DateRange,
  type RangePreset,
} from "./revenueAnalytics";

/**
 * Data for the Revenue analytics dashboard. The selected range lives in the
 * URL (`?range=`, default this month) and drives only the period-based
 * figures (receipts, donut, weekly flow, trend). Current-balance figures —
 * Overdue, Expected hosting, active hosting clients — are "as of today" and
 * read from the same report but never depend on the range (the server
 * computes them against today regardless of start/end).
 *
 * The range report is the full, unpaginated set for the period (the same
 * endpoint the calendar uses). The previous-period report is fetched only
 * when a like-for-like comparison is possible (see `previousPeriod`).
 */
export function useRevenueAnalyticsData(workspace: Workspace | null, dataVersion: number) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const preset = parseRangePreset(searchParams.get("range"));
  const today = useMemo(() => todayInTimeZone(workspace?.timezone), [workspace?.timezone]);
  const range: DateRange = useMemo(() => resolveRange(preset, today), [preset, today]);
  const historyStart = workspace?.created_at ? todayInTimeZone(workspace.timezone, new Date(workspace.created_at)) : null;
  const prev = useMemo(() => previousPeriod(range, today, historyStart), [range, today, historyStart]);

  const [report, setReport] = useState<RevenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prevReport, setPrevReport] = useState<RevenueReport | null>(null);

  // Clear stale figures the moment the range changes (render-time reset,
  // same pattern ClientsRevenueTab uses for its calendar report).
  const rangeKey = `${range.start}:${range.end}`;
  const [prevRangeKey, setPrevRangeKey] = useState(rangeKey);
  if (prevRangeKey !== rangeKey) {
    setPrevRangeKey(rangeKey);
    setReport(null);
    setPrevReport(null);
  }

  function load() {
    api
      .getRevenueReport(range.start, range.end)
      .then((r) => {
        setError(null);
        setReport(r);
      })
      .catch(() => setError("Couldn't load revenue for this period."));
  }

  useEffect(load, [range.start, range.end, dataVersion]);

  useEffect(() => {
    if (!prev.comparable) return;
    let cancelled = false;
    api
      .getRevenueReport(prev.start, prev.end)
      .then((r) => {
        if (!cancelled) setPrevReport(r);
      })
      .catch(() => {
        if (!cancelled) setPrevReport(null); // comparison simply not shown
      });
    return () => {
      cancelled = true;
    };
  }, [prev.start, prev.end, prev.comparable, dataVersion]);

  function setPreset(next: RangePreset) {
    router.replace(`${pathname}?${withParam(searchParams, "range", next === "this_month" ? null : next)}`, { scroll: false });
  }

  return {
    preset,
    setPreset,
    range,
    today,
    historyStart,
    report,
    error,
    reload: load,
    previous: prev.comparable ? { ...prev, report: prevReport } : null,
  };
}
