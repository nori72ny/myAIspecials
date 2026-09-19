import type { OriginProviderErrorCode } from "../../legacy/originProviderClient.js";

export type OriginAnswerQualitySafeEvaluatorFailureCode =
  | `AQ_BENCHMARK_EVALUATOR_${OriginProviderErrorCode}`
  | "AQ_BENCHMARK_EVALUATOR_TOOL_JSON_INVALID"
  | "AQ_BENCHMARK_EVALUATOR_CANDIDATE_LIMIT"
  | "AQ_BENCHMARK_EVALUATOR_PLAN_UNAVAILABLE";

const PROVIDER_CODES = new Set<OriginProviderErrorCode>([
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_POLICY_VIOLATION",
  "PROVIDER_COST_UNVERIFIED",
  "PROVIDER_ROUTING_UNVERIFIED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_INVALID_RESPONSE",
  "PROVIDER_REQUIRED_TOOL_MISSING",
  "PROVIDER_REQUIRED_TOOL_AMBIGUOUS",
  "PROVIDER_REQUIRED_TOOL_INVALID",
  "PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID",
  "PROVIDER_REQUIRED_TOOL_TRUNCATED",
  "PROVIDER_INTERNAL_ERROR",
]);

const LOCAL_CODES = new Set<OriginAnswerQualitySafeEvaluatorFailureCode>([
  "AQ_BENCHMARK_EVALUATOR_TOOL_JSON_INVALID",
  "AQ_BENCHMARK_EVALUATOR_CANDIDATE_LIMIT",
  "AQ_BENCHMARK_EVALUATOR_PLAN_UNAVAILABLE",
]);

export function classifyOriginAnswerQualityEvaluatorFailure(
  error: unknown,
): OriginAnswerQualitySafeEvaluatorFailureCode | null {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && PROVIDER_CODES.has(code as OriginProviderErrorCode)) {
      return `AQ_BENCHMARK_EVALUATOR_${code as OriginProviderErrorCode}`;
    }
  }

  if (!(error instanceof Error)) return null;
  if (LOCAL_CODES.has(error.message as OriginAnswerQualitySafeEvaluatorFailureCode)) {
    return error.message as OriginAnswerQualitySafeEvaluatorFailureCode;
  }
  if (error.message.startsWith("AQ_BENCHMARK_EVALUATOR_PLAN_UNAVAILABLE:")) {
    return "AQ_BENCHMARK_EVALUATOR_PLAN_UNAVAILABLE";
  }
  return null;
}
