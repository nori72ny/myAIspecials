import { describe, expect, it } from "vitest";
import { buildZeroCostOpenRouterRequestBody } from "../src/legacy/zeroCostProviderRequest";

describe("zero-cost provider request", () => {
  it("cannot opt into paid or data-retaining routing", () => {
    const body = buildZeroCostOpenRouterRequestBody("google/gemma-4-31b-it:free", []);
    expect(body.provider.allow_fallbacks).toBe(true);
    expect(body.provider.data_collection).toBe("deny");
    expect(body.provider.zdr).toBe(true);
    expect(body.provider.max_price).toEqual({ prompt: 0, completion: 0 });
  });
});
