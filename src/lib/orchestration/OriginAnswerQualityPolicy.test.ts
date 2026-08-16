import { describe, expect, it } from "vitest";
import {
  originAnswerQualityInstruction,
  resolveOriginAnswerQualityPolicy,
} from "./OriginAnswerQualityPolicy";
import type { OriginRequestIntent } from "./OriginRequestIntent";

function intent(overrides: Partial<OriginRequestIntent> = {}): OriginRequestIntent {
  return {
    primaryTask: "implementation",
    interactionMode: "conversation",
    requiredCapabilities: [],
    requestedOutputs: [],
    suggestedOutputs: [],
    ...overrides,
  };
}

describe("OriginAnswerQualityPolicy", () => {
  it("uses a decision response when a comparison would improve the answer", () => {
    expect(resolveOriginAnswerQualityPolicy({
      intent: intent({ suggestedOutputs: ["comparison"] }),
      taskType: "implementation",
      independentReviewRequired: false,
    })).toEqual({
      answerMode: "decision",
      verificationLevel: "basic",
    });
  });

  it("requires evidence for research without pretending an independent review ran", () => {
    expect(resolveOriginAnswerQualityPolicy({
      intent: intent({ requiredCapabilities: ["research"] }),
      taskType: "research",
      independentReviewRequired: false,
    })).toEqual({
      answerMode: "research",
      verificationLevel: "evidence-required",
    });
  });

  it("raises consequential work to independent-review-required", () => {
    const policy = resolveOriginAnswerQualityPolicy({
      intent: intent(),
      taskType: "security",
      independentReviewRequired: true,
    });

    expect(policy.verificationLevel).toBe("independent-review-required");
    expect(originAnswerQualityInstruction(policy)).toContain(
      "If the execution record does not prove it ran",
    );
    expect(originAnswerQualityInstruction(policy)).toContain(
      "Never display invented confidence percentages",
    );
  });
});
