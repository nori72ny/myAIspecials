export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY_V2 = Object.freeze({
  allow_fallbacks: true,
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0 },
} as const);
