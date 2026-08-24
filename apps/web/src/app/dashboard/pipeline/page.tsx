"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Lead, type LeadPriority, type LeadStatus, type PipelineStage } from "@/lib/api";
import { STALE_DAYS, countStale, daysSince, groupLeadsByStatus, isStale, orderStages } from "@/lib/pipeline";

const PRIORITY_STYLE: Record<LeadPriority, string> = {
  low: "bg-neutral-100 text-neutral-600",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-red-100 text-red-700",
};

export default function PipelinePage() {
  const [stages, setStages] = useState<PipelineStage[] | null>(null);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  function load() {
    api.listPipelineStages().then(setStages).catch(() => setError("Couldn't load pipeline stages."));
    api.listLeads().then(setLeads).catch(() => setError("Couldn't load leads."));
  }

  useEffect(load, []);

  const orderedStages = useMemo(() => (stages ? orderStages(stages) : null), [stages]);
  const leadsByStatus = useMemo(() => groupLeadsByStatus(leads ?? []), [leads]);
  const staleCount = useMemo(() => countStale(leads ?? [], stages ?? []), [leads, stages]);

  async function moveLead(leadId: string, newStatus: LeadStatus) {
    const lead = (leads ?? []).find((l) => l.id === leadId);
    if (!lead || lead.status === newStatus) return;
    setMovingLeadId(leadId);
    setError(null);
    try {
      await api.updateLead(leadId, { status: newStatus });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't move that lead.");
    } finally {
      setMovingLeadId(null);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Pipeline</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Every active lead by stage. Drag a card to move it, or use a lead&apos;s detail page.
          </p>
        </div>
        {staleCount > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            {staleCount} need{staleCount === 1 ? "s" : ""} attention — no movement in {STALE_DAYS}+ days
          </span>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {orderedStages && leads && (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-4">
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
                  if (leadId) moveLead(leadId, stage.key);
                }}
                className={`flex w-64 shrink-0 flex-col rounded-md border ${
                  isDragOver ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"
                }`}
              >
                <div
                  className={`flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                    stage.is_won
                      ? "text-emerald-700"
                      : stage.is_lost
                        ? "text-red-700"
                        : "text-neutral-600"
                  }`}
                >
                  <span>{stage.label}</span>
                  <span className="text-neutral-400">{stageLeads.length}</span>
                </div>

                <div className="flex-1 space-y-2 p-2">
                  {stageLeads.length === 0 && (
                    <p className="px-1 py-2 text-center text-xs text-neutral-400">No leads</p>
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
                        className={`cursor-grab rounded-md border bg-white p-2.5 text-sm shadow-sm active:cursor-grabbing ${
                          stale ? "border-amber-300" : "border-neutral-200"
                        } ${movingLeadId === lead.id ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            href={`/dashboard/leads/${lead.id}`}
                            className="font-medium text-neutral-900 hover:underline"
                          >
                            {lead.business_name}
                          </Link>
                          {lead.score !== null && (
                            <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700">
                              {lead.score}
                            </span>
                          )}
                        </div>
                        {lead.industry && <p className="mt-0.5 text-xs text-neutral-500">{lead.industry}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_STYLE[lead.priority]}`}
                          >
                            {lead.priority}
                          </span>
                          {lead.assigned_user_name && (
                            <span className="text-[11px] text-neutral-500">{lead.assigned_user_name}</span>
                          )}
                          {stale && (
                            <span className="ml-auto text-[11px] font-medium text-amber-700">
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
      )}
    </div>
  );
}
