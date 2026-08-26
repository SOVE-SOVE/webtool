// Thin fetch wrapper around apps/api. Browser calls the API directly
// (no proxy/BFF layer) per docs/02_ARCHITECTURE.md §5 — every call sends
// credentials so the session cookie set by /auth/login is included.
//
// Types here are hand-written. The API surface has grown past "two
// endpoints" (see docs/05_DECISIONS.md's shared-types entry) — codegen
// from the OpenAPI schema is the right next infra step, not done here
// to keep this change scoped to the dashboard itself.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// FastAPI's `detail` is a plain string for HTTPException, but a list of
// {loc, msg, type} objects for Pydantic validation errors (422s) — flatten
// either shape into one readable string.
function errorMessage(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => (e && typeof e === "object" && "msg" in e ? String(e.msg) : String(e)))
      .join("; ");
  }
  return undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errorMessage(body.detail) ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type Role = "admin" | "member";

export type Me = {
  id: string;
  name: string;
  email: string;
  role: Role;
  workspace_id: string;
  workspace_name: string;
};

export type Workspace = { id: string; name: string; created_at: string };

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: string;
};

export type UserCreate = { name: string; email: string; password: string; role?: Role };
export type UserUpdate = { role: Role };

export type ActivityItem = {
  id: string;
  user_id: string | null;
  user_name: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string | null;
  created_at: string;
};

export type Business = {
  id: string;
  name: string;
  industry: string | null;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  social_links: string | null;
  notes: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  abn: string | null;
  created_at: string;
  updated_at: string;
};

export type BusinessUpdate = {
  name?: string;
  industry?: string;
  website_url?: string;
  phone?: string;
  email?: string;
  social_links?: string;
  notes?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  abn?: string;
};

