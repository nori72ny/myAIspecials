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
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(init).toMatchObject({
      method: "GET", redirect: "error", cache: "no-store",
      headers: { accept: "application/json", "cache-control": "no-cache, no-store" },
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
    ["misleading-mime", { mime: "text/plain; note=application/json" }],
    ["invalid-json", { raw: "{invalid" }],
    ["array", { raw: "[]" }],
    ["too-large", { raw: JSON.stringify({ payload: "x".repeat(5000) }) }],
  ])("rejects malformed HTTP %s", async (_label, options) => {
    await expect(verifyOriginProductionHealth(env(), fakeApi(options))).rejects.toThrow();
  });

  it("cancels an oversized chunked response before reading its remainder", async () => {
    const cancelled = vi.fn();
    let pulls = 0;
    const client = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(4097));
      },
      cancel: cancelled,
    }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } }));
    await expect(verifyOriginProductionHealth(env(), client))
      .rejects.toThrow("ORIGIN_HEALTH_RESPONSE_OVERSIZED");
    expect(pulls).toBe(3);
    expect(cancelled).toHaveBeenCalledTimes(3);
  });

  it("accepts valid JSON at the byte limit, including split UTF-8 characters", async () => {
    const client = vi.fn(async (url: RequestInfo | URL) => {
      const host = new URL(String(url)).hostname;
      const json = JSON.stringify({ ...healthy(expected()[host]), note: "確認" });
      const bytes = new TextEncoder().encode(json + " ".repeat(4096 - Buffer.byteLength(json)));
      return new Response(new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }), { headers: { "content-type": "application/json; charset=utf-8" } });
    });
    expect((await verifyOriginProductionHealth(env(), client)).checked).toHaveLength(3);
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
