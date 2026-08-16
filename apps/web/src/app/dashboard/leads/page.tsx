"use client";

import { useEffect, useState } from "react";
import { api, LEAD_STAGES, type Lead, type LeadStage } from "@/lib/api";

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [suburb, setSuburb] = useState("");
  const [state, setState] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .listLeads()
      .then(setLeads)
      .catch(() => setError("Couldn't load leads."));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createLead({
        business_name: businessName,
        industry: industry || undefined,
        suburb: suburb || undefined,
        state: state || undefined,
        source: source || undefined,
      });
      setBusinessName("");
      setIndustry("");
      setSuburb("");
      setState("");
      setSource("");
      setShowForm(false);
      load();
    } catch {
      setError("Couldn't create lead.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStageChange(id: string, stage: LeadStage) {
    await api.updateLead(id, { stage });
    load();
  }

  async function handleScoreChange(id: string, score: string) {
    const parsed = score === "" ? undefined : Number(score);
    if (parsed !== undefined && Number.isNaN(parsed)) return;
    await api.updateLead(id, { score: parsed });
    load();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Leads</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          {showForm ? "Cancel" : "Add lead"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 grid max-w-2xl grid-cols-2 gap-3 border border-neutral-200 p-4">
          <input
            required
            placeholder="Business name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="col-span-2 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <input
            placeholder="Suburb"
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <input
            placeholder="State"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={saving}
            className="col-span-2 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save lead"}
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {leads && (
        <table className="mt-6 w-full border border-neutral-200 text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {leads.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                  No leads yet.
                </td>
              </tr>
            )}
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td className="px-3 py-2">
                  <div className="font-medium text-neutral-900">{lead.business_name}</div>
                  {lead.industry && <div className="text-xs text-neutral-500">{lead.industry}</div>}
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  {[lead.suburb, lead.state].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={lead.stage}
                    onChange={(e) => handleStageChange(lead.id, e.target.value as LeadStage)}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  >
                    {LEAD_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    defaultValue={lead.score ?? ""}
                    onBlur={(e) => handleScoreChange(lead.id, e.target.value)}
                    className="w-16 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-3 py-2 text-neutral-600">{lead.source ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
