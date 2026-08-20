"use client";

import type { ProjectApprovalStatus } from "@/lib/api";

export function ApprovalPipelineView({ status }: { status: ProjectApprovalStatus }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Approval pipeline</h2>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            status.can_deploy ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {status.can_deploy ? "Ready to deploy" : "Not ready to deploy"}
        </span>
      </div>

      <ol className="mt-3 flex flex-wrap gap-2">
        {status.checkpoints.map((checkpoint, i) => (
          <li
            key={checkpoint.stage}
            title={checkpoint.approved ? checkpoint.notes ?? undefined : checkpoint.blocked_reason ?? undefined}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
              checkpoint.approved ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-neutral-50 text-neutral-500"
            }`}
          >
            <span aria-hidden="true">{checkpoint.approved ? "✓" : i + 1}</span>
            <span className="font-medium">{checkpoint.label}</span>
          </li>
        ))}
      </ol>

      {!status.can_deploy && status.missing_for_deployment.length > 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          Still needed before deployment: {status.missing_for_deployment.join(", ")}.
        </p>
      )}
    </div>
  );
}
