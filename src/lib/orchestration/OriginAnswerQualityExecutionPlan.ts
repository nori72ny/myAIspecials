import type { OriginAnswerQualityStageRequirements } from "./OriginAnswerQualityStagePolicy.js";

export type OriginAnswerQualityExecutionPlanStage =
  | "claim-extraction"
  | "claim-coverage-review"
  | "source-verification"
  | "verifier"
  | "independent-review"
  | "repair"
  | "reverification"
  | "presenter"
  | "trace";

export interface OriginAnswerQualityExecutionPlanStageRecord {
  readonly stage: OriginAnswerQualityExecutionPlanStage;
  readonly required: boolean;
  readonly onFailure: "stop" | "continue-unverified";
}

export interface OriginAnswerQualityExecutionPlan {
  readonly schemaVersion: "origin.aq-execution-plan.v1";
  readonly stages: readonly OriginAnswerQualityExecutionPlanStageRecord[];
}

const ORDER: readonly OriginAnswerQualityExecutionPlanStage[] = Object.freeze([
  "claim-extraction",
  "claim-coverage-review",
  "source-verification",
  "verifier",
  "independent-review",
  "repair",
  "reverification",
  "presenter",
  "trace",
]);

export function buildOriginAnswerQualityExecutionPlan(
  requirements: OriginAnswerQualityStageRequirements,
): OriginAnswerQualityExecutionPlan {
  const required = new Set<OriginAnswerQualityExecutionPlanStage>();

  if (requirements.claimExtractionRequired) required.add("claim-extraction");
  if (requirements.claimCoverageReviewRequired) required.add("claim-coverage-review");
  if (requirements.sourceVerificationRequired) required.add("source-verification");

  required.add("verifier");
  if (requirements.independentReviewRequired) required.add("independent-review");

  // Repair/reverification are conditional stages: they must exist in the plan,
  // but they execute only if the verifier returns REPAIR_REQUIRED.
  required.add("repair");
  required.add("reverification");
  required.add("presenter");

  if (requirements.tracePersistenceRequired) required.add("trace");

  const stages = ORDER.map((stage) => Object.freeze({
    stage,
    required: required.has(stage),
    onFailure:
      stage === "presenter" || (!required.has(stage) && stage === "trace")
        ? "continue-unverified" as const
        : "stop" as const,
  }));

  return Object.freeze({
    schemaVersion: "origin.aq-execution-plan.v1",
    stages: Object.freeze(stages),
  });
}

export function validateOriginAnswerQualityExecutionPlan(
  plan: OriginAnswerQualityExecutionPlan,
): { ok: true } | { ok: false; code: "AQ_EXECUTION_PLAN_INVALID" } {
  if (
    plan.schemaVersion !== "origin.aq-execution-plan.v1"
    || plan.stages.length !== ORDER.length
  ) {
    return { ok: false, code: "AQ_EXECUTION_PLAN_INVALID" };
  }

  for (let index = 0; index < ORDER.length; index += 1) {
    const record = plan.stages[index];
    if (!record || record.stage !== ORDER[index]) {
      return { ok: false, code: "AQ_EXECUTION_PLAN_INVALID" };
    }
  }

  const verifier = plan.stages.find((stage) => stage.stage === "verifier");
  const presenter = plan.stages.find((stage) => stage.stage === "presenter");
  if (!verifier?.required || !presenter?.required) {
    return { ok: false, code: "AQ_EXECUTION_PLAN_INVALID" };
  }

  return { ok: true };
}
