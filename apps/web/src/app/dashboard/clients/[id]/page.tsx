"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  api,
  type ActivityItem,
  type Business,
  type Client,
  type Project,
  type Task,
  type User,
} from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TabBar } from "@/components/ui/Tabs";
import { clientTone, currentProject } from "@/lib/clients";
import { nextOpenTask } from "@/lib/projects";
import { FINISHED_STAGES } from "@/lib/filters";
import { ClientHeader } from "./ClientHeader";
import { CLIENT_TABS, useClientTab, type ClientTabId } from "./useClientTab";
import { OverviewTab } from "./OverviewTab";
import { ProjectsWebsitesTab } from "./ProjectsWebsitesTab";
import { BillingTab } from "./BillingTab";
import { TasksTab } from "./TasksTab";
import { DetailsNotesTab } from "./DetailsNotesTab";

function HeaderSkeleton() {
  return (
    <div className="p-4 sm:p-6">
      <Skeleton className="h-3 w-16" />
      <div className="mt-3 flex items-center gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-6 flex gap-4 border-b border-border pb-2">
        {CLIENT_TABS.map((t) => (
          <Skeleton key={t.id} className="h-4 w-20" />
        ))}
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

function ClientDetailPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const clientId = params.id;

  const [clientsReturnUrl] = useState(
    () => (typeof window !== "undefined" && sessionStorage.getItem("wdos-list-return:clients")) || "/dashboard/clients",
  );
  const { activeTab, setTab } = useClientTab(clientId);

  const [clientRecord, setClientRecord] = useState<Client | null>(null);
  const [workspaceCurrency, setWorkspaceCurrency] = useState("AUD");
  const [business, setBusiness] = useState<Business | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startingIntake, setStartingIntake] = useState(false);

  function load() {
    api
      .getClient(clientId)
      .then((c) => {
        setClientRecord(c);
        return api.getBusiness(c.business_id);
      })
      .then((b) => {
        setError(null);
        setBusiness(b);
      })
      .catch(() => setError("Couldn't load this client."));
    api.getWorkspace().then((w) => setWorkspaceCurrency(w.currency)).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api.listProjects().then(setProjects).catch(() => {});
    api.listTasks().then(setTasks).catch(() => {});
    api
      .listActivity({ entity_type: "client", entity_id: clientId })
      .then(setActivity)
      .catch(() => {});
  }

  useEffect(load, [clientId]);

  async function saveClient(data: Parameters<typeof api.updateClient>[1]) {
    const updated = await api.updateClient(clientId, data);
    setClientRecord(updated);
  }

  async function saveBusiness(data: Parameters<typeof api.updateBusiness>[1]) {
    if (!business) return;
    const updated = await api.updateBusiness(business.id, data);
    setBusiness(updated);
  }

  // Pre-fills the intake with whatever the CRM already knows about this
  // business — never fabricated, just copied from the existing record —
  // so the operator isn't re-typing what's already on file. Without
  // forceNew the API reuses this client's unfinished project rather than
  // creating a duplicate, so a double-click is harmless.
  async function handleStartIntake(forceNew = false) {
    if (!business) return;
    setStartingIntake(true);
    setError(null);
    try {
      const location = [business.suburb, business.state].filter(Boolean).join(", ");
      const brief = await api.startIntake(clientId, {
        business_name: business.name,
        industry: business.industry || undefined,
        location: location || undefined,
        contact_email: business.email || undefined,
        contact_phone: business.phone || undefined,
        existing_website_url: business.website_url || undefined,
        existing_social_profiles: business.social_links || undefined,
        force_new: forceNew || undefined,
      });
      router.push(`/dashboard/projects/${brief.project_id}`);
    } catch {
      setError("Couldn't start intake — try again.");
      setStartingIntake(false);
    }
  }

  async function handleStartAnotherProject(activeProject: Project) {
    const ok = await confirm({
      title: "Start an additional project?",
      description: `${activeProject.name} is still in progress. This starts a separate, additional project for this client.`,
      confirmLabel: "Start project",
    });
    if (ok) handleStartIntake(true);
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!clientRecord || !business) return <HeaderSkeleton />;

  const clientProjects = projects.filter((p) => p.client_id === clientId);
  const activeProject = clientProjects.find((p) => !FINISHED_STAGES.includes(p.stage));
  const tone = clientTone(clientProjects);
  const overviewProject = currentProject(clientProjects);
  const nextTask = overviewProject ? nextOpenTask(tasks, overviewProject.id) : null;

  function onOpenTab(tab: ClientTabId) {
    setTab(tab);
  }

  return (
    <div>
      <ClientHeader
        business={business}
        clientRecord={clientRecord}
        clientProjects={clientProjects}
        tone={tone}
        clientsReturnUrl={clientsReturnUrl}
        startingIntake={startingIntake}
        onStartIntake={() => handleStartIntake()}
        onEditClick={() => setTab("details")}
      />

      <div className="p-4 sm:p-6">
        <TabBar tabs={CLIENT_TABS} active={activeTab} onChange={(id) => setTab(id as ClientTabId)} />

        <div key={activeTab} className="animate-fade-in mt-6">
          {activeTab === "overview" && (
            <OverviewTab
              clientId={clientId}
              business={business}
              clientProjects={clientProjects}
              nextTask={nextTask}
              activity={activity ?? []}
              workspaceCurrency={workspaceCurrency}
              onOpenTab={onOpenTab}
            />
          )}
          {activeTab === "projects" && (
            <ProjectsWebsitesTab
              clientProjects={clientProjects}
              currency={workspaceCurrency}
              hasActiveProject={!!activeProject}
              startingIntake={startingIntake}
              onStartAnotherProject={() => activeProject && handleStartAnotherProject(activeProject)}
            />
          )}
          {activeTab === "billing" && <BillingTab clientId={clientId} currency={workspaceCurrency} />}
          {activeTab === "tasks" && <TasksTab clientId={clientId} />}
          {activeTab === "details" && (
            <DetailsNotesTab
              clientRecord={clientRecord}
              business={business}
              users={users}
              saveClient={saveClient}
              saveBusiness={saveBusiness}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function ClientDetailPage() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6" />}>
      <ClientDetailPageInner />
    </Suspense>
  );
}
