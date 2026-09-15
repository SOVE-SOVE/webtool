"use client";

import { useEffect, useState } from "react";
import { api, type HostingPlan, type WebsiteAgreement } from "@/lib/api";
import { RecordPaymentModal } from "./RecordPaymentModal";

/**
 * The Revenue page's primary "Record Payment" action — unlike every
 * other RecordPaymentModal call site, this one has no project in
 * context yet, so it adds one small step in front: pick the Client,
 * then the Project, then hand off to the exact same existing modal
 * (same agreement/hosting-plan fetch, same submit call) rather than a
 * second payment-entry implementation.
 */
export function RecordPaymentLauncher({
  currency,
  onClose,
  onSaved,
}: {
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clients, setClients] = useState<{ id: string; business_name: string }[] | null>(null);
  const [projects, setProjects] = useState<{ id: string; client_id: string | null; name: string }[] | null>(null);
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [agreement, setAgreement] = useState<WebsiteAgreement | null>(null);
  const [hostingPlans, setHostingPlans] = useState<HostingPlan[]>([]);
  const [loadedForProjectId, setLoadedForProjectId] = useState<string | null>(null);

  useEffect(() => {
    api.listClients().then(setClients).catch(() => setClients([]));
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    Promise.all([api.getAgreement(projectId).catch(() => null), api.listHostingPlans(projectId).catch(() => [])]).then(
      ([a, hp]) => {
        if (!alive) return;
        setAgreement(a);
        setHostingPlans(hp);
        setLoadedForProjectId(projectId);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  if (projectId && loadedForProjectId === projectId) {
    return (
      <RecordPaymentModal
        projectId={projectId}
        agreement={agreement}
        hostingPlans={hostingPlans}
        currency={currency}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  const clientProjects = (projects ?? []).filter((p) => p.client_id === clientId);
  const loading = clients === null || projects === null;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-panel max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-payment-launcher-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="record-payment-launcher-title" className="section-title">
          Record a payment
        </h2>
        <p className="mt-1 text-xs text-fg-subtle">Choose which client and project this payment is for.</p>

        {loading ? (
          <p className="mt-4 text-sm text-fg-muted">Loading…</p>
        ) : (
          <>
            <label className="field-label mt-4">Client</label>
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setProjectId("");
              }}
              className="input mt-1.5"
            >
              <option value="">Select a client…</option>
              {clients!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.business_name}
                </option>
              ))}
            </select>

            {clientId &&
              (clientProjects.length > 0 ? (
                <>
                  <label className="field-label mt-3">Project</label>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input mt-1.5">
                    <option value="">Select a project…</option>
                    {clientProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="mt-3 text-xs text-fg-subtle">This client has no projects yet.</p>
              ))}

            {projectId && loadedForProjectId !== projectId && (
              <p className="mt-3 text-xs text-fg-subtle">Loading billing details…</p>
            )}
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
