import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves with the parsed body on a successful response", async () => {
    const me = {
      id: "u1",
      name: "Ada Admin",
      email: "admin@example.com",
      role: "admin",
      workspace_id: "w1",
      workspace_name: "Acme Web Design",
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(me), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.me();

    expect(result).toEqual(me);
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
      await api.updateLead("abc", { status: "won" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/leads/abc"),
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "won" }) }),
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

    it("generateCreativeDirection posts to /api/v1/projects/:id/creative-directions with an empty body by default", async () => {
      const fetchMock = stubOk({ id: "cd1" });
      await api.generateCreativeDirection("p1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/p1/creative-directions"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
      );
    });

    it("generateCreativeDirection sends operator-supplied context when given", async () => {
      const fetchMock = stubOk({ id: "cd1" });
      await api.generateCreativeDirection("p1", { target_audience: "Homeowners", business_goals: "More calls" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/p1/creative-directions"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ target_audience: "Homeowners", business_goals: "More calls" }),
        }),
      );
    });

    it("startIntake posts to /api/v1/clients/:id/intake with the given body", async () => {
      const fetchMock = stubOk({ id: "b1", project_id: "p1" });
      await api.startIntake("c1", { business_name: "Coastal Cafe" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/clients/c1/intake"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ business_name: "Coastal Cafe" }),
        }),
      );
    });

    it("startIntake sends force_new when starting an additional project", async () => {
      const fetchMock = stubOk({ id: "b1", project_id: "p2" });
      await api.startIntake("c1", { force_new: true, project_name: "Coastal Cafe Rebrand" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/clients/c1/intake"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ force_new: true, project_name: "Coastal Cafe Rebrand" }),
        }),
      );
    });

    it("listCreativeDirections gets /api/v1/projects/:id/creative-directions", async () => {
      const fetchMock = stubOk([]);
      await api.listCreativeDirections("p1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/p1/creative-directions"),
        expect.anything(),
      );
    });

    it("getBrief gets /api/v1/projects/:id/brief", async () => {
      const fetchMock = stubOk({ id: "b1" });
      await api.getBrief("p1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/p1/brief"),
        expect.anything(),
      );
    });

    it("updateCreativeDirection patches /api/v1/creative-directions/:id", async () => {
      const fetchMock = stubOk({ id: "cd1" });
      await api.updateCreativeDirection("cd1", { creative_concept: "Revised concept" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/creative-directions/cd1"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ creative_concept: "Revised concept" }),
        }),
      );
    });

    it("updateBrief patches /api/v1/projects/:id/brief", async () => {
      const fetchMock = stubOk({ id: "b1" });
      await api.updateBrief("p1", { business_name: "Coastal Cafe" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/p1/brief"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ business_name: "Coastal Cafe" }),
        }),
      );
    });

    it("approveCreativeDirection posts to /api/v1/creative-directions/:id/approve", async () => {
      const fetchMock = stubOk({ id: "cd1", status: "approved" });
      await api.approveCreativeDirection("cd1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/creative-directions/cd1/approve"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("getProject gets /api/v1/projects/:id", async () => {
      const fetchMock = stubOk({ id: "p1" });
      await api.getProject("p1");

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/projects/p1"), expect.anything());
    });

    it("approveBrief posts to /api/v1/projects/:id/brief/approve", async () => {
      const fetchMock = stubOk({ id: "b1", status: "approved" });
      await api.approveBrief("p1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/p1/brief/approve"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("generateSitemap posts to /api/v1/projects/:id/sitemaps with an empty body by default", async () => {
      const fetchMock = stubOk({ id: "s1" });
      await api.generateSitemap("p1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/p1/sitemaps"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
      );
    });

    it("generateSitemap sends the chosen creative direction and notes when given", async () => {
      const fetchMock = stubOk({ id: "s1" });
      await api.generateSitemap("p1", { creative_direction_id: "cd1", additional_notes: "Keep it small" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/p1/sitemaps"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ creative_direction_id: "cd1", additional_notes: "Keep it small" }),
        }),
      );
    });

    it("listSitemaps gets /api/v1/projects/:id/sitemaps", async () => {
      const fetchMock = stubOk([]);
      await api.listSitemaps("p1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/projects/p1/sitemaps"),
        expect.anything(),
      );
    });

    it("approveSitemap posts to /api/v1/sitemaps/:id/approve", async () => {
      const fetchMock = stubOk({ id: "s1", status: "approved" });
      await api.approveSitemap("s1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/sitemaps/s1/approve"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("addSitemapPage posts to /api/v1/sitemaps/:id/pages with the given page", async () => {
      const fetchMock = stubOk({ id: "s1" });
      await api.addSitemapPage("s1", { title: "FAQ", slug: "faq" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/sitemaps/s1/pages"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ title: "FAQ", slug: "faq" }),
        }),
      );
    });

    it("updateSitemapPage patches /api/v1/sitemaps/:id/pages/:pageId", async () => {
      const fetchMock = stubOk({ id: "s1" });
      await api.updateSitemapPage("s1", "pg1", { title: "Updated" });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/sitemaps/s1/pages/pg1"),
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "Updated" }) }),
      );
    });

    it("deleteSitemapPage deletes /api/v1/sitemaps/:id/pages/:pageId", async () => {
      const fetchMock = stubOk({ id: "s1" });
      await api.deleteSitemapPage("s1", "pg1");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/sitemaps/s1/pages/pg1"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("reorderSitemapPages patches /api/v1/sitemaps/:id/pages/reorder with the given items", async () => {
      const fetchMock = stubOk({ id: "s1" });
      await api.reorderSitemapPages("s1", [{ id: "pg1", order_index: 1 }]);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/sitemaps/s1/pages/reorder"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ items: [{ id: "pg1", order_index: 1 }] }),
        }),
      );
    });
  });
});
