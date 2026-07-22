import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ORIGIN_AI_STUDIO_CANDIDATE_BLOCKERS,
  ORIGIN_AI_STUDIO_FREE_MODEL_CANDIDATE,
} from "./OriginAiStudioFreeModelCandidate";
import {
  DEFAULT_ORIGIN_AI_STUDIO_FREE_MODEL_CATALOG,
  isExplicitStableGeminiModelId,
  type OriginAiStudioFreeModelEvidence,
} from "./OriginAiStudioRuntimePolicy";

describe("OriginAiStudioFreeModelCandidate", () => {
  it("keeps the public-document candidate outside the production catalog", () => {
    expect(DEFAULT_ORIGIN_AI_STUDIO_FREE_MODEL_CATALOG).toEqual([]);
    expect(ORIGIN_AI_STUDIO_FREE_MODEL_CANDIDATE.activationStatus).toBe("blocked");
    expectTypeOf(ORIGIN_AI_STUDIO_FREE_MODEL_CANDIDATE)
      .not.toMatchTypeOf<OriginAiStudioFreeModelEvidence>();
  });

  it("records a stable explicit model and documented zero Free Tier prices", () => {
    const candidate = ORIGIN_AI_STUDIO_FREE_MODEL_CANDIDATE;

    expect(isExplicitStableGeminiModelId(candidate.modelId)).toBe(true);
    expect(candidate.documentedFreeTier.inputCostUsd).toBe(0);
    expect(candidate.documentedFreeTier.outputCostUsd).toBe(0);
    expect(candidate.apiFamily).toBe("interactions");
    expect(candidate.requestPolicy.store).toBe(false);
  });

  it("requires every account, region, disclosure, and approval blocker to be resolved", () => {
    expect(ORIGIN_AI_STUDIO_FREE_MODEL_CANDIDATE.blockers).toEqual([
      "FORMAL_ACCOUNT_TIER_UNVERIFIED",
      "FORMAL_ACCOUNT_MODEL_AVAILABILITY_UNVERIFIED",
      "FORMAL_ACCOUNT_RATE_LIMIT_UNVERIFIED",
      "EXECUTION_REGION_UNVERIFIED",
      "FREE_TIER_DATA_USE_DISCLOSURE_NOT_ACCEPTED",
      "LIVE_REQUEST_NOT_APPROVED",
    ]);
    expect(ORIGIN_AI_STUDIO_CANDIDATE_BLOCKERS).toHaveLength(6);
    expect(
      ORIGIN_AI_STUDIO_FREE_MODEL_CANDIDATE.documentedFreeTier
        .dataUsedToImproveGoogleProducts,
    ).toBe(true);
  });

  it("uses only official evidence URLs with a short review window", () => {
    const { evidence } = ORIGIN_AI_STUDIO_FREE_MODEL_CANDIDATE;
    const urls = [
      evidence.pricingSourceUrl,
      evidence.modelSourceUrl,
      evidence.interactionsSourceUrl,
      evidence.rateLimitsSourceUrl,
      evidence.regionsSourceUrl,
    ];
    const evidenceLifetimeMs = Date.parse(evidence.reviewAfter) - Date.parse(evidence.verifiedAt);

    expect(urls.every((url) => url.startsWith("https://ai.google.dev/"))).toBe(true);
    expect(evidence.level).toEqual(["DOC_PROVEN", "ACCOUNT_UNVERIFIED"]);
    expect(evidenceLifetimeMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
