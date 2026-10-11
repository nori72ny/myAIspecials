import { describe, expect, it } from "vitest";
import { validateZeroCost } from "../zeroCostValidator";
describe("validateZeroCost", () => {
  it("accepts explicitly verified zero-cost calls", () => expect(validateZeroCost({freeOnly:true,provider:"openrouter",modelId:"free-model",costUsd:0})).toEqual({ok:true,reason:"verified-zero-cost"}));
  it("fails closed on unknown cost", () => expect(validateZeroCost({freeOnly:true,provider:"openrouter",modelId:"model",costUsd:null})).toEqual({ok:false,reason:"unknown-cost"}));
  it("rejects paid cost and paid fallback", () => {
    expect(validateZeroCost({freeOnly:true,provider:"x",modelId:"model",costUsd:0.01})).toEqual({ok:false,reason:"nonzero-cost"});
    expect(validateZeroCost({freeOnly:true,provider:"x",modelId:"free-model",costUsd:0,fallbackRequested:true})).toEqual({ok:false,reason:"paid-fallback-forbidden"});
  });
  it("rejects disabled FREE_ONLY", () => expect(validateZeroCost({freeOnly:false,provider:"x",modelId:"free-model",costUsd:0})).toEqual({ok:false,reason:"free-only-disabled"}));
});
