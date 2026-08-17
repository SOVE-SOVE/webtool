import type { SalesAuditReport } from "@/lib/api";

function section(title: string, content: React.ReactNode) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      <div className="mt-1 text-sm text-neutral-800">{content}</div>
    </div>
  );
}

function bulletList(items: string[]) {
  if (items.length === 0) return <p className="text-neutral-400">—</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function SalesAuditReportView({ report }: { report: SalesAuditReport }) {
  return (
    <div>
      {report.flagged_for_review && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Flagged for review — evidence was limited when this report was generated.
          {report.review_notes && <p className="mt-1">{report.review_notes}</p>}
        </div>
      )}
      {section("Business summary", <p>{report.business_summary}</p>)}
      {section("Website strengths", bulletList(report.website_strengths))}
      {section("Top problems", bulletList(report.top_problems))}
      {section("Why each problem matters", bulletList(report.why_problems_matter))}
      {section("Recommended improvements", bulletList(report.recommended_improvements))}
      {section("Suggested website structure", bulletList(report.suggested_structure))}
      {section("Talking points", bulletList(report.talking_points))}
      {section("Potential objections", bulletList(report.potential_objections))}
      {section("Suggested offer", <p>{report.suggested_offer}</p>)}
      {report.sources_note && (
        <p className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-500">
          Sources: {report.sources_note}
        </p>
      )}
    </div>
  );
}
