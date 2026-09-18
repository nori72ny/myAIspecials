import { describe, expect, it, vi } from "vitest";

import { createOriginAnswerQualityBenchmarkEphemeralEvidenceVault } from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault";
import { createOriginAnswerQualityBenchmarkOfficialScoringCollector } from "./OriginAnswerQualityBenchmarkOfficialScoringCollector";
import type {
  OriginAnswerQualityBenchmarkExecutableCase,
  OriginAnswerQualityBenchmarkExecutionEvidence,
} from "./OriginAnswerQualityBenchmarkRunner";

const ref = (char: string) => `sha256:${char.repeat(64)}`;
const now = Date.parse("2026-09-19T00:00:00.000Z");

function item(
  category: OriginAnswerQualityBenchmarkExecutableCase["category"],
  caseId = "case-1",
  prompt = "Prompt",
): OriginAnswerQualityBenchmarkExecutableCase {
  return {
    caseId,
    category,
    prompt,
    caseDigest: ref("f"),
  };
}

function execution(
  overrides: Partial<OriginAnswerQualityBenchmarkExecutionEvidence> = {},
): OriginAnswerQualityBenchmarkExecutionEvidence {
  return {
    caseId: "case-1",
    finalAnswerRef: ref("a"),
    evidenceLedgerRef: ref("b"),
    verifierResult: "PASS",
    providerRequests: 1,
    toolCalls: 1,
    latencyMs: 100,
    costUsd: 0,
    failureCode: null,
    ...overrides,
  };
}

function dependencies(options: {
  claimText?: string;
  promptSupported?: boolean;
  semantic?: Partial<{
    deliverableCompleted: boolean;
    materialContradictionsPresent: number;
    materialContradictionsSurfaced: number;
    verificationIntegrityAccurate: boolean;
    failClosedCorrect: boolean;
    userActionabilityScore: 0 | 1 | 2 | 3;
  }>;
  sourceThrows?: boolean;
} = {}) {
  const claimText = options.claimText;
  const materialClaimExtractor = vi.fn().mockImplementation(async (request) => ({
    answerDigest: request.answerDigest,
    claims: claimText ? [{
      id: "claim-a",
      text: claimText,
      kind: "factual",
      freshness: "stable",
      evidenceRequirement: "supporting-evidence",
      risk: "medium",
    }] : [],
    actualCostUsd: 0,
    attempts: 1,
  }));

  const promptClaimJudge = vi.fn().mockImplementation(async (request) => ({
    caseId: request.caseId,
    rubricVersion: request.rubricVersion,
    promptDigest: request.promptDigest,
    claimSetDigest: request.claimSetDigest,
    supportedClaimIds: options.promptSupported && claimText ? ["claim-a"] : [],
    actualCostUsd: 0,
    attempts: 1,
  }));

  const semanticJudge = vi.fn().mockImplementation(async (request) => ({
    caseId: request.caseId,
    category: request.category,
    rubricVersion: request.rubricVersion,
    promptDigest: request.promptDigest,
    answerDigest: request.answerDigest,
    deliverableCompleted: options.semantic?.deliverableCompleted ?? true,
    materialContradictionsPresent:
      options.semantic?.materialContradictionsPresent ?? 0,
    materialContradictionsSurfaced:
      options.semantic?.materialContradictionsSurfaced ?? 0,
    verificationIntegrityAccurate:
      options.semantic?.verificationIntegrityAccurate ?? true,
    ...(request.category === "fail-closed"
      ? { failClosedCorrect: options.semantic?.failClosedCorrect ?? true }
      : {}),
    userActionabilityScore: options.semantic?.userActionabilityScore ?? 3,
    actualCostUsd: 0,
    attempts: 1,
  }));

  const sourceVerificationExecutor = vi.fn().mockImplementation(async (request) => {
    if (options.sourceThrows) throw new Error("source unavailable");
    return {
      verificationId: request.verificationId,
      sourceUrl: request.sourceUrl,
      finalUrl: request.sourceUrl,
      claim: request.claim,
      fetchedAt: new Date(now).toISOString(),
      httpStatus: 200,
      contentDigest: ref("c"),
      externalFetchPerformed: true,
      actualCostUsd: 0,
      networkPolicy: {
        publicAddressOnly: true,
        redirectsFollowed: false,
      },
      checks: {
        content: "passed",
        freshness: "not-applicable",
        claimSupport: "passed",
      },
    };
  });

  return {
    materialClaimExtractor,
    promptClaimJudge,
    semanticJudge,
    sourceVerificationExecutor,
  };
}

