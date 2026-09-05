export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY = Object.freeze({
  allow_fallbacks: false,
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0 },
  require_parameters: [],
} as const);
