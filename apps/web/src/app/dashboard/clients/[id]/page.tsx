"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  PROJECT_STAGE_LABELS,
  type ActivityItem,
  type Business,
  type Client,
  type Project,
  type User,
} from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { ErrorState } from "@/components/ui/ErrorState";

function field(label: string, value: React.ReactNode) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

const inputClass = "w-full rounded-md border border-border-strong px-3 py-1.5 text-sm";

// Client.contract_signed_at is a full timestamp; <input type="date"> needs
// just the date portion, and round-trips back out as UTC midnight.
function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const clientId = params.id;

  const [clientRecord, setClientRecord] = useState<Client | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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
    api.listUsers().then(setUsers).catch(() => {});
    api.listProjects().then(setProjects).catch(() => {});
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

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!clientRecord || !business) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;

  const clientProjects = projects.filter((p) => p.client_id === clientId);
  const activeProject = clientProjects.find(
    (p) => p.stage !== "maintenance" && p.stage !== "complete",
  );

  return (
    <div className="p-6">
      <Link href="/dashboard/leads?tab=won" className="text-sm text-fg-muted hover:underline">
        ← All clients
      </Link>

      <h1 className="mt-2 text-lg font-semibold text-fg">{business.name}</h1>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-8">
        <section>
          <h2 className="text-sm font-semibold text-fg">Business</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field(
              "Name",
              <input
                defaultValue={business.name}
                onBlur={(e) => e.target.value !== business.name && saveBusiness({ name: e.target.value })}
                className={inputClass}
              />,
            )}
            {field(
              "Industry",
              <input
                defaultValue={business.industry ?? ""}
                onBlur={(e) => saveBusiness({ industry: e.target.value })}
                className={inputClass}
              />,
            )}
            {field(
              "Website",
              <input
                defaultValue={business.website_url ?? ""}
                onBlur={(e) => saveBusiness({ website_url: e.target.value })}
                className={inputClass}
              />,
            )}
            {field(
              "Phone",
              <input
                defaultValue={business.phone ?? ""}
                onBlur={(e) => saveBusiness({ phone: e.target.value })}
                className={inputClass}
              />,
            )}
            {field(
              "Email",
              <input
                defaultValue={business.email ?? ""}
                onBlur={(e) => saveBusiness({ email: e.target.value })}
                className={inputClass}
              />,
            )}
            {field(
              "Location",
              <div className="flex gap-2">
                <input
                  placeholder="Suburb"
                  defaultValue={business.suburb ?? ""}
                  onBlur={(e) => saveBusiness({ suburb: e.target.value })}
                  className={inputClass}
                />
                <input
                  placeholder="State"
                  defaultValue={business.state ?? ""}
                  onBlur={(e) => saveBusiness({ state: e.target.value })}
                  className={inputClass}
                />
              </div>,
            )}
            <div className="col-span-2">
              {field(
                "Business notes",
                <textarea
                  defaultValue={business.notes ?? ""}
                  onBlur={(e) => saveBusiness({ notes: e.target.value })}
                  rows={3}
                  className={inputClass}
                />,
              )}
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-fg">Client</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field(
              "Billing email",
              <input
                defaultValue={clientRecord.billing_email ?? ""}
                onBlur={(e) => saveClient({ billing_email: e.target.value || null })}
                className={inputClass}
              />,
            )}
            {field(
              "Contract signed",
              <input
                type="date"
                defaultValue={toDateInputValue(clientRecord.contract_signed_at)}
                onBlur={(e) =>
                  saveClient({
                    contract_signed_at: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
                className={inputClass}
              />,
            )}
            {field(
              "Assigned to",
              <select
                value={clientRecord.assigned_user_id ?? ""}
                onChange={(e) => saveClient({ assigned_user_id: e.target.value || null })}
                className={inputClass}
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Client since",
              <span className="text-sm text-fg-muted">
                {new Date(clientRecord.created_at).toLocaleDateString()}
              </span>,
            )}
          </div>
        </section>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Projects</h2>
          <div className="flex items-center gap-3">
            {activeProject && (
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: "Start an additional project?",
                    description: `${activeProject.name} is still in progress. This starts a separate, additional project for this client.`,
                    confirmLabel: "Start project",
                  });
                  if (ok) handleStartIntake(true);
                }}
                disabled={startingIntake}
                className="text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
              >
                Start another project
              </button>
            )}
            <button
              onClick={() => handleStartIntake()}
              disabled={startingIntake}
              className="btn btn-primary"
            >
              {startingIntake ? "Starting…" : activeProject ? "Open intake" : "Start intake"}
            </button>
          </div>
        </div>
        <ul className="mt-3 divide-y divide-border border border-border">
          {clientProjects.length === 0 && (
            <li className="px-3 py-3 text-sm text-fg-muted">
              No projects yet. Start intake creates one and opens its client intake form.
            </li>
          )}
          {clientProjects.map((project) => (
            <li key={project.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <Link href={`/dashboard/projects/${project.id}`} className="text-fg hover:underline">
                  {project.name}
                </Link>
                {project.source_lead_id && (
                  <Link
                    href={`/dashboard/leads/${project.source_lead_id}`}
                    className="ml-2 text-xs text-fg-muted hover:underline"
                  >
                    from lead
                  </Link>
                )}
              </div>
              <span className="flex items-center gap-3 text-xs text-fg-muted">
                <span className="rounded bg-surface-subtle px-2 py-0.5 font-medium text-fg-muted">
                  {PROJECT_STAGE_LABELS[project.stage]}
                </span>
                {project.assigned_user_name && <span>· {project.assigned_user_name}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fg">Activity history</h2>
        <ul className="mt-3 divide-y divide-border border border-border">
          {activity && activity.length === 0 && (
            <li className="px-3 py-3 text-sm text-fg-muted">No activity yet.</li>
          )}
          {activity?.map((item) => (
            <li key={item.id} className="px-3 py-2 text-sm">
              <span className="text-fg">{item.summary ?? item.action}</span>
              <span className="ml-2 text-xs text-fg-muted">
                {item.user_name ?? "System"} · {new Date(item.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
