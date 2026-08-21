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
      creativeSpecRequired: false,
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
      creativeSpecRequired: false,
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

  it("requires concrete breadth for short representative-example questions", () => {
    const policy = resolveOriginAnswerQualityPolicy({
      intent: intent(),
      taskType: "implementation",
      independentReviewRequired: false,
    });
    const instruction = originAnswerQualityInstruction(policy);

    expect(instruction).toContain(
      "A short question can require a broad, concrete answer",
    );
    expect(instruction).toContain("roughly 6-10 useful examples");
    expect(instruction).toContain(
      "named varieties, locations, seasons, uses, or other domain-specific details",
    );
    expect(instruction).toContain(
      "Do not let generic selection tips, cautions, background, or a closing offer displace concrete information",
    );
  });

  it("creates an internal Creative / Vibe Spec preflight for app, slide, website, and dashboard deliverables", () => {
    const policy = resolveOriginAnswerQualityPolicy({
      intent: intent({
        interactionMode: "deliverable",
        requiredCapabilities: ["application-development", "design"],
        requestedOutputs: ["application", "dashboard"],
      }),
      taskType: "implementation",
      independentReviewRequired: false,
    });

    expect(policy.creativeSpecRequired).toBe(true);
    const instruction = originAnswerQualityInstruction(policy);
    expect(instruction).toContain("Creative / Vibe Spec preflight (internal only)");
    expect(instruction).toContain("purpose and target user");
    expect(instruction).toContain("visual hierarchy and layout");
    expect(instruction).toContain("OKLCH color palette");
    expect(instruction).toContain("Do not output the spec");
  });
});
