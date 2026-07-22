import { describe, expect, it } from "vitest";

import { ORIGIN_PRODUCT_EXPERIENCE_CONTRACT } from "./OriginProductExperienceContract";

describe("OriginProductExperienceContract", () => {
  it("keeps ORIGIN provider-neutral and free-only", () => {
    const contract = ORIGIN_PRODUCT_EXPERIENCE_CONTRACT;
    const serializedCore = JSON.stringify({
      purpose: contract.purpose,
      orchestrationStages: contract.orchestrationStages,
    }).toLowerCase();

    expect(contract.invariants.providerNeutralCore).toBe(true);
    expect(contract.invariants.freeOnly).toBe(true);
    expect(contract.invariants.maxEstimatedCostUsd).toBe(0);
    expect(contract.invariants.automaticPaidFallback).toBe(false);
    expect(serializedCore).not.toContain("google");
    expect(serializedCore).not.toContain("gemini");
    expect(serializedCore).not.toContain("openrouter");
  });

  it("preserves the full orchestration path instead of reducing ORIGIN to chat", () => {
    expect(ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.orchestrationStages).toEqual([
      "understand-goal",
      "classify-task",
      "select-safe-free-ai",
      "execute",
      "collect-evidence",
      "independent-review-when-required",
      "synthesize",
      "present-truthfully",
    ]);
  });

  it("requires a Japanese-first, evidence-aware answer hierarchy", () => {
    const presentation = ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.answerPresentation;

    expect(presentation.defaultLanguage).toBe("ja");
    expect(presentation.requiredOrder).toEqual([
      "conclusion",
      "answer",
      "evidence",
      "verification-status",
      "limitations",
      "next-actions",
    ]);
    expect(presentation.progressiveDisclosure).toBe(true);
    expect(presentation.technicalDetailsCollapsedByDefault).toBe(true);
  });

  it("keeps rich outputs conditional and forbids misleading product claims", () => {
    const contract = ORIGIN_PRODUCT_EXPERIENCE_CONTRACT;

    expect(contract.answerPresentation.optionalWhenUseful).toEqual(
      expect.arrayContaining(["forecast", "advice", "chart", "illustration", "downloadable-artifact"]),
    );
    expect(contract.invariants.fabricatedDataAllowed).toBe(false);
    expect(contract.invariants.unimplementedFeaturesPresentedAsAvailable).toBe(false);
    expect(contract.invariants.unexecutedReviewPresentedAsVerified).toBe(false);
    expect(contract.invariants.unsupportedQualityClaimsAllowed).toBe(false);
  });
});
