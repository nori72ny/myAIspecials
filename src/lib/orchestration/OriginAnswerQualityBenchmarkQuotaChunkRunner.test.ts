import { describe, expect, it, vi } from "vitest";

import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof";
import {
  createOriginAnswerQualityBenchmarkRuntimeAdapter,
} from "./OriginAnswerQualityBenchmarkRuntimeAdapter";
import {
  runOriginAnswerQualityOfficialQuotaChunkHarness,
} from "./OriginAnswerQualityBenchmarkQuotaChunkRunner";

const MODEL = "inclusionai/ling-3.0-flash-sante:free";
const SCORER_REVISION = `sha256:${"d".repeat(64)}`;

const proof: OriginAnswerQualityBenchmarkEnvironmentProof = {
  schemaVersion: "origin.aq-benchmark-environment-proof.v1",
  baseUrl: "https://candidate.example/",
  expectedGitSha: "a".repeat(40),
  observedReleaseSha: "a".repeat(40),
  freeOnly: true,
  costUsd: 0,
  paidFallbackEnabled: false,
  runtimeIds: {
    research: "grounded-research-v1.1",
    coding: "coding-v1.4",
    artifact: "artifact-v1.2",
  },
  codingReady: true,
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeEvaluators(options: { beforeProviderRequest?: () => void }) {
  const count = () => options.beforeProviderRequest?.();
  return Object.freeze({
    materialClaimExtractor: async (request: {
      answerDigest: string;
    }) => {
      count();
      return {
        answerDigest: request.answerDigest,
        claims: [],
        actualCostUsd: 0,
        attempts: 1,
      };
    },
    promptClaimJudge: async (request: {
      caseId: string;
      rubricVersion: string;
      promptDigest: string;
      claimSetDigest: string;
    }) => {
      count();
      return {
        caseId: request.caseId,
        rubricVersion: request.rubricVersion,
        promptDigest: request.promptDigest,
        claimSetDigest: request.claimSetDigest,
        supportedClaimIds: [],
        actualCostUsd: 0,
        attempts: 1,
      };
    },
    semanticJudge: async (request: {
      caseId: string;
      category: string;
      rubricVersion: string;
      promptDigest: string;
      answerDigest: string;
    }) => {
      count();
      return {
        caseId: request.caseId,
        category: request.category,
        rubricVersion: request.rubricVersion,
        promptDigest: request.promptDigest,
        answerDigest: request.answerDigest,
        deliverableCompleted: true,
        materialContradictionsPresent: 0,
        materialContradictionsSurfaced: 0,
        verificationIntegrityAccurate: true,
        userActionabilityScore: 3,
        actualCostUsd: 0,
        attempts: 1,
      };
    },
    claimAssessor: async () => {
      count();
      throw new Error("unexpected individual claim assessor call");
    },
    batchClaimAssessor: async () => {
      count();
      throw new Error("unexpected batch claim assessor call");
    },
    scorerProvenance: Object.freeze({
      schemaVersion: "origin.aq-benchmark-scorer.v1" as const,
      scorerId: "origin-aq-public-deterministic-v1" as const,
      scorerRevision: SCORER_REVISION,
      corpusId: "aq-post-heldout-public" as const,
      corpusVersion: "v1" as const,
    }),
  });
}

describe("OriginAnswerQualityBenchmarkQuotaChunkRunner", () => {
  it("runs exactly four frozen cases and records measured evaluator requests", async () => {
    const fetchImpl = vi.fn(async () => json({
      ok: true,
      report: "# report",
      sources: [],
      conflicts: [],
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    }));

    const result = await runOriginAnswerQualityOfficialQuotaChunkHarness({
      chunkIndex: 0,
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: MODEL,
      environmentProof: proof,
      sourceRoot: "/repo",
      fetchImpl: fetchImpl as typeof fetch,
      nowMs: () => 1_789_761_600_000,
    }, {
      createEvaluators: fakeEvaluators as never,
      createCodingAdapter: async () =>
        createOriginAnswerQualityBenchmarkRuntimeAdapter(
          "coding",
          "coding-v1.4",
          async (item) => ({
            caseId: item.caseId,
            finalAnswerRef: null,
            evidenceLedgerRef: null,
            verifierResult: "BLOCKED_UNVERIFIED",
            providerRequests: 0,
            toolCalls: 0,
            latencyMs: 0,
            costUsd: 0,
            failureCode: "TEST_ONLY",
          }),
        ),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cases).toHaveLength(4);
    expect(result.value.evaluatorRequests).toBe(12);
    expect(result.value.runtimeProviderRequests).toBe(0);
    expect(result.value.totalRequests).toBe(12);
    expect(result.value.scorerProvenanceDigest).toBe(SCORER_REVISION);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("fails before a seventeenth evaluator provider request can start", async () => {
    let started = 0;
    const overflowingFactory = (options: { beforeProviderRequest?: () => void }) => {
      const base = fakeEvaluators(options);
      return {
        ...base,
        materialClaimExtractor: async (request: { answerDigest: string }) => {
          for (let index = 0; index < 17; index += 1) {
            options.beforeProviderRequest?.();
            started += 1;
          }
          return {
            answerDigest: request.answerDigest,
            claims: [],
            actualCostUsd: 0,
            attempts: 1,
          };
        },
      };
    };

    const result = await runOriginAnswerQualityOfficialQuotaChunkHarness({
      chunkIndex: 0,
      gitSha: "a".repeat(40),
      providerId: "openrouter-free",
      modelId: MODEL,
      environmentProof: proof,
      sourceRoot: "/repo",
      fetchImpl: vi.fn(async () => json({
        ok: true,
        report: "# report",
        sources: [],
        conflicts: [],
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      })) as typeof fetch,
      nowMs: () => 1_789_761_600_000,
    }, {
      createEvaluators: overflowingFactory as never,
      createCodingAdapter: async () =>
        createOriginAnswerQualityBenchmarkRuntimeAdapter(
          "coding",
          "coding-v1.4",
          async (item) => ({
            caseId: item.caseId,
            finalAnswerRef: null,
            evidenceLedgerRef: null,
            verifierResult: "BLOCKED_UNVERIFIED",
            providerRequests: 0,
            toolCalls: 0,
            latencyMs: 0,
            costUsd: 0,
            failureCode: "TEST_ONLY",
          }),
        ),
    });

    expect(result.ok).toBe(false);
    expect(started).toBe(16);
    if (result.ok) return;
    expect(result.code).toBe("AQ_BENCHMARK_QUOTA_CHUNK_EXECUTION_FAILED");
  });
});
