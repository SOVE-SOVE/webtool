// Client for the public, unauthenticated preview surface
// (apps/api's modules/previews + modules/website_feedback). Deliberately
// separate from lib/api.ts: a preview link is opened by a client with no
// session cookie at all, so this never sends credentials and never
// touches the authenticated API surface.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// A hung backend or dead network otherwise leaves this pending
// indefinitely — worse here than the authenticated dashboard, since the
// viewer is an external client with no way to know anything is wrong.
const REQUEST_TIMEOUT_MS = 20_000;

export class PreviewApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new PreviewApiError(0, "The request timed out — check your connection and try again.");
    }
    throw new PreviewApiError(0, "Couldn't reach the server — check your connection and try again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : res.statusText;
    throw new PreviewApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export type PreviewAudience = "client" | "internal";

export type PreviewSection = {
  id: string;
  type: string;
  config: Record<string, unknown>;
};

export type PreviewPage = {
  slug: string;
  name: string;
  sections: PreviewSection[];
};

export type PreviewVersionSummary = {
  id: string;
  label: string;
  approved: boolean;
  client_approved: boolean;
  generated_at: string;
};

export type PublicPreview = {
  project_name: string;
  audience: PreviewAudience;
  website_id: string;
  approved: boolean;
  client_approved: boolean;
  navigation: PreviewSection;
  footer: PreviewSection;
  pages: PreviewPage[];
  versions: PreviewVersionSummary[];
};

export const FEEDBACK_TYPES = ["comment", "change_request", "approval", "rejection", "general"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export type FeedbackCreate = {
  feedback_type: FeedbackType;
  message: string;
  page_slug?: string | null;
  section_id?: string | null;
  client_name?: string;
  client_email?: string;
};

export type Feedback = {
  id: string;
  feedback_type: FeedbackType;
  message: string;
  page_slug: string | null;
  section_id: string | null;
  client_name: string | null;
  status: string;
  created_at: string;
};

export const previewApi = {
  get: (token: string, websiteId?: string) =>
    request<PublicPreview>(`/api/v1/preview/${token}${websiteId ? `/versions/${websiteId}` : ""}`),
  submitFeedback: (token: string, websiteId: string, data: FeedbackCreate) =>
    request<Feedback>(`/api/v1/preview/${token}/websites/${websiteId}/feedback`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
