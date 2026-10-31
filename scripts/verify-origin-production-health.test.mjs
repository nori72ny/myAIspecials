import { describe, expect, it } from "vitest";
import { ORIGIN_PRODUCTION_DOMAINS, verifyOriginProductionHealth } from "./verify-origin-production-health.mjs";

const sha = "a".repeat(40);
const env = {
  ORIGIN_EXPECTED_HEALTH_SHA_MAP_JSON: JSON.stringify(
    Object.fromEntries(ORIGIN_PRODUCTION_DOMAINS.map((domain) => [domain, sha])),
  ),
};

function clientFor(health) {
  return async () => new Response(JSON.stringify(health), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("production health attestation cost contract", () => {
  it("accepts truthful FREE_ONLY health without an unverified costUsd claim", async () => {
    const result = await verifyOriginProductionHealth(env, clientFor({
      status: "ok",
      releaseSha: sha,
      freeOnly: true,
      paidFallbackEnabled: false,
      secretDelivery: "server-only",
    }));

    expect(result.status).toBe("production-health-verified");
    expect(result.checked).toHaveLength(3);
    expect(result.productionPromotionAuthorized).toBe(false);
  });

  it("rejects a health response that claims costUsd without request-level evidence", async () => {
    await expect(verifyOriginProductionHealth(env, clientFor({
      status: "ok",
      releaseSha: sha,
      freeOnly: true,
      paidFallbackEnabled: false,
      costUsd: 0,
      secretDelivery: "server-only",
    }))).rejects.toThrow("ORIGIN_HEALTH_MUST_NOT_CLAIM_UNVERIFIED_ZERO_COST");
  });
});
