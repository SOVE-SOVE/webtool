"use client";

import { QA_CATEGORIES, type QaCheck, type QaReport } from "@/lib/api";

const CATEGORY_LABELS: Record<(typeof QA_CATEGORIES)[number], string> = {
  performance: "Performance",
  responsiveness: "Responsiveness",
  accessibility: "Accessibility",
  seo: "SEO",
  functionality: "Functionality",
  security: "Security",
};

const STATUS_CLASSES: Record<QaCheck["status"], string> = {
  pass: "bg-emerald-100 text-emerald-800",
  fail: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-800",
  skipped: "bg-surface-subtle text-fg-muted",
};

const SEVERITY_CLASSES: Record<QaCheck["severity"], string> = {
  critical: "bg-red-600 text-white",
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-surface-subtle text-fg-muted",
  info: "bg-surface-subtle text-fg-muted",
};

function CheckRow({ check }: { check: QaCheck }) {
  return (
    <li className="flex items-start gap-2 py-2 text-sm">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[check.status]}`}>{check.status}</span>
      {check.status === "fail" && (
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[check.severity]}`}>{check.severity}</span>
      )}
      <div>
        <p className="font-medium text-fg">{check.name}</p>
        <p className="text-fg-muted">{check.message}</p>
        {check.recommended_fix && <p className="mt-0.5 text-xs text-fg-muted">Fix: {check.recommended_fix}</p>}
        {check.location && <p className="text-xs text-fg-subtle">{check.location}</p>}
      </div>
    </li>
  );
}

export function QaReportView({ report }: { report: QaReport }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            report.passed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
          }`}
        >
          {report.passed ? "Ready for client review" : "Not ready for client review — critical issues found"}
        </span>
        <span className="text-xs text-fg-muted">
          {report.passed_count} passed · {report.failed_count} failed · {report.warning_count} warnings · {report.skipped_count} skipped
        </span>
      </div>
      <p className="mt-1 text-xs text-fg-subtle">
        {new Date(report.created_at).toLocaleString()}
        {report.generated_by_user_name ? ` · ${report.generated_by_user_name}` : ""}
        {report.preview_url ? ` · checked against ${report.preview_url}` : " · static check only (no live preview yet)"}
      </p>

      <div className="mt-4 space-y-4">
        {QA_CATEGORIES.map((category) => {
          const checks = report.checks.filter((c) => c.category === category);
          if (checks.length === 0) return null;
          return (
            <div key={category}>
              <h4 className="text-sm font-semibold text-fg">{CATEGORY_LABELS[category]}</h4>
              <ul className="divide-y divide-border border-t border-border">
                {checks.map((check, i) => (
                  <CheckRow key={i} check={check} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
