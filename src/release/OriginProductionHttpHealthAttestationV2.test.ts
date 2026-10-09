import { describe, expect, it, vi } from "vitest";
import { ORIGIN_PRODUCTION_DOMAINS, verifyOriginProductionHealth } from "../../scripts/verify-origin-production-health.mjs";

const oldSha = "a".repeat(40);
const newSha = "b".repeat(40);
const expected = () => Object.fromEntries(ORIGIN_PRODUCTION_DOMAINS.map((name, index) =>
  [name, index === 0 ? oldSha : newSha]));
const env = (mapping = expected()) => ({
  ORIGIN_EXPECTED_HEALTH_SHA_MAP_JSON: JSON.stringify(mapping),
});
const healthy = (sha: string) => ({
  status: "ok", releaseSha: sha, freeOnly: true,
  paidFallbackEnabled: false, costUsd: 0, secretDelivery: "server-only",
});
function fakeApi(options: {
  driftDomain?: string; patch?: Record<string, unknown>;
  statusCode?: number; mime?: string; raw?: string;
} = {}) {
  return vi.fn(async (url: string, init: {method: string; redirect: string; headers: {accept: string}}) => {
    expect(init).toMatchObject({
      method: "GET", redirect: "error", headers: { accept: "application/json" },
    });
    const host = String(url).replace(/^https:\/\//, "").replace(/\/api\/health$/, "");
    expect(ORIGIN_PRODUCTION_DOMAINS).toContain(host);
    const content = options.raw ?? JSON.stringify({
      ...healthy(options.driftDomain === host ? oldSha : expected()[host]),
      ...options.patch,
    });
    return new Response(content, {
      status: options.statusCode ?? 200,
      headers: { "content-type": options.mime ?? "application/json" },
    });
  });
}

describe("read-only ORIGIN Production 3-domain live health attestation", () => {
  it("checks all fixed domains against independently captured per-domain SHAs", async () => {
    const spy = fakeApi();
    const result = await verifyOriginProductionHealth(env(), spy);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.checked.map((x) => x.domain)).toEqual(ORIGIN_PRODUCTION_DOMAINS);
    expect(result.firstMainPushNegativePathVerified).toBe(false);
    expect(result.productionPromotionAuthorized).toBe(false);
  });

  it("fails if one secondary domain serves an unexpected different SHA", async () => {
    await expect(verifyOriginProductionHealth(env(), fakeApi({
      driftDomain: ORIGIN_PRODUCTION_DOMAINS[1],
    }))).rejects.toThrow("ORIGIN_HEALTH_SHA_MISMATCH");
  });

  it.each([
    ["bad-status", { status: "error" }],
    ["missing-sha", { releaseSha: null }],
    ["paid-fallback", { paidFallbackEnabled: true }],
    ["not-free", { freeOnly: false }],
    ["positive-cost", { costUsd: 1 }],
    ["unsafe-secrets", { secretDelivery: "browser" }],
  ])("refuses unsafe live response %s", async (_label, patch) => {
    await expect(verifyOriginProductionHealth(env(), fakeApi({ patch }))).rejects.toThrow();
  });

  it.each([
    ["http-503", { statusCode: 503 }],
    ["bad-mime", { mime: "text/plain" }],
    ["invalid-json", { raw: "{invalid" }],
    ["array", { raw: "[]" }],
    ["too-large", { raw: JSON.stringify({ payload: "x".repeat(5000) }) }],
  ])("rejects malformed HTTP %s", async (_label, options) => {
    await expect(verifyOriginProductionHealth(env(), fakeApi(options))).rejects.toThrow();
  });

  it.each([
    ["absent", undefined],
    ["malformed", "{bad"],
    ["empty-map", "{}"],
    ["extra-host", JSON.stringify({ ...expected(), "malicious.example.net": oldSha })],
    ["bad-sha", JSON.stringify({ ...expected(), [ORIGIN_PRODUCTION_DOMAINS[1]]: "not-a-sha" })],
    ["too-long", "x".repeat(2100)],
  ])("rejects unapproved snapshot %s before network requests", async (_label, snapshot) => {
    const spy = vi.fn();
    await expect(verifyOriginProductionHealth(
      { ORIGIN_EXPECTED_HEALTH_SHA_MAP_JSON: snapshot }, spy,
    )).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
