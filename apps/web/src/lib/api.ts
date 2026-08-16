// Thin fetch wrapper around apps/api. Browser calls the API directly
// (no proxy/BFF layer) per docs/02_ARCHITECTURE.md §5 — every call sends
// credentials so the session cookie set by /auth/login is included.
//
// Types here are hand-written for now. Once the API surface grows past
// auth + businesses, generate these from the API's OpenAPI schema
// instead of maintaining them by hand — see docs/02_ARCHITECTURE.md §4.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type Me = { email: string };

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

export const api = {
  login: (email: string, password: string) =>
    request<Me>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<Me>("/api/v1/auth/me"),
  listBusinesses: () => request<Business[]>("/api/v1/businesses"),
};
