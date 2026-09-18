import { describe, expect, it } from "vitest";

import { buildOriginAnswerQualityExecutionPlan } from "./OriginAnswerQualityExecutionPlan";
import {
  createOriginAnswerQualityExecutionState,
  transitionOriginAnswerQualityStage,
} from "./OriginAnswerQualityStageMachine";

function fullPlan() {
  return buildOriginAnswerQualityExecutionPlan({
    claimExtractionRequired: true,
    claimCoverageReviewRequired: true,
    sourceVerificationRequired: true,
    independentReviewRequired: true,
    tracePersistenceRequired: true,
  });
}

describe("OriginAnswerQualityStageMachine", () => {
  it("initializes required stages pending and optional stages not-required", () => {
    const state = createOriginAnswerQualityExecutionState(fullPlan());
    expect(state.stages.every((stage) =>
      stage.required ? stage.status === "pending" : stage.status === "not-required"
    )).toBe(true);
  });

  it("prevents skipping required stages", () => {
    const state = createOriginAnswerQualityExecutionState(fullPlan());

    expect(() => transitionOriginAnswerQualityStage(
      state,
      "source-verification",
      "running",
    )).toThrow("AQ_STAGE_PREREQUISITE_INCOMPLETE");
  });

  it("allows only pending->running->terminal transitions", () => {
    let state = createOriginAnswerQualityExecutionState(fullPlan());

    state = transitionOriginAnswerQualityStage(state, "claim-extraction", "running");
    state = transitionOriginAnswerQualityStage(state, "claim-extraction", "passed");

    expect(state.stages.find((stage) => stage.stage === "claim-extraction")?.status)
      .toBe("passed");

    expect(() => transitionOriginAnswerQualityStage(
      state,
      "claim-extraction",
      "running",
    )).toThrow("AQ_STAGE_ALREADY_TERMINAL");
  });

  it("does not permit direct pending->passed self-certification", () => {
    const state = createOriginAnswerQualityExecutionState(fullPlan());

    expect(() => transitionOriginAnswerQualityStage(
      state,
      "claim-extraction",
      "passed",
    )).toThrow("AQ_STAGE_TRANSITION_INVALID");
  });

  it("prevents execution of non-required stages", () => {
    const plan = buildOriginAnswerQualityExecutionPlan({
      claimExtractionRequired: false,
      claimCoverageReviewRequired: false,
      sourceVerificationRequired: false,
      independentReviewRequired: false,
      tracePersistenceRequired: false,
    });
    const state = createOriginAnswerQualityExecutionState(plan);

    expect(() => transitionOriginAnswerQualityStage(
      state,
      "claim-extraction",
      "running",
    )).toThrow("AQ_STAGE_NOT_REQUIRED");
  });
});
