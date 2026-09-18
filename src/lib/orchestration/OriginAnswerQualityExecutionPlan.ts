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

export type OriginAnswerQualityStageActivation = "required" | "conditional" | "optional";

export interface OriginAnswerQualityExecutionPlanStageRecord {
  readonly stage: OriginAnswerQualityExecutionPlanStage;
  readonly activation: OriginAnswerQualityStageActivation;
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
  const conditional = new Set<OriginAnswerQualityExecutionPlanStage>([
    "repair",
    "reverification",
  ]);

  if (requirements.claimExtractionRequired) required.add("claim-extraction");
  if (requirements.claimCoverageReviewRequired) required.add("claim-coverage-review");
  if (requirements.sourceVerificationRequired) required.add("source-verification");

  required.add("verifier");
  if (requirements.independentReviewRequired) required.add("independent-review");
  required.add("presenter");

  if (requirements.tracePersistenceRequired) required.add("trace");

  const stages = ORDER.map((stage) => {
    const activation: OriginAnswerQualityStageActivation = required.has(stage)
      ? "required"
      : conditional.has(stage)
        ? "conditional"
        : "optional";

    return Object.freeze({
      stage,
      activation,
      onFailure:
        stage === "presenter" || (activation === "optional" && stage === "trace")
          ? "continue-unverified" as const
          : "stop" as const,
    });
  });

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
  const repair = plan.stages.find((stage) => stage.stage === "repair");
  const reverification = plan.stages.find((stage) => stage.stage === "reverification");
  if (
    verifier?.activation !== "required"
    || presenter?.activation !== "required"
    || repair?.activation !== "conditional"
    || reverification?.activation !== "conditional"
  ) {
    return { ok: false, code: "AQ_EXECUTION_PLAN_INVALID" };
  }

  return { ok: true };
}
