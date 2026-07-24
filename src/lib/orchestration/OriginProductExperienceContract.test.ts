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
      "identify-needed-context-data-and-deliverables",
      "classify-task",
      "select-safe-free-ai",
      "execute",
      "collect-evidence",
      "independent-review-when-required",
      "synthesize",
      "present-truthfully",
    ]);
  });

  it("treats useful work beyond the literal request as part of the product", () => {
    expect(ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.finalGoal).toBe(
      "world-class-ai-agent-service",
    );
    expect(ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.purpose).toEqual(
      expect.arrayContaining([
        "identify-unspoken-information-needed-to-achieve-the-goal",
        "deliver-useful-information-data-risks-and-next-actions-beyond-the-literal-request",
        "use-specialist-ai-when-it-materially-improves-the-result",
      ]),
    );
  });

  it("requires equivalent product quality across all target devices", () => {
    expect(ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.design.targetDevices).toEqual([
      "smartphone",
      "tablet",
      "desktop",
    ]);
    expect(ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.design.principles).toEqual(
      expect.arrayContaining([
        "cross-device-equivalence",
        "device-appropriate-information-density",
      ]),
    );
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

  it("defines world-leading quality as a measured goal rather than a claim", () => {
    const quality = ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.qualityGoal;

    expect(quality.target).toBe("highest-verified-deliverable-quality");
    expect(quality.unsupportedWorldBestClaimAllowed).toBe(false);
    expect(quality.comparisonRequired).toBe(true);
    expect(quality.humanAcceptanceRequired).toBe(true);
    expect(quality.evaluationDimensions).toEqual(expect.arrayContaining([
      "factual-accuracy",
      "goal-and-instruction-fit",
      "practical-usability",
      "design-quality",
      "cross-device-quality",
    ]));
  });

  it("allows future AI providers without rewriting the product core or UI", () => {
    expect(ORIGIN_PRODUCT_EXPERIENCE_CONTRACT.evolution).toEqual({
      integrationBoundary: "provider-adapter",
      capabilityCatalogExtensible: true,
      outputCatalogExtensible: true,
      interactionModes: ["conversation", "deliverable", "agent-workflow"],
      routingEvidence: ["capability", "safety", "cost", "availability", "quality-evidence"],
      coreRewriteRequiredForNewAi: false,
      uiRewriteRequiredForNewAi: false,
      automaticActivation: false,
      explicitStableModelIdsOnly: true,
      lifecycleEvidenceRequired: true,
    });
  });
});
