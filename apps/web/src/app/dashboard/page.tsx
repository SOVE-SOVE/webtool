"use client";

import { Suspense, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { DelayedSectionLoading } from "@/components/ui/SectionLoadingIndicator";
import { TabBar, type TabItem } from "@/components/ui/Tabs";
import { useTodayTab, type TodayTabId } from "./useTodayTab";
import { TodayOverviewTab } from "./TodayOverviewTab";
import { TasksView } from "./tasks/TasksView";
import { CalendarView } from "./calendar/CalendarView";

const TODAY_TABS: TabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
  { id: "calendar", label: "Calendar" },
];

/**
 * The Today workspace — Overview (the original Today dashboard),
 * Tasks, and Calendar merged into one destination behind a single
 * `PageHeader` + `TabBar`, the same shell shape as the Clients
 * workspace (`dashboard/clients/page.tsx`): one title-only header, the
 * tab strip as its own row below it, each tab a separate component
 * that owns its own data fetch and primary action rather than this
 * shell hoisting a one-size-fits-all action bar.
 *
 * Tabs stay mounted once opened (state survives switching), and keep
 * each other current through `lib/todaySync.ts`. The old `/dashboard/tasks` and `/dashboard/calendar` routes redirect
 * here (`?tab=tasks` / `?tab=calendar`) and are no longer in the
 * sidebar; see docs/07_SESSION_LOG.md.
 */
function TodayPageInner() {
  const { activeTab, setTab } = useTodayTab();
  // Tabs mount the first time they're opened and then stay mounted
  // (hidden), so switching away and back keeps each tab's own filters,
  // search, calendar month, open forms and scroll — remounting on every
  // switch used to throw all of that away. Set during render (React's
  // "adjust state on prop change" pattern), so there's no flash frame.
  const [visited, setVisited] = useState<ReadonlySet<TodayTabId>>(() => new Set([activeTab]));
  if (!visited.has(activeTab)) setVisited(new Set([...visited, activeTab]));

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Today" />

      <TabBar tabs={TODAY_TABS} active={activeTab} onChange={(id) => setTab(id as TodayTabId)} variant="workspace" className="mt-4" />

      {TODAY_TABS.map(({ id }) =>
        visited.has(id as TodayTabId) ? (
          <div key={id} hidden={id !== activeTab} className={id === activeTab ? "animate-fade-in mt-6" : undefined}>
            {id === "overview" && <TodayOverviewTab />}
            {id === "tasks" && <TasksView />}
            {id === "calendar" && <CalendarView />}
          </div>
        ) : null,
      )}
    </div>
  );
}

export default function TodayPage() {
  return (
    <Suspense fallback={<DelayedSectionLoading icon="home" label="Loading Today…" />}>
      <TodayPageInner />
    </Suspense>
  );
}
