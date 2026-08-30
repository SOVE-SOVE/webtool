/**
 * The website build checklist — DERIVED from real backend state, never
 * a hard-coded completion list. Every item maps to something the API
 * actually reports: an approval checkpoint, a generated page, a QA
 * check, a deployment. If the data for a stage doesn't exist yet, the
 * stage is "todo" — it's never shown as done on a guess.
 *
 * Pure + unit-tested (same pattern as lib/projects.ts).
 */

import type {
  Deployment,
  ProjectApprovalStatus,
  QaCheck,
  QaReport,
  Website,
  WebsitePage,
} from "@/lib/api";

export type ChecklistStatus = "done" | "active" | "todo";

export type ChecklistItem = {
  key: string;
  label: string;
  status: ChecklistStatus;
  /** One line explaining the current state — pulled from real data. */
  detail: string;
  /** Which workspace tab to jump to for this item. */
  tab: "content" | "qa" | "preview" | "approval" | "deployment";
};

function checkpointApproved(approvals: ProjectApprovalStatus | null, stage: string): boolean {
  return approvals?.checkpoints.find((c) => c.stage === stage)?.approved ?? false;
}

function checkpointBlockedReason(approvals: ProjectApprovalStatus | null, stage: string): string | null {
  return approvals?.checkpoints.find((c) => c.stage === stage)?.blocked_reason ?? null;
}

function pageOfType(website: Website | null, ...types: string[]): WebsitePage | undefined {
  return website?.pages.find((p) => types.includes(p.page_type));
}

function pageState(page: WebsitePage | undefined): { present: boolean; approved: boolean; sections: number } {
  if (!page) return { present: false, approved: false, sections: 0 };
  const sections = page.sections.length;
  return { present: true, approved: sections > 0 && page.sections.every((s) => s.approved), sections };
}

function qaByCategory(report: QaReport | null, category: string): QaCheck[] {
  return (report?.checks ?? []).filter((c) => c.category === category);
}

function qaCategoryPasses(report: QaReport | null, category: string): boolean {
  const checks = qaByCategory(report, category);
  return checks.length > 0 && checks.every((c) => c.status === "pass" || c.status === "skipped");
}

function qaCategoryIssues(report: QaReport | null, category: string): number {
  return qaByCategory(report, category).filter((c) => c.status === "fail" || c.status === "warning").length;
}

type Raw = Omit<ChecklistItem, "status"> & { done: boolean; blocked: string | null };

