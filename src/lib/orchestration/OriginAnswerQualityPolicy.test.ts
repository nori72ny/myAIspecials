import { describe, expect, it } from "vitest";
import { originAnswerQualityInstruction, resolveOriginAnswerQualityPolicy } from "./OriginAnswerQualityPolicy";
import type { OriginRequestIntent } from "./OriginRequestIntent";

function intent(overrides: Partial<OriginRequestIntent> = {}): OriginRequestIntent {
  return { primaryTask: "implementation", interactionMode: "conversation", requiredCapabilities: [], requestedOutputs: [], suggestedOutputs: [], ...overrides };
}

describe("OriginAnswerQualityPolicy", () => {
  it("uses a decision response when a comparison would improve the answer", () => {
    expect(resolveOriginAnswerQualityPolicy({ intent: intent({ suggestedOutputs: ["comparison"] }), taskType: "implementation", independentReviewRequired: false })).toEqual({ answerMode: "decision", verificationLevel: "basic", creativeSpecRequired: false, executiveReasoningRequired: true });
  });

  it("requires evidence for research without pretending an independent review ran", () => {
    expect(resolveOriginAnswerQualityPolicy({ intent: intent({ requiredCapabilities: ["research"] }), taskType: "research", independentReviewRequired: false })).toEqual({ answerMode: "research", verificationLevel: "evidence-required", creativeSpecRequired: false, executiveReasoningRequired: true });
  });

  it("raises consequential work to independent-review-required", () => {
    const policy = resolveOriginAnswerQualityPolicy({ intent: intent(), taskType: "security", independentReviewRequired: true });
    expect(policy.verificationLevel).toBe("independent-review-required");
    expect(policy.executiveReasoningRequired).toBe(true);
    const instruction = originAnswerQualityInstruction(policy);
    expect(instruction).toContain("If the execution record does not prove it ran");
    expect(instruction).toContain("Never output confidence percentages");
  });

  it("uses the current Fast Path policy for short direct questions", () => {
    const policy = resolveOriginAnswerQualityPolicy({ intent: intent(), taskType: "implementation", independentReviewRequired: false });
    const instruction = originAnswerQualityInstruction(policy);
    expect(instruction).toContain("Response mode: direct");
    expect(instruction).toContain("Fast Path for simple, low-stakes questions");
    expect(instruction).toContain("Prefer specific recommendations, examples, and ready-to-use wording");
  });

  it("creates an internal Creative / Vibe Spec preflight for creative deliverables", () => {
    const policy = resolveOriginAnswerQualityPolicy({ intent: intent({ interactionMode: "deliverable", requiredCapabilities: ["application-development", "design"], requestedOutputs: ["application", "dashboard"] }), taskType: "implementation", independentReviewRequired: false });
    expect(policy.creativeSpecRequired).toBe(true);
    const instruction = originAnswerQualityInstruction(policy);
    expect(instruction).toContain("Creative / Vibe Spec preflight (internal only)");
    expect(instruction).toContain("purpose, target user, hierarchy, responsive layout");
  });

  it("enforces Executive Reasoning Protocol v5.2 without percentage confidence", () => {
    const policy = resolveOriginAnswerQualityPolicy({ intent: intent({ suggestedOutputs: ["comparison"] }), taskType: "implementation", independentReviewRequired: false });
    const instruction = originAnswerQualityInstruction(policy);
    expect(instruction).toContain("Executive Reasoning Protocol v5.2");
    expect(instruction).toContain("Direct Executive Framing");
    expect(instruction).toContain("Counter-Hypothesis");
    expect(instruction).toContain("Decision-Changing Conditions");
    expect(instruction).toContain("Epistemic Confidence: use only High / Medium / Low");
    expect(instruction).toContain("Information Needed");
    expect(instruction).not.toContain("confidence 87%");
  });
});
