// ORIGIN V2: a request may use exactly one eligible zero-cost, ZDR endpoint.
export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY = Object.freeze({
  // Never let OpenRouter make a second provider attempt. If the selected ZDR
  // endpoint is unavailable, fail closed and let the owner retry explicitly.
  allow_fallbacks: false,
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0 },
} as const);
