import {
  createOriginAnswerQualityFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";
import {
  createOriginAnswerQualityBenchmarkQuotaChunkPlan,
  ORIGIN_AQ_CHUNK_MAX_CASES,
  ORIGIN_AQ_MAX_EVALUATOR_REQUESTS_PER_CASE,
} from "./OriginAnswerQualityBenchmarkQuotaChunk.js";
import {
  createOriginAnswerQualityBenchmarkQuotaChunkArtifact,
  type OriginAnswerQualityBenchmarkQuotaChunkArtifact,
} from "./OriginAnswerQualityBenchmarkQuotaChunkArtifact.js";
import {
  createOriginAnswerQualityBenchmarkProviderEvaluators,
} from "./OriginAnswerQualityBenchmarkProviderEvaluators.js";
import {
  createOriginAnswerQualityBenchmarkOfficialScoringCollector,
} from "./OriginAnswerQualityBenchmarkOfficialScoringCollector.js";
import {
  createOriginAnswerQualityBenchmarkEphemeralEvidenceVault,
} from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault.js";
import {
  createOriginAnswerQualityBenchmarkArtifactHttpAdapter,
  createOriginAnswerQualityBenchmarkChatHttpAdapter,
  createOriginAnswerQualityBenchmarkResearchHttpAdapter,
} from "./OriginAnswerQualityBenchmarkHttpRuntimeAdapters.js";
import {
  createOriginAnswerQualityBenchmarkCodingCheckoutAdapter,
} from "./OriginAnswerQualityBenchmarkCodingCheckoutAdapter.js";
import {
  createOriginAnswerQualityBenchmarkLaneExecutor,
  resolveOriginAnswerQualityBenchmarkExecutionLane,
  type OriginAnswerQualityBenchmarkExecutionLane,
  type OriginAnswerQualityBenchmarkLaneExecutors,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import type {
  OriginAnswerQualityBenchmarkChunkEnvironmentProof,
} from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";
import {
  runOriginAnswerQualityBenchmark,
} from "./OriginAnswerQualityBenchmarkRunner.js";
import {
  scoreOriginAnswerQualityBenchmarkEvidence,
} from "./OriginAnswerQualityBenchmarkScoring.js";
import type {
  OriginAnswerQualityBenchmarkMeasuredObservation,
} from "./OriginAnswerQualityBenchmarkScorecard.js";
import type {
  OriginExecutionPlanningOptions,
} from "./OriginExecutionPolicy.js";

export interface OriginAnswerQualityOfficialQuotaChunkInput {
  readonly chunkIndex: number;
  readonly gitSha: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly environmentProof: OriginAnswerQualityBenchmarkChunkEnvironmentProof;
  readonly sourceRoot: string;
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
  readonly nowMs?: () => number;
  readonly evaluatorPlanningOptions?: Omit<OriginExecutionPlanningOptions, "nowMs">;
}

export type OriginAnswerQualityOfficialQuotaChunkResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkQuotaChunkArtifact }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_QUOTA_CHUNK_PLAN_INVALID"
        | "AQ_BENCHMARK_QUOTA_CHUNK_ENVIRONMENT_INVALID"
        | "AQ_BENCHMARK_QUOTA_CHUNK_RUNTIME_NOT_READY"
        | "AQ_BENCHMARK_QUOTA_CHUNK_EXECUTION_FAILED"
        | "AQ_BENCHMARK_QUOTA_CHUNK_ARTIFACT_INVALID";
      detail?: string;
    };

export interface OriginAnswerQualityOfficialQuotaChunkDependencies {
  readonly createEvaluators?: typeof createOriginAnswerQualityBenchmarkProviderEvaluators;
  readonly createCodingAdapter?: typeof createOriginAnswerQualityBenchmarkCodingCheckoutAdapter;
}


function sameLaneSet(
  actual: readonly OriginAnswerQualityBenchmarkExecutionLane[],
  expected: ReadonlySet<OriginAnswerQualityBenchmarkExecutionLane>,
): boolean {
  const unique = new Set(actual);
  return unique.size === expected.size
    && [...expected].every((lane) => unique.has(lane));
}

function validChunkEnvironment(
  proof: OriginAnswerQualityBenchmarkChunkEnvironmentProof,
  gitSha: string,
  requiredLanes: ReadonlySet<OriginAnswerQualityBenchmarkExecutionLane>,
): boolean {
  return proof.schemaVersion === "origin.aq-benchmark-chunk-environment-proof.v1"
    && proof.expectedGitSha === gitSha
    && proof.observedReleaseSha === gitSha
    && proof.freeOnly === true
    && proof.costUsd === 0
    && proof.paidFallbackEnabled === false
    && sameLaneSet(proof.requiredLanes, requiredLanes)
    && (!requiredLanes.has("research") || proof.researchReady)
    && (!requiredLanes.has("coding") || proof.codingReady)
    && (!requiredLanes.has("artifact") || proof.artifactReady);
}

