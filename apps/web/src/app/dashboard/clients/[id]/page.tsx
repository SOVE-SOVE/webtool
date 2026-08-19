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

function field(label: string, value: React.ReactNode) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

const inputClass = "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm";

// Client.contract_signed_at is a full timestamp; <input type="date"> needs
// just the date portion, and round-trips back out as UTC midnight.
function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
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
      .then(setBusiness)
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
  // so the operator isn't re-typing what's already on file.
  async function handleStartIntake() {
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
      });
      router.push(`/dashboard/projects/${brief.project_id}`);
    } catch {
      setError("Couldn't start intake — try again.");
      setStartingIntake(false);
    }
  }

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!clientRecord || !business) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  const clientProjects = projects.filter((p) => p.client_id === clientId);

  return (
    <div className="p-6">
      <Link href="/dashboard/clients" className="text-sm text-neutral-500 hover:underline">
        ← All clients
      </Link>

      <h1 className="mt-2 text-lg font-semibold text-neutral-900">{business.name}</h1>

      <div className="mt-6 grid grid-cols-2 gap-8">
        <section>
          <h2 className="text-sm font-semibold text-neutral-900">Business</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
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
          <h2 className="text-sm font-semibold text-neutral-900">Client</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
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
              <span className="text-sm text-neutral-700">
                {new Date(clientRecord.created_at).toLocaleDateString()}
              </span>,
            )}
          </div>
        </section>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Projects</h2>
          <button
            onClick={handleStartIntake}
            disabled={startingIntake}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {startingIntake ? "Starting…" : "Start intake"}
          </button>
        </div>
        <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
          {clientProjects.length === 0 && (
            <li className="px-3 py-3 text-sm text-neutral-500">
              No projects yet. Start intake creates one and opens its client intake form.
            </li>
          )}
          {clientProjects.map((project) => (
            <li key={project.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <Link href={`/dashboard/projects/${project.id}`} className="text-neutral-900 hover:underline">
                  {project.name}
                </Link>
                {project.source_lead_id && (
                  <Link
                    href={`/dashboard/leads/${project.source_lead_id}`}
                    className="ml-2 text-xs text-neutral-500 hover:underline"
                  >
                    from lead
                  </Link>
                )}
              </div>
              <span className="flex items-center gap-3 text-xs text-neutral-500">
                <span className="rounded bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700">
                  {PROJECT_STAGE_LABELS[project.stage]}
                </span>
                {project.assigned_user_name && <span>· {project.assigned_user_name}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Activity history</h2>
        <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
          {activity && activity.length === 0 && (
            <li className="px-3 py-3 text-sm text-neutral-500">No activity yet.</li>
          )}
          {activity?.map((item) => (
            <li key={item.id} className="px-3 py-2 text-sm">
              <span className="text-neutral-900">{item.summary ?? item.action}</span>
              <span className="ml-2 text-xs text-neutral-500">
                {item.user_name ?? "System"} · {new Date(item.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