describe("OriginAnswerQualityBenchmarkOfficialScoringCollector", () => {
  it("counts a factual claim as supported only after explicit citation verification", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    const answer = "The service has a free tier. 〔Source: [Official](https://example.com/docs)〕";
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: answer,
      evidenceJson: {},
    });
    const deps = dependencies({ claimText: "The service has a free tier." });
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      ...deps,
      nowMs: () => now,
    });

    const result = await collector(item("current-factual"), execution());

    expect(result.totalMaterialClaims).toBe(1);
    expect(result.supportedMaterialClaims).toBe(1);
    expect(result.totalRenderedCitations).toBe(1);
    expect(result.supportingRenderedCitations).toBe(1);
    expect(result.citationsRequired).toBe(true);
    expect(result.verificationIntegrityAccurate).toBe(true);
    expect(vault.size()).toBe(0);
    expect(deps.sourceVerificationExecutor).toHaveBeenCalledTimes(1);
  });

  it("credits factual claims entailed by the user prompt without requiring an external citation", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "The retained count is 10.",
      evidenceJson: {},
    });
    const deps = dependencies({
      claimText: "The retained count is 10.",
      promptSupported: true,
    });
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      ...deps,
      nowMs: () => now,
    });

    const result = await collector(item(
      "user-document-reasoning",
      "case-1",
      "12 features shipped and 2 were rolled back.",
    ), execution());

    expect(result.totalMaterialClaims).toBe(1);
    expect(result.supportedMaterialClaims).toBe(1);
    expect(result.totalRenderedCitations).toBe(0);
    expect(result.supportingRenderedCitations).toBe(0);
    expect(result.citationsRequired).toBe(false);
  });

  it("does not let a PASS label hide an unsupported factual claim", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "The market will grow 50%.",
      evidenceJson: {},
    });
    const deps = dependencies({ claimText: "The market will grow 50%." });
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      ...deps,
      nowMs: () => now,
    });

    const result = await collector(item("professional-advice"), execution());

    expect(result.totalMaterialClaims).toBe(1);
    expect(result.supportedMaterialClaims).toBe(0);
    expect(result.verifierRejectedUnsupportedClaim).toBe(false);
    expect(result.verificationIntegrityAccurate).toBe(false);
  });

  it("requires verified execution before coding repair can count as completed", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "{\"status\":\"repair_limit\"}",
      evidenceJson: [],
    });
    const deps = dependencies();
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      ...deps,
      nowMs: () => now,
    });

    const result = await collector(
      item("coding-repair"),
      execution({
        verifierResult: "REPAIR_REQUIRED",
        failureCode: "CODING_REPAIR_LIMIT",
      }),
    );

    expect(result.deliverableCompleted).toBe(false);
    expect(result.repairRequired).toBe(true);
    expect(result.repairSucceeded).toBe(false);
  });

  it("scores a no-answer fail-closed execution deterministically without invoking judges", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    const deps = dependencies();
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      ...deps,
      nowMs: () => now,
    });

    const result = await collector(
      item("fail-closed"),
      execution({
        finalAnswerRef: null,
        evidenceLedgerRef: null,
        verifierResult: "BLOCKED_UNVERIFIED",
        providerRequests: 0,
        failureCode: "PROVIDER_UNAVAILABLE",
      }),
    );

    expect(result.deliverableCompleted).toBe(false);
    expect(result.verificationIntegrityAccurate).toBe(true);
    expect(result.failClosedDesigned).toBe(true);
    expect(result.failClosedCorrect).toBe(true);
    expect(result.userActionabilityScore).toBe(0);
    expect(deps.materialClaimExtractor).not.toHaveBeenCalled();
    expect(deps.semanticJudge).not.toHaveBeenCalled();
  });

  it("treats failed source verification as an unsupported citation rather than fabricated support", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "The service has a free tier. 〔Source: [Official](https://example.com/docs)〕",
      evidenceJson: {},
    });
    const deps = dependencies({
      claimText: "The service has a free tier.",
      sourceThrows: true,
    });
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      ...deps,
      nowMs: () => now,
    });

    const result = await collector(item("current-factual"), execution());

    expect(result.supportedMaterialClaims).toBe(0);
    expect(result.totalRenderedCitations).toBe(1);
    expect(result.supportingRenderedCitations).toBe(0);
    expect(result.verificationIntegrityAccurate).toBe(false);
  });

  it("fails if execution refs cannot consume the matching ephemeral evidence", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "Answer",
      evidenceJson: {},
    });
    const deps = dependencies();
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      ...deps,
      nowMs: () => now,
    });

    await expect(collector(
      item("professional-advice"),
      execution({ finalAnswerRef: ref("d") }),
    )).rejects.toThrow("AQ_BENCHMARK_OFFICIAL_SCORER_EPHEMERAL_EVIDENCE_MISSING");
    expect(vault.size()).toBe(1);
  });

  it("consumes raw evidence even when a later semantic judgment fails", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "Answer",
      evidenceJson: {},
    });
    const deps = dependencies();
    deps.semanticJudge.mockRejectedValueOnce(new Error("judge unavailable"));
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      ...deps,
      nowMs: () => now,
    });

    await expect(collector(item("professional-advice"), execution()))
      .rejects.toThrow("AQ_BENCHMARK_SEMANTIC_JUDGE_FAILED");
    expect(vault.size()).toBe(0);
  });
});
