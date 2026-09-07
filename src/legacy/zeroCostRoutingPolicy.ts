export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY = Object.freeze({
  // Keep provider failover bounded to the fixed free model while restricting
  // execution to the privacy-focused Venice free endpoint.
  allow_fallbacks: false,
  only: ["venice"],
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0 },
} as const);