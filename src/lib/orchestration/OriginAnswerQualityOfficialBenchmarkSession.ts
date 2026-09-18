import { createHash } from "node:crypto";

import type { OriginClaimAssessor } from "./OriginClaimAssessor.js";
import type { OriginMaterialClaimExtractor } from "./OriginMaterialClaimExtractor.js";
import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";
import {
  createOriginAnswerQualityBenchmarkEphemeralEvidenceVault,
  type OriginAnswerQualityBenchmarkEphemeralEvidenceVault,
} from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault.js";
import {
  createOriginAnswerQualityBenchmarkOfficialScoringCollector,
} from "./OriginAnswerQualityBenchmarkOfficialScoringCollector.js";
import type {
  OriginAnswerQualityBenchmarkPromptClaimJudge,
} from "./OriginAnswerQualityBenchmarkPromptClaimJudge.js";
import type {
  OriginAnswerQualityBenchmarkSemanticJudge,
} from "./OriginAnswerQualityBenchmarkSemanticJudge.js";
import {
  createOriginSourceVerificationExecutor,
} from "./OriginSourceVerificationExecutor.js";
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
  type OriginAnswerQualityBenchmarkSessionSuccess,
} from "./OriginAnswerQualityBenchmarkSession.js";

export interface OriginAnswerQualityOfficialBenchmarkScorerProvenance {
  readonly schemaVersion: "origin.aq-benchmark-scorer.v1";
  readonly scorerId: "origin-aq-public-deterministic-v1";
  readonly scorerRevision: string;
  readonly corpusId: "aq-post-heldout-public";
  readonly corpusVersion: "v1";
}

export interface OriginAnswerQualityOfficialBenchmarkHarnessInput {
  readonly runId: string;
  readonly gitSha: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof;
  readonly sourceRoot: string;
  readonly collectScoringEvidence: OriginAnswerQualityBenchmarkScoringEvidenceCollector;
  readonly scorerProvenance: OriginAnswerQualityOfficialBenchmarkScorerProvenance;
  readonly evidenceVault?: OriginAnswerQualityBenchmarkEphemeralEvidenceVault;
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
  readonly nowMs?: () => number;
}

export interface OriginAnswerQualityOfficialBenchmarkSessionSuccess
  extends OriginAnswerQualityBenchmarkSessionSuccess {
  readonly scorerProvenance: OriginAnswerQualityOfficialBenchmarkScorerProvenance;
  readonly scorerProvenanceDigest: string;
}

export type OriginAnswerQualityOfficialBenchmarkSessionResult =
  | { ok: true; value: OriginAnswerQualityOfficialBenchmarkSessionSuccess }
  | Exclude<OriginAnswerQualityBenchmarkSessionResult, { ok: true }>
  | { ok: false; code: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID" };

const SHA256 = /^sha256:[a-f0-9]{64}$/;

export function digestOriginAnswerQualityOfficialScorerRevision(
  source: string,
): string {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

function canonicalScorerProvenance(
  value: OriginAnswerQualityOfficialBenchmarkScorerProvenance,
): string {
  return [
    value.schemaVersion,
    value.scorerId,
    value.scorerRevision,
    value.corpusId,
    value.corpusVersion,
  ].join("\n");
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
export async function runOriginAnswerQualityOfficialBenchmarkSessionHarness(
  input: OriginAnswerQualityOfficialBenchmarkHarnessInput,
): Promise<OriginAnswerQualityOfficialBenchmarkSessionResult> {
  if (!validScorerProvenance(input.scorerProvenance)) {
    return { ok: false, code: "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID" };
  }

  const httpOptions = {
    environmentProof: input.environmentProof,
    fetchImpl: input.fetchImpl,
    nowMs: input.nowMs,
    evidenceVault: input.evidenceVault,
  };

  const coding = await createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
    sourceRoot: input.sourceRoot,
    expectedGitSha: input.gitSha,
    env: input.env,
    nowMs: input.nowMs,
    evidenceVault: input.evidenceVault,
  });

  const session = await runOriginAnswerQualityBenchmarkSession({
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

  if (session.ok === false) return session;

  const scorerProvenance = Object.freeze({ ...input.scorerProvenance });
  return {
    ok: true,
    value: Object.freeze({
      ...session.value,
      scorerProvenance,
      scorerProvenanceDigest: digestOriginAnswerQualityOfficialScorerRevision(
        canonicalScorerProvenance(scorerProvenance),
      ),
    }),
  };
}


export interface OriginAnswerQualityOfficialBenchmarkSessionInput
  extends Omit<
    OriginAnswerQualityOfficialBenchmarkHarnessInput,
    "collectScoringEvidence" | "evidenceVault"
  > {
  readonly materialClaimExtractor: OriginMaterialClaimExtractor;
  readonly promptClaimJudge: OriginAnswerQualityBenchmarkPromptClaimJudge;
  readonly semanticJudge: OriginAnswerQualityBenchmarkSemanticJudge;
  readonly claimAssessor: OriginClaimAssessor;
}

/**
 * Preferred official AQ benchmark entrypoint.
 *
 * Raw answers/evidence exist only inside a consume-once in-memory vault.
 * Execution adapters and the scoring collector are constructed internally.
 * Public source verification is always composed through the pinned,
 * public-address-only source verifier; callers cannot replace the collector.
 */
export async function runOriginAnswerQualityOfficialBenchmarkSession(
  input: OriginAnswerQualityOfficialBenchmarkSessionInput,
): Promise<OriginAnswerQualityOfficialBenchmarkSessionResult> {
  const evidenceVault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
  const sourceVerificationExecutor = createOriginSourceVerificationExecutor({
    assessor: input.claimAssessor,
    now: input.nowMs,
  });

  const collector = createOriginAnswerQualityBenchmarkOfficialScoringCollector({
    evidenceVault,
    materialClaimExtractor: input.materialClaimExtractor,
    promptClaimJudge: input.promptClaimJudge,
    semanticJudge: input.semanticJudge,
    sourceVerificationExecutor,
    nowMs: input.nowMs,
  });

  try {
    return await runOriginAnswerQualityOfficialBenchmarkSessionHarness({
      runId: input.runId,
      gitSha: input.gitSha,
      providerId: input.providerId,
      modelId: input.modelId,
      environmentProof: input.environmentProof,
      sourceRoot: input.sourceRoot,
      scorerProvenance: input.scorerProvenance,
      fetchImpl: input.fetchImpl,
      env: input.env,
      nowMs: input.nowMs,
      evidenceVault,
      collectScoringEvidence: collector,
    });
  } finally {
    evidenceVault.clear();
  }
}


/**
 * Backward-compatible name for the evidence-grounded official entrypoint.
 * Official callers should prefer runOriginAnswerQualityOfficialBenchmarkSession.
 */
export const runOriginAnswerQualityOfficialEvidenceScoredSession =
  runOriginAnswerQualityOfficialBenchmarkSession;
