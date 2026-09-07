// ORIGIN V1: keep zero-cost routing bounded by explicit privacy and price constraints.
export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY = Object.freeze({
  // Do not pin Gemma to a provider that may not serve this model. OpenRouter
  // must select only endpoints satisfying the explicit ZDR, no-training, and
  // $0 constraints below; provider failover stays enabled within that boundary.
  allow_fallbacks: true,
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0 },
} as const);