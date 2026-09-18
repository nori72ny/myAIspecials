import type { OriginAnswerQualityExecutionState } from "./OriginAnswerQualityStageMachine.js";

export interface OriginAnswerQualityDeliveryGateResult {
  readonly deliverable: boolean;
  readonly blockingStages: readonly string[];
}

export function evaluateOriginAnswerQualityDeliveryGate(
  state: OriginAnswerQualityExecutionState,
): OriginAnswerQualityDeliveryGateResult {
  const blockingStages = state.stages
    .filter((stage) => stage.active && stage.status !== "passed")
    .map((stage) => stage.stage);

  const presenter = state.stages.find((stage) => stage.stage === "presenter");
  if (!presenter || !presenter.active || presenter.status !== "passed") {
    if (!blockingStages.includes("presenter")) blockingStages.push("presenter");
  }

  return Object.freeze({
    deliverable: blockingStages.length === 0,
    blockingStages: Object.freeze(blockingStages),
  });
}
