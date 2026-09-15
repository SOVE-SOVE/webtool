"use client";

import { useEffect, useState } from "react";
import { api, type HostingPlan, type NextPaymentObligation, type NextPaymentSummary, type WebsiteAgreement } from "@/lib/api";
import { ClientBillingSection } from "@/components/billing/ClientBillingSection";
import { NextPaymentPanel } from "@/components/billing/NextPaymentPanel";
import { RecordPaymentModal } from "@/components/billing/RecordPaymentModal";

export function BillingTab({ clientId, currency }: { clientId: string; currency: string }) {
  const [summary, setSummary] = useState<NextPaymentSummary | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    obligation: NextPaymentObligation;
    agreement: WebsiteAgreement | null;
    hostingPlans: HostingPlan[];
  } | null>(null);
  // Bumped after a payment recorded through this panel's own modal, so
  // ClientBillingSection (which owns its own independent fetch) reloads too
  // — a mutation here wouldn't otherwise reach its state.
  const [billingRefreshToken, setBillingRefreshToken] = useState(0);

  function load() {
    api.getNextPaymentSummary(clientId).then(setSummary).catch(() => setSummary(null));
  }

  useEffect(load, [clientId]);

  async function handleRecordPayment(obligation: NextPaymentObligation) {
    const [agreement, hostingPlans] = await Promise.all([
      api.getAgreement(obligation.project_id).catch(() => null),
      api.listHostingPlans(obligation.project_id).catch(() => []),
    ]);
    setPaymentModal({ obligation, agreement, hostingPlans });
  }

  return (
    <div>
      {summary && (
        <NextPaymentPanel summary={summary} currency={currency} onReload={load} onRecordPayment={handleRecordPayment} />
      )}
      <ClientBillingSection clientId={clientId} currency={currency} onChanged={load} refreshToken={billingRefreshToken} />

      {paymentModal && (
        <RecordPaymentModal
          projectId={paymentModal.obligation.project_id}
          agreement={paymentModal.agreement}
          hostingPlans={paymentModal.hostingPlans}
          currency={currency}
          initialAllocation={
            paymentModal.obligation.website_agreement_id
              ? { type: "agreement", id: paymentModal.obligation.website_agreement_id }
              : paymentModal.obligation.hosting_charge_id
                ? { type: "hosting_charge", id: paymentModal.obligation.hosting_charge_id }
                : undefined
          }
          initialAmountCents={paymentModal.obligation.amount_cents}
          onClose={() => setPaymentModal(null)}
          onSaved={() => {
            setPaymentModal(null);
            load();
            setBillingRefreshToken((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
