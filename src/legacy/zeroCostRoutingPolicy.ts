// ORIGIN V2: only zero-cost OpenRouter routing policies are permitted.
// Progressively relax only the ZDR filter when OpenRouter reports no matching
// endpoint (403/404). Cost, fallback, and data-collection restrictions never relax.
const ZERO_PRICE = Object.freeze({ prompt: 0, completion: 0, request: 0 });

export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY = Object.freeze({
  allow_fallbacks: false,
  data_collection: "deny",
  zdr: true,
  max_price: ZERO_PRICE,
} as const);

export const ORIGIN_ZERO_COST_OPENROUTER_POLICY_STAGES = Object.freeze([
  ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY,
  Object.freeze({
    allow_fallbacks: false,
    data_collection: "deny",
    max_price: ZERO_PRICE,
  } as const),
  Object.freeze({
    allow_fallbacks: false,
    data_collection: "deny",
    max_price: Object.freeze({ request: 0 }),
  } as const),
] as const);
