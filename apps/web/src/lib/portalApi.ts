// Thin fetch wrapper for the client-facing portal API
// (/api/v1/portal/*). Deliberately a separate module from lib/api.ts,
// not a shared helper — the portal and the internal dashboard talk to
// completely different session namespaces (see
// apps/api/app/modules/portal/auth.py: a different cookie name, signed
// with a different itsdangerous salt, backed by a different table).
// Keeping the networking code itself separate too means there's no
// shared function whose behavior an internal-dashboard change could
// accidentally alter for the portal, or vice versa.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class PortalApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

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
    throw new PortalApiError(res.status, errorMessage(body.detail) ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type PortalMe = {
  id: string;
  client_id: string;
  business_name: string;
  name: string;
  email: string;
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

export type PortalProject = {
  id: string;
  name: string;
  stage: ProjectStage;
  stage_label: string;
  package: string | null;
  deadline: string | null;
  created_at: string;
  updated_at: string;
};

export const portalApi = {
  login: (email: string, password: string) =>
    request<PortalMe>("/api/v1/portal/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/api/v1/portal/auth/logout", { method: "POST" }),
  me: () => request<PortalMe>("/api/v1/portal/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/v1/portal/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  listProjects: () => request<PortalProject[]>("/api/v1/portal/projects"),
  getProject: (id: string) => request<PortalProject>(`/api/v1/portal/projects/${id}`),
};
