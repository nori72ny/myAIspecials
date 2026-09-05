export const ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY = Object.freeze({
  // Provider-layer failover stays inside the fixed free model and is bounded by
  // zero-cost + privacy constraints. ORIGIN itself still forbids provider/model
  // fallback in its execution plan.
  allow_fallbacks: true,
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0 },
  require_parameters: [],
} as const);
