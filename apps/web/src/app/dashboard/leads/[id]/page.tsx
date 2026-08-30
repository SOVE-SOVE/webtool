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
  type Meeting,
  type OutreachChannel,
  type OutreachMessage,
  type PipelineEvent,
  type Project,
  PROJECT_STAGE_LABELS,
  type SalesAuditReport,
  type SalesOpportunity,
  type User,
} from "@/lib/api";
import { SalesAuditReportView } from "@/components/SalesAuditReportView";
import { OutreachMessageView } from "@/components/OutreachMessageView";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { ErrorState } from "@/components/ui/ErrorState";

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
  follow_up: "Draft follow-up message",
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
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

const inputClass = "w-full rounded-md border border-border-strong px-3 py-1.5 text-sm";

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const confirm = useConfirm();
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

  const [editingOutreachId, setEditingOutreachId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editOpeningLine, setEditOpeningLine] = useState("");
  const [editKeyPoints, setEditKeyPoints] = useState("");
  const [editObjectionHandling, setEditObjectionHandling] = useState("");
  const [editSuggestedClose, setEditSuggestedClose] = useState("");
  const [savingOutreachEdit, setSavingOutreachEdit] = useState(false);

  const [generatingFollowUp, setGeneratingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [latestFollowUp, setLatestFollowUp] = useState<FollowUp | null>(null);

  const [opportunities, setOpportunities] = useState<SalesOpportunity[] | null>(null);
  const [proposalTier, setProposalTier] = useState("");
  const [proposalPrice, setProposalPrice] = useState("");
  const [loggingProposal, setLoggingProposal] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [opportunityActionId, setOpportunityActionId] = useState<string | null>(null);

  const [meetings, setMeetings] = useState<Meeting[] | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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
      .then((b) => {
        setError(null);
        setBusiness(b);
      })
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
    api.listProjects().then(setProjects).catch(() => {});
    api.listMeetings({ leadId }).then(setMeetings).catch(() => {});
    api.listOpportunities(leadId).then(setOpportunities).catch(() => {});
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

  async function handleLogProposal(e: React.FormEvent) {
    e.preventDefault();
    setLoggingProposal(true);
    setProposalError(null);
    try {
      const priceInput = proposalPrice.trim();
      const opportunity = await api.createOpportunity(leadId, {
        tier: proposalTier.trim() || undefined,
        proposed_price_cents: priceInput === "" ? undefined : Math.round(Number(priceInput) * 100),
      });
      setOpportunities((prev) => [opportunity, ...(prev ?? [])]);
      setProposalTier("");
      setProposalPrice("");
      // Logging a proposal advances the lead to PROPOSAL server-side.
      setLead((prev) => (prev ? { ...prev, status: "proposal" } : prev));
      refreshActivity();
    } catch (err) {
      setProposalError(err instanceof ApiError ? err.message : "Couldn't log the proposal.");
    } finally {
      setLoggingProposal(false);
    }
  }

  async function handleMarkOpportunityLost(opportunityId: string) {
    setOpportunityActionId(opportunityId);
    setProposalError(null);
    try {
      const updated = await api.markOpportunityLost(opportunityId);
      setOpportunities((prev) => (prev ?? []).map((o) => (o.id === updated.id ? updated : o)));
      refreshActivity();
    } catch (err) {
      setProposalError(err instanceof ApiError ? err.message : "Couldn't update the proposal.");
    } finally {
      setOpportunityActionId(null);
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

  function startEditOutreach(message: OutreachMessage) {
    setEditSubject(message.subject ?? "");
    setEditBody(message.body ?? "");
    setEditOpeningLine(message.opening_line ?? "");
    setEditKeyPoints(message.key_points.join("\n"));
    setEditObjectionHandling(message.objection_handling.join("\n"));
    setEditSuggestedClose(message.suggested_close ?? "");
    setOutreachError(null);
    setEditingOutreachId(message.id);
  }

  function cancelEditOutreach() {
    setEditingOutreachId(null);
  }

  async function handleSaveOutreachEdit(message: OutreachMessage) {
    setSavingOutreachEdit(true);
    setOutreachError(null);
    try {
      const patch =
        message.channel === "email" || message.channel === "follow_up"
          ? { subject: editSubject, body: editBody }
          : {
              opening_line: editOpeningLine,
              key_points: editKeyPoints.split("\n").map((s) => s.trim()).filter(Boolean),
              objection_handling: editObjectionHandling.split("\n").map((s) => s.trim()).filter(Boolean),
              suggested_close: editSuggestedClose,
            };
      const updated = await api.updateOutreach(message.id, patch);
      setOutreachMessages((prev) => (prev ?? []).map((m) => (m.id === message.id ? updated : m)));
      setEditingOutreachId(null);
      refreshActivity();
    } catch (err) {
      setOutreachError(err instanceof ApiError ? err.message : "Couldn't save the edit.");
    } finally {
      setSavingOutreachEdit(false);
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
    if (!business) return;
    const ok = await confirm({
      title: `Convert ${business.name} to a client?`,
      description:
        "This marks the lead WON and creates a new client and an INTAKE-stage project" +
        (convertPackage ? ` (${convertPackage})` : "") +
        ". The lead's history — audits, outreach, sales opportunities, and notes — stays exactly where it is, attached to the lead. This can't be undone.",
      confirmLabel: "Convert to client",
      danger: true,
    });
    if (!ok) return;

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

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!lead || !business) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;

  return (
    <div className="p-6">
      <Link href="/dashboard/leads" className="text-sm text-fg-muted hover:underline">
        ← All leads
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-fg">{business.name}</h1>
        <button
          onClick={handleArchiveToggle}
          className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle"
        >
          {lead.archived_at ? "Unarchive lead" : "Archive lead"}
        </button>
      </div>
      {lead.archived_at && (
        <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
          Archived on {new Date(lead.archived_at).toLocaleDateString()}
        </p>
      )}

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
            <div className="sm:col-span-2">
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
          <h2 className="text-sm font-semibold text-fg">Lead</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            {field("Source", <span className="text-sm text-fg-muted">{lead.source ?? "—"}</span>)}
            {field(
              "Created",
              <span className="text-sm text-fg-muted">
                {new Date(lead.created_at).toLocaleDateString()}
              </span>,
            )}
            <div className="sm:col-span-2">
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
          <h2 className="text-sm font-semibold text-fg">Pipeline stage history</h2>
          <Link href="/dashboard/leads?view=board" className="text-xs text-fg-muted hover:underline">
            View pipeline board →
          </Link>
        </div>
        <ul className="mt-3 divide-y divide-border border border-border">
          {pipelineEvents && pipelineEvents.length === 0 && (
            <li className="px-3 py-3 text-sm text-fg-muted">
              No stage changes yet — this lead has been {lead.status.replace("_", " ")} since it was created.
            </li>
          )}
          {pipelineEvents?.map((event) => (
            <li key={event.id} className="px-3 py-2 text-sm">
              <span className="text-fg">{event.summary ?? event.kind}</span>
              <span className="ml-2 text-xs text-fg-muted">{new Date(event.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>

      {SALES_AUDIT_ELIGIBLE_STATUSES.includes(lead.status) && !lead.archived_at && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-fg">Proposal / quote</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Log the quote you sent so it shows up as pipeline value on the Sales page. Logging one moves this lead to
            Proposal.
          </p>

          <ul className="mt-3 divide-y divide-border border border-border">
            {opportunities && opportunities.length === 0 && (
              <li className="px-3 py-3 text-sm text-fg-muted">No proposal logged yet.</li>
            )}
            {opportunities?.map((op) => (
              <li key={op.id} className="flex items-center justify-between px-3 py-3 text-sm">
                <span className="text-fg">
                  {op.proposed_price_cents != null
                    ? `$${(op.proposed_price_cents / 100).toLocaleString()}`
                    : "No price recorded"}
                  {op.tier ? ` · ${op.tier}` : ""}
                  <span className="ml-2 text-xs text-fg-muted">
                    {op.status === "open" ? "Open" : op.status === "won" ? "Won" : "Lost"} ·{" "}
                    {new Date(op.created_at).toLocaleDateString()}
                  </span>
                </span>
                {op.status === "open" && (
                  <button
                    onClick={() => handleMarkOpportunityLost(op.id)}
                    disabled={opportunityActionId === op.id}
                    className="text-xs text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
                  >
                    Mark lost
                  </button>
                )}
              </li>
            ))}
          </ul>

          {!opportunities?.some((o) => o.status === "open") && lead.status !== "won" && lead.status !== "lost" && (
            <form onSubmit={handleLogProposal} className="mt-3 flex flex-wrap items-end gap-2">
              <input
                value={proposalTier}
                onChange={(e) => setProposalTier(e.target.value)}
                placeholder="Package (e.g. Core)"
                className="input w-40"
              />
              <input
                value={proposalPrice}
                onChange={(e) => setProposalPrice(e.target.value)}
                inputMode="decimal"
                placeholder="Quoted price, AUD"
                className="input w-40"
              />
              <button
                type="submit"
                disabled={loggingProposal}
                className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle disabled:opacity-50"
              >
                {loggingProposal ? "Logging…" : "Log proposal"}
              </button>
            </form>
          )}
          {proposalError && <p className="mt-2 text-error">{proposalError}</p>}
        </section>
      )}

      {(() => {
        const existingClient = clients.find((c) => c.business_id === business.id) ?? convertedClient;
        const clientProjects = existingClient
          ? projects.filter((p) => p.client_id === existingClient.id)
          : [];
        const activeProject =
          clientProjects.find((p) => p.stage !== "maintenance" && p.stage !== "complete") ??
          clientProjects[0] ??
          null;
        if (lead.archived_at) return null;
        return (
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">
                {existingClient ? "Client & delivery" : "Convert to client"}
              </h2>
              {!existingClient && (
                <button
                  onClick={() => setShowConvertForm((v) => !v)}
                  className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle"
                >
                  {showConvertForm ? "Cancel" : "Mark WON — convert"}
                </button>
              )}
            </div>

            {existingClient ? (
              <div className="mt-2 space-y-1.5 text-sm">
                <p className="text-fg-muted">
                  Won and converted.{" "}
                  <Link href={`/dashboard/clients/${existingClient.id}`} className="text-fg hover:underline">
                    Client record ↗
                  </Link>
                </p>
                {activeProject ? (
                  <p className="text-fg-muted">
                    Project{" "}
                    <Link href={`/dashboard/projects/${activeProject.id}`} className="text-fg hover:underline">
                      {activeProject.name}
                    </Link>{" "}
                    · <span className="text-fg">{PROJECT_STAGE_LABELS[activeProject.stage]}</span>
                    {" · "}
                    <Link
                      href={`/dashboard/projects/${activeProject.id}/website`}
                      className="text-fg-muted hover:underline"
                    >
                      Website
                    </Link>
                    {clientProjects.length > 1 && (
                      <span className="text-fg-subtle"> (+{clientProjects.length - 1} more)</span>
                    )}
                  </p>
                ) : (
                  <p className="text-fg-subtle">No project yet — start intake from the client record.</p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm text-fg-muted">
                Creates the client record and an INTAKE-stage project (with starter tasks) in one step, and
                preserves this lead&apos;s full history — audits, outreach, and notes stay attached to it.
              </p>
            )}

            {showConvertForm && !existingClient && (
              <form
                onSubmit={handleConvert}
                className="mt-3 max-w-2xl space-y-3 border border-border p-4"
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
                    <label className="text-xs uppercase tracking-wide text-fg-muted">
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
                {convertError && <p className="text-error">{convertError}</p>}
                <button
                  type="submit"
                  disabled={converting}
                  className="btn btn-primary"
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
            <h2 className="text-sm font-semibold text-fg">Sales audit</h2>
            <button
              onClick={handleGenerateSalesAudit}
              disabled={generatingAudit}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle disabled:opacity-50"
            >
              {generatingAudit ? "Generating…" : "Generate sales audit"}
            </button>
          </div>
          {generatingAudit && (
            <p className="mt-2 text-sm text-fg-muted">
              Auditing the website, checking public info, and writing the report — this can take up to a
              minute.
            </p>
          )}
          {generateAuditError && <p className="mt-2 text-error">{generateAuditError}</p>}

          <ul className="mt-3 divide-y divide-border border border-border">
            {salesAudits && salesAudits.length === 0 && !generatingAudit && (
              <li className="px-3 py-3 text-sm text-fg-muted">No sales audits generated yet.</li>
            )}
            {salesAudits?.map((report) => {
              const expanded = expandedAuditId === report.id;
              return (
                <li key={report.id} className="px-3 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setExpandedAuditId(expanded ? null : report.id)}
                      className="text-left text-fg hover:underline"
                    >
                      {expanded ? "▾" : "▸"} Sales audit — {new Date(report.generated_at).toLocaleString()}
                    </button>
                    <div className="flex items-center gap-3">
                      {report.flagged_for_review && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                          Flagged for review
                        </span>
                      )}
                      <Link
                        href={`/dashboard/leads/${leadId}/sales-audits/${report.id}`}
                        className="text-xs text-fg-muted hover:underline"
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
            <h2 className="text-sm font-semibold text-fg">Outreach</h2>
            <div className="flex gap-2">
              {OUTREACH_CHANNELS.map((channel) => (
                <button
                  key={channel}
                  onClick={() => handleGenerateOutreach(channel)}
                  disabled={generatingChannel !== null}
                  className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle disabled:opacity-50"
                >
                  {generatingChannel === channel ? "Generating…" : OUTREACH_CHANNEL_LABELS[channel]}
                </button>
              ))}
              {outreachMessages && outreachMessages.length > 0 && (
                <button
                  onClick={() => handleGenerateOutreach("follow_up")}
                  disabled={generatingChannel !== null}
                  className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle disabled:opacity-50"
                  title="Drafts an actual follow-up message, grounded in the outreach already sent to this lead."
                >
                  {generatingChannel === "follow_up" ? "Generating…" : OUTREACH_CHANNEL_LABELS.follow_up}
                </button>
              )}
            </div>
          </div>
          {outreachError && <p className="mt-2 text-error">{outreachError}</p>}

          <ul className="mt-3 divide-y divide-border border border-border">
            {outreachMessages && outreachMessages.length === 0 && generatingChannel === null && (
              <li className="px-3 py-3 text-sm text-fg-muted">No outreach drafted yet.</li>
            )}
            {outreachMessages?.map((message) => {
              const expanded = expandedOutreachId === message.id;
              const busy = outreachActionId === message.id;
              return (
                <li key={message.id} className="px-3 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setExpandedOutreachId(expanded ? null : message.id)}
                      className="text-left text-fg hover:underline"
                    >
                      {expanded ? "▾" : "▸"} {OUTREACH_CHANNEL_LABELS[message.channel].replace("Draft ", "")} —{" "}
                      {new Date(message.generated_at).toLocaleString()}
                    </button>
                    <div className="flex items-center gap-2">
                      {message.flagged_for_review && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Flagged</span>
                      )}
                      <span className="rounded bg-surface-subtle px-2 py-0.5 text-xs text-fg-muted">
                        {OUTREACH_STATUS_LABELS[message.status]}
                      </span>
                    </div>
                  </div>
                  {expanded && editingOutreachId === message.id && (
                    <div className="mt-3">
                      {message.channel === "email" || message.channel === "follow_up" ? (
                        <div className="space-y-2">
                          <input
                            value={editSubject}
                            onChange={(e) => setEditSubject(e.target.value)}
                            placeholder="Subject"
                            className={inputClass}
                          />
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            placeholder="Body"
                            rows={6}
                            className={inputClass}
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <input
                            value={editOpeningLine}
                            onChange={(e) => setEditOpeningLine(e.target.value)}
                            placeholder="Opening line"
                            className={inputClass}
                          />
                          <textarea
                            value={editKeyPoints}
                            onChange={(e) => setEditKeyPoints(e.target.value)}
                            placeholder="Key points — one per line"
                            rows={4}
                            className={inputClass}
                          />
                          <textarea
                            value={editObjectionHandling}
                            onChange={(e) => setEditObjectionHandling(e.target.value)}
                            placeholder="Objection handling — one per line"
                            rows={3}
                            className={inputClass}
                          />
                          <input
                            value={editSuggestedClose}
                            onChange={(e) => setEditSuggestedClose(e.target.value)}
                            placeholder="Suggested close"
                            className={inputClass}
                          />
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => handleSaveOutreachEdit(message)}
                          disabled={savingOutreachEdit}
                          className="rounded-md border border-fg bg-accent px-2.5 py-1 text-xs text-accent-fg hover:opacity-90 disabled:opacity-50"
                        >
                          {savingOutreachEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={cancelEditOutreach}
                          disabled={savingOutreachEdit}
                          className="rounded-md border border-border-strong px-2.5 py-1 text-xs hover:bg-surface-subtle disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {expanded && editingOutreachId !== message.id && (
                    <div className="mt-3">
                      <OutreachMessageView message={message} />
                      <div className="mt-3 flex gap-2">
                        {(message.status === "drafted" || message.status === "approved") && (
                          <button
                            onClick={() => startEditOutreach(message)}
                            className="rounded-md border border-border-strong px-2.5 py-1 text-xs hover:bg-surface-subtle"
                          >
                            Edit
                          </button>
                        )}
                        {message.status === "drafted" && (
                          <button
                            onClick={() => handleOutreachAction(message.id, "approve")}
                            disabled={busy}
                            className="rounded-md border border-border-strong px-2.5 py-1 text-xs hover:bg-surface-subtle disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                        {(message.status === "drafted" || message.status === "approved") && (
                          <button
                            onClick={() => handleOutreachAction(message.id, "mark-sent")}
                            disabled={busy}
                            className="rounded-md border border-border-strong px-2.5 py-1 text-xs hover:bg-surface-subtle disabled:opacity-50"
                          >
                            Mark sent
                          </button>
                        )}
                        {(message.status === "sent" || message.status === "follow_up_due") && (
                          <button
                            onClick={() => handleOutreachAction(message.id, "mark-replied")}
                            disabled={busy}
                            className="rounded-md border border-border-strong px-2.5 py-1 text-xs hover:bg-surface-subtle disabled:opacity-50"
                          >
                            Mark replied
                          </button>
                        )}
                        {message.status !== "closed" && (
                          <button
                            onClick={() => handleOutreachAction(message.id, "close")}
                            disabled={busy}
                            className="rounded-md border border-border-strong px-2.5 py-1 text-xs hover:bg-surface-subtle disabled:opacity-50"
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
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-surface-subtle disabled:opacity-50"
            >
              {generatingFollowUp ? "Generating…" : "Generate follow-up"}
            </button>
            <Link href="/dashboard/follow-ups" className="text-xs text-fg-muted hover:underline">
              View all follow-ups
            </Link>
          </div>
          {followUpError && <p className="mt-2 text-error">{followUpError}</p>}
          {latestFollowUp && (
            <div className="mt-3 rounded-md border border-border px-3 py-2 text-sm">
              <p className="text-fg">
                Follow up via {latestFollowUp.channel.replace("_", " ")} by{" "}
                {new Date(latestFollowUp.due_date).toLocaleDateString()}
              </p>
              <p className="mt-1 text-fg-muted">{latestFollowUp.suggested_next_action}</p>
            </div>
          )}
        </section>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Meetings</h2>
          <Link href="/dashboard/calendar" className="text-xs text-fg-muted hover:underline">
            Schedule on calendar →
          </Link>
        </div>
        <ul className="mt-3 divide-y divide-border border border-border">
          {meetings && meetings.length === 0 && (
            <li className="px-3 py-3 text-sm text-fg-muted">No meetings scheduled yet.</li>
          )}
          {meetings?.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-fg">
                {m.title}
                <span className="ml-2 text-xs text-fg-muted">
                  {new Date(m.scheduled_at).toLocaleString()} · {m.status.replace("_", " ")}
                  {m.assigned_user_name ? ` · ${m.assigned_user_name}` : ""}
                </span>
              </span>
              {m.outcome && <span className="shrink-0 text-xs text-fg-muted">{m.outcome}</span>}
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
