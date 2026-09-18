import { describe, expect, it } from "vitest";

import { buildOriginAnswerQualityExecutionPlan } from "./OriginAnswerQualityExecutionPlan";
import {
  activateOriginAnswerQualityConditionalStages,
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
  it("initializes required stages pending and conditional/optional stages inactive", () => {
    const state = createOriginAnswerQualityExecutionState(fullPlan());

    expect(state.stages.find((stage) => stage.stage === "claim-extraction"))
      .toEqual(expect.objectContaining({ activation: "required", active: true, status: "pending" }));
    expect(state.stages.find((stage) => stage.stage === "repair"))
      .toEqual(expect.objectContaining({ activation: "conditional", active: false, status: "not-required" }));
    expect(state.stages.find((stage) => stage.stage === "reverification"))
      .toEqual(expect.objectContaining({ activation: "conditional", active: false, status: "not-required" }));
  });

  it("prevents skipping active prerequisite stages", () => {
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

  it("keeps repair inactive on the normal pass path", () => {
    const state = createOriginAnswerQualityExecutionState(fullPlan());

    expect(() => transitionOriginAnswerQualityStage(
      state,
      "repair",
      "running",
    )).toThrow("AQ_STAGE_NOT_ACTIVE");
  });

  it("activates repair and reverification only when explicitly required", () => {
    const state = createOriginAnswerQualityExecutionState(fullPlan());
    const activated = activateOriginAnswerQualityConditionalStages(
      state,
      ["repair", "reverification"],
    );

    expect(activated.stages.find((stage) => stage.stage === "repair"))
      .toEqual(expect.objectContaining({ active: true, status: "pending" }));
    expect(activated.stages.find((stage) => stage.stage === "reverification"))
      .toEqual(expect.objectContaining({ active: true, status: "pending" }));
  });

  it("prevents activation of required or optional stages as conditionals", () => {
    const state = createOriginAnswerQualityExecutionState(fullPlan());

    expect(() => activateOriginAnswerQualityConditionalStages(
      state,
      ["verifier"],
    )).toThrow("AQ_STAGE_NOT_CONDITIONAL");
  });
});
