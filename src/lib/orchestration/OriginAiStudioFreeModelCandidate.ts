export const ORIGIN_AI_STUDIO_CANDIDATE_EVIDENCE_LEVELS = [
  "DOC_PROVEN",
  "ACCOUNT_UNVERIFIED",
] as const;

export const ORIGIN_AI_STUDIO_CANDIDATE_BLOCKERS = [
  "FORMAL_ACCOUNT_TIER_UNVERIFIED",
  "FORMAL_ACCOUNT_MODEL_AVAILABILITY_UNVERIFIED",
  "FORMAL_ACCOUNT_RATE_LIMIT_UNVERIFIED",
  "EXECUTION_REGION_UNVERIFIED",
  "FREE_TIER_DATA_USE_DISCLOSURE_NOT_ACCEPTED",
  "LIVE_REQUEST_NOT_APPROVED",
] as const;

/**
 * Public-document candidate only. This deliberately does not implement
 * OriginAiStudioFreeModelEvidence and cannot activate the runtime catalog.
 */
export const ORIGIN_AI_STUDIO_FREE_MODEL_CANDIDATE = {
  activationStatus: "blocked",
  providerLabel: "Google AI Studio Free Tier candidate",
  modelId: "gemini-3.5-flash-lite",
  apiFamily: "interactions",
  requestPolicy: {
    store: false,
  },
  documentedFreeTier: {
    inputCostUsd: 0,
    outputCostUsd: 0,
    dataUsedToImproveGoogleProducts: true,
  },
  evidence: {
    level: ORIGIN_AI_STUDIO_CANDIDATE_EVIDENCE_LEVELS,
    verifiedAt: "2026-07-23T00:00:00.000Z",
    reviewAfter: "2026-07-30T00:00:00.000Z",
    pricingSourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    modelSourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    interactionsSourceUrl: "https://ai.google.dev/gemini-api/docs/interactions-overview",
    rateLimitsSourceUrl: "https://ai.google.dev/gemini-api/docs/rate-limits",
    regionsSourceUrl: "https://ai.google.dev/gemini-api/docs/available-regions",
  },
  blockers: ORIGIN_AI_STUDIO_CANDIDATE_BLOCKERS,
} as const;
