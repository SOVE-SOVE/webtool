"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
  type EmailSend,
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
import { LeadPriorityBadge, LeadStatusBadge } from "@/components/LeadStatusBadge";
import { StageChecklistPanel } from "@/components/checklists/StageChecklistPanel";
import { Badge } from "@/components/ui/Badge";
import { Disclosure } from "@/components/ui/Disclosure";
import { DetailField, DetailRow } from "@/components/ui/DetailField";
import { EmptyRow } from "@/components/ui/Panel";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/ToastProvider";
import { LEAD_STATUS_LABEL, leadNextAction } from "@/lib/leads";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

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

// Thin positional-argument wrappers over the shared DetailField/DetailRow
// primitives (docs/11_UI_REDESIGN_PLAN.md §2.4/§4) — kept so the many
// existing `field("Label", value)` / `summaryRow("Label", value)` call
// sites below don't all need to become `<DetailField label=... value=... />`.
function field(label: string, value: React.ReactNode) {
  return <DetailField label={label} value={value} />;
}

function summaryRow(label: string, value: React.ReactNode) {
  return <DetailRow label={label} value={value} />;
}

const inputClass = "input";

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const showToast = useToast();
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
  const [emailSends, setEmailSends] = useState<EmailSend[] | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);

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
  const [scheduledFollowUp, setScheduledFollowUp] = useState<FollowUp | null>(null);

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

  const [startingPlanning, setStartingPlanning] = useState(false);
  const [startPlanningError, setStartPlanningError] = useState<string | null>(null);

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
    api.listLeadEmails(leadId).then(setEmailSends).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
    api.listProjects().then(setProjects).catch(() => {});
    api.listMeetings({ leadId }).then(setMeetings).catch(() => {});
    api.listOpportunities(leadId).then(setOpportunities).catch(() => {});
    api
      .listFollowUps()
      .then((b) => {
        const mine = [...b.overdue, ...b.due_today, ...b.upcoming]
          .filter((f) => f.lead_id === leadId)
          .sort((a, z) => (a.due_date < z.due_date ? -1 : 1));
        setScheduledFollowUp(mine[0] ?? null);
      })
      .catch(() => {});
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
    if (!lead.archived_at) {
      const ok = await confirm({
        title: `Archive ${lead.business_name}?`,
        description:
          "The lead will be removed from the active Leads list and workflow counts, but nothing is deleted — its " +
          "history, any client, and any project stay exactly as they are. You can restore it any time from the " +
          "Leads list.",
        confirmLabel: "Archive lead",
        danger: true,
      });
      if (!ok) return;
    }
    const updated = lead.archived_at ? await api.unarchiveLead(lead.id) : await api.archiveLead(lead.id);
    setLead(updated);
    refreshActivity();
    showToast(updated.archived_at ? `${lead.business_name} archived.` : `${lead.business_name} restored.`);
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

  async function handleStartPlanning() {
    setStartingPlanning(true);
    setStartPlanningError(null);
    try {
      const planning = await api.startPlanning(leadId);
      router.push(`/dashboard/planning/${planning.id}`);
    } catch (err) {
      setStartPlanningError(err instanceof ApiError ? err.message : "Couldn't open Planning for this lead.");
      setStartingPlanning(false);
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

  async function handleSendEmail(id: string) {
    setSendingEmailId(id);
    setOutreachError(null);
    try {
      const send = await api.sendOutreachEmail(id);
      setEmailSends((prev) => [send, ...(prev ?? [])]);
      if (send.status === "sent") {
        // A successful send flips the message to SENT server-side.
        await api.listOutreach(leadId).then(setOutreachMessages);
      } else {
        setOutreachError(
          send.error_message
            ? `Send failed: ${send.error_message}`
            : "Send failed. The message is still approved — you can retry.",
        );
      }
      refreshActivity();
    } catch (err) {
      setOutreachError(err instanceof ApiError ? err.message : "Couldn't send the email.");
    } finally {
      setSendingEmailId(null);
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
      setScheduledFollowUp(followUp);
      refreshActivity();
      api.listOutreach(leadId).then(setOutreachMessages).catch(() => {});
    } catch (err) {
      setFollowUpError(err instanceof ApiError ? err.message : "Couldn't generate a follow-up.");
    } finally {
      setGeneratingFollowUp(false);
    }
  }

  async function handleStartProject() {
    if (!business) return;
    const ok = await confirm({
      title: `Start a website project for ${business.name}?`,
      description:
        "Creates a speculative project owned by this lead, then opens it so you can build the website. The lead " +
        "stays a Lead — no client is created and nothing here is final. Convert to a client separately once the " +
        "business agrees to work with you.",
      confirmLabel: "Start project",
    });
    if (!ok) return;

    setConverting(true);
    setConvertError(null);
    try {
      const project = await api.createProject({ lead_id: leadId, name: `${business.name} Website` });
      router.push(`/dashboard/projects/${project.id}?created=1`);
    } catch (err) {
      setConvertError(err instanceof ApiError ? err.message : "Couldn't start the project.");
    } finally {
      setConverting(false);
    }
  }

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault();
    if (!business) return;
    const ok = await confirm({
      title: `Convert ${business.name} to a client?`,
      description:
        "This marks the lead WON and creates a new client" +
        (lead?.prospect_project
          ? `, linking its existing prospect project (${lead.prospect_project.name}) to it`
          : " and an INTAKE-stage project") +
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
      const [updatedLead, allProjects] = await Promise.all([api.getLead(leadId), api.listProjects()]);
      setLead(updatedLead);
      setProjects(allProjects);
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

  const existingClient = clients.find((c) => c.business_id === business.id) ?? convertedClient;
  const clientProjects = existingClient ? projects.filter((p) => p.client_id === existingClient.id) : [];
  const activeProject =
    clientProjects.find((p) => p.stage !== "maintenance" && p.stage !== "complete") ??
    clientProjects[0] ??
    null;

  // Shared by both "no client yet" branches below (with or without an
  // existing prospect project) — the one genuine, explicit conversion
  // action (docs/05_DECISIONS.md).
  const convertForm = showConvertForm && (
    <form onSubmit={handleConvert} className="mt-3 max-w-2xl space-y-3 border border-border p-4">
      <Input
        placeholder="Project name (defaults to “{business} Website”)"
        value={convertProjectName}
        onChange={(e) => setConvertProjectName(e.target.value)}
        className={inputClass}
      />
      <div className="flex gap-3">
        <Input
          placeholder="Package (e.g. Core, $899)"
          value={convertPackage}
          onChange={(e) => setConvertPackage(e.target.value)}
          className={inputClass}
        />
        <Input
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
          <label className="text-xs uppercase tracking-wide text-fg-muted">Agreed deadline</label>
          <Input
            type="date"
            value={convertDeadline}
            onChange={(e) => setConvertDeadline(e.target.value)}
            className={`${inputClass} mt-1`}
          />
        </div>
        <Input
          placeholder="Billing email (optional)"
          value={convertBillingEmail}
          onChange={(e) => setConvertBillingEmail(e.target.value)}
          className={`${inputClass} mt-5`}
        />
      </div>
      <Select value={convertAssignedUserId} onChange={(e) => setConvertAssignedUserId(e.target.value)} className={inputClass}>
        <option value="">Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </Select>
      <button type="submit" disabled={converting} className="btn btn-primary">
        {converting ? "Converting…" : "Convert to client"}
      </button>
    </form>
  );

  const contactLine = [business.phone, business.email].filter(Boolean).join(" · ") || "No contact details";
  const locationLine = [business.suburb, business.state].filter(Boolean).join(", ") || "Location unknown";
  const nextLine = scheduledFollowUp
    ? `${scheduledFollowUp.suggested_next_action} (by ${new Date(scheduledFollowUp.due_date).toLocaleDateString()})`
    : leadNextAction(lead, null);

  const salesEligible = SALES_AUDIT_ELIGIBLE_STATUSES.includes(lead.status) && !lead.archived_at;

  return (
    <div className="p-6">
      <Link href="/dashboard/leads" className="text-sm text-fg-muted hover:underline">
        ← All leads
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="page-title">{business.name}</h1>
          <LeadStatusBadge status={lead.status} />
          <LeadPriorityBadge priority={lead.priority} score={lead.score} />
        </div>
        <button onClick={handleArchiveToggle} className="btn btn-secondary">
          {lead.archived_at ? "Unarchive lead" : "Archive lead"}
        </button>
      </div>
      {lead.archived_at && (
        <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
          Archived on {new Date(lead.archived_at).toLocaleDateString()}
        </p>
      )}

      {/* At-a-glance: who / status / next */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Who</h2>
          <div className="mt-2 space-y-1.5">
            {summaryRow("Type", business.industry || "—")}
            {summaryRow("Location", locationLine)}
            {summaryRow("Contact", contactLine)}
            {summaryRow(
              "Website",
              business.website_url ? (
                <a href={business.website_url} target="_blank" rel="noreferrer" className="hover:underline">
                  Visit site ↗
                </a>
              ) : (
                "No website"
              ),
            )}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Status</h2>
          <div className="mt-2 space-y-1.5">
            {summaryRow("Stage", LEAD_STATUS_LABEL[lead.status])}
            {summaryRow("Priority", <LeadPriorityBadge priority={lead.priority} score={lead.score} />)}
            {summaryRow("Assigned", lead.assigned_user_name ?? "Unassigned")}
            {summaryRow("Source", lead.source ?? "—")}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Next</h2>
          <p className="mt-2 text-sm text-fg">{nextLine}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerateFollowUp}
              disabled={generatingFollowUp}
              className="btn btn-secondary btn-sm"
            >
              {generatingFollowUp ? "Generating…" : scheduledFollowUp ? "Regenerate follow-up" : "Generate follow-up"}
            </button>
            <Link href="/dashboard/follow-ups" className="text-xs text-fg-muted hover:underline">
              All follow-ups
            </Link>
          </div>
          {followUpError && <p className="mt-2 text-error">{followUpError}</p>}
        </div>
      </div>

      {/* Notes — read-only preview so "what do I already know about this
          lead" is visible without opening the edit form below. Editing
          still happens in the "Business & lead details" disclosure; this
          is the one place that stays in sync with it automatically since
          it just reads `lead.notes`. */}
      {lead.notes && (
        <div className="card mt-4 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{lead.notes}</p>
        </div>
      )}

      {/* Google review intelligence — read-only projection from Lead
          Intelligence discovery; the full analysis lives on the
          discovered business's own page, not duplicated here. */}
      {(lead.google_rating !== null || lead.review_summary !== null) && (
        <div className="card mt-4 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Google reviews</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-fg">
              {lead.google_rating !== null ? `${lead.google_rating.toFixed(1)}★` : "No rating"}
              {lead.google_review_count !== null && (
                <span className="text-fg-muted"> ({lead.google_review_count} reviews)</span>
              )}
            </span>
            {lead.review_health_score !== null && (
              <span className="text-fg-muted">Health {lead.review_health_score}/100</span>
            )}
            {lead.review_activity_level && lead.review_activity_level !== "unknown" && (
              <span className="text-fg-muted">
                Activity {lead.review_activity_level.toUpperCase()}
                {lead.review_frequency_per_month !== null && ` (~${lead.review_frequency_per_month}/month)`}
              </span>
            )}
            {lead.review_sentiment_trend && lead.review_sentiment_trend !== "insufficient_data" && (
              <span className="text-fg-muted capitalize">Trend: {lead.review_sentiment_trend}</span>
            )}
          </div>
          {(lead.positive_review_themes.length > 0 || lead.negative_review_themes.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
              {lead.positive_review_themes.length > 0 && (
                <span>Praise: {lead.positive_review_themes.join(", ")}</span>
              )}
              {lead.negative_review_themes.length > 0 && (
                <span>Friction: {lead.negative_review_themes.join(", ")}</span>
              )}
            </div>
          )}
          {lead.review_summary && <p className="mt-2 text-sm text-fg-muted">{lead.review_summary}</p>}
        </div>
      )}

      {/* Planning — the only bridge from this lead to its Planning workspace */}
      {!lead.archived_at && (
        <section className="panel mt-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title">Planning</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              Understand this lead&apos;s existing website before building — analysis, findings, and the
              create-project decision all happen in Planning.
            </p>
            {startPlanningError && <p className="mt-2 text-error">{startPlanningError}</p>}
          </div>
          {lead.planning_id ? (
            <Link href={`/dashboard/planning/${lead.planning_id}`} className="btn btn-primary shrink-0">
              Open Planning →
            </Link>
          ) : (
            <button onClick={handleStartPlanning} disabled={startingPlanning} className="btn btn-primary shrink-0">
              {startingPlanning ? "Opening…" : "Start Planning →"}
            </button>
          )}
        </section>
      )}

      {/* Project & website — the one forward action */}
      {!lead.archived_at && (
        <section className="mt-8">
          <h2 className="section-title">Project &amp; website</h2>
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
                    Open website workspace →
                  </Link>
                  {clientProjects.length > 1 && (
                    <span className="text-fg-subtle"> (+{clientProjects.length - 1} more)</span>
                  )}
                </p>
              ) : (
                <p className="text-fg-subtle">No project yet — start intake from the client record.</p>
              )}
            </div>
          ) : lead.prospect_project ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-fg-muted">
                Prospect project{" "}
                <Link href={`/dashboard/projects/${lead.prospect_project.id}`} className="text-fg hover:underline">
                  {lead.prospect_project.name}
                </Link>{" "}
                · <span className="text-fg">{PROJECT_STAGE_LABELS[lead.prospect_project.stage]}</span>
                {" · "}
                <Link
                  href={`/dashboard/projects/${lead.prospect_project.id}/website`}
                  className="text-fg-muted hover:underline"
                >
                  Open website workspace →
                </Link>
              </p>
              <p className="text-xs text-fg-subtle">
                Speculative — this lead stays a Lead until you explicitly convert it below.
              </p>
              <button onClick={() => setShowConvertForm((v) => !v)} className="btn btn-secondary btn-sm">
                {showConvertForm ? "Cancel" : "Convert to client"}
              </button>
              {convertError && <p className="mt-2 text-error">{convertError}</p>}
              {convertForm}
            </div>
          ) : (
            <div className="mt-2">
              <p className="text-sm text-fg-muted">
                Build the website now — speculative work you can show before the business has committed. This
                creates a prospect project owned by the lead; the lead stays a Lead until you explicitly convert it
                with the form below.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={handleStartProject} disabled={converting} className="btn btn-primary">
                  {converting ? "Starting…" : "Start website project →"}
                </button>
                <button onClick={() => setShowConvertForm((v) => !v)} className="btn btn-ghost btn-sm">
                  {showConvertForm ? "Cancel" : "Convert with full details"}
                </button>
              </div>
              {convertError && <p className="mt-2 text-error">{convertError}</p>}
              {convertForm}
            </div>
          )}
        </section>
      )}

      <div className="mt-4">
        <StageChecklistPanel ownerType="lead" ownerId={leadId} title="Stage checklist" />
      </div>

      {/* Editable detail — collapsed by default */}
      <div className="mt-8">
        <Disclosure title="Business & lead details" hint="Contact info, location, status, priority, score, notes">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            <section>
              <h3 className="text-sm font-semibold text-fg">Business</h3>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {field(
                  "Name",
                  <Input
                    defaultValue={business.name}
                    onBlur={(e) => e.target.value !== business.name && saveBusiness({ name: e.target.value })}
                    className={inputClass}
                  />,
                )}
                {field(
                  "Industry",
                  <Input
                    defaultValue={business.industry ?? ""}
                    onBlur={(e) => saveBusiness({ industry: e.target.value })}
                    className={inputClass}
                  />,
                )}
                {field(
                  "Website",
                  <Input
                    defaultValue={business.website_url ?? ""}
                    onBlur={(e) => saveBusiness({ website_url: e.target.value })}
                    className={inputClass}
                  />,
                )}
                {field(
                  "Phone",
                  <Input
                    defaultValue={business.phone ?? ""}
                    onBlur={(e) => saveBusiness({ phone: e.target.value })}
                    className={inputClass}
                  />,
                )}
                {field(
                  "Email",
                  <Input
                    defaultValue={business.email ?? ""}
                    onBlur={(e) => saveBusiness({ email: e.target.value })}
                    className={inputClass}
                  />,
                )}
                {field(
                  "Location",
                  <div className="flex gap-2">
                    <Input
                      placeholder="Suburb"
                      defaultValue={business.suburb ?? ""}
                      onBlur={(e) => saveBusiness({ suburb: e.target.value })}
                      className={inputClass}
                    />
                    <Input
                      placeholder="State"
                      defaultValue={business.state ?? ""}
                      onBlur={(e) => saveBusiness({ state: e.target.value })}
                      className={inputClass}
                    />
                  </div>,
                )}
                {field(
                  "Social links",
                  <Textarea
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
                    <Textarea
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
              <h3 className="text-sm font-semibold text-fg">Lead</h3>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {field(
                  "Status",
                  <Select
                    value={lead.status}
                    onChange={(e) => saveLead({ status: e.target.value as LeadStatus })}
                    className={inputClass}
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {LEAD_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Select>,
                )}
                {field(
                  "Priority",
                  <Select
                    value={lead.priority}
                    onChange={(e) => saveLead({ priority: e.target.value as LeadPriority })}
                    className={inputClass}
                  >
                    {LEAD_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>,
                )}
                {field(
                  "Score",
                  <Input
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
                  <Select
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
                  </Select>,
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
                    <Textarea
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
        </Disclosure>
      </div>

      {/* Sales prep & outreach — collapsed; only once the lead is worth working */}
      {salesEligible && (
        <div className="mt-4">
          <Disclosure
            title="Sales prep & outreach"
            hint="Proposal / quote, sales audit, and outreach drafts"
          >
            <section>
              <h3 className="text-sm font-semibold text-fg">Proposal / quote</h3>
              <p className="mt-1 text-xs text-fg-muted">
                Log the quote you sent so it shows up as pipeline value on the Sales page. Logging one moves this lead
                to Proposal.
              </p>

              <ul className="mt-3 divide-y divide-border border border-border">
                {opportunities && opportunities.length === 0 && (
                  <li>
                    <EmptyRow>No proposal logged yet.</EmptyRow>
                  </li>
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
                  <Input
                    value={proposalTier}
                    onChange={(e) => setProposalTier(e.target.value)}
                    placeholder="Package (e.g. Core)"
                    className="input w-40"
                  />
                  <Input
                    value={proposalPrice}
                    onChange={(e) => setProposalPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder="Quoted price, AUD"
                    className="input w-40"
                  />
                  <button
                    type="submit"
                    disabled={loggingProposal}
                    className="btn btn-secondary"
                  >
                    {loggingProposal ? "Logging…" : "Log proposal"}
                  </button>
                </form>
              )}
              {proposalError && <p className="mt-2 text-error">{proposalError}</p>}
            </section>

            <section className="mt-8">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg">Sales audit</h3>
                <button
                  onClick={handleGenerateSalesAudit}
                  disabled={generatingAudit}
                  className="btn btn-secondary"
                >
                  {generatingAudit ? "Generating…" : "Generate sales audit"}
                </button>
              </div>
              {generatingAudit && (
                <p className="mt-2 text-sm text-fg-muted">
                  Auditing the website, checking public info, and writing the report — this can take up to a minute.
                </p>
              )}
              {generateAuditError && <p className="mt-2 text-error">{generateAuditError}</p>}

              <ul className="mt-3 divide-y divide-border border border-border">
                {salesAudits && salesAudits.length === 0 && !generatingAudit && (
                  <li>
                    <EmptyRow>No sales audits generated yet.</EmptyRow>
                  </li>
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
                          {report.flagged_for_review && <Badge tone="warning">Flagged for review</Badge>}
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

            <section className="mt-8">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg">Outreach</h3>
                <div className="flex gap-2">
                  {OUTREACH_CHANNELS.map((channel) => (
                    <button
                      key={channel}
                      onClick={() => handleGenerateOutreach(channel)}
                      disabled={generatingChannel !== null}
                      className="btn btn-secondary"
                    >
                      {generatingChannel === channel ? "Generating…" : OUTREACH_CHANNEL_LABELS[channel]}
                    </button>
                  ))}
                  {outreachMessages && outreachMessages.length > 0 && (
                    <button
                      onClick={() => handleGenerateOutreach("follow_up")}
                      disabled={generatingChannel !== null}
                      className="btn btn-secondary"
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
                  <li>
                    <EmptyRow>No outreach drafted yet.</EmptyRow>
                  </li>
                )}
                {outreachMessages?.map((message) => {
                  const expanded = expandedOutreachId === message.id;
                  const busy = outreachActionId === message.id;
                  const messageSends = (emailSends ?? []).filter((s) => s.outreach_message_id === message.id);
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
                          {message.flagged_for_review && <Badge tone="warning">Flagged</Badge>}
                          <Badge tone="muted">{OUTREACH_STATUS_LABELS[message.status]}</Badge>
                        </div>
                      </div>
                      {expanded && editingOutreachId === message.id && (
                        <div className="mt-3">
                          {message.channel === "email" || message.channel === "follow_up" ? (
                            <div className="space-y-2">
                              <Input
                                value={editSubject}
                                onChange={(e) => setEditSubject(e.target.value)}
                                placeholder="Subject"
                                className={inputClass}
                              />
                              <Textarea
                                value={editBody}
                                onChange={(e) => setEditBody(e.target.value)}
                                placeholder="Body"
                                rows={6}
                                className={inputClass}
                              />
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <Input
                                value={editOpeningLine}
                                onChange={(e) => setEditOpeningLine(e.target.value)}
                                placeholder="Opening line"
                                className={inputClass}
                              />
                              <Textarea
                                value={editKeyPoints}
                                onChange={(e) => setEditKeyPoints(e.target.value)}
                                placeholder="Key points — one per line"
                                rows={4}
                                className={inputClass}
                              />
                              <Textarea
                                value={editObjectionHandling}
                                onChange={(e) => setEditObjectionHandling(e.target.value)}
                                placeholder="Objection handling — one per line"
                                rows={3}
                                className={inputClass}
                              />
                              <Input
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
                              className="btn btn-primary btn-sm"
                            >
                              {savingOutreachEdit ? "Saving…" : "Save"}
                            </button>
                            <button
                              onClick={cancelEditOutreach}
                              disabled={savingOutreachEdit}
                              className="btn btn-secondary btn-sm"
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
                                className="btn btn-secondary btn-sm"
                              >
                                Edit
                              </button>
                            )}
                            {message.status === "drafted" && (
                              <button
                                onClick={() => handleOutreachAction(message.id, "approve")}
                                disabled={busy}
                                className="btn btn-secondary btn-sm"
                              >
                                Approve
                              </button>
                            )}
                            {message.channel === "email" && message.status === "approved" && (
                              <button
                                onClick={() => handleSendEmail(message.id)}
                                disabled={sendingEmailId === message.id}
                                className="btn btn-primary btn-sm"
                                title="Dispatches this approved email through the configured provider and records the attempt."
                              >
                                {sendingEmailId === message.id
                                  ? "Sending…"
                                  : messageSends.some((s) => s.status === "failed")
                                    ? "Retry send"
                                    : "Send email"}
                              </button>
                            )}
                            {(message.status === "drafted" || message.status === "approved") && (
                              <button
                                onClick={() => handleOutreachAction(message.id, "mark-sent")}
                                disabled={busy}
                                className="btn btn-secondary btn-sm"
                                title={
                                  message.channel === "email"
                                    ? "Records that this went out by hand, without dispatching it from the app."
                                    : undefined
                                }
                              >
                                Mark sent
                              </button>
                            )}
                            {(message.status === "sent" || message.status === "follow_up_due") && (
                              <button
                                onClick={() => handleOutreachAction(message.id, "mark-replied")}
                                disabled={busy}
                                className="btn btn-secondary btn-sm"
                              >
                                Mark replied
                              </button>
                            )}
                            {message.status !== "closed" && (
                              <button
                                onClick={() => handleOutreachAction(message.id, "close")}
                                disabled={busy}
                                className="btn btn-secondary btn-sm"
                              >
                                Close
                              </button>
                            )}
                          </div>
                          {messageSends.length > 0 && (
                            <ul className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
                              {messageSends.map((send) => (
                                <li key={send.id} className="flex flex-wrap items-baseline gap-x-2">
                                  <span
                                    className={
                                      send.status === "sent"
                                        ? "font-medium text-emerald-800 dark:text-emerald-300"
                                        : "font-medium text-danger"
                                    }
                                  >
                                    {send.status === "sent" ? "Sent" : "Failed"}
                                  </span>
                                  <span className="text-fg-muted">
                                    {new Date(send.created_at).toLocaleString()} · to {send.to_email}
                                    {send.sent_by_user_name ? ` · by ${send.sent_by_user_name}` : ""}
                                  </span>
                                  {send.error_message && (
                                    <span className="w-full text-danger">{send.error_message}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </Disclosure>
        </div>
      )}

      {/* History — meetings, stage changes, activity */}
      <div className="mt-4">
        <Disclosure title="History" hint="Meetings, pipeline stage changes, and the full activity log">
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">Meetings</h3>
              <Link href="/dashboard/calendar" className="text-xs text-fg-muted hover:underline">
                Schedule on calendar →
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-border border border-border">
              {meetings && meetings.length === 0 && (
                <li>
                  <EmptyRow>No meetings scheduled yet.</EmptyRow>
                </li>
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
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">Pipeline stage history</h3>
              <Link href="/dashboard/leads?view=board" className="text-xs text-fg-muted hover:underline">
                View pipeline board →
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-border border border-border">
              {pipelineEvents && pipelineEvents.length === 0 && (
                <li>
                  <EmptyRow>
                    No stage changes yet — this lead has been {LEAD_STATUS_LABEL[lead.status].toLowerCase()} since it
                    was created.
                  </EmptyRow>
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

          <section className="mt-8">
            <h3 className="text-sm font-semibold text-fg">Activity history</h3>
            <ul className="mt-3 divide-y divide-border border border-border">
              {activity && activity.length === 0 && (
                <li>
                  <EmptyRow>No activity yet.</EmptyRow>
                </li>
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
        </Disclosure>
      </div>
    </div>
  );
}
