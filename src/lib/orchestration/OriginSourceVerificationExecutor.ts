import type { OriginClaimAssessor } from "./OriginClaimAssessor.js";
import { assessOriginClaimAgainstSource } from "./OriginClaimAssessor.js";
import {
  fetchOriginPublicSource,
  type OriginPinnedFetchTransport,
} from "./OriginPublicSourceFetch.js";
import type { OriginDnsResolver } from "./OriginPublicNetworkPolicy.js";
import type {
  OriginSourceVerificationExecutionRequest,
  OriginSourceVerificationExecutor,
  OriginSourceVerificationRecord,
} from "./OriginSourceVerification.js";

export interface OriginSourceVerificationExecutorOptions {
  assessor: OriginClaimAssessor;
  resolver?: OriginDnsResolver;
  transport?: OriginPinnedFetchTransport;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
}

export function createOriginSourceVerificationExecutor(
  options: OriginSourceVerificationExecutorOptions,
): OriginSourceVerificationExecutor {
  return async (
    request: OriginSourceVerificationExecutionRequest,
  ): Promise<OriginSourceVerificationRecord> => {
    const fetched = await fetchOriginPublicSource(request.sourceUrl, {
      resolver: options.resolver,
      transport: options.transport,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes,
      now: options.now,
    });

    if (fetched.ok === false) {
      throw new Error(fetched.code);
    }

    const assessed = await assessOriginClaimAgainstSource(
      request.claim,
      fetched.value,
      options.assessor,
    );

    if (assessed.ok === false) {
      throw new Error(assessed.code);
    }

    return {
      verificationId: request.verificationId,
      sourceUrl: request.sourceUrl,
      finalUrl: fetched.value.finalUrl,
      claim: request.claim,
      fetchedAt: fetched.value.fetchedAt,
      httpStatus: 200,
      contentDigest: fetched.value.contentDigest,
      externalFetchPerformed: true,
      actualCostUsd: 0,
      networkPolicy: {
        publicAddressOnly: true,
        redirectsFollowed: false,
      },
      checks: {
        content: "passed",
        freshness: "not-applicable",
        claimSupport: "passed",
      },
    };
  };
}
