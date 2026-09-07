// ORIGIN V1: keep zero-cost provider failover explicitly bounded.
export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY = Object.freeze({
  // Fallbacks remain bounded to the fixed free model and the privacy-focused
  // Venice provider. This is failover within the approved zero-cost boundary,
  // not permission to route to arbitrary providers or paid models.
  allow_fallbacks: true,
  only: ["venice"],
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0 },
} as const);