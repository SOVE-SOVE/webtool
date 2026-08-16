"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  type ActivityItem,
  type Business,
  type Lead,
  type LeadPriority,
  type LeadStatus,
  type LeadScore,
  type User,
  type WebsiteAudit,
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

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const leadId = params.id;

  const [lead, setLead] = useState<Lead | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [audits, setAudits] = useState<WebsiteAudit[] | null>(null);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [scores, setScores] = useState<LeadScore[] | null>(null);
  const [scoreRunning, setScoreRunning] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .getLead(leadId)
      .then((l) => {
        setLead(l);
        return api.getBusiness(l.business_id);
      })
      .then(setBusiness)
      .catch(() => setError("Couldn't load this lead."));
    api.listUsers().then(setUsers).catch(() => {});
    api
      .listActivity({ entity_type: "lead", entity_id: leadId })
      .then(setActivity)
      .catch(() => {});
    api.listWebsiteAudits(leadId).then(setAudits).catch(() => {});
    api.listLeadScores(leadId).then(setScores).catch(() => {});
  }

  useEffect(load, [leadId]);

  async function saveLead(data: Parameters<typeof api.updateLead>[1]) {
    const updated = await api.updateLead(leadId, data);
    setLead(updated);
    api.listActivity({ entity_type: "lead", entity_id: leadId }).then(setActivity).catch(() => {});
  }

  async function saveBusiness(data: Parameters<typeof api.updateBusiness>[1]) {
    if (!business) return;
    const updated = await api.updateBusiness(business.id, data);
    setBusiness(updated);
  }

  async function handleArchiveToggle() {
    if (!lead) return;
    const updated = lead.archived_at ? await api.unarchiveLead(lead.id) : await api.archiveLead(lead.id);
    setLead(updated);
    api.listActivity({ entity_type: "lead", entity_id: leadId }).then(setActivity).catch(() => {});
  }

  async function handleRunAudit() {
    setAuditRunning(true);
    setAuditError(null);
    try {
      const audit = await api.triggerWebsiteAudit(leadId);
      setAudits((prev) => [audit, ...(prev ?? [])]);
      api.listActivity({ entity_type: "lead", entity_id: leadId }).then(setActivity).catch(() => {});
    } catch {
      setAuditError("Couldn't run the audit — the site may be unreachable.");
    } finally {
      setAuditRunning(false);
    }
  }

  async function handleRunScore() {
    setScoreRunning(true);
    setScoreError(null);
    try {
      const score = await api.triggerLeadScore(leadId);
      setScores((prev) => [score, ...(prev ?? [])]);
      const updated = await api.getLead(leadId);
      setLead(updated);
      api.listActivity({ entity_type: "lead", entity_id: leadId }).then(setActivity).catch(() => {});
    } catch {
      setScoreError("Couldn't score this lead.");
    } finally {
      setScoreRunning(false);
    }
  }

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!lead || !business) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  const latestAudit = audits?.[0] ?? null;
  const latestScore = scores?.[0] ?? null;
  const confidenceClass: Record<string, string> = {
    high: "bg-green-100 text-green-800",
    medium: "bg-amber-100 text-amber-800",
    low: "bg-red-100 text-red-800",
  };

  return (
    <div className="p-6">
      <Link href="/dashboard/leads" className="text-sm text-neutral-500 hover:underline">
        ← All leads
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">{business.name}</h1>
        <button
          onClick={handleArchiveToggle}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          {lead.archived_at ? "Unarchive lead" : "Archive lead"}
        </button>
      </div>
      {lead.archived_at && (
        <p className="mt-1 text-sm text-amber-600">
          Archived on {new Date(lead.archived_at).toLocaleDateString()}
        </p>
      )}

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
            {field(
              "Social links",
              <textarea
                defaultValue={business.social_links ?? ""}
                onBlur={(e) => saveBusiness({ social_links: e.target.value })}
                placeholder="One URL per line"
                rows={2}
                className={inputClass}
              />,
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
          <h2 className="text-sm font-semibold text-neutral-900">Lead</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            {field(
              "Status",
              <select
                value={lead.status}
                onChange={(e) => saveLead({ status: e.target.value as LeadStatus })}
                className={inputClass}
              >
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Priority",
              <select
                value={lead.priority}
                onChange={(e) => saveLead({ priority: e.target.value as LeadPriority })}
                className={inputClass}
              >
                {LEAD_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Score",
              <input
                type="number"
                defaultValue={lead.score ?? ""}
                onBlur={(e) => {
                  const parsed = e.target.value === "" ? undefined : Number(e.target.value);
                  if (parsed === undefined || !Number.isNaN(parsed)) saveLead({ score: parsed });
                }}
                className={inputClass}
              />,
            )}
            {field(
              "Assigned to",
              <select
                value={lead.assigned_user_id ?? ""}
                onChange={(e) => saveLead({ assigned_user_id: e.target.value || null })}
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
            {field("Source", <span className="text-sm text-neutral-700">{lead.source ?? "—"}</span>)}
            {field(
              "Created",
              <span className="text-sm text-neutral-700">
                {new Date(lead.created_at).toLocaleDateString()}
              </span>,
            )}
            <div className="col-span-2">
              {field(
                "Lead notes",
                <textarea
                  defaultValue={lead.notes ?? ""}
                  onBlur={(e) => saveLead({ notes: e.target.value })}
                  rows={3}
                  className={inputClass}
                />,
              )}
            </div>
          </div>
        </section>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Website audit</h2>
          <button
            onClick={handleRunAudit}
            disabled={auditRunning || !business.website_url}
            title={business.website_url ? undefined : "Set a website URL on this business first"}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {auditRunning ? "Running…" : "Run audit"}
          </button>
        </div>
        {auditError && <p className="mt-2 text-sm text-red-600">{auditError}</p>}
        {!latestAudit && !auditError && (
          <p className="mt-3 text-sm text-neutral-500">No audits run yet.</p>
        )}
        {latestAudit && (
          <div className="mt-3 border border-neutral-200 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  latestAudit.status === "success"
                    ? "bg-green-100 text-green-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {latestAudit.status}
              </span>
              {latestAudit.https !== null && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                  HTTPS: {latestAudit.https ? "yes" : "no"}
                </span>
              )}
              {latestAudit.mobile_friendly !== null && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                  Viewport configured: {latestAudit.mobile_friendly ? "yes" : "no"}
                </span>
              )}
              {latestAudit.page_speed_score !== null && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                  Heuristic speed score: {latestAudit.page_speed_score}/100
                </span>
              )}
              {latestAudit.flagged_for_review && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">Flagged for review</span>
              )}
              <span className="text-neutral-500">{new Date(latestAudit.audited_at).toLocaleString()}</span>
            </div>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-sans text-sm text-neutral-800">
              {latestAudit.report_markdown}
            </pre>
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Lead score</h2>
          <button
            onClick={handleRunScore}
            disabled={scoreRunning}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scoreRunning ? "Scoring…" : "Run score"}
          </button>
        </div>
        {scoreError && <p className="mt-2 text-sm text-red-600">{scoreError}</p>}
        {!latestScore && !scoreError && <p className="mt-3 text-sm text-neutral-500">Not scored yet.</p>}
        {latestScore && (
          <div className="mt-3 border border-neutral-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-semibold text-neutral-900">
                {latestScore.overall_score}
                <span className="text-sm font-normal text-neutral-500">/100</span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceClass[latestScore.confidence]}`}
              >
                {latestScore.confidence} confidence
              </span>
              {latestScore.flagged_for_review && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                  Flagged for review
                </span>
              )}
              <span className="text-xs text-neutral-500">
                {new Date(latestScore.scored_at).toLocaleString()}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {latestScore.results.categories.map((cat) => (
                <div key={cat.key} className="border border-neutral-100 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-900">{cat.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${confidenceClass[cat.confidence]}`}
                    >
                      {cat.confidence}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {cat.score}/100 · weight {cat.weight}%
                  </div>
                  {cat.reasons.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-neutral-700">
                      {cat.reasons.map((r) => (
                        <li key={r.rule_id}>
                          {r.description} ({r.points >= 0 ? "+" : ""}
                          {r.points})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            {latestScore.results.warnings.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Warnings</div>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-neutral-600">
                  {latestScore.results.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
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
