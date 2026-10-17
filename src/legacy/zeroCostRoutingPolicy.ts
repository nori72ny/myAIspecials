// ORIGIN V2: send zero-price, no-fallback, data-collection-deny, and ZDR request parameters.
// These parameters are best-effort provider requests, not independent proof of billing,
// upstream retention behavior, or contractual ZDR coverage. Runtime must still verify
// returned model identity and all reported cost evidence; unverifiable evidence fails closed.
export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY = Object.freeze({
  // Never let OpenRouter make a second provider attempt. If the selected ZDR
  // endpoint is unavailable, fail closed and let the owner retry explicitly.
  allow_fallbacks: false,
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0 },
} as const);
