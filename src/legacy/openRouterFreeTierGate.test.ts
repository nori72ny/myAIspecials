import { describe, expect, it, vi } from "vitest";
import { OPENROUTER_KEY_METADATA_URL, requiresOpenRouterFreeTierAttestation, verifyOpenRouterFreeTierAccount } from "./openRouterFreeTierGate.js";

describe("OpenRouter production free-tier account gate", () => {
  it("requires attestation in production environments", () => {
    expect(requiresOpenRouterFreeTierAttestation({ VERCEL_ENV: "production" })).toBe(true);
    expect(requiresOpenRouterFreeTierAttestation({ NODE_ENV: "production" })).toBe(true);
    expect(requiresOpenRouterFreeTierAttestation({ NODE_ENV: "test" })).toBe(false);
  });

  it("accepts only a non-management free-tier key and keeps the secret out of the URL", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(OPENROUTER_KEY_METADATA_URL);
      expect(String(input)).not.toContain("synthetic-secret");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer synthetic-secret");
      return new Response(JSON.stringify({ data: { is_free_tier: true, is_management_key: false } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    await expect(verifyOpenRouterFreeTierAccount("synthetic-secret", fetchMock as typeof fetch)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: { is_free_tier: false, is_management_key: false } },
    { data: { is_free_tier: true, is_management_key: true } },
    { data: {} },
  ])("fails closed for non-free or unverifiable key metadata", async (payload) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(verifyOpenRouterFreeTierAccount("synthetic-secret", fetchMock as typeof fetch)).resolves.toBe(false);
  });

  it("fails closed on metadata HTTP or parsing failures without retry", async () => {
    const fetchMock = vi.fn(async () => new Response("unavailable", { status: 503 }));
    await expect(verifyOpenRouterFreeTierAccount("synthetic-secret", fetchMock as typeof fetch)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