export function buildChecklist(input: {
  approvals: ProjectApprovalStatus | null;
  website: Website | null;
  qaReport: QaReport | null;
  deployments: Deployment[];
}): ChecklistItem[] {
  const { approvals, website, qaReport, deployments } = input;

  const successfulDeploy = deployments.find((d) => d.status === "success");
  const verifiedDeploy = deployments.find((d) => d.status === "success" && d.verified_at !== null);

  const home = pageState(pageOfType(website, "home"));
  const services = pageState(pageOfType(website, "services", "service_detail"));
  const about = pageState(pageOfType(website, "about"));
  const contact = pageState(pageOfType(website, "contact"));
  const everyPageHasTitle =
    !!website && website.pages.length > 0 && website.pages.every((p) => !!p.seo?.title);

  const raw: Raw[] = [
    {
      key: "discovery",
      label: "Discovery & brief",
      tab: "approval",
      done: checkpointApproved(approvals, "client_brief"),
      blocked: checkpointBlockedReason(approvals, "client_brief"),
      detail: checkpointApproved(approvals, "client_brief")
        ? "Client brief approved"
        : checkpointBlockedReason(approvals, "client_brief") ?? "Not started",
    },
    {
      key: "branding",
      label: "Branding & creative direction",
      tab: "approval",
      done: checkpointApproved(approvals, "creative_direction"),
      blocked: checkpointBlockedReason(approvals, "creative_direction"),
      detail: checkpointApproved(approvals, "creative_direction")
        ? "Creative direction approved"
        : checkpointBlockedReason(approvals, "creative_direction") ?? "Not started",
    },
    {
      key: "structure",
      label: "Content & structure",
      tab: "content",
      done: checkpointApproved(approvals, "sitemap"),
      blocked: checkpointBlockedReason(approvals, "sitemap"),
      detail: checkpointApproved(approvals, "sitemap")
        ? "Sitemap approved"
        : checkpointBlockedReason(approvals, "sitemap") ?? "Not started",
    },
    {
      key: "generated",
      label: "Website generated",
      tab: "content",
      done: website !== null,
      blocked: website ? null : "Generate the website from the approved sitemap",
      detail: website
        ? `${website.pages.length} page${website.pages.length === 1 ? "" : "s"} · quality ${website.anti_slop_score}/100`
        : "Not generated yet",
    },
    {
      key: "homepage",
      label: "Homepage",
      tab: "content",
      done: home.approved,
      blocked: home.present ? null : "No homepage in the sitemap",
      detail: home.present
        ? home.approved
          ? "All sections approved"
          : `${home.sections} section${home.sections === 1 ? "" : "s"} — not all approved`
        : "Not started",
    },
    {
      key: "services",
      label: "Services page",
      tab: "content",
      done: services.approved,
      blocked: services.present ? null : "No services page in the sitemap",
      detail: services.present
        ? services.approved
          ? "All sections approved"
          : `${services.sections} section${services.sections === 1 ? "" : "s"} — not all approved`
        : "Not started",
    },
    {
      key: "about",
      label: "About page",
      tab: "content",
      done: about.approved,
      blocked: about.present ? null : "No about page in the sitemap",
      detail: about.present
        ? about.approved
          ? "All sections approved"
          : `${about.sections} section${about.sections === 1 ? "" : "s"} — not all approved`
        : "Not started",
    },
    {
      key: "contact",
      label: "Contact page",
      tab: "content",
      done: contact.approved,
      blocked: contact.present ? null : "No contact page in the sitemap",
      detail: contact.present
        ? contact.approved
          ? "All sections approved"
          : `${contact.sections} section${contact.sections === 1 ? "" : "s"} — not all approved`
        : "Not started",
    },
    {
      key: "mobile",
      label: "Mobile optimisation",
      tab: "qa",
      done: qaCategoryPasses(qaReport, "responsiveness"),
      blocked: qaReport ? null : "Run a QA check",
      detail: qaReport
        ? qaCategoryPasses(qaReport, "responsiveness")
          ? "Responsiveness checks pass"
          : `${qaCategoryIssues(qaReport, "responsiveness")} responsiveness issue(s) to review`
        : "No QA run yet",
    },
    {
      key: "seo",
      label: "SEO",
      tab: "qa",
      done: qaCategoryPasses(qaReport, "seo") && everyPageHasTitle,
      blocked: qaReport ? null : "Run a QA check",
      detail: !website
        ? "No website yet"
        : !everyPageHasTitle
          ? "Some pages have no SEO title"
          : qaReport
            ? qaCategoryPasses(qaReport, "seo")
              ? "SEO checks pass"
              : `${qaCategoryIssues(qaReport, "seo")} SEO issue(s) to review`
            : "Page titles set — QA not run",
    },
    {
      key: "qa",
      label: "Technical QA sign-off",
      tab: "qa",
      done: checkpointApproved(approvals, "qa"),
      blocked: checkpointBlockedReason(approvals, "qa"),
      detail: checkpointApproved(approvals, "qa")
        ? "QA report signed off"
        : qaReport
          ? qaReport.passed
            ? "QA passed — awaiting sign-off"
            : `${qaReport.failed_count} critical issue(s) to fix`
          : "No QA run yet",
    },
    {
      key: "client_approval",
      label: "Client approval",
      tab: "approval",
      done: checkpointApproved(approvals, "client_review") || !!website?.client_approved,
      blocked: checkpointBlockedReason(approvals, "client_review"),
      detail: website?.client_approved
        ? `Approved${website.client_approved_by_user_name ? ` (recorded by ${website.client_approved_by_user_name})` : ""}`
        : checkpointBlockedReason(approvals, "client_review") ?? "Not recorded",
    },
    {
      key: "deployment",
      label: "Deployment",
      tab: "deployment",
      done: !!verifiedDeploy,
      blocked: checkpointBlockedReason(approvals, "deployment"),
      detail: verifiedDeploy
        ? `Live${verifiedDeploy.url ? ` at ${verifiedDeploy.url}` : ""}`
        : successfulDeploy
          ? "Deployed — not verified yet"
          : checkpointBlockedReason(approvals, "deployment") ?? "Not deployed",
    },
  ];

  // The first not-done item becomes "active" (what to do next); the
  // rest of the not-done items are plain "todo".
  let markedActive = false;
  return raw.map(({ done, blocked, ...rest }) => {
    let status: ChecklistStatus = done ? "done" : "todo";
    if (!done && !markedActive) {
      status = "active";
      markedActive = true;
    }
    void blocked;
    return { ...rest, status };
  });
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number; pct: number } {
  const done = items.filter((i) => i.status === "done").length;
  const total = items.length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}
