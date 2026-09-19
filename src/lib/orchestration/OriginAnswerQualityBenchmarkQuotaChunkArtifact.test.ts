import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import {
  createOriginAnswerQualityBenchmarkQuotaChunkPlan,
} from "./OriginAnswerQualityBenchmarkQuotaChunk";
import {
  createOriginAnswerQualityBenchmarkQuotaChunkArtifact,
} from "./OriginAnswerQualityBenchmarkQuotaChunkArtifact";

function makeCase(caseId: string, category: string, caseDigest: string) {
  const execution = {
    caseId,
    finalAnswerRef: `sha256:${"a".repeat(64)}`,
    evidenceLedgerRef: `sha256:${"b".repeat(64)}`,
    verifierResult: "PASS" as const,
    providerRequests: 1,
    toolCalls: 1,
    latencyMs: 100,
    costUsd: 0,
    failureCode: null,
  };
  return {
    caseId,
    category: category as any,
    caseDigest,
    execution,
    observation: {
      caseId,
      category: category as any,
      factualSupportScore: 1,
      citationPrecisionScore: 1,
      taskCompletionScore: 1,
      contradictionDetectionScore: 1,
      verifierRejectedUnsupportedClaim: false,
      repairSucceeded: category === "coding-repair" ? true : undefined,
      providerRequests: 1,
      latencyMs: 100,
      costUsd: 0,
      unsupportedMaterialClaimCount: 0,
      verificationIntegrityAccurate: true,
      failClosedCorrect: category === "fail-closed" ? true : undefined,
      userActionabilityScore: 3 as const,
    },
  };
}

describe("OriginAnswerQualityBenchmarkQuotaChunkArtifact", () => {
  it("seals only sanitized execution and observation fields", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const plan = createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, 0);
    if (!plan.ok) throw new Error(plan.code);

    const cases = plan.value.cases.map((item) =>
      makeCase(item.caseId, item.category, item.caseDigest)
    );

    const result = createOriginAnswerQualityBenchmarkQuotaChunkArtifact({
      plan: plan.value,
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free:free",
      scorerProvenanceDigest: `sha256:${"c".repeat(64)}`,
      startedAt: "2026-09-19T00:00:00.000Z",
      completedAt: "2026-09-19T00:10:00.000Z",
      evaluatorRequests: 12,
      cases,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalRequests).toBe(16);
    expect(result.value.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("answerText");
    expect(serialized).not.toContain("messages");
    expect(serialized).not.toContain("chain-of-thought");
  });

  it("rejects a case outside the planned chunk", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const plan = createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, 0);
    if (!plan.ok) throw new Error(plan.code);

    const cases = plan.value.cases.map((item) =>
      makeCase(item.caseId, item.category, item.caseDigest)
    );
    cases[0] = {
      ...cases[0],
      caseId: "not-in-plan",
      execution: { ...cases[0].execution, caseId: "not-in-plan" },
      observation: { ...cases[0].observation, caseId: "not-in-plan" },
    };

    expect(createOriginAnswerQualityBenchmarkQuotaChunkArtifact({
      plan: plan.value,
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free:free",
      scorerProvenanceDigest: `sha256:${"c".repeat(64)}`,
      startedAt: "2026-09-19T00:00:00.000Z",
      completedAt: "2026-09-19T00:10:00.000Z",
      evaluatorRequests: 12,
      cases,
    })).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_CHUNK_ARTIFACT_CASESET_MISMATCH",
    });
  });

  it("rejects observation/execution identity drift", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const plan = createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, 0);
    if (!plan.ok) throw new Error(plan.code);

    const cases = plan.value.cases.map((item) =>
      makeCase(item.caseId, item.category, item.caseDigest)
    );
    cases[0] = {
      ...cases[0],
      observation: {
        ...cases[0].observation,
        providerRequests: 2,
      },
    };

    expect(createOriginAnswerQualityBenchmarkQuotaChunkArtifact({
      plan: plan.value,
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free:free",
      scorerProvenanceDigest: `sha256:${"c".repeat(64)}`,
      startedAt: "2026-09-19T00:00:00.000Z",
      completedAt: "2026-09-19T00:10:00.000Z",
      evaluatorRequests: 12,
      cases,
    })).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_CHUNK_ARTIFACT_OBSERVATION_MISMATCH",
    });
  });

  it("fails closed if measured requests exceed the daily-safe chunk budget", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const plan = createOriginAnswerQualityBenchmarkQuotaChunkPlan(corpus, 0);
    if (!plan.ok) throw new Error(plan.code);

    const cases = plan.value.cases.map((item) => {
      const value = makeCase(item.caseId, item.category, item.caseDigest);
      return {
        ...value,
        execution: {
          ...value.execution,
          providerRequests: 7,
        },
        observation: {
          ...value.observation,
          providerRequests: 7,
        },
      };
    });

    expect(createOriginAnswerQualityBenchmarkQuotaChunkArtifact({
      plan: plan.value,
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: "example/free:free",
      scorerProvenanceDigest: `sha256:${"c".repeat(64)}`,
      startedAt: "2026-09-19T00:00:00.000Z",
      completedAt: "2026-09-19T00:10:00.000Z",
      evaluatorRequests: 17,
      cases,
    })).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_CHUNK_ARTIFACT_REQUEST_BUDGET_EXCEEDED",
    });
  });
});
