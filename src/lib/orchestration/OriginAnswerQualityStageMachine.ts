import type {
  OriginAnswerQualityExecutionPlan,
  OriginAnswerQualityExecutionPlanStage,
} from "./OriginAnswerQualityExecutionPlan.js";

export type OriginAnswerQualityStageStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "not-required";

export interface OriginAnswerQualityStageState {
  readonly stage: OriginAnswerQualityExecutionPlanStage;
  readonly required: boolean;
  readonly status: OriginAnswerQualityStageStatus;
}

export interface OriginAnswerQualityExecutionState {
  readonly schemaVersion: "origin.aq-execution-state.v1";
  readonly stages: readonly OriginAnswerQualityStageState[];
}

const TERMINAL = new Set<OriginAnswerQualityStageStatus>([
  "passed",
  "failed",
  "blocked",
  "not-required",
]);

export function createOriginAnswerQualityExecutionState(
  plan: OriginAnswerQualityExecutionPlan,
): OriginAnswerQualityExecutionState {
  return Object.freeze({
    schemaVersion: "origin.aq-execution-state.v1",
    stages: Object.freeze(plan.stages.map((stage) => Object.freeze({
      stage: stage.stage,
      required: stage.required,
      status: stage.required ? "pending" as const : "not-required" as const,
    }))),
  });
}

function priorRequiredStagesSatisfied(
  state: OriginAnswerQualityExecutionState,
  stageIndex: number,
): boolean {
  for (let index = 0; index < stageIndex; index += 1) {
    const prior = state.stages[index];
    if (!prior.required) continue;
    if (prior.status !== "passed") return false;
  }
  return true;
}

export function transitionOriginAnswerQualityStage(
  state: OriginAnswerQualityExecutionState,
  stage: OriginAnswerQualityExecutionPlanStage,
  nextStatus: Exclude<OriginAnswerQualityStageStatus, "pending" | "not-required">,
): OriginAnswerQualityExecutionState {
  const index = state.stages.findIndex((entry) => entry.stage === stage);
  if (index < 0) throw new Error("AQ_STAGE_NOT_FOUND");

  const current = state.stages[index];
  if (!current.required) throw new Error("AQ_STAGE_NOT_REQUIRED");
  if (TERMINAL.has(current.status)) throw new Error("AQ_STAGE_ALREADY_TERMINAL");

  if (current.status === "pending") {
    if (nextStatus !== "running") throw new Error("AQ_STAGE_TRANSITION_INVALID");
    if (!priorRequiredStagesSatisfied(state, index)) {
      throw new Error("AQ_STAGE_PREREQUISITE_INCOMPLETE");
    }
  } else if (current.status === "running") {
    if (nextStatus === "running") throw new Error("AQ_STAGE_TRANSITION_INVALID");
  } else {
    throw new Error("AQ_STAGE_TRANSITION_INVALID");
  }

  const stages = state.stages.map((entry, entryIndex) =>
    entryIndex === index
      ? Object.freeze({ ...entry, status: nextStatus })
      : entry
  );

  return Object.freeze({
    schemaVersion: "origin.aq-execution-state.v1",
    stages: Object.freeze(stages),
  });
}
