"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type Client, type Lead, type User } from "@/lib/api";
import { filterClients, UNASSIGNED } from "@/lib/filters";

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<"direct" | "convert">("direct");
  const [businessName, setBusinessName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [leadId, setLeadId] = useState("");
  const [wonPrice, setWonPrice] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  function load() {
    api
      .listClients()
      .then(setClients)
      .catch(() => setError("Couldn't load clients."));
    api.listLeads().then(setLeads).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
  }

  useEffect(load, []);

  const openLeads = leads.filter((l) => l.status !== "won" && l.status !== "lost");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (mode === "convert") {
        if (!leadId) return;
        const price = wonPrice === "" ? undefined : Math.round(Number(wonPrice) * 100);
        await api.createClient({
          from_lead_id: leadId,
          billing_email: billingEmail || undefined,
          won_price_cents: price,
          assigned_user_id: assignedUserId || undefined,
        });
      } else {
        await api.createClient({
          business_name: businessName,
          billing_email: billingEmail || undefined,
          assigned_user_id: assignedUserId || undefined,
        });
      }
      setBusinessName("");
      setBillingEmail("");
      setLeadId("");
      setWonPrice("");
      setAssignedUserId("");
      setShowForm(false);
      load();
    } catch {
      setError("Couldn't create client.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssigneeChange(id: string, assigneeId: string) {
    await api.updateClient(id, { assigned_user_id: assigneeId || null });
    load();
  }

  const visibleClients = useMemo(
    () => (clients === null ? null : filterClients(clients, { search, assignee: assigneeFilter })),
    [clients, search, assigneeFilter],
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Clients</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          {showForm ? "Cancel" : "Add client"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 max-w-2xl space-y-3 border border-neutral-200 p-4">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "direct"} onChange={() => setMode("direct")} />
              New client
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "convert"} onChange={() => setMode("convert")} />
              Convert a won/open lead
            </label>
          </div>

          {mode === "direct" ? (
            <input
              required
              placeholder="Business name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
          ) : (
            <>
              <select
                required
                value={leadId}
                onChange={(e) => setLeadId(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
              >
                <option value="">Select a lead…</option>
                {openLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.business_name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Won price, AUD (optional — counts toward revenue)"
                value={wonPrice}
                onChange={(e) => setWonPrice(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
              />
            </>
          )}

          <input
            placeholder="Billing email (optional)"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />

          <select
            value={assignedUserId}
            onChange={(e) => setAssignedUserId(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save client"}
          </button>
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search business or billing email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">Anyone assigned</option>
          <option value={UNASSIGNED}>Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {visibleClients && (
        <table className="mt-4 w-full border border-neutral-200 text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Billing email</th>
              <th className="px-3 py-2">Projects</th>
              <th className="px-3 py-2">Client since</th>
              <th className="px-3 py-2">Assigned to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {visibleClients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                  {clients && clients.length === 0 ? "No clients yet." : "No clients match."}
                </td>
              </tr>
            )}
            {visibleClients.map((client) => (
              <tr key={client.id}>
                <td className="px-3 py-2 font-medium text-neutral-900">
                  <Link href={`/dashboard/clients/${client.id}`} className="hover:underline">
                    {client.business_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-neutral-600">{client.billing_email ?? "—"}</td>
                <td className="px-3 py-2 text-neutral-600">{client.project_count}</td>
                <td className="px-3 py-2 text-neutral-600">
                  {new Date(client.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={client.assigned_user_id ?? ""}
                    onChange={(e) => handleAssigneeChange(client.id, e.target.value)}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
