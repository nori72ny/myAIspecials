import assert from "node:assert/strict";
import { PROTECTED_ORIGIN_ALIASES } from "./verify-vercel-release-hold.mjs";

const EXPECTED_SHA = /^[a-f0-9]{40}$/;
const MAX_RESPONSE_BYTES = 4096;

/**
 * Read-only public production attestation. Do not pass untrusted hostnames:
 * the protected host inventory is code-reviewed in the release-hold module.
 * Checks live bytes through every alias, not merely Vercel's metadata.
 * This alone CANNOT approve a deployment or prove a first-main-push hold.
 */
export async function verifyOriginProductionHealth(env = process.env, client = fetch) {
  const sha = env.ORIGIN_EXPECTED_PRODUCTION_SHA;
  assert.equal(typeof sha, "string", "PRODUCTION_HEALTH_SHA_MISSING");
  assert.match(sha, EXPECTED_SHA, "PRODUCTION_HEALTH_SHA_INVALID");
  const results = await Promise.all(PROTECTED_ORIGIN_ALIASES.map(async (hostname) => {
    const url = "https://" + hostname + "/api/health";
    const response = await client(url, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    assert.equal(response.status, 200, "PRODUCTION_HEALTH_BAD_HTTP");
    assert.ok(response.headers.get("content-type")?.toLowerCase().includes("application/json"),
      "PRODUCTION_HEALTH_INVALID_CONTENT_TYPE");
    const raw = await response.text();
    assert.ok(raw.length > 0 && Buffer.byteLength(raw, "utf8") <= MAX_RESPONSE_BYTES,
      "PRODUCTION_HEALTH_OVERSIZED");
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw Error("PRODUCTION_HEALTH_INVALID_JSON"); }
    assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed),
      "PRODUCTION_HEALTH_INVALID_JSON");
    assert.equal(parsed.status, "ok", "PRODUCTION_HEALTH_NOT_OK");
    assert.equal(parsed.releaseSha, sha, "PRODUCTION_HEALTH_SHA_MISMATCH");
    assert.equal(parsed.costUsd, 0, "PRODUCTION_HEALTH_COST_NOT_ZERO");
    assert.equal(parsed.freeOnly, true, "PRODUCTION_HEALTH_NOT_FREE_ONLY");
    assert.equal(parsed.paidFallbackEnabled, false, "PRODUCTION_HEALTH_PAID_FALLBACK_ENABLED");
    assert.equal(parsed.secretDelivery, "server-only", "PRODUCTION_HEALTH_SECRET_DELIVERY_UNSAFE");
    return { hostname, releaseSha: parsed.releaseSha, status: "verified" };
  }));
  return { productionLiveHealthVerified: true, sha, results,
    // Never convert a healthy response into authorization for a merge.
    firstMainPushNegativePathVerified: false, productionPromotionAuthorized: false };
}

if (process.argv[1]?.endsWith("verify-origin-production-health.mjs")) {
  verifyOriginProductionHealth().then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      // Avoid logging response contents, authentication data and URLs.
      const code = error instanceof Error && /^[A-Z0-9_:-]{4,80}$/.test(error.message)
        ? error.message : "PRODUCTION_HEALTH_VERIFICATION_FAILED";
      console.error(code);
      process.exitCode = 1;
    },
  );
}
