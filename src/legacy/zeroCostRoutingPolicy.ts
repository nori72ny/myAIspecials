// ORIGIN V2: only zero-cost OpenRouter routing policies with strict ZDR are permitted.
// A 403/404 is terminal: never retry by removing ZDR or weakening any other constraint.
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
