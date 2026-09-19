import { describe, expect, it } from "vitest";

import {
  classifyOriginAnswerQualityEvaluatorFailure,
} from "./OriginAnswerQualityEvaluatorFailure";

describe("OriginAnswerQualityEvaluatorFailure", () => {
  it("maps only allowlisted provider codes to sanitized AQ diagnostics", () => {
    expect(classifyOriginAnswerQualityEvaluatorFailure({
      code: "PROVIDER_RATE_LIMITED",
      message: "secret body must not escape",
    })).toBe("AQ_BENCHMARK_EVALUATOR_PROVIDER_RATE_LIMITED");

    expect(classifyOriginAnswerQualityEvaluatorFailure({
      code: "PROVIDER_REQUIRED_TOOL_MISSING",
      message: "raw provider output",
    })).toBe("AQ_BENCHMARK_EVALUATOR_PROVIDER_REQUIRED_TOOL_MISSING");
  });

  it("preserves only known local evaluator codes", () => {
    expect(classifyOriginAnswerQualityEvaluatorFailure(
      new Error("AQ_BENCHMARK_EVALUATOR_TOOL_JSON_INVALID"),
    )).toBe("AQ_BENCHMARK_EVALUATOR_TOOL_JSON_INVALID");

    expect(classifyOriginAnswerQualityEvaluatorFailure(
      new Error("AQ_BENCHMARK_EVALUATOR_PLAN_UNAVAILABLE:FREE_MODEL_EVIDENCE_STALE"),
    )).toBe("AQ_BENCHMARK_EVALUATOR_PLAN_UNAVAILABLE");
  });

  it("drops arbitrary messages and unknown codes", () => {
    expect(classifyOriginAnswerQualityEvaluatorFailure(
      new Error("Authorization: Bearer secret-token"),
    )).toBeNull();
    expect(classifyOriginAnswerQualityEvaluatorFailure({
      code: "SOME_ARBITRARY_CODE",
      message: "secret",
    })).toBeNull();
  });
});
