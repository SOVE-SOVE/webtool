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
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  abn: string | null;
  created_at: string;
  updated_at: string;
};

export const LEAD_STAGES = [
  "prospect",
  "research",
  "website_audit",
  "lead_score",
  "sales_preparation",
  "outreach",
  "follow_up",
  "meeting",
  "won",
  "lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export type Lead = {
  id: string;
  business_id: string;
  business_name: string;
  industry: string | null;
  suburb: string | null;
  state: string | null;
  stage: LeadStage;
  score: number | null;
  source: string | null;
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
  assigned_user_id?: string;
};

// assigned_user_id: null unassigns, omitted leaves assignment untouched.
export type LeadUpdate = { stage?: LeadStage; score?: number; assigned_user_id?: string | null };

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
  | { from_lead_id: string; billing_email?: string; won_price_cents?: number }
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

export type ClientUpdate = { assigned_user_id: string | null };

export const PROJECT_STAGES = [
  "intake",
  "project",
  "research",
  "design_brief",
  "sitemap",
  "copy",
  "website",
  "qa",
  "my_approval",
  "client_approval",
  "deployment",
  "maintenance",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export type Project = {
  id: string;
  client_id: string;
  client_business_name: string;
  name: string;
  stage: ProjectStage;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectCreate = { client_id: string; name: string; assigned_user_id?: string };
// assigned_user_id: null unassigns, omitted leaves assignment untouched.
export type ProjectUpdate = { stage?: ProjectStage; assigned_user_id?: string | null };

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

export type AttentionItem = {
  kind: "task" | "stale_lead";
  id: string;
  title: string;
  detail: string;
  href: string;
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

  listLeads: () => request<Lead[]>("/api/v1/leads"),
  createLead: (data: LeadCreate) =>
    request<Lead>("/api/v1/leads", { method: "POST", body: JSON.stringify(data) }),
  updateLead: (id: string, data: LeadUpdate) =>
    request<Lead>(`/api/v1/leads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  listClients: () => request<Client[]>("/api/v1/clients"),
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

  listUsers: () => request<User[]>("/api/v1/users"),
  createUser: (data: UserCreate) =>
    request<User>("/api/v1/users", { method: "POST", body: JSON.stringify(data) }),
  updateUserRole: (id: string, data: UserUpdate) =>
    request<User>(`/api/v1/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getWorkspace: () => request<Workspace>("/api/v1/workspace"),
  updateWorkspace: (name: string) =>
    request<Workspace>("/api/v1/workspace", { method: "PATCH", body: JSON.stringify({ name }) }),

  listActivity: () => request<ActivityItem[]>("/api/v1/activity"),
};