export async function runOriginAnswerQualityOfficialQuotaChunkHarness(
  input: OriginAnswerQualityOfficialQuotaChunkInput,
  dependencies: OriginAnswerQualityOfficialQuotaChunkDependencies = {},
): Promise<OriginAnswerQualityOfficialQuotaChunkResult> {
  const corpus = createOriginAnswerQualityFrozenCorpus();
  const plan = createOriginAnswerQualityBenchmarkQuotaChunkPlan(
    corpus,
    input.chunkIndex,
  );
  if (!plan.ok) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_QUOTA_CHUNK_PLAN_INVALID",
      detail: plan.code,
    };
  }

  const requiredLanes = new Set(
    plan.value.cases.map((item) =>
      resolveOriginAnswerQualityBenchmarkExecutionLane(item.category)
    ),
  );
  if (!validChunkEnvironment(input.environmentProof, input.gitSha, requiredLanes)) {
    return { ok: false, code: "AQ_BENCHMARK_QUOTA_CHUNK_ENVIRONMENT_INVALID" };
  }

  const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
  const evaluatorLimit =
    ORIGIN_AQ_CHUNK_MAX_CASES * ORIGIN_AQ_MAX_EVALUATOR_REQUESTS_PER_CASE;
  let evaluatorRequests = 0;
  const now = input.nowMs ?? Date.now;
  const startedAt = new Date(now()).toISOString();

  try {
    const createEvaluators = dependencies.createEvaluators
      ?? createOriginAnswerQualityBenchmarkProviderEvaluators;
    const evaluators = createEvaluators({
      env: input.env,
      nowMs: input.nowMs,
      planningOptions: input.evaluatorPlanningOptions,
      beforeProviderRequest: () => {
        if (evaluatorRequests >= evaluatorLimit) {
          throw new Error("AQ_BENCHMARK_CHUNK_EVALUATOR_REQUEST_BUDGET_EXCEEDED");
        }
        evaluatorRequests += 1;
      },
    });

    const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
      evidenceVault: vault,
      materialClaimExtractor: evaluators.materialClaimExtractor,
      promptClaimJudge: evaluators.promptClaimJudge,
      semanticJudge: evaluators.semanticJudge,
      batchClaimAssessor: evaluators.batchClaimAssessor,
      nowMs: input.nowMs,
    });

    const httpOptions = {
      environmentProof: input.environmentProof,
      fetchImpl: input.fetchImpl,
      nowMs: input.nowMs,
      evidenceVault: vault,
      expectedProviderId: input.providerId,
      expectedModelId: input.modelId,
    };

    const executors: OriginAnswerQualityBenchmarkLaneExecutors = {};

    if (requiredLanes.has("research")) {
      executors.research = createOriginAnswerQualityBenchmarkResearchHttpAdapter(httpOptions);
    }
    if (requiredLanes.has("chat")) {
      executors.chat = createOriginAnswerQualityBenchmarkChatHttpAdapter(httpOptions);
    }
    if (requiredLanes.has("artifact")) {
      executors.artifact = createOriginAnswerQualityBenchmarkArtifactHttpAdapter(httpOptions);
    }
    if (requiredLanes.has("coding")) {
      const createCodingAdapter = dependencies.createCodingAdapter
        ?? createOriginAnswerQualityBenchmarkCodingCheckoutAdapter;
      executors.coding = await createCodingAdapter({
        sourceRoot: input.sourceRoot,
        expectedGitSha: input.gitSha,
        env: input.env,
        nowMs: input.nowMs,
        evidenceVault: vault,
      });
    }

    for (const lane of requiredLanes) {
      if (!executors[lane]) {
        return {
          ok: false,
          code: "AQ_BENCHMARK_QUOTA_CHUNK_RUNTIME_NOT_READY",
          detail: lane,
        };
      }
    }

    const measuredById =
      new Map<string, OriginAnswerQualityBenchmarkMeasuredObservation>();

    const execution = await runOriginAnswerQualityBenchmark({
      manifest: plan.value.chunkManifest,
      cases: plan.value.cases,
      execute: createOriginAnswerQualityBenchmarkLaneExecutor(executors),
      score: async (item, evidence) => {
        const raw = await collector(item, evidence);
        const scored = scoreOriginAnswerQualityBenchmarkEvidence(evidence, raw);
        if (!scored.ok) throw new Error(scored.code);
        measuredById.set(item.caseId, scored.value);
        return scored.value;
      },
    });
    if (!execution.ok) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_QUOTA_CHUNK_EXECUTION_FAILED",
        detail: execution.failedCaseId
          ? `${execution.code}:${execution.failedCaseId}`
          : execution.code,
      };
    }

    const cases = plan.value.cases.map((item) => {
      const scored = execution.value.scoredCases.find(
        (entry) => entry.observation.caseId === item.caseId,
      );
      const measured = measuredById.get(item.caseId);
      if (!scored || !measured) {
        throw new Error("AQ_BENCHMARK_QUOTA_CHUNK_CASE_RESULT_MISSING");
      }
      return {
        caseId: item.caseId,
        category: item.category,
        caseDigest: item.caseDigest,
        execution: scored.execution,
        observation: measured,
      };
    });

    const artifact = createOriginAnswerQualityBenchmarkQuotaChunkArtifact({
      plan: plan.value,
      gitSha: input.gitSha,
      providerId: input.providerId,
      modelId: input.modelId,
      scorerProvenanceDigest: evaluators.scorerProvenance.scorerRevision,
      startedAt,
      completedAt: new Date(now()).toISOString(),
      evaluatorRequests,
      cases,
    });

    if (!artifact.ok) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_QUOTA_CHUNK_ARTIFACT_INVALID",
        detail: artifact.code,
      };
    }

    return { ok: true, value: artifact.value };
  } catch (error) {
    return {
      ok: false,
      code: "AQ_BENCHMARK_QUOTA_CHUNK_EXECUTION_FAILED",
      detail: error instanceof Error ? error.message : undefined,
    };
  } finally {
    vault.clear();
  }
}


export async function runOriginAnswerQualityOfficialQuotaChunk(
  input: OriginAnswerQualityOfficialQuotaChunkInput,
): Promise<OriginAnswerQualityOfficialQuotaChunkResult> {
  return runOriginAnswerQualityOfficialQuotaChunkHarness(input);
}
