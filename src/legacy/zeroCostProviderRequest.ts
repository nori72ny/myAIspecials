import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY } from "./zeroCostRoutingPolicy";

export function buildZeroCostOpenRouterRequestBody(model: string, messages: unknown[]) {
  return {
    model,
    messages,
    provider: ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY,
  };
}
