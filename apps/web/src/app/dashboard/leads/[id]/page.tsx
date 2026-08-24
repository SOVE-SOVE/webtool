"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  OUTREACH_CHANNELS,
  type ActivityItem,
  type Business,
  type Client,
  type FollowUp,
  type Lead,
  type LeadPriority,
  type LeadStatus,
  type OutreachChannel,
  type OutreachMessage,
  type PipelineEvent,
  type SalesAuditReport,
  type User,
} from "@/lib/api";
import { SalesAuditReportView } from "@/components/SalesAuditReportView";
import { OutreachMessageView } from "@/components/OutreachMessageView";

// Sales Audit / Outreach generation reads or references live evidence, so
// it's only meaningful once a lead has cleared initial qualification —
// matches "for qualified leads" from the request.
const SALES_AUDIT_ELIGIBLE_STATUSES: LeadStatus[] = [
  "qualified",
  "contacted",
  "replied",
  "meeting",
  "proposal",
  "won",
  "nurture",
];

const OUTREACH_CHANNEL_LABELS: Record<OutreachChannel, string> = {
  email: "Draft email",
  phone: "Draft phone talking points",
  in_person: "Draft in-person talking points",
};

const OUTREACH_STATUS_LABELS: Record<OutreachMessage["status"], string> = {
  drafted: "Drafted",
  approved: "Approved",
  sent: "Sent",
  replied: "Replied",
  follow_up_due: "Follow-up due",
  closed: "Closed",
};

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
  const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [salesAudits, setSalesAudits] = useState<SalesAuditReport[] | null>(null);
  const [generatingAudit, setGeneratingAudit] = useState(false);
  const [generateAuditError, setGenerateAuditError] = useState<string | null>(null);
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);

  const [outreachMessages, setOutreachMessages] = useState<OutreachMessage[] | null>(null);
  const [generatingChannel, setGeneratingChannel] = useState<OutreachChannel | null>(null);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [expandedOutreachId, setExpandedOutreachId] = useState<string | null>(null);
  const [outreachActionId, setOutreachActionId] = useState<string | null>(null);

  const [generatingFollowUp, setGeneratingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [latestFollowUp, setLatestFollowUp] = useState<FollowUp | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [convertBillingEmail, setConvertBillingEmail] = useState("");
  const [convertPackage, setConvertPackage] = useState("");
  const [convertPrice, setConvertPrice] = useState("");
  const [convertDeadline, setConvertDeadline] = useState("");
  const [convertProjectName, setConvertProjectName] = useState("");
  const [convertAssignedUserId, setConvertAssignedUserId] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertedClient, setConvertedClient] = useState<Client | null>(null);

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
    api.listLeadPipelineEvents(leadId).then(setPipelineEvents).catch(() => {});
    api.listSalesAudits(leadId).then(setSalesAudits).catch(() => {});
    api.listOutreach(leadId).then(setOutreachMessages).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
  }

  function refreshActivity() {
    api.listActivity({ entity_type: "lead", entity_id: leadId }).then(setActivity).catch(() => {});
    api.listLeadPipelineEvents(leadId).then(setPipelineEvents).catch(() => {});
  }

  useEffect(load, [leadId]);

  async function saveLead(data: Parameters<typeof api.updateLead>[1]) {
    const updated = await api.updateLead(leadId, data);
    setLead(updated);
    refreshActivity();
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
    refreshActivity();
  }

  async function handleGenerateSalesAudit() {
    setGeneratingAudit(true);
    setGenerateAuditError(null);
    try {
      const report = await api.generateSalesAudit(leadId);
      setSalesAudits((prev) => [report, ...(prev ?? [])]);
      setExpandedAuditId(report.id);
      refreshActivity();
    } catch (err) {
      setGenerateAuditError(err instanceof ApiError ? err.message : "Couldn't generate the sales audit.");
    } finally {
      setGeneratingAudit(false);
    }
  }

  async function handleGenerateOutreach(channel: OutreachChannel) {
    setGeneratingChannel(channel);
    setOutreachError(null);
    try {
      const message = await api.generateOutreach(leadId, channel);
      setOutreachMessages((prev) => [message, ...(prev ?? [])]);
      setExpandedOutreachId(message.id);
      refreshActivity();
    } catch (err) {
      setOutreachError(err instanceof ApiError ? err.message : "Couldn't generate the outreach draft.");
    } finally {
      setGeneratingChannel(null);
    }
  }

  async function handleOutreachAction(id: string, action: "approve" | "mark-sent" | "mark-replied" | "close") {
    setOutreachActionId(id);
    setOutreachError(null);
    try {
      const fn =
        action === "approve"
          ? api.approveOutreach
          : action === "mark-sent"
            ? api.markOutreachSent
            : action === "mark-replied"
              ? api.markOutreachReplied
              : api.closeOutreach;
      const updated = await fn(id);
      setOutreachMessages((prev) => (prev ?? []).map((m) => (m.id === id ? updated : m)));
      refreshActivity();
    } catch (err) {
      setOutreachError(err instanceof ApiError ? err.message : "That action didn't go through.");
    } finally {
      setOutreachActionId(null);
    }
  }

  async function handleGenerateFollowUp() {
    setGeneratingFollowUp(true);
    setFollowUpError(null);
    try {
      const followUp = await api.generateFollowUp(leadId);
      setLatestFollowUp(followUp);
      refreshActivity();
      api.listOutreach(leadId).then(setOutreachMessages).catch(() => {});
    } catch (err) {
      setFollowUpError(err instanceof ApiError ? err.message : "Couldn't generate a follow-up.");
    } finally {
      setGeneratingFollowUp(false);
    }
  }

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault();
    setConverting(true);
    setConvertError(null);
    try {
      const price = convertPrice === "" ? undefined : Math.round(Number(convertPrice) * 100);
      const newClient = await api.createClient({
        from_lead_id: leadId,
        billing_email: convertBillingEmail || undefined,
        won_price_cents: price,
        package: convertPackage || undefined,
        deadline: convertDeadline || undefined,
        project_name: convertProjectName || undefined,
        assigned_user_id: convertAssignedUserId || undefined,
      });
      setConvertedClient(newClient);
      setClients((prev) => [newClient, ...prev]);
      setShowConvertForm(false);
      const updatedLead = await api.getLead(leadId);
      setLead(updatedLead);
      refreshActivity();
    } catch (err) {
      setConvertError(err instanceof ApiError ? err.message : "Couldn't convert this lead.");
    } finally {
      setConverting(false);
    }
  }

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!lead || !business) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

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
          <h2 className="text-sm font-semibold text-neutral-900">Pipeline stage history</h2>
          <Link href="/dashboard/pipeline" className="text-xs text-neutral-500 hover:underline">
            View pipeline board →
          </Link>
        </div>
        <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
          {pipelineEvents && pipelineEvents.length === 0 && (
            <li className="px-3 py-3 text-sm text-neutral-500">
              No stage changes yet — this lead has been {lead.status.replace("_", " ")} since it was created.
            </li>
          )}
          {pipelineEvents?.map((event) => (
            <li key={event.id} className="px-3 py-2 text-sm">
              <span className="text-neutral-900">{event.summary ?? event.kind}</span>
              <span className="ml-2 text-xs text-neutral-500">{new Date(event.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>

      {(() => {
        const existingClient = clients.find((c) => c.business_id === business.id) ?? convertedClient;
        if (lead.archived_at) return null;
        return (
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Convert to client</h2>
              {!existingClient && (
                <button
                  onClick={() => setShowConvertForm((v) => !v)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
                >
                  {showConvertForm ? "Cancel" : "Mark WON — convert"}
                </button>
              )}
            </div>

            {existingClient ? (
              <p className="mt-2 text-sm text-neutral-600">
                This lead was won and converted.{" "}
                <Link href={`/dashboard/clients/${existingClient.id}`} className="hover:underline">
                  View client
                </Link>
                .
              </p>
            ) : (
              <p className="mt-1 text-sm text-neutral-500">
                Creates the client record and an INTAKE-stage project (with starter tasks) in one step, and
                preserves this lead&apos;s full history — audits, outreach, and notes stay attached to it.
              </p>
            )}

            {showConvertForm && !existingClient && (
              <form
                onSubmit={handleConvert}
                className="mt-3 max-w-2xl space-y-3 border border-neutral-200 p-4"
              >
                <input
                  placeholder="Project name (defaults to “{business} Website”)"
                  value={convertProjectName}
                  onChange={(e) => setConvertProjectName(e.target.value)}
                  className={inputClass}
                />
                <div className="flex gap-3">
                  <input
                    placeholder="Package (e.g. Core, $899)"
                    value={convertPackage}
                    onChange={(e) => setConvertPackage(e.target.value)}
                    className={inputClass}
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Agreed price, AUD"
                    value={convertPrice}
                    onChange={(e) => setConvertPrice(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs uppercase tracking-wide text-neutral-500">
                      Agreed deadline
                    </label>
                    <input
                      type="date"
                      value={convertDeadline}
                      onChange={(e) => setConvertDeadline(e.target.value)}
                      className={`${inputClass} mt-1`}
                    />
                  </div>
                  <input
                    placeholder="Billing email (optional)"
                    value={convertBillingEmail}
                    onChange={(e) => setConvertBillingEmail(e.target.value)}
                    className={`${inputClass} mt-5`}
                  />
                </div>
                <select
                  value={convertAssignedUserId}
                  onChange={(e) => setConvertAssignedUserId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
                {convertError && <p className="text-sm text-red-600">{convertError}</p>}
                <button
                  type="submit"
                  disabled={converting}
                  className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {converting ? "Converting…" : "Convert to client"}
                </button>
              </form>
            )}
          </section>
        );
      })()}

      {SALES_AUDIT_ELIGIBLE_STATUSES.includes(lead.status) && !lead.archived_at && (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Sales audit</h2>
            <button
              onClick={handleGenerateSalesAudit}
              disabled={generatingAudit}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {generatingAudit ? "Generating…" : "Generate sales audit"}
            </button>
          </div>
          {generatingAudit && (
            <p className="mt-2 text-sm text-neutral-500">
              Auditing the website, checking public info, and writing the report — this can take up to a
              minute.
            </p>
          )}
          {generateAuditError && <p className="mt-2 text-sm text-red-600">{generateAuditError}</p>}

          <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
            {salesAudits && salesAudits.length === 0 && !generatingAudit && (
              <li className="px-3 py-3 text-sm text-neutral-500">No sales audits generated yet.</li>
            )}
            {salesAudits?.map((report) => {
              const expanded = expandedAuditId === report.id;
              return (
                <li key={report.id} className="px-3 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setExpandedAuditId(expanded ? null : report.id)}
                      className="text-left text-neutral-900 hover:underline"
                    >
                      {expanded ? "▾" : "▸"} Sales audit — {new Date(report.generated_at).toLocaleString()}
                    </button>
                    <div className="flex items-center gap-3">
                      {report.flagged_for_review && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                          Flagged for review
                        </span>
                      )}
                      <Link
                        href={`/dashboard/leads/${leadId}/sales-audits/${report.id}`}
                        className="text-xs text-neutral-500 hover:underline"
                      >
                        Open full view
                      </Link>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3">
                      <SalesAuditReportView report={report} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {SALES_AUDIT_ELIGIBLE_STATUSES.includes(lead.status) && !lead.archived_at && (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Outreach</h2>
            <div className="flex gap-2">
              {OUTREACH_CHANNELS.map((channel) => (
                <button
                  key={channel}
                  onClick={() => handleGenerateOutreach(channel)}
                  disabled={generatingChannel !== null}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
                >
                  {generatingChannel === channel ? "Generating…" : OUTREACH_CHANNEL_LABELS[channel]}
                </button>
              ))}
            </div>
          </div>
          {outreachError && <p className="mt-2 text-sm text-red-600">{outreachError}</p>}

          <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
            {outreachMessages && outreachMessages.length === 0 && generatingChannel === null && (
              <li className="px-3 py-3 text-sm text-neutral-500">No outreach drafted yet.</li>
            )}
            {outreachMessages?.map((message) => {
              const expanded = expandedOutreachId === message.id;
              const busy = outreachActionId === message.id;
              return (
                <li key={message.id} className="px-3 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setExpandedOutreachId(expanded ? null : message.id)}
                      className="text-left text-neutral-900 hover:underline"
                    >
                      {expanded ? "▾" : "▸"} {OUTREACH_CHANNEL_LABELS[message.channel].replace("Draft ", "")} —{" "}
                      {new Date(message.generated_at).toLocaleString()}
                    </button>
                    <div className="flex items-center gap-2">
                      {message.flagged_for_review && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Flagged</span>
                      )}
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                        {OUTREACH_STATUS_LABELS[message.status]}
                      </span>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3">
                      <OutreachMessageView message={message} />
                      <div className="mt-3 flex gap-2">
                        {message.status === "drafted" && (
                          <button
                            onClick={() => handleOutreachAction(message.id, "approve")}
                            disabled={busy}
                            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                        {(message.status === "drafted" || message.status === "approved") && (
                          <button
                            onClick={() => handleOutreachAction(message.id, "mark-sent")}
                            disabled={busy}
                            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                          >
                            Mark sent
                          </button>
                        )}
                        {(message.status === "sent" || message.status === "follow_up_due") && (
                          <button
                            onClick={() => handleOutreachAction(message.id, "mark-replied")}
                            disabled={busy}
                            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                          >
                            Mark replied
                          </button>
                        )}
                        {message.status !== "closed" && (
                          <button
                            onClick={() => handleOutreachAction(message.id, "close")}
                            disabled={busy}
                            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                          >
                            Close
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleGenerateFollowUp}
              disabled={generatingFollowUp}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {generatingFollowUp ? "Generating…" : "Generate follow-up"}
            </button>
            <Link href="/dashboard/follow-ups" className="text-xs text-neutral-500 hover:underline">
              View all follow-ups
            </Link>
          </div>
          {followUpError && <p className="mt-2 text-sm text-red-600">{followUpError}</p>}
          {latestFollowUp && (
            <div className="mt-3 rounded-md border border-neutral-200 px-3 py-2 text-sm">
              <p className="text-neutral-900">
                Follow up via {latestFollowUp.channel.replace("_", " ")} by{" "}
                {new Date(latestFollowUp.due_date).toLocaleDateString()}
              </p>
              <p className="mt-1 text-neutral-600">{latestFollowUp.suggested_next_action}</p>
            </div>
          )}
        </section>
      )}

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