export const LEAD_STATUSES = [
  "new",
  "researched",
  "qualified",
  "contacted",
  "replied",
  "meeting",
  "proposal",
  "won",
  "lost",
  "nurture",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_PRIORITIES = ["low", "medium", "high"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export type Lead = {
  id: string;
  business_id: string;
  business_name: string;
  industry: string | null;
  suburb: string | null;
  state: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  score: number | null;
  source: string | null;
  notes: string | null;
  archived_at: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadCreate = {
  business_name: string;
  industry?: string;
  website_url?: string;
  phone?: string;
  suburb?: string;
  state?: string;
  source?: string;
  priority?: LeadPriority;
  assigned_user_id?: string;
};

// assigned_user_id: null unassigns, omitted leaves assignment untouched.
export type LeadUpdate = {
  status?: LeadStatus;
  priority?: LeadPriority;
  score?: number;
  notes?: string;
  assigned_user_id?: string | null;
};

// Sales pipeline (Phase 3) — board display config over the existing
// `LeadStatus` values (not a separate set of stage keys, see
// docs/05_DECISIONS.md 2026-08-16) plus read access to the
// stage-transition history already recorded for every status change.
export type PipelineStage = {
  id: string;
  key: LeadStatus;
  label: string;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
};

export type PipelineStageUpdate = {
  label?: string;
  sort_order?: number;
};

export type PipelineEvent = {
  id: string;
  lead_id: string | null;
  kind: string;
  summary: string | null;
  created_at: string;
};

export type Client = {
  id: string;
  business_id: string;
  business_name: string;
  billing_email: string | null;
  contract_signed_at: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  project_count: number;
  created_at: string;
};

export type ClientCreate = (
  | {
      from_lead_id: string;
      billing_email?: string;
      // The agreed terms of the deal, captured on conversion — see
      // apps/api/app/modules/clients/schemas.py's ClientCreate. price
      // also records a won SalesOpportunity for the dashboard's
      // revenue metric; package/deadline land directly on the new
      // Project this creates.
      won_price_cents?: number;
      package?: string;
      deadline?: string;
      project_name?: string;
    }
  | {
      business_name: string;
      industry?: string;
      website_url?: string;
      phone?: string;
      suburb?: string;
      state?: string;
      billing_email?: string;
    }
) & { assigned_user_id?: string };

// Every field: omitting the key leaves it untouched, `null` clears it
// (or unassigns, for assigned_user_id).
export type ClientUpdate = {
  billing_email?: string | null;
  contract_signed_at?: string | null;
  assigned_user_id?: string | null;
};

export const PROJECT_STAGES = [
  "intake",
  "research",
  "brief",
  "design",
  "development",
  "qa",
  "client_review",
  "revisions",
  "ready_to_deploy",
  "deployed",
  "maintenance",
  "complete",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  intake: "Intake",
  research: "Research",
  brief: "Brief",
  design: "Design",
  development: "Development",
  qa: "QA",
  client_review: "Client review",
  revisions: "Revisions",
  ready_to_deploy: "Ready to deploy",
  deployed: "Deployed",
  maintenance: "Maintenance",
  complete: "Complete",
};

export type Project = {
  id: string;
  client_id: string;
  client_business_name: string;
  source_lead_id: string | null;
  name: string;
  stage: ProjectStage;
  package: string | null;
  price_cents: number | null;
  deadline: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectCreate = {
  client_id: string;
  name: string;
  assigned_user_id?: string;
  package?: string;
  price_cents?: number;
  deadline?: string;
};
// assigned_user_id: null unassigns, omitted leaves assignment untouched.
export type ProjectUpdate = {
  stage?: ProjectStage;
  assigned_user_id?: string | null;
  package?: string | null;
  price_cents?: number | null;
  deadline?: string | null;
};

export const BRIEF_STATUSES = ["draft", "approved"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

// Every field the client intake form collects, per docs/04_ROADMAP.md M4.
// All optional/nullable — an unanswered question stays missing rather
// than being guessed at (see BriefRead.missing_fields below).
export type BriefFields = {
  // Business
  business_name?: string;
  industry?: string;
  location?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  business_description?: string;
  services_products?: string;
  target_customers?: string;
  business_goals?: string;
  // Brand
  brand_name?: string;
  logo_notes?: string;
  brand_colours?: string;
  brand_fonts?: string;
  brand_guidelines?: string;
  visual_references?: string;
  existing_social_profiles?: string;
  // Content
  about_content?: string;
  services_content?: string;
  products_content?: string;
  content_contact_details?: string;
  testimonials?: string;
  faqs?: string;
  calls_to_action?: string;
  // Website
  required_pages?: string;
  required_functionality?: string;
  existing_website_url?: string;
  domain?: string;
  hosting?: string;
  integrations?: string;
  // Assets (reference/notes, not file uploads — see docs/02_ARCHITECTURE.md)
  logo_assets?: string;
  image_assets?: string;
  video_assets?: string;
  document_assets?: string;
  existing_copy_assets?: string;
};

export type BriefUpdate = BriefFields;
// force_new opts in to an additional project for a client who already
// has an unfinished one; without it the API returns the existing
// project's brief rather than creating a duplicate project.
export type BriefIntakeStart = BriefFields & { project_name?: string; force_new?: boolean };

export type BriefFieldValue = string | string[] | null;

export type BriefSection = {
  label: string;
  fields: Record<string, BriefFieldValue>;
  missing: string[];
};

export type Brief = {
  id: string;
  project_id: string;
  status: BriefStatus;
  approved_at: string | null;
  approved_by_user_name: string | null;
  business: BriefSection;
  brand: BriefSection;
  content: BriefSection;
  website: BriefSection;
  assets: BriefSection;
  missing_fields: string[];
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: string;
  title: string;
  done: boolean;
  due_at: string | null;
  project_id: string | null;
  lead_id: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  context: string;
  created_at: string;
};

export type TaskCreate = {
  title: string;
  due_at?: string;
  project_id?: string;
  lead_id?: string;
  assigned_user_id?: string;
};

// assigned_user_id: null unassigns, omitted leaves assignment untouched.
export type TaskUpdate = { done?: boolean; assigned_user_id?: string | null };

export const MEETING_TYPES = ["sales_call", "client_check_in", "other"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_STATUSES = ["scheduled", "held", "cancelled", "no_show"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export type MeetingBrief = {
  id: string;
  business_name: string;
  business_industry: string | null;
  business_location: string | null;
  business_website: string | null;
  website_strengths: string[];
  website_weaknesses: string[];
  website_opportunities: string[];
  lead_score: number | null;
  previous_interactions: string[];
  outreach_history: string[];
  objections: string[];
  questions_to_ask: string[];
  likely_requirements: string[];
  possible_package: string;
  suggested_pricing_range: string;
  flagged_for_review: boolean;
  review_notes: string | null;
  generated_at: string;
};

export type MeetingAttendee = {
  id: string;
  name: string | null;
  email: string;
  is_organizer: boolean;
  created_at: string;
};

export type MeetingAttendeeCreate = {
  email: string;
  name?: string;
  is_organizer?: boolean;
};

export const REMINDER_CHANNELS = ["in_app"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export type MeetingReminder = {
  id: string;
  remind_at: string;
  channel: ReminderChannel;
  note: string | null;
  acknowledged_at: string | null;
  created_at: string;
};

export type MeetingReminderCreate = {
  remind_at: string;
  channel?: ReminderChannel;
  note?: string;
};

// A reminder that's come due, with its meeting's context folded in — see
// GET /api/v1/meetings/reminders/due. There's no email/push delivery
// integration anywhere in this app: this list *is* the reminder.
export type DueReminder = {
  id: string;
  remind_at: string;
  channel: ReminderChannel;
  note: string | null;
  meeting_id: string;
  meeting_title: string;
  meeting_scheduled_at: string;
  meeting_context: string;
};

export type Meeting = {
  id: string;
  title: string;
  meeting_type: MeetingType;
  status: MeetingStatus;
  scheduled_at: string;
  duration_minutes: number;
  held_at: string | null;
  notes: string | null;
  outcome: string | null;
  project_id: string | null;
  lead_id: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  synced_to_calendar: boolean;
  context: string;
  created_at: string;
  brief: MeetingBrief | null;
  attendees: MeetingAttendee[];
  reminders: MeetingReminder[];
};

export type MeetingCreate = {
  title: string;
  meeting_type?: MeetingType;
  scheduled_at: string;
  duration_minutes?: number;
  project_id?: string;
  lead_id?: string;
  // Omitted defaults to the parent lead/project's assigned user.
  assigned_user_id?: string | null;
  notes?: string;
  attendees?: MeetingAttendeeCreate[];
  reminders?: MeetingReminderCreate[];
};

// assigned_user_id: null unassigns, omitted leaves assignment untouched.
export type MeetingUpdate = {
  title?: string;
  scheduled_at?: string;
  duration_minutes?: number;
  status?: MeetingStatus;
  held_at?: string | null;
  notes?: string | null;
  outcome?: string | null;
  assigned_user_id?: string | null;
};

export type CalendarConnection = {
  google_email: string | null;
  calendar_id: string;
  connected_at: string;
};

export type CalendarEvent = {
  kind: "meeting" | "task";
  id: string;
  title: string;
  at: string;
  detail: string;
  done: boolean | null;
  href: string;
};

// Server-ranked: the API returns these already ordered most-urgent
// first, so the Overview renders them in the order received rather than
// re-sorting client side.
export type AttentionItem = {
  kind: "task" | "stale_lead" | "follow_up" | "meeting" | "project" | "hot_lead" | "stale_proposal" | "new_lead";
  label: string;
  id: string;
  title: string;
  detail: string;
  action: string;
  href: string;
};

export type WebsiteAudit = {
  id: string;
  lead_id: string;
  has_existing_site: boolean;
  mobile_friendly: boolean | null;
  https: boolean | null;
  page_speed_score: number | null;
  load_time_ms: number | null;
  title: string | null;
  meta_description: string | null;
  viewport_meta_present: boolean | null;
  audit_error: string | null;
  notes: string | null;
  audited_at: string;
};

export type SalesAuditReport = {
  id: string;
  lead_id: string;
  website_audit: WebsiteAudit | null;
  business_summary: string;
  website_strengths: string[];
  top_problems: string[];
  why_problems_matter: string[];
  recommended_improvements: string[];
  suggested_structure: string[];
  talking_points: string[];
  potential_objections: string[];
  suggested_offer: string;
  sources_note: string | null;
  flagged_for_review: boolean;
  review_notes: string | null;
  model_used: string;
  generated_by_user_id: string | null;
  generated_by_user_name: string | null;
  generated_at: string;
};

export const CREATIVE_DIRECTION_STATUSES = ["draft", "approved"] as const;
export type CreativeDirectionStatus = (typeof CREATIVE_DIRECTION_STATUSES)[number];

export type CreativeDirectionBrief = {
  id: string;
  project_id: string;
  status: CreativeDirectionStatus;
  target_audience: string | null;
  business_goals: string | null;
  conversion_goal: string | null;
  facts: string[];
  assumptions: string[];
  creative_concept: string;
  visual_direction: string;
  brand_personality: string[];
  colour_direction: string;
  typography_direction: string;
  spacing_system: string;
  image_direction: string;
  component_style: string;
  layout_direction: string;
  ux_direction: string;
  tone_of_voice: string;
  visual_hierarchy: string;
  cta_strategy: string;
  things_to_avoid: string[];
  references_inspiration: string[];
  sources_note: string | null;
  flagged_for_review: boolean;
  review_notes: string | null;
  model_used: string;
  generated_by_user_id: string | null;
  generated_by_user_name: string | null;
  generated_at: string;
  edited_by_user_name: string | null;
  edited_at: string | null;
  approved_by_user_name: string | null;
  approved_at: string | null;
};

export type GenerateCreativeDirectionRequest = {
  target_audience?: string;
  business_goals?: string;
  conversion_goal?: string;
  additional_notes?: string;
};

export type CreativeDirectionUpdate = {
  facts?: string[];
  assumptions?: string[];
  creative_concept?: string;
  visual_direction?: string;
  brand_personality?: string[];
  colour_direction?: string;
  typography_direction?: string;
  spacing_system?: string;
  image_direction?: string;
  component_style?: string;
  layout_direction?: string;
  ux_direction?: string;
  tone_of_voice?: string;
  visual_hierarchy?: string;
  cta_strategy?: string;
  things_to_avoid?: string[];
  references_inspiration?: string[];
};

export const SITEMAP_STATUSES = ["draft", "approved"] as const;
export type SitemapStatus = (typeof SITEMAP_STATUSES)[number];

export const PAGE_TYPES = [
  "home",
  "about",
  "services",
  "service_detail",
  "products",
  "product_detail",
  "contact",
  "faq",
  "testimonials",
  "portfolio",
  "blog",
  "blog_post",
  "custom",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const NAV_PLACEMENTS = ["primary_nav", "footer_nav", "primary_and_footer", "not_in_nav"] as const;
export type NavPlacement = (typeof NAV_PLACEMENTS)[number];

export type SitemapPage = {
  id: string;
  sitemap_id: string;
  parent_page_id: string | null;
  title: string;
  slug: string;
  page_type: PageType;
  nav_placement: NavPlacement;
  order_index: number;
  purpose: string;
  primary_cta: string | null;
  secondary_cta: string | null;
  key_sections: string[];
  required_content: string[];
  required_functionality: string[];
  created_at: string;
  updated_at: string;
  children: SitemapPage[];
};

export type Sitemap = {
  id: string;
  project_id: string;
  status: SitemapStatus;
  overview: string | null;
  creative_direction_id: string | null;
  sources_note: string | null;
  flagged_for_review: boolean;
  review_notes: string | null;
  model_used: string | null;
  generated_by_user_id: string | null;
  generated_by_user_name: string | null;
  generated_at: string;
  approved_by_user_name: string | null;
  approved_at: string | null;
  updated_at: string;
  pages: SitemapPage[];
};

export type GenerateSitemapRequest = {
  creative_direction_id?: string;
  additional_notes?: string;
};

export type SitemapPageCreate = {
  title: string;
  slug: string;
  page_type?: PageType;
  parent_page_id?: string | null;
  nav_placement?: NavPlacement;
  purpose?: string;
  primary_cta?: string | null;
  secondary_cta?: string | null;
  key_sections?: string[];
  required_content?: string[];
  required_functionality?: string[];
  order_index?: number;
};

// Every field: omitting the key leaves it untouched, `null` on
// parent_page_id promotes the page to top-level.
export type SitemapPageUpdate = {
  title?: string;
  slug?: string;
  page_type?: PageType;
  parent_page_id?: string | null;
  nav_placement?: NavPlacement;
  purpose?: string;
  primary_cta?: string | null;
  secondary_cta?: string | null;
  key_sections?: string[];
  required_content?: string[];
  required_functionality?: string[];
};

export type SitemapPageOrderItem = {
  id: string;
  order_index: number;
  // Omit to leave the current parent untouched; null promotes to top-level.
  parent_page_id?: string | null;
};

export const WEBSITE_STATUSES = ["draft", "live"] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

export const QUALITY_ISSUE_SEVERITIES = ["high", "medium", "low"] as const;
export type QualityIssueSeverity = (typeof QUALITY_ISSUE_SEVERITIES)[number];

// Matches packages/site-templates' SiteSection shape — `config` is
// whatever that section type's fields are (heading, services, etc.),
// left as a plain object here since the dashboard doesn't render a
// live preview (see docs/05_DECISIONS.md), only structured content.
export type WebsiteSection = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  approved: boolean;
};

export type PageSeo = {
  title: string;
  meta_description: string | null;
};

export type WebsitePage = {
  sitemap_page_id: string;
  name: string;
  slug: string;
  page_type: PageType;
  seo: PageSeo;
  sections: WebsiteSection[];
};

export type QualityIssue = {
  category: string;
  rule: string;
  severity: QualityIssueSeverity;
  message: string;
  location: string | null;
};

export type Website = {
  id: string;
  project_id: string;
  status: WebsiteStatus;
  navigation: WebsiteSection;
  footer: WebsiteSection;
  pages: WebsitePage[];
  missing_information: string[];
  anti_slop_score: number;
  anti_slop_passed: boolean;
  anti_slop_issues: QualityIssue[];
  flagged_for_review: boolean;
  sources_note: string | null;
  generated_by_user_id: string | null;
  generated_by_user_name: string | null;
  generated_at: string;
  updated_at: string;

  approved: boolean;
  approved_by_user_name: string | null;
  approved_at: string | null;
  approval_notes: string | null;

  client_approved: boolean;
  client_approved_by_user_name: string | null;
  client_approved_at: string | null;
  client_approval_notes: string | null;
};

export type WebsiteSummary = {
  id: string;
  status: WebsiteStatus;
  anti_slop_score: number | null;
  flagged_for_review: boolean;
  generated_by_user_name: string | null;
  generated_at: string;
  approved: boolean;
  client_approved: boolean;
};

export type GenerateWebsiteRequest = {
  sitemap_id?: string;
  creative_direction_id?: string;
  force_regenerate_all?: boolean;
};

export type ApproveWebsiteRequest = {
  notes?: string;
};

export type SectionUpdate = {
  config?: Record<string, unknown>;
  approved?: boolean;
};

export const QA_CATEGORIES = ["performance", "responsiveness", "accessibility", "seo", "functionality", "security"] as const;
export type QaCategory = (typeof QA_CATEGORIES)[number];

export const QA_CHECK_STATUSES = ["pass", "fail", "warning", "skipped"] as const;
export type QaCheckStatus = (typeof QA_CHECK_STATUSES)[number];

export type QaCheck = {
  category: QaCategory;
  name: string;
  status: QaCheckStatus;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  recommended_fix: string | null;
  location: string | null;
};

export type QaReport = {
  id: string;
  website_id: string;
  kind: string;
  passed: boolean;
  checks: QaCheck[];
  passed_count: number;
  failed_count: number;
  warning_count: number;
  skipped_count: number;
  preview_url: string | null;
  generated_by_user_id: string | null;
  generated_by_user_name: string | null;
  created_at: string;

  human_approved: boolean;
  approved_by_user_name: string | null;
  approved_at: string | null;
  approval_notes: string | null;
};

export type ApproveQaReportRequest = {
  notes?: string;
};

export type QaReportSummary = {
  id: string;
  passed: boolean;
  human_approved: boolean;
  passed_count: number;
  failed_count: number;
  warning_count: number;
  skipped_count: number;
  generated_by_user_name: string | null;
  created_at: string;
};

export type GenerateQaReportRequest = {
  preview_url?: string;
};

export const APPROVAL_STAGES = [
  "client_brief",
  "creative_direction",
  "sitemap",
  "generated_website",
  "qa",
  "client_review",
  "deployment",
] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

export type ApprovalCheckpoint = {
  stage: ApprovalStage;
  label: string;
  approved: boolean;
  approved_by_user_name: string | null;
  approved_at: string | null;
  version_label: string | null;
  notes: string | null;
  blocked_reason: string | null;
};

export type ProjectApprovalStatus = {
  project_id: string;
  checkpoints: ApprovalCheckpoint[];
  can_deploy: boolean;
  missing_for_deployment: string[];
};

export const DEPLOYMENT_STATUSES = ["pending", "running", "success", "failed"] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export type Deployment = {
  id: string;
  website_id: string;
  environment: string;
  target: string;
  url: string | null;
  status: DeploymentStatus;
  result: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  deployed_at: string | null;
  rollback_of_deployment_id: string | null;
  approved_by_user_name: string | null;
  notes: string | null;
  created_at: string;
};

export type CreateDeploymentRequest = {
  environment?: string;
  notes?: string;
};

export type RollbackDeploymentRequest = {
  target_deployment_id: string;
  notes?: string;
};

// The three first-contact channels a qualified lead can be drafted for.
export const OUTREACH_CHANNELS = ["email", "phone", "in_person"] as const;
// "follow_up" is a fourth, drafted-message-only channel (see api docs on
// generateOutreach below) — not offered as a first-contact option, so it
// stays out of OUTREACH_CHANNELS, but a message can carry it.
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number] | "follow_up";

export const OUTREACH_STATUSES = [
  "drafted",
  "approved",
  "sent",
  "replied",
  "follow_up_due",
  "closed",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export type OutreachMessage = {
  id: string;
  lead_id: string;
  based_on_sales_audit_id: string | null;
  channel: OutreachChannel;
  status: OutreachStatus;
  subject: string | null;
  body: string | null;
  opening_line: string | null;
  key_points: string[];
  objection_handling: string[];
  suggested_close: string | null;
  model_used: string;
  flagged_for_review: boolean;
  review_notes: string | null;
  generated_by_user_id: string | null;
  generated_by_user_name: string | null;
  generated_at: string;
  approved_by_user_name: string | null;
  approved_at: string | null;
  sent_by_user_name: string | null;
  sent_at: string | null;
  replied_at: string | null;
  closed_by_user_name: string | null;
  closed_at: string | null;
};

export type OutreachMessageUpdate = {
  subject?: string;
  body?: string;
  opening_line?: string;
  key_points?: string[];
  objection_handling?: string[];
  suggested_close?: string;
};

export type PreviousOutreachSummary = {
  id: string;
  channel: OutreachChannel;
  status: OutreachStatus;
  generated_at: string;
  excerpt: string;
};

export const FOLLOW_UP_STATUSES = ["pending", "done"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export type FollowUp = {
  id: string;
  lead_id: string;
  business_name: string;
  channel: OutreachChannel;
  due_date: string;
  suggested_next_action: string;
  status: FollowUpStatus;
  previous_outreach: PreviousOutreachSummary | null;
  generated_by_user_name: string | null;
  generated_at: string;
  resolved_by_user_name: string | null;
  resolved_at: string | null;
};

export type FollowUpBuckets = {
  overdue: FollowUp[];
  due_today: FollowUp[];
  upcoming: FollowUp[];
};

// A lead the deterministic detector thinks has gone quiet with nothing
// scheduled — distinct from FollowUp, which is already on the calendar.
export type FollowUpCandidate = {
  lead_id: string;
  business_name: string;
  lead_status: LeadStatus;
  reason: string;
  suggested_channel: OutreachChannel;
  days_quiet: number;
};

export type DashboardOverview = {
  total_leads: number;
  qualified_leads: number;
  contacted_leads: number;
  upcoming_meetings: number;
  won_projects: number;
  active_projects: number;
  revenue_cents: number;
  tasks_needing_attention: number;
  follow_ups_due: number;
  needs_attention: AttentionItem[];
};

export const OPPORTUNITY_STATUSES = ["open", "won", "lost"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export type SalesOpportunity = {
  id: string;
  lead_id: string;
  business_name: string;
  tier: string | null;
  proposed_price_cents: number | null;
  status: OpportunityStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type SalesOpportunityCreate = {
  tier?: string;
  proposed_price_cents?: number;
};

// Sales Command Centre (Phase 3) — the sales-funnel-only counterpart to
// DashboardOverview above, which spans the whole business. See
// apps/api/app/modules/sales_dashboard/service.py for every field's
// exact definition.
export type SalesLeadSummary = {
  id: string;
  business_name: string;
  status: LeadStatus;
  priority: LeadPriority;
  score: number | null;
  updated_at: string;
  assigned_user_name: string | null;
};

export type SalesFollowUpDue = {
  lead_id: string;
  business_name: string;
  due_date: string;
  overdue: boolean;
  suggested_next_action: string;
};

export type SalesMeetingSummary = {
  id: string;
  lead_id: string;
  business_name: string;
  title: string;
  scheduled_at: string;
};

export type SalesProposalSummary = {
  lead_id: string;
  business_name: string;
  opportunity_id: string | null;
  tier: string | null;
  proposed_price_cents: number | null;
  since: string;
};

export type SalesDealSummary = {
  lead_id: string;
  business_name: string;
  proposed_price_cents: number | null;
  tier: string | null;
  closed_at: string | null;
};

export type SalesOutreachActivityItem = {
  id: string;
  lead_id: string;
  business_name: string;
  kind: "sent" | "replied";
  channel: OutreachChannel | null;
  occurred_at: string;
  summary: string | null;
};

export type SalesOutreachActivity = {
  sent_last_7_days: number;
  replied_last_7_days: number;
  reply_rate_pct: number | null;
  recent: SalesOutreachActivityItem[];
};

export type SalesDashboard = {
  new_leads_count: number;
  hot_leads_count: number;
  needs_follow_up_count: number;
  upcoming_meetings_count: number;
  proposals_count: number;
  won_deals_count: number;
  lost_deals_count: number;
  conversion_rate_pct: number | null;
  estimated_revenue_cents: number;
  actual_revenue_cents: number;
  new_leads: SalesLeadSummary[];
  hot_leads: SalesLeadSummary[];
  needs_follow_up: SalesFollowUpDue[];
  upcoming_meetings: SalesMeetingSummary[];
  proposals: SalesProposalSummary[];
  recent_won: SalesDealSummary[];
  recent_lost: SalesDealSummary[];
  outreach_activity: SalesOutreachActivity;
  do_this_next: AttentionItem[];
};

// Lead Intelligence (Phase 2) — top-of-funnel pipeline: a DiscoverySearch
// runs a provider adapter and produces DiscoveredBusiness rows, a
// reviewable list that is never auto-imported into `businesses`/`leads`.
// This pass only wires the read-side (list/get) — search creation and
// the provider adapters land in the business-discovery capability.
export const DISCOVERY_SEARCH_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type DiscoverySearchStatus = (typeof DISCOVERY_SEARCH_STATUSES)[number];

export const DISCOVERED_BUSINESS_STATUSES = [
  "new",
  "researched",
  "audited",
  "scored",
  "approved",
  "rejected",
  "archived",
  "imported",
] as const;
export type DiscoveredBusinessStatus = (typeof DISCOVERED_BUSINESS_STATUSES)[number];

export const OPPORTUNITY_SCORE_CATEGORIES = ["hot", "warm", "cold", "review"] as const;
export type OpportunityScoreCategory = (typeof OPPORTUNITY_SCORE_CATEGORIES)[number];

export type DiscoverySearchCreate = {
  query_label?: string;
  location?: string;
  industry?: string;
  business_type?: string;
  keywords?: string;
  min_score?: number;
  max_score?: number;
  has_website?: boolean;
  website_outdated?: boolean;
  provider?: string;
};

export type DiscoverySearch = {
  id: string;
  query_label: string | null;
  location: string | null;
  industry: string | null;
  business_type: string | null;
  keywords: string | null;
  min_score: number | null;
  max_score: number | null;
  has_website: boolean | null;
  website_outdated: boolean | null;
  provider: string;
  status: DiscoverySearchStatus;
  result_count: number;
  error_message: string | null;
  created_by_user_id: string | null;
  created_at: string;
  completed_at: string | null;
};

export type DiscoveredBusiness = {
  id: string;
  discovery_search_id: string;
  name: string;
  industry: string | null;
  business_type: string | null;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  social_links: string | null;
  source_provider: string;
  source_query: string | null;
  source_external_id: string | null;
  duplicate_of_business_id: string | null;
  duplicate_of_discovered_business_id: string | null;
  status: DiscoveredBusinessStatus;
  opportunity_score: number | null;
  score_category: OpportunityScoreCategory | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  imported_lead_id: string | null;
  discovered_at: string;
  updated_at: string;
};

// One row of the dedicated review interface (Phase 2 checkpoint) — the
// latest research/quality/score context folded in so an operator can
// decide approve/reject/archive/import without opening each business.
export type DiscoveredBusinessReviewItem = {
  id: string;
  name: string;
  industry: string | null;
  suburb: string | null;
  state: string | null;
  website_url: string | null;
  status: DiscoveredBusinessStatus;
  source_provider: string;
  discovered_at: string;
  imported_lead_id: string | null;
  reviewed_by_user_name: string | null;
  reviewed_at: string | null;
  researched_at: string | null;
  research_error: string | null;
  quality_summary: string | null;
  key_problems: string[];
  opportunity_score: number | null;
  score_category: OpportunityScoreCategory | null;
  confidence: number | null;
  recommended_sales_angle: string | null;
};

export type BulkApproveResult = {
  approved: DiscoveredBusiness[];
  not_found: string[];
};

export type BusinessResearchResult = {
  id: string;
  discovered_business_id: string;
  official_website_url: string | null;
  website_reachable: boolean | null;
  https: boolean | null;
  http_status: number | null;
  page_title: string | null;
  meta_description: string | null;
  mobile_viewport_present: boolean | null;
  contact_cta_present: boolean | null;
  load_time_ms: number | null;
  estimated_site_age: string | null;
  appears_template_or_placeholder: boolean | null;
  technical_issues: string[];
  social_presence: string[];
  confirmed_facts: string[];
  inferred_facts: string[];
  unavailable_fields: string[];
  research_error: string | null;
  researched_at: string;
};

export type QualityFindingSeverity = "low" | "medium" | "high" | "critical";

export type QualityFinding = {
  category: string;
  severity: QualityFindingSeverity;
  message: string;
  evidence: string;
  confidence: number;
};

export type WebsiteQualityAudit = {
  id: string;
  discovered_business_id: string;
  business_research_id: string | null;
  findings: QualityFinding[];
  summary: string | null;
  issue_count: number;
  critical_count: number;
  audited_at: string;
};

export type ScoreFactorDirection = "positive" | "negative";

export type ScoreFactor = {
  factor: string;
  points: number;
  direction: ScoreFactorDirection;
  explanation: string;
};

export type OpportunityScoreResult = {
  id: string;
  discovered_business_id: string;
  overall_score: number;
  category: OpportunityScoreCategory;
  confidence: number;
  positive_signals: string[];
  negative_signals: string[];
  factors: ScoreFactor[];
  recommendation_reason: string;
  scored_at: string;
};

export const api = {
  login: (email: string, password: string) =>
    request<Me>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<Me>("/api/v1/auth/me"),

  listBusinesses: () => request<Business[]>("/api/v1/businesses"),
  getBusiness: (id: string) => request<Business>(`/api/v1/businesses/${id}`),
  updateBusiness: (id: string, data: BusinessUpdate) =>
    request<Business>(`/api/v1/businesses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  listLeads: (opts?: { includeArchived?: boolean }) =>
    request<Lead[]>(`/api/v1/leads${opts?.includeArchived ? "?include_archived=true" : ""}`),
  getLead: (id: string) => request<Lead>(`/api/v1/leads/${id}`),
  createLead: (data: LeadCreate) =>
    request<Lead>("/api/v1/leads", { method: "POST", body: JSON.stringify(data) }),
  updateLead: (id: string, data: LeadUpdate) =>
    request<Lead>(`/api/v1/leads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  archiveLead: (id: string) => request<Lead>(`/api/v1/leads/${id}/archive`, { method: "POST" }),
  unarchiveLead: (id: string) => request<Lead>(`/api/v1/leads/${id}/unarchive`, { method: "POST" }),
  listLeadPipelineEvents: (id: string) => request<PipelineEvent[]>(`/api/v1/leads/${id}/pipeline-events`),

  listPipelineStages: () => request<PipelineStage[]>("/api/v1/pipeline/stages"),
  updatePipelineStage: (id: string, data: PipelineStageUpdate) =>
    request<PipelineStage>(`/api/v1/pipeline/stages/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  listClients: () => request<Client[]>("/api/v1/clients"),
  getClient: (id: string) => request<Client>(`/api/v1/clients/${id}`),
  createClient: (data: ClientCreate) =>
    request<Client>("/api/v1/clients", { method: "POST", body: JSON.stringify(data) }),
  updateClient: (id: string, data: ClientUpdate) =>
    request<Client>(`/api/v1/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  listProjects: () => request<Project[]>("/api/v1/projects"),
  getProject: (id: string) => request<Project>(`/api/v1/projects/${id}`),
  createProject: (data: ProjectCreate) =>
    request<Project>("/api/v1/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: ProjectUpdate) =>
    request<Project>(`/api/v1/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  startIntake: (clientId: string, data: BriefIntakeStart) =>
    request<Brief>(`/api/v1/clients/${clientId}/intake`, { method: "POST", body: JSON.stringify(data) }),
  getBrief: (projectId: string) => request<Brief>(`/api/v1/projects/${projectId}/brief`),
  updateBrief: (projectId: string, data: BriefUpdate) =>
    request<Brief>(`/api/v1/projects/${projectId}/brief`, { method: "PATCH", body: JSON.stringify(data) }),
  approveBrief: (projectId: string) =>
    request<Brief>(`/api/v1/projects/${projectId}/brief/approve`, { method: "POST" }),

  listTasks: () => request<Task[]>("/api/v1/tasks"),
  createTask: (data: TaskCreate) =>
    request<Task>("/api/v1/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: string, data: TaskUpdate) =>
    request<Task>(`/api/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  dashboardOverview: () => request<DashboardOverview>("/api/v1/dashboard/overview"),
  salesDashboard: () => request<SalesDashboard>("/api/v1/dashboard/sales"),

  listMeetings: (opts?: { leadId?: string; projectId?: string }) => {
    const params = new URLSearchParams();
    if (opts?.leadId) params.set("lead_id", opts.leadId);
    if (opts?.projectId) params.set("project_id", opts.projectId);
    const qs = params.toString();
    return request<Meeting[]>(`/api/v1/meetings${qs ? `?${qs}` : ""}`);
  },
  getMeeting: (id: string) => request<Meeting>(`/api/v1/meetings/${id}`),
  createMeeting: (data: MeetingCreate) =>
    request<Meeting>("/api/v1/meetings", { method: "POST", body: JSON.stringify(data) }),
  updateMeeting: (id: string, data: MeetingUpdate) =>
    request<Meeting>(`/api/v1/meetings/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMeeting: (id: string) => request<void>(`/api/v1/meetings/${id}`, { method: "DELETE" }),
  generateMeetingBrief: (id: string) => request<Meeting>(`/api/v1/meetings/${id}/brief`, { method: "POST" }),

  addMeetingAttendee: (meetingId: string, data: MeetingAttendeeCreate) =>
    request<Meeting>(`/api/v1/meetings/${meetingId}/attendees`, { method: "POST", body: JSON.stringify(data) }),
  removeMeetingAttendee: (meetingId: string, attendeeId: string) =>
    request<Meeting>(`/api/v1/meetings/${meetingId}/attendees/${attendeeId}`, { method: "DELETE" }),
  addMeetingReminder: (meetingId: string, data: MeetingReminderCreate) =>
    request<Meeting>(`/api/v1/meetings/${meetingId}/reminders`, { method: "POST", body: JSON.stringify(data) }),
  removeMeetingReminder: (meetingId: string, reminderId: string) =>
    request<Meeting>(`/api/v1/meetings/${meetingId}/reminders/${reminderId}`, { method: "DELETE" }),
  acknowledgeMeetingReminder: (meetingId: string, reminderId: string) =>
    request<Meeting>(`/api/v1/meetings/${meetingId}/reminders/${reminderId}/acknowledge`, { method: "POST" }),
  listDueReminders: () => request<DueReminder[]>("/api/v1/meetings/reminders/due"),

  listCalendarEvents: (start: string, end: string) =>
    request<CalendarEvent[]>(`/api/v1/calendar?start=${start}&end=${end}`),

  getGoogleCalendarStatus: () => request<CalendarConnection | null>("/api/v1/calendar/google/status"),
  // A real browser navigation (OAuth consent screen), not a fetch call.
  googleCalendarConnectUrl: () => `${API_URL}/api/v1/calendar/google/connect`,
  disconnectGoogleCalendar: () => request<void>("/api/v1/calendar/google/disconnect", { method: "POST" }),

  generateSalesAudit: (leadId: string) =>
    request<SalesAuditReport>(`/api/v1/leads/${leadId}/sales-audits`, { method: "POST" }),
  listSalesAudits: (leadId: string) =>
    request<SalesAuditReport[]>(`/api/v1/leads/${leadId}/sales-audits`),
  getSalesAudit: (id: string) => request<SalesAuditReport>(`/api/v1/sales-audits/${id}`),

  generateCreativeDirection: (projectId: string, data?: GenerateCreativeDirectionRequest) =>
    request<CreativeDirectionBrief>(`/api/v1/projects/${projectId}/creative-directions`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  listCreativeDirections: (projectId: string) =>
    request<CreativeDirectionBrief[]>(`/api/v1/projects/${projectId}/creative-directions`),
  getCreativeDirection: (id: string) => request<CreativeDirectionBrief>(`/api/v1/creative-directions/${id}`),
  updateCreativeDirection: (id: string, data: CreativeDirectionUpdate) =>
    request<CreativeDirectionBrief>(`/api/v1/creative-directions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  approveCreativeDirection: (id: string) =>
    request<CreativeDirectionBrief>(`/api/v1/creative-directions/${id}/approve`, { method: "POST" }),

  generateSitemap: (projectId: string, data?: GenerateSitemapRequest) =>
    request<Sitemap>(`/api/v1/projects/${projectId}/sitemaps`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  listSitemaps: (projectId: string) => request<Sitemap[]>(`/api/v1/projects/${projectId}/sitemaps`),
  getSitemap: (id: string) => request<Sitemap>(`/api/v1/sitemaps/${id}`),
  approveSitemap: (id: string) => request<Sitemap>(`/api/v1/sitemaps/${id}/approve`, { method: "POST" }),
  addSitemapPage: (sitemapId: string, data: SitemapPageCreate) =>
    request<Sitemap>(`/api/v1/sitemaps/${sitemapId}/pages`, { method: "POST", body: JSON.stringify(data) }),
  updateSitemapPage: (sitemapId: string, pageId: string, data: SitemapPageUpdate) =>
    request<Sitemap>(`/api/v1/sitemaps/${sitemapId}/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteSitemapPage: (sitemapId: string, pageId: string) =>
    request<Sitemap>(`/api/v1/sitemaps/${sitemapId}/pages/${pageId}`, { method: "DELETE" }),
  reorderSitemapPages: (sitemapId: string, items: SitemapPageOrderItem[]) =>
    request<Sitemap>(`/api/v1/sitemaps/${sitemapId}/pages/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ items }),
    }),

  generateWebsite: (projectId: string, data?: GenerateWebsiteRequest) =>
    request<Website>(`/api/v1/projects/${projectId}/websites`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  listWebsites: (projectId: string) => request<WebsiteSummary[]>(`/api/v1/projects/${projectId}/websites`),
  getWebsite: (id: string) => request<Website>(`/api/v1/websites/${id}`),
  regenerateWebsiteSection: (websiteId: string, sectionId: string) =>
    request<Website>(`/api/v1/websites/${websiteId}/sections/${sectionId}/regenerate`, { method: "POST" }),
  updateWebsiteSection: (websiteId: string, sectionId: string, data: SectionUpdate) =>
    request<Website>(`/api/v1/websites/${websiteId}/sections/${sectionId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  approveWebsite: (websiteId: string, data?: ApproveWebsiteRequest) =>
    request<Website>(`/api/v1/websites/${websiteId}/approve`, { method: "POST", body: JSON.stringify(data ?? {}) }),
  clientApproveWebsite: (websiteId: string, data?: ApproveWebsiteRequest) =>
    request<Website>(`/api/v1/websites/${websiteId}/client-approve`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),

  generateQaReport: (websiteId: string, data?: GenerateQaReportRequest) =>
    request<QaReport>(`/api/v1/websites/${websiteId}/qa-reports`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  listQaReports: (websiteId: string) => request<QaReportSummary[]>(`/api/v1/websites/${websiteId}/qa-reports`),
  getQaReport: (id: string) => request<QaReport>(`/api/v1/qa-reports/${id}`),
  approveQaReport: (id: string, data?: ApproveQaReportRequest) =>
    request<QaReport>(`/api/v1/qa-reports/${id}/approve`, { method: "POST", body: JSON.stringify(data ?? {}) }),

  getProjectApprovals: (projectId: string) => request<ProjectApprovalStatus>(`/api/v1/projects/${projectId}/approvals`),

  createDeployment: (projectId: string, data?: CreateDeploymentRequest) =>
    request<Deployment>(`/api/v1/projects/${projectId}/deployments`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  listDeployments: (projectId: string) => request<Deployment[]>(`/api/v1/projects/${projectId}/deployments`),
  getDeployment: (id: string) => request<Deployment>(`/api/v1/deployments/${id}`),
  executeDeployment: (id: string) => request<Deployment>(`/api/v1/deployments/${id}/execute`, { method: "POST" }),
  rollbackDeployment: (projectId: string, data: RollbackDeploymentRequest) =>
    request<Deployment>(`/api/v1/projects/${projectId}/deployments/rollback`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  generateOutreach: (leadId: string, channel: OutreachChannel) =>
    request<OutreachMessage>(`/api/v1/leads/${leadId}/outreach`, {
      method: "POST",
      body: JSON.stringify({ channel }),
    }),
  listOutreach: (leadId: string) => request<OutreachMessage[]>(`/api/v1/leads/${leadId}/outreach`),
  updateOutreach: (id: string, data: OutreachMessageUpdate) =>
    request<OutreachMessage>(`/api/v1/outreach/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  approveOutreach: (id: string) => request<OutreachMessage>(`/api/v1/outreach/${id}/approve`, { method: "POST" }),
  markOutreachSent: (id: string) => request<OutreachMessage>(`/api/v1/outreach/${id}/mark-sent`, { method: "POST" }),
  markOutreachReplied: (id: string) =>
    request<OutreachMessage>(`/api/v1/outreach/${id}/mark-replied`, { method: "POST" }),
  closeOutreach: (id: string) => request<OutreachMessage>(`/api/v1/outreach/${id}/close`, { method: "POST" }),

  generateFollowUp: (leadId: string) => request<FollowUp>(`/api/v1/leads/${leadId}/follow-ups`, { method: "POST" }),
  listFollowUps: () => request<FollowUpBuckets>("/api/v1/follow-ups"),
  listNeedsFollowUp: () => request<FollowUpCandidate[]>("/api/v1/follow-ups/needs-scheduling"),
  scheduleFollowUp: (leadId: string) =>
    request<FollowUp>(`/api/v1/leads/${leadId}/follow-ups/auto`, { method: "POST" }),
  resolveFollowUp: (id: string) => request<FollowUp>(`/api/v1/follow-ups/${id}/resolve`, { method: "POST" }),
  snoozeFollowUp: (id: string, days: number) =>
    request<FollowUp>(`/api/v1/follow-ups/${id}/snooze`, { method: "POST", body: JSON.stringify({ days }) }),

  createOpportunity: (leadId: string, data: SalesOpportunityCreate) =>
    request<SalesOpportunity>(`/api/v1/leads/${leadId}/opportunities`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listOpportunities: (leadId: string) => request<SalesOpportunity[]>(`/api/v1/leads/${leadId}/opportunities`),
  markOpportunityLost: (id: string) =>
    request<SalesOpportunity>(`/api/v1/opportunities/${id}/mark-lost`, { method: "POST" }),

  listUsers: () => request<User[]>("/api/v1/users"),
  createUser: (data: UserCreate) =>
    request<User>("/api/v1/users", { method: "POST", body: JSON.stringify(data) }),
  updateUserRole: (id: string, data: UserUpdate) =>
    request<User>(`/api/v1/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getWorkspace: () => request<Workspace>("/api/v1/workspace"),
  updateWorkspace: (name: string) =>
    request<Workspace>("/api/v1/workspace", { method: "PATCH", body: JSON.stringify({ name }) }),

  listActivity: (filter?: { entity_type: string; entity_id: string }) =>
    request<ActivityItem[]>(
      `/api/v1/activity${filter ? `?entity_type=${filter.entity_type}&entity_id=${filter.entity_id}` : ""}`,
    ),

  listDiscoverySearches: () => request<DiscoverySearch[]>("/api/v1/discovery-searches"),
  createDiscoverySearch: (data: DiscoverySearchCreate) =>
    request<DiscoverySearch>("/api/v1/discovery-searches", { method: "POST", body: JSON.stringify(data) }),
  getDiscoverySearch: (id: string) => request<DiscoverySearch>(`/api/v1/discovery-searches/${id}`),
  listDiscoveredBusinesses: (searchId: string) =>
    request<DiscoveredBusiness[]>(`/api/v1/discovery-searches/${searchId}/results`),
  getDiscoveredBusiness: (id: string) => request<DiscoveredBusiness>(`/api/v1/discovered-businesses/${id}`),
  listBusinessResearch: (discoveredBusinessId: string) =>
    request<BusinessResearchResult[]>(`/api/v1/discovered-businesses/${discoveredBusinessId}/research`),
  runBusinessResearch: (discoveredBusinessId: string) =>
    request<BusinessResearchResult>(`/api/v1/discovered-businesses/${discoveredBusinessId}/research`, {
      method: "POST",
    }),
  listQualityAudits: (discoveredBusinessId: string) =>
    request<WebsiteQualityAudit[]>(`/api/v1/discovered-businesses/${discoveredBusinessId}/quality-audits`),
  runQualityAudit: (discoveredBusinessId: string) =>
    request<WebsiteQualityAudit>(`/api/v1/discovered-businesses/${discoveredBusinessId}/quality-audits`, {
      method: "POST",
    }),
  listOpportunityScores: (discoveredBusinessId: string) =>
    request<OpportunityScoreResult[]>(`/api/v1/discovered-businesses/${discoveredBusinessId}/scores`),
  runOpportunityScore: (discoveredBusinessId: string) =>
    request<OpportunityScoreResult>(`/api/v1/discovered-businesses/${discoveredBusinessId}/scores`, {
      method: "POST",
    }),

  listReviewItems: (opts?: { includeArchived?: boolean }) =>
    request<DiscoveredBusinessReviewItem[]>(
      `/api/v1/discovered-businesses${opts?.includeArchived ? "?include_archived=true" : ""}`,
    ),
  approveDiscoveredBusiness: (id: string) =>
    request<DiscoveredBusiness>(`/api/v1/discovered-businesses/${id}/approve`, { method: "POST" }),
  rejectDiscoveredBusiness: (id: string, notes?: string) =>
    request<DiscoveredBusiness>(`/api/v1/discovered-businesses/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),
  archiveDiscoveredBusiness: (id: string) =>
    request<DiscoveredBusiness>(`/api/v1/discovered-businesses/${id}/archive`, { method: "POST" }),
  importDiscoveredBusiness: (id: string) =>
    request<DiscoveredBusiness>(`/api/v1/discovered-businesses/${id}/import`, { method: "POST" }),
  bulkApproveDiscoveredBusinesses: (businessIds: string[]) =>
    request<BulkApproveResult>("/api/v1/discovered-businesses/bulk-approve", {
      method: "POST",
      body: JSON.stringify({ business_ids: businessIds }),
    }),
};
