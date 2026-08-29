"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Lead, LeadPriority, LeadStatus, PipelineStage } from "@/lib/api";
import { daysSince, groupLeadsByStatus, isStale, orderStages } from "@/lib/pipeline";

/**
 * The stage board for leads — columns come from the workspace's
 * `PipelineStageConfig` (one per `LeadStatus`), drag a card to change a
 * lead's status. Extracted from the old standalone /dashboard/pipeline
 * page so the Leads page can show it as a "Board" view; the pipeline
 * route now redirects here.
 */

const PRIORITY_STYLE: Record<LeadPriority, string> = {
  low: "bg-surface-subtle text-fg-muted",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  high: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

export function LeadsBoard({
  leads,
  stages,
  onMove,
}: {
  leads: Lead[];
  stages: PipelineStage[];
  onMove: (leadId: string, status: LeadStatus) => void | Promise<void>;
}) {
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  const orderedStages = useMemo(() => orderStages(stages), [stages]);
  const leadsByStatus = useMemo(() => groupLeadsByStatus(leads), [leads]);

  async function handleMove(leadId: string, status: LeadStatus) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === status) return;
    setMovingLeadId(leadId);
    try {
      await onMove(leadId, status);
    } finally {
      setMovingLeadId(null);
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {orderedStages.map((stage) => {
        const stageLeads = leadsByStatus.get(stage.key) ?? [];
        const isDragOver = dragOverStageId === stage.id;
        return (
          <div
            key={stage.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStageId(stage.id);
            }}
            onDragLeave={() => setDragOverStageId((cur) => (cur === stage.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverStageId(null);
              const leadId = e.dataTransfer.getData("text/lead-id");
              if (leadId) handleMove(leadId, stage.key);
            }}
            className={`flex w-64 shrink-0 flex-col rounded-md border ${
              isDragOver ? "border-fg bg-surface-subtle" : "border-border"
            }`}
          >
            <div
              className={`flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                stage.is_won
                  ? "text-emerald-700 dark:text-emerald-400"
                  : stage.is_lost
                    ? "text-red-700 dark:text-red-400"
                    : "text-fg-muted"
              }`}
            >
              <span>{stage.label}</span>
              <span className="text-fg-subtle">{stageLeads.length}</span>
            </div>

            <div className="flex-1 space-y-2 p-2">
              {stageLeads.length === 0 && (
                <p className="px-1 py-2 text-center text-xs text-fg-subtle">No leads</p>
              )}
              {stageLeads.map((lead) => {
                const stale = isStale(lead, stage);
                return (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/lead-id", lead.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className={`cursor-grab rounded-md border bg-surface p-2.5 text-sm shadow-sm active:cursor-grabbing ${
                      stale ? "border-amber-300" : "border-border"
                    } ${movingLeadId === lead.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/dashboard/leads/${lead.id}`}
                        className="font-medium text-fg hover:underline"
                      >
                        {lead.business_name}
                      </Link>
                      {lead.score !== null && (
                        <span className="shrink-0 rounded-full bg-surface-subtle px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
                          {lead.score}
                        </span>
                      )}
                    </div>
                    {lead.industry && <p className="mt-0.5 text-xs text-fg-muted">{lead.industry}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_STYLE[lead.priority]}`}
                      >
                        {lead.priority}
                      </span>
                      {lead.assigned_user_name && (
                        <span className="text-[11px] text-fg-muted">{lead.assigned_user_name}</span>
                      )}
                      {stale && (
                        <span className="ml-auto text-[11px] font-medium text-amber-700 dark:text-amber-400">
                          {daysSince(lead.updated_at)}d idle
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
