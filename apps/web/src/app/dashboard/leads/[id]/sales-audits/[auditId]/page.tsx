"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type SalesAuditReport } from "@/lib/api";
import { SalesAuditReportView } from "@/components/SalesAuditReportView";

export default function SalesAuditDetailPage() {
  const params = useParams<{ id: string; auditId: string }>();
  const leadId = params.id;
  const auditId = params.auditId;

  const [report, setReport] = useState<SalesAuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSalesAudit(auditId)
      .then(setReport)
      .catch(() => setError("Couldn't load this sales audit."));
  }, [auditId]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!report) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl p-6 print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/dashboard/leads/${leadId}`} className="text-sm text-neutral-500 hover:underline">
          ← Back to lead
        </Link>
        <button
          onClick={() => window.print()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Print
        </button>
      </div>

      <h1 className="mt-4 text-lg font-semibold text-neutral-900">Sales audit</h1>
      <p className="text-sm text-neutral-500">
        Generated {new Date(report.generated_at).toLocaleString()}
        {report.generated_by_user_name ? ` by ${report.generated_by_user_name}` : ""}
      </p>

      <div className="mt-6">
        <SalesAuditReportView report={report} />
      </div>
    </div>
  );
}
