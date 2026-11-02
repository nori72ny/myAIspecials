// ORIGIN V2: only fully privacy-qualified, zero-cost OpenRouter routing is permitted.
// Never relax ZDR, data collection denial, the zero-price ceiling, or provider fallback.
// If no endpoint satisfies every condition, the request must fail closed.
const ZERO_PRICE = Object.freeze({ prompt: 0, completion: 0, request: 0 });

export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY = Object.freeze({
  allow_fallbacks: false,
  data_collection: "deny",
  zdr: true,
  max_price: ZERO_PRICE,
} as const);

export const ORIGIN_ZERO_COST_OPENROUTER_POLICY_STAGES = Object.freeze([
  ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY,
] as const);
