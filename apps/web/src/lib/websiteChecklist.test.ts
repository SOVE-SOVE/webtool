import { describe, expect, it } from "vitest";
import { buildChecklist, checklistProgress } from "./websiteChecklist";
import type { Deployment, ProjectApprovalStatus, QaReport, Website } from "./api";

function approvals(approvedStages: string[]): ProjectApprovalStatus {
  const all = ["client_brief", "creative_direction", "sitemap", "generated_website", "qa", "client_review", "deployment"];
  return {
    project_id: "p1",
    can_deploy: false,
    missing_for_deployment: [],
    checkpoints: all.map((stage) => ({
      stage: stage as ProjectApprovalStatus["checkpoints"][number]["stage"],
      label: stage,
      approved: approvedStages.includes(stage),
      approved_by_user_name: null,
      approved_at: null,
      version_label: null,
      notes: null,
      blocked_reason: approvedStages.includes(stage) ? null : `${stage} not ready`,
    })),
  };
}

function website(over: Partial<Website> = {}): Website {
  return {
    id: "w1", project_id: "p1", status: "draft", workflow_status: "draft",
    navigation: { id: "n", type: "navigation", config: {}, approved: true },
    footer: { id: "f", type: "footer", config: {}, approved: true },
    pages: [],
    missing_information: [], anti_slop_score: 82, anti_slop_passed: true, anti_slop_issues: [],
    flagged_for_review: false, sources_note: null, generated_by_user_id: null, generated_by_user_name: null,
    generated_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z",
    approved: false, approved_by_user_name: null, approved_at: null, approval_notes: null,
    client_approved: false, client_approved_by_user_name: null, client_approved_at: null, client_approval_notes: null,
    ...over,
  };
}

function page(page_type: string, allApproved: boolean, title = "T") {
  return {
    sitemap_page_id: page_type, name: page_type, slug: page_type, page_type: page_type as never,
    seo: { title, meta_description: null },
    sections: [{ id: "s1", type: "hero", config: {}, approved: allApproved }],
  };
}

describe("buildChecklist", () => {
  it("everything is todo/active with no data, and the first item is active", () => {
    const items = buildChecklist({ approvals: null, website: null, qaReport: null, deployments: [] });
    expect(items).toHaveLength(13);
    expect(items[0].status).toBe("active");
    expect(items.slice(1).every((i) => i.status === "todo")).toBe(true);
    expect(checklistProgress(items).done).toBe(0);
  });

  it("marks stages done from real approval checkpoints", () => {
    const items = buildChecklist({
      approvals: approvals(["client_brief", "creative_direction"]),
      website: null, qaReport: null, deployments: [],
    });
    expect(items.find((i) => i.key === "discovery")?.status).toBe("done");
    expect(items.find((i) => i.key === "branding")?.status).toBe("done");
    // "content & structure" (sitemap) is the first not-done → active
    expect(items.find((i) => i.key === "structure")?.status).toBe("active");
  });

  it("marks page items done only when the page exists and every section is approved", () => {
    const w = website({ pages: [page("home", true), page("about", false)] });
    const items = buildChecklist({ approvals: approvals(["sitemap"]), website: w, qaReport: null, deployments: [] });
    expect(items.find((i) => i.key === "generated")?.status).toBe("done");
    expect(items.find((i) => i.key === "homepage")?.status).toBe("done");
    expect(items.find((i) => i.key === "about")?.status).not.toBe("done");
    expect(items.find((i) => i.key === "contact")?.status).not.toBe("done");
  });

  it("derives mobile/SEO from real QA check categories", () => {
    const qa: QaReport = {
      id: "q1", website_id: "w1", kind: "technical", passed: true, checks: [
        { category: "responsiveness", name: "viewport", status: "pass", severity: "info", message: "", recommended_fix: null, location: null },
        { category: "seo", name: "titles", status: "fail", severity: "high", message: "", recommended_fix: null, location: null },
      ],
      passed_count: 1, failed_count: 1, warning_count: 0, skipped_count: 0, preview_url: null,
      generated_by_user_id: null, generated_by_user_name: null, created_at: "2026-08-21T00:00:00Z",
      human_approved: false, approved_by_user_name: null, approved_at: null, approval_notes: null,
    };
    const w = website({ pages: [page("home", true)] });
    const items = buildChecklist({ approvals: approvals(["sitemap"]), website: w, qaReport: qa, deployments: [] });
    expect(items.find((i) => i.key === "mobile")?.status).toBe("done");
    expect(items.find((i) => i.key === "seo")?.status).not.toBe("done");
  });

  it("deployment is done only for a verified successful deploy", () => {
    const base = { approvals: approvals([]), website: website(), qaReport: null };
    const pending: Deployment[] = [{ id: "d1", website_id: "w1", environment: "production", target: "vercel", url: "https://x.com", provider_ref: null, status: "success", result: null, error_message: null, started_at: null, completed_at: null, deployed_at: null, verified_at: null, verified_by_user_name: null, rollback_of_deployment_id: null, approved_by_user_name: null, notes: null, created_at: "2026-08-25T00:00:00Z" }];
    expect(buildChecklist({ ...base, deployments: pending }).find((i) => i.key === "deployment")?.status).not.toBe("done");
    const verified = [{ ...pending[0], verified_at: "2026-08-26T00:00:00Z" }];
    expect(buildChecklist({ ...base, deployments: verified }).find((i) => i.key === "deployment")?.status).toBe("done");
  });
});
