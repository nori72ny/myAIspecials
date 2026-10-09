import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTECTED_ORIGIN_ALIASES } from "../../scripts/verify-vercel-release-hold.mjs";
import { verifyOriginProductionHealth } from "../../scripts/verify-origin-production-health.mjs";

const SHA = "a".repeat(40);
const valid = () => ({
  status: "ok",
  releaseSha: SHA,
  costUsd: 0,
  freeOnly: true,
  paidFallbackEnabled: false,
  secretDelivery: "server-only",
});
function provider(value = valid(), options: { code?: number; type?: string; raw?: string } = {}) {
  return vi.fn(async (input, init) => {
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.headers.accept).toBe("application/json");
    expect(PROTECTED_ORIGIN_ALIASES.map((name) => "https://" + name + "/api/health")).toContain(input);
    return new Response(options.raw ?? JSON.stringify(value), {
      status: options.code ?? 200, headers: { "content-type": options.type ?? "application/json" },
    });
  });
}
afterEach(() => vi.restoreAllMocks());

describe("Production HTTP health verification: all 3 protected aliases, read-only and fail-closed", () => {
  it("checks every domain, validates exact live SHA, and never approves production", async () => {
    const get = provider();
    const result = await verifyOriginProductionHealth({ ORIGIN_EXPECTED_PRODUCTION_SHA: SHA }, get);
    expect(get).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      productionLiveHealthVerified: true, sha: SHA,
      firstMainPushNegativePathVerified: false,
      productionPromotionAuthorized: false,
    });
    expect(result.results.map((x) => x.hostname)).toEqual(PROTECTED_ORIGIN_ALIASES);
  });
  it.each([
    ["different commit", { releaseSha: "b".repeat(40) }],
    ["missing commit", { releaseSha: undefined }],
    ["paid fallback", { paidFallbackEnabled: true }],
    ["not free only", { freeOnly: false }],
    ["cost > 0", { costUsd: 0.01 }],
    ["exposed secrets", { secretDelivery: "browser" }],
    ["degraded", { status: "error" }],
  ])("rejects %s", async (_description, changes) => {
    const get = provider({ ...valid(), ...changes });
    await expect(verifyOriginProductionHealth({ ORIGIN_EXPECTED_PRODUCTION_SHA: SHA }, get)).rejects.toThrow();
  });
  it.each([
    ["service unavailable", provider(valid(), { code: 503 })],
    ["not json", provider(valid(), { type: "text/plain" })],
    ["malformed json", provider(valid(), { raw: "{bad" })],
    ["not object", provider(valid(), { raw: "[]" })],
    ["oversized response", provider(valid(), { raw: JSON.stringify({ large: "x".repeat(5000) }) })],
  ])("rejects %s", async (_description, get) => {
    await expect(verifyOriginProductionHealth({ ORIGIN_EXPECTED_PRODUCTION_SHA: SHA }, get)).rejects.toThrow();
  });
  it.each([undefined, "", "abc", "B".repeat(40)])("rejects missing or untrusted SHA %s before HTTP", async (sha) => {
    const get = vi.fn();
    await expect(verifyOriginProductionHealth({ ORIGIN_EXPECTED_PRODUCTION_SHA: sha }, get)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});
