/**
 * Reject a frozen AQ-40 benchmark when its reviewed baseline SHA no longer
 * matches what all THREE canonical ORIGIN Production domains actually serve.
 *
 * This is a read-only release-preflight. Never overwrite the frozen SHA using
 * live responses: resetting the benchmark corpus/round requires review.
 */
import { pathToFileURL } from "node:url";
import {
  ORIGIN_PRODUCTION_DOMAINS,
  verifyOriginProductionHealth,
} from "./verify-origin-production-health.mjs";

const SHA = /^[0-9a-f]{40}$/;

export async function verifyAqFrozenBaselineLiveProduction(
  baselineSha,
  client = fetch,
) {
  if (typeof baselineSha !== "string" || !SHA.test(baselineSha)) {
    throw new Error("AQ_FROZEN_BASELINE_SHA_INVALID");
  }

  // The expected SHA comes from the frozen, reviewed workflow definition.
  // We deliberately do not derive it from post-hoc HTTP observations.
  const fixedExpected = Object.fromEntries(
    ORIGIN_PRODUCTION_DOMAINS.map(domain => [domain, baselineSha]),
  );
  try {
    const attestation = await verifyOriginProductionHealth({
      ORIGIN_EXPECTED_HEALTH_SHA_MAP_JSON: JSON.stringify(fixedExpected),
    }, client);
    if (attestation.checked.length !== ORIGIN_PRODUCTION_DOMAINS.length
      || attestation.checked.some(entry => entry.observedSha !== baselineSha)) {
      throw new Error("AQ_FROZEN_BASELINE_NOT_SERVING");
    }
  } catch {
    // No URLs, response bodies, credentials, or current live SHA in logs.
    throw new Error("AQ_FROZEN_BASELINE_NOT_SERVING");
  }

  return Object.freeze({
    schemaVersion: "origin.aq-frozen-baseline-live-production.v1",
    frozenBaselineSha: baselineSha,
    servingProductionAliasesVerified: ORIGIN_PRODUCTION_DOMAINS.length,
    providerCalls: 0,
    hasRealModelAnswers: false,
    benchmarkPromotionAuthorized: false,
    productionPromotionAuthorized: false,
  });
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyAqFrozenBaselineLiveProduction(process.env.BASELINE_SHA).then(
    result => process.stdout.write(JSON.stringify(result) + "\n"),
    error => {
      const msg = error instanceof Error && /^AQ_FROZEN_BASELINE_[A-Z_]+$/.test(error.message)
        ? error.message : "AQ_FROZEN_BASELINE_CHECK_FAILED";
      process.stderr.write(msg + "\n");
      process.exitCode = 3;
    },
  );
}
