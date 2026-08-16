import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves with the parsed body on a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ email: "operator@example.com" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.me();

    expect(result).toEqual({ email: "operator@example.com" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/auth/me"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("throws an ApiError carrying the status and server-provided detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid credentials" }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.login("a@example.com", "wrong")).rejects.toMatchObject(
      new ApiError(401, "Invalid credentials"),
    );
  });

  it("falls back to the status text when the error body isn't JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 500, statusText: "Server Error" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.me()).rejects.toMatchObject(new ApiError(500, "Server Error"));
  });

  it("flattens FastAPI's list-of-objects validation error body into a readable message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [{ type: "value_error", loc: ["body", "email"], msg: "value is not a valid email address" }],
        }),
        { status: 422 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.login("", "x")).rejects.toMatchObject(
      new ApiError(422, "value is not a valid email address"),
    );
  });

  describe("request wiring for each resource", () => {
    function stubOk(body: unknown) {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("createLead posts to /api/v1/leads with the given body", async () => {
      const fetchMock = stubOk({ id: "1" });
      await api.createLead({ business_name: "Riverside Plumbing" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/leads"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ business_name: "Riverside Plumbing" }),
        }),
      );
    });

    it("updateLead patches /api/v1/leads/:id", async () => {
      const fetchMock = stubOk({ id: "1" });
      await api.updateLead("abc", { stage: "won" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/leads/abc"),
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ stage: "won" }) }),
      );
    });

    it("createClient posts to /api/v1/clients", async () => {
      const fetchMock = stubOk({ id: "1" });
      await api.createClient({ business_name: "Coastal Cafe" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/clients"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("updateProject patches /api/v1/projects/:id", async () => {
      const fetchMock = stubOk({ id: "1" });
      await api.updateProject("xyz", { stage: "maintenance" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/xyz"),
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    it("updateTask patches /api/v1/tasks/:id", async () => {
      const fetchMock = stubOk({ id: "1" });
      await api.updateTask("t1", { done: true });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/tasks/t1"),
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ done: true }) }),
      );
    });

    it("dashboardOverview gets /api/v1/dashboard/overview", async () => {
      const fetchMock = stubOk({ total_leads: 0 });
      await api.dashboardOverview();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/dashboard/overview"),
        expect.anything(),
      );
    });
  });
});
