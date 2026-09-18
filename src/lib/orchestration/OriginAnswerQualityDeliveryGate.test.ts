import { describe, expect, it } from "vitest";

import { buildOriginAnswerQualityExecutionPlan } from "./OriginAnswerQualityExecutionPlan";
import {
  activateOriginAnswerQualityConditionalStages,
  createOriginAnswerQualityExecutionState,
  transitionOriginAnswerQualityStage,
} from "./OriginAnswerQualityStageMachine";
import { evaluateOriginAnswerQualityDeliveryGate } from "./OriginAnswerQualityDeliveryGate";

function plan() {
  return buildOriginAnswerQualityExecutionPlan({
    claimExtractionRequired: false,
    claimCoverageReviewRequired: false,
    sourceVerificationRequired: false,
    independentReviewRequired: false,
    tracePersistenceRequired: false,
  });
}

describe("OriginAnswerQualityDeliveryGate", () => {
  it("blocks delivery while any active required stage is incomplete", () => {
    const state = createOriginAnswerQualityExecutionState(plan());
    const gate = evaluateOriginAnswerQualityDeliveryGate(state);

    expect(gate.deliverable).toBe(false);
    expect(gate.blockingStages).toContain("verifier");
    expect(gate.blockingStages).toContain("presenter");
  });

  it("allows delivery on the fast path after verifier and presenter pass", () => {
    let state = createOriginAnswerQualityExecutionState(plan());
    state = transitionOriginAnswerQualityStage(state, "verifier", "running");
    state = transitionOriginAnswerQualityStage(state, "verifier", "passed");
    state = transitionOriginAnswerQualityStage(state, "presenter", "running");
    state = transitionOriginAnswerQualityStage(state, "presenter", "passed");

    expect(evaluateOriginAnswerQualityDeliveryGate(state)).toEqual({
      deliverable: true,
      blockingStages: [],
    });
  });

  it("blocks delivery until activated repair and reverification complete", () => {
    let state = createOriginAnswerQualityExecutionState(plan());
    state = transitionOriginAnswerQualityStage(state, "verifier", "running");
    state = transitionOriginAnswerQualityStage(state, "verifier", "passed");
    state = activateOriginAnswerQualityConditionalStages(
      state,
      ["repair", "reverification"],
    );

    const gate = evaluateOriginAnswerQualityDeliveryGate(state);
    expect(gate.deliverable).toBe(false);
    expect(gate.blockingStages).toContain("repair");
    expect(gate.blockingStages).toContain("reverification");
  });

  it("blocks delivery when required trace persistence is incomplete", () => {
    const tracePlan = buildOriginAnswerQualityExecutionPlan({
      claimExtractionRequired: false,
      claimCoverageReviewRequired: false,
      sourceVerificationRequired: false,
      independentReviewRequired: false,
      tracePersistenceRequired: true,
    });
    let state = createOriginAnswerQualityExecutionState(tracePlan);
    state = transitionOriginAnswerQualityStage(state, "verifier", "running");
    state = transitionOriginAnswerQualityStage(state, "verifier", "passed");
    state = transitionOriginAnswerQualityStage(state, "presenter", "running");
    state = transitionOriginAnswerQualityStage(state, "presenter", "passed");

    const gate = evaluateOriginAnswerQualityDeliveryGate(state);
    expect(gate.deliverable).toBe(false);
    expect(gate.blockingStages).toContain("trace");
  });
});
