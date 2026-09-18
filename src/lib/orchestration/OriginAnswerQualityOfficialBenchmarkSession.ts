import { createHash } from "node:crypto";

import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";
import { createOriginAnswerQualityBenchmarkCodingCheckoutAdapter } from "./OriginAnswerQualityBenchmarkCodingCheckoutAdapter.js";
import {
  createOriginAnswerQualityBenchmarkArtifactHttpAdapter,
  createOriginAnswerQualityBenchmarkChatHttpAdapter,
  createOriginAnswerQualityBenchmarkResearchHttpAdapter,
} from "./OriginAnswerQualityBenchmarkHttpRuntimeAdapters.js";
import {
  runOriginAnswerQualityBenchmarkSession,
  type OriginAnswerQualityBenchmarkScoringEvidenceCollector,
  type OriginAnswerQualityBenchmarkSessionResult,
} from "./OriginAnswerQualityBenchmarkSession.js";

export interface OriginAnswerQualityOfficialBenchmarkScorerProvenance {
  readonly schemaVersion: "origin.aq-benchmark-scorer.v1";
  readonly scorerId: "origin-aq-public-deterministic-v1";
  readonly scorerRevision: string;
  readonly corpusId: "aq-post-heldout-public";
  readonly corpusVersion: "v1";
}

export interface OriginAnswerQualityOfficialBenchmarkSessionInput {
  readonly runId: string;
  readonly gitSha: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof;
  readonly sourceRoot: string;
  readonly collectScoringEvidence: OriginAnswerQualityBenchmarkScoringEvidenceCollector;
  readonly scorerProvenance: OriginAnswerQualityOfficialBenchmarkScorerProvenance;
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
  readonly nowMs?: () => number;
}

export type OriginAnswerQualityOfficialBenchmarkSessionResult =
  | OriginAnswerQualityBenchmarkSessionResult
  | { ok: false; code: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID" };

const SHA256 = /^sha256:[a-f0-9]{64}$/;

export function digestOriginAnswerQualityOfficialScorerRevision(
  source: string,
): string {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

function validScorerProvenance(
  value: OriginAnswerQualityOfficialBenchmarkScorerProvenance,
): boolean {
  return value.schemaVersion === "origin.aq-benchmark-scorer.v1"
    && value.scorerId === "origin-aq-public-deterministic-v1"
    && value.corpusId === "aq-post-heldout-public"
    && value.corpusVersion === "v1"
    && SHA256.test(value.scorerRevision);
}

/**
 * Official public AQ benchmark entrypoint.
 *
 * Unlike the generic session harness, callers cannot supply execution-lane
 * adapters. Research/Chat/Artifact are always constructed from the exact
 * environment proof and Coding is always constructed from the exact clean
 * checkout. The scoring collector remains an explicit evaluation dependency,
 * but its implementation revision is provenance-bound for before/after
 * comparability.
 */
export async function runOriginAnswerQualityOfficialBenchmarkSession(
  input: OriginAnswerQualityOfficialBenchmarkSessionInput,
): Promise<OriginAnswerQualityOfficialBenchmarkSessionResult> {
  if (!validScorerProvenance(input.scorerProvenance)) {
    return { ok: false, code: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID" };
  }

  const httpOptions = {
    environmentProof: input.environmentProof,
    fetchImpl: input.fetchImpl,
    nowMs: input.nowMs,
  };

  const coding = await createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
    sourceRoot: input.sourceRoot,
    expectedGitSha: input.gitSha,
    env: input.env,
    nowMs: input.nowMs,
  });

  return runOriginAnswerQualityBenchmarkSession({
    runId: input.runId,
    gitSha: input.gitSha,
    providerId: input.providerId,
    modelId: input.modelId,
    environmentProof: input.environmentProof,
    executors: {
      research: createOriginAnswerQualityBenchmarkResearchHttpAdapter(httpOptions),
      chat: createOriginAnswerQualityBenchmarkChatHttpAdapter(httpOptions),
      coding,
      artifact: createOriginAnswerQualityBenchmarkArtifactHttpAdapter(httpOptions),
    },
    collectScoringEvidence: input.collectScoringEvidence,
    nowMs: input.nowMs,
  });
}
