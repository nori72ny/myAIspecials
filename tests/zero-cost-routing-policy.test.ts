import { describe, expect, it } from "vitest";
import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY } from "../src/legacy/zeroCostRoutingPolicy";

describe("zero-cost OpenRouter routing policy", () => {
  it("fails closed on paid routing and data-retaining providers", () => {
    expect(ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY.allow_fallbacks).toBe(false);
    expect(ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY.data_collection).toBe("deny");
    expect(ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY.zdr).toBe(true);
    expect(ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY.max_price).toEqual({ prompt: 0, completion: 0, request: 0 });
  });
});
