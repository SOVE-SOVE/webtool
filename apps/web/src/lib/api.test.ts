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
});
