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

export type AttentionItem = {
  kind: "task" | "stale_lead";
  id: string;
  title: string;
  detail: string;
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

export const OUTREACH_CHANNELS = ["email", "phone", "in_person"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

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

export type DashboardOverview = {
  total_leads: number;
  qualified_leads: number;
  contacted_leads: number;
  meetings: number;
  won_projects: number;
  active_projects: number;
  revenue_cents: number;
  tasks_needing_attention: number;
  needs_attention: AttentionItem[];
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

  listClients: () => request<Client[]>("/api/v1/clients"),
  getClient: (id: string) => request<Client>(`/api/v1/clients/${id}`),
  createClient: (data: ClientCreate) =>
    request<Client>("/api/v1/clients", { method: "POST", body: JSON.stringify(data) }),
  updateClient: (id: string, data: ClientUpdate) =>
    request<Client>(`/api/v1/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  listProjects: () => request<Project[]>("/api/v1/projects"),
  createProject: (data: ProjectCreate) =>
    request<Project>("/api/v1/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: ProjectUpdate) =>
    request<Project>(`/api/v1/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  listTasks: () => request<Task[]>("/api/v1/tasks"),
  createTask: (data: TaskCreate) =>
    request<Task>("/api/v1/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: string, data: TaskUpdate) =>
    request<Task>(`/api/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  dashboardOverview: () => request<DashboardOverview>("/api/v1/dashboard/overview"),

  listMeetings: () => request<Meeting[]>("/api/v1/meetings"),
  getMeeting: (id: string) => request<Meeting>(`/api/v1/meetings/${id}`),
  createMeeting: (data: MeetingCreate) =>
    request<Meeting>("/api/v1/meetings", { method: "POST", body: JSON.stringify(data) }),
  updateMeeting: (id: string, data: MeetingUpdate) =>
    request<Meeting>(`/api/v1/meetings/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMeeting: (id: string) => request<void>(`/api/v1/meetings/${id}`, { method: "DELETE" }),
  generateMeetingBrief: (id: string) => request<Meeting>(`/api/v1/meetings/${id}/brief`, { method: "POST" }),

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

  generateOutreach: (leadId: string, channel: OutreachChannel) =>
    request<OutreachMessage>(`/api/v1/leads/${leadId}/outreach`, {
      method: "POST",
      body: JSON.stringify({ channel }),
    }),
  listOutreach: (leadId: string) => request<OutreachMessage[]>(`/api/v1/leads/${leadId}/outreach`),
  approveOutreach: (id: string) => request<OutreachMessage>(`/api/v1/outreach/${id}/approve`, { method: "POST" }),
  markOutreachSent: (id: string) => request<OutreachMessage>(`/api/v1/outreach/${id}/mark-sent`, { method: "POST" }),
  markOutreachReplied: (id: string) =>
    request<OutreachMessage>(`/api/v1/outreach/${id}/mark-replied`, { method: "POST" }),
  closeOutreach: (id: string) => request<OutreachMessage>(`/api/v1/outreach/${id}/close`, { method: "POST" }),

  generateFollowUp: (leadId: string) => request<FollowUp>(`/api/v1/leads/${leadId}/follow-ups`, { method: "POST" }),
  listFollowUps: () => request<FollowUpBuckets>("/api/v1/follow-ups"),
  resolveFollowUp: (id: string) => request<FollowUp>(`/api/v1/follow-ups/${id}/resolve`, { method: "POST" }),

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
};
