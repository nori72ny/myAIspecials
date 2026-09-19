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
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import {
  assertOriginAnswerQualityBenchmarkRuntimeReady,
} from "./OriginAnswerQualityBenchmarkRuntimeReadiness.js";
import {
  isOriginAnswerQualityBenchmarkSessionEnvironmentProofValid,
} from "./OriginAnswerQualityBenchmarkSession.js";
import type {
  OriginAnswerQualityBenchmarkEnvironmentProof,
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
  readonly environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof;
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

export async function runOriginAnswerQualityOfficialQuotaChunk(
  input: OriginAnswerQualityOfficialQuotaChunkInput,
): Promise<OriginAnswerQualityOfficialQuotaChunkResult> {
  if (!isOriginAnswerQualityBenchmarkSessionEnvironmentProofValid(
    input.environmentProof,
    input.gitSha,
  )) {
    return { ok: false, code: "AQ_BENCHMARK_QUOTA_CHUNK_ENVIRONMENT_INVALID" };
  }

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

  const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
  const evaluatorLimit =
    ORIGIN_AQ_CHUNK_MAX_CASES * ORIGIN_AQ_MAX_EVALUATOR_REQUESTS_PER_CASE;
  let evaluatorRequests = 0;
  const now = input.nowMs ?? Date.now;
  const startedAt = new Date(now()).toISOString();

  try {
    const evaluators = createOriginAnswerQualityBenchmarkProviderEvaluators({
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

    const coding = await createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
      sourceRoot: input.sourceRoot,
      expectedGitSha: input.gitSha,
      env: input.env,
      nowMs: input.nowMs,
      evidenceVault: vault,
    });

    const executors = {
      research: createOriginAnswerQualityBenchmarkResearchHttpAdapter(httpOptions),
      chat: createOriginAnswerQualityBenchmarkChatHttpAdapter(httpOptions),
      coding,
      artifact: createOriginAnswerQualityBenchmarkArtifactHttpAdapter(httpOptions),
    };

    try {
      assertOriginAnswerQualityBenchmarkRuntimeReady(executors);
    } catch (error) {
      return {
        ok: false,
        code: "AQ_BENCHMARK_QUOTA_CHUNK_RUNTIME_NOT_READY",
        detail: error instanceof Error ? error.message : undefined,
      };
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
      scorerProvenanceDigest: evaluators.scorerProvenance
        ? `sha256:${await import("node:crypto").then(({ createHash }) =>
          createHash("sha256").update([
            evaluators.scorerProvenance.schemaVersion,
            evaluators.scorerProvenance.scorerId,
            evaluators.scorerProvenance.scorerRevision,
            evaluators.scorerProvenance.corpusId,
            evaluators.scorerProvenance.corpusVersion,
          ].join("\n"), "utf8").digest("hex")
        )}`
        : "",
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
