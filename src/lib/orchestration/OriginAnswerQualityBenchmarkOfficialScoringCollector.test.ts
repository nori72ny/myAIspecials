import { describe, expect, it, vi } from "vitest";

import {
  createOriginAnswerQualityBenchmarkEphemeralEvidenceVault,
} from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault";
import {
  createOriginAnswerQualityBenchmarkOfficialScoringCollector,
} from "./OriginAnswerQualityBenchmarkOfficialScoringCollector";
import type {
  OriginAnswerQualityBenchmarkExecutableCase,
  OriginAnswerQualityBenchmarkExecutionEvidence,
} from "./OriginAnswerQualityBenchmarkRunner";

const ref = (char: string) => `sha256:${char.repeat(64)}`;

const item: OriginAnswerQualityBenchmarkExecutableCase = {
  caseId: "case-current",
  category: "current-factual",
  prompt: "現在のLTSを確認してください。",
  caseDigest: ref("c"),
};

const execution: OriginAnswerQualityBenchmarkExecutionEvidence = {
  caseId: item.caseId,
  finalAnswerRef: ref("a"),
  evidenceLedgerRef: ref("b"),
  verifierResult: "PASS",
  providerRequests: 1,
  toolCalls: 1,
  latencyMs: 100,
  costUsd: 0,
  failureCode: null,
};

function claimExtractor() {
  return vi.fn().mockImplementation(async (request) => ({
    answerDigest: request.answerDigest,
    claims: [{
      id: "claim-node",
      text: "Node.js 22 is LTS.",
      kind: "factual",
      freshness: "current",
      evidenceRequirement: "supporting-evidence",
      risk: "medium",
    }],
    actualCostUsd: 0,
    attempts: 1,
  }));
}

function semanticJudge() {
  return vi.fn().mockImplementation(async (request) => ({
    caseId: request.caseId,
    category: request.category,
    promptDigest: request.promptDigest,
    finalAnswerRef: request.finalAnswerRef,
    evidenceLedgerRef: request.evidenceLedgerRef,
    materialContradictionsPresent: 0,
    materialContradictionsSurfaced: 0,
    deliverableCompleted: true,
    verifierRejectedUnsupportedClaim: true,
    verificationIntegrityAccurate: true,
    userActionabilityScore: 2,
    actualCostUsd: 0,
    attempts: 1,
  }));
}

describe("OriginAnswerQualityBenchmarkOfficialScoringCollector", () => {
  it("counts only exact source-checked claim evidence as supported", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: item.caseId,
      finalAnswerRef: execution.finalAnswerRef!,
      evidenceLedgerRef: execution.evidenceLedgerRef!,
      answerText: "Node.js 22 is LTS. 〔出典: [Node](https://nodejs.org/)〕",
      evidenceJson: [{
        label: "Node",
        sourceUrl: "https://nodejs.org/",
        claim: "Node.js 22 is LTS.",
        evidenceLevel: "source-checked",
        checks: {
          safeUrl: "passed",
          content: "passed",
          freshness: "not-applicable",
          claimSupport: "passed",
        },
      }],
    });

    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      claimExtractor: claimExtractor(),
      semanticJudge: semanticJudge(),
    });

    const result = await collector(item, execution);

    expect(result.totalMaterialClaims).toBe(1);
    expect(result.supportedMaterialClaims).toBe(1);
    expect(result.totalRenderedCitations).toBe(1);
    expect(result.supportingRenderedCitations).toBe(1);
    expect(vault.size()).toBe(0);
  });

  it("does not count provider-presented but unchecked evidence as support", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: item.caseId,
      finalAnswerRef: execution.finalAnswerRef!,
      evidenceLedgerRef: execution.evidenceLedgerRef!,
      answerText: "Node.js 22 is LTS. 〔出典: [Node](https://nodejs.org/)〕",
      evidenceJson: [{
        label: "Node",
        sourceUrl: "https://nodejs.org/",
        claim: "Node.js 22 is LTS.",
        evidenceLevel: "provided",
        checks: {
          safeUrl: "passed",
          content: "not-run",
          freshness: "not-run",
          claimSupport: "not-run",
        },
      }],
    });

    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      claimExtractor: claimExtractor(),
      semanticJudge: semanticJudge(),
    });

    const result = await collector(item, execution);

    expect(result.supportedMaterialClaims).toBe(0);
    expect(result.supportingRenderedCitations).toBe(0);
  });

  it("fails closed if the semantic judge changes bound answer identity", async () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: item.caseId,
      finalAnswerRef: execution.finalAnswerRef!,
      evidenceLedgerRef: execution.evidenceLedgerRef!,
      answerText: "Node.js 22 is LTS.",
      evidenceJson: [],
    });

    const judge = vi.fn().mockImplementation(async (request) => ({
      caseId: request.caseId,
      category: request.category,
      promptDigest: request.promptDigest,
      finalAnswerRef: ref("f"),
      evidenceLedgerRef: request.evidenceLedgerRef,
      materialContradictionsPresent: 0,
      materialContradictionsSurfaced: 0,
      deliverableCompleted: true,
      verifierRejectedUnsupportedClaim: true,
      verificationIntegrityAccurate: true,
      userActionabilityScore: 2,
      actualCostUsd: 0,
      attempts: 1,
    }));
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      claimExtractor: claimExtractor(),
      semanticJudge: judge,
    });

    await expect(collector(item, execution))
      .rejects.toThrow("AQ_BENCHMARK_SEMANTIC_JUDGE_RECORD_MISMATCH");
  });

  it("derives coding repair success from measured session summary, not the judge", async () => {
    const repairItem: OriginAnswerQualityBenchmarkExecutableCase = {
      caseId: "case-repair",
      category: "coding-repair",
      prompt: "修正してください。",
      caseDigest: ref("d"),
    };
    const repairExecution = {
      ...execution,
      caseId: repairItem.caseId,
      finalAnswerRef: ref("d"),
      evidenceLedgerRef: ref("e"),
    };
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: repairItem.caseId,
      finalAnswerRef: repairExecution.finalAnswerRef!,
      evidenceLedgerRef: repairExecution.evidenceLedgerRef!,
      answerText: JSON.stringify({
        status: "verified",
        code: "CODING_CHECKS_PASSED",
        repairRounds: 1,
        changedPaths: ["src/a.ts"],
        checks: [{ kind: "test", ok: true, exitCode: 0, timedOut: false }],
      }),
      evidenceJson: [],
    });

    const extractor = vi.fn().mockImplementation(async (request) => ({
      answerDigest: request.answerDigest,
      claims: [],
      actualCostUsd: 0,
      attempts: 1,
    }));
    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      claimExtractor: extractor,
      semanticJudge: semanticJudge(),
    });

    const result = await collector(repairItem, repairExecution);

    expect(result.repairRequired).toBe(true);
    expect(result.repairSucceeded).toBe(true);
  });
});
