import assert from "node:assert/strict";

/**
 * Read-only live HTTP attestation independent of Vercel API metadata.
 * A manually approved snapshot must be captured BEFORE an operation.
 * Never automatically adopt post-operation SHA values as new expectations.
 */
export const ORIGIN_PRODUCTION_DOMAINS = Object.freeze([
  "origin-personal.vercel.app",
  "origin-personal-nori72nyprivate-6923s-projects.vercel.app",
  "origin-personal-git-main-nori72nyprivate-6923s-projects.vercel.app"
]);
const SHA = /^[0-9a-f]{40}$/;
const MAX_BYTES = 4096;

export async function verifyOriginProductionHealth(env = process.env, client = fetch) {
  const rawSnapshot = env.ORIGIN_EXPECTED_HEALTH_SHA_MAP_JSON;
  assert.equal(typeof rawSnapshot, "string", "ORIGIN_HEALTH_SNAPSHOT_MISSING");
  assert.ok(rawSnapshot.length > 0 && rawSnapshot.length <= 2048,
    "ORIGIN_HEALTH_SNAPSHOT_INVALID_SIZE");
  let approved;
  try { approved = JSON.parse(rawSnapshot); }
  catch { throw Error("ORIGIN_HEALTH_SNAPSHOT_INVALID_JSON"); }
  assert.ok(approved !== null && typeof approved === "object" && !Array.isArray(approved),
    "ORIGIN_HEALTH_SNAPSHOT_INVALID");
  assert.deepEqual(Object.keys(approved).sort(),
    [...ORIGIN_PRODUCTION_DOMAINS].sort(), "ORIGIN_HEALTH_SNAPSHOT_INCOMPLETE");
  for (const domain of ORIGIN_PRODUCTION_DOMAINS) {
    assert.equal(typeof approved[domain], "string", "ORIGIN_HEALTH_SHA_INVALID");
    assert.match(approved[domain], SHA, "ORIGIN_HEALTH_SHA_INVALID");
  }

  const checked = await Promise.all(ORIGIN_PRODUCTION_DOMAINS.map(async (domain) => {
    // domain is a fixed reviewed code constant, never from a user-supplied URL.
    const response = await client("https://" + domain + "/api/health", {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, "ORIGIN_HEALTH_BAD_HTTP");
    assert.ok(response.headers.get("content-type")?.toLowerCase().includes("application/json"),
      "ORIGIN_HEALTH_BAD_CONTENT_TYPE");
    const body = await response.text();
    assert.ok(body.length > 0 && Buffer.byteLength(body, "utf8") <= MAX_BYTES,
      "ORIGIN_HEALTH_RESPONSE_OVERSIZED");
    let health;
    try { health = JSON.parse(body); } catch { throw Error("ORIGIN_HEALTH_BAD_JSON"); }
    assert.ok(health && typeof health === "object" && !Array.isArray(health),
      "ORIGIN_HEALTH_BAD_JSON");
    assert.equal(health.status, "ok", "ORIGIN_HEALTH_BAD_STATUS");
    assert.equal(health.releaseSha, approved[domain], "ORIGIN_HEALTH_SHA_MISMATCH");
    assert.equal(health.freeOnly, true, "ORIGIN_HEALTH_FREE_ONLY_DISABLED");
    assert.equal(health.paidFallbackEnabled, false, "ORIGIN_HEALTH_PAID_FALLBACK_ENABLED");
    assert.equal(health.costUsd, 0, "ORIGIN_HEALTH_NONZERO_COST");
    assert.equal(health.secretDelivery, "server-only", "ORIGIN_HEALTH_UNSAFE_SECRET_DELIVERY");
    return { domain, observedSha: health.releaseSha, status: "verified" };
  }));
  return {
    status: "production-health-verified",
    checked,
    firstMainPushNegativePathVerified: false,
    productionPromotionAuthorized: false,
  };
}

if (process.argv[1]?.endsWith("verify-origin-production-health.mjs")) {
  verifyOriginProductionHealth().then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      const safe = error instanceof Error && /^[A-Z0-9_:-]{4,90}$/.test(error.message)
        ? error.message : "ORIGIN_HEALTH_CHECK_FAILED";
      // Never log response bodies, URLs with credentials or headers.
      console.error(safe);
      process.exitCode = 1;
    },
  );
}
