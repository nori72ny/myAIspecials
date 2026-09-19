import { createHash } from "node:crypto";

import {
  buildOriginAnswerQualityBenchmarkEvaluationBundle,
  type OriginAnswerQualityBenchmarkEvaluationBundle,
} from "./OriginAnswerQualityBenchmarkEvaluationBundle.js";
import type {
  OriginAnswerQualityOfficialBenchmarkSessionSuccess,
  OriginAnswerQualityOfficialBenchmarkScorerProvenance,
} from "./OriginAnswerQualityOfficialBenchmarkSession.js";

export interface OriginAnswerQualityOfficialBenchmarkEvaluationBundle {
  readonly schemaVersion: "origin.aq-official-benchmark-evaluation-bundle.v1";
  readonly scorerProvenance: OriginAnswerQualityOfficialBenchmarkScorerProvenance;
  readonly scorerProvenanceDigest: string;
  readonly evaluation: OriginAnswerQualityBenchmarkEvaluationBundle;
  readonly officialBundleDigest: string;
}

export type OriginAnswerQualityOfficialBenchmarkEvaluationBundleResult =
  | { ok: true; value: OriginAnswerQualityOfficialBenchmarkEvaluationBundle }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_OFFICIAL_SCORER_MISMATCH"
        | "AQ_BENCHMARK_OFFICIAL_CORPUS_MISMATCH"
        | "AQ_BENCHMARK_OFFICIAL_EVALUATION_INVALID";
    };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sameScorer(
  baseline: OriginAnswerQualityOfficialBenchmarkSessionSuccess,
  candidate: OriginAnswerQualityOfficialBenchmarkSessionSuccess,
): boolean {
  return baseline.scorerProvenanceDigest === candidate.scorerProvenanceDigest
    && baseline.scorerProvenance.schemaVersion === candidate.scorerProvenance.schemaVersion
    && baseline.scorerProvenance.scorerId === candidate.scorerProvenance.scorerId
    && baseline.scorerProvenance.scorerRevision === candidate.scorerProvenance.scorerRevision
    && baseline.scorerProvenance.corpusId === candidate.scorerProvenance.corpusId
    && baseline.scorerProvenance.corpusVersion === candidate.scorerProvenance.corpusVersion;
}

export function buildOriginAnswerQualityOfficialBenchmarkEvaluationBundle(
  baseline: OriginAnswerQualityOfficialBenchmarkSessionSuccess,
  candidate: OriginAnswerQualityOfficialBenchmarkSessionSuccess,
): OriginAnswerQualityOfficialBenchmarkEvaluationBundleResult {
  if (!sameScorer(baseline, candidate)) {
    return { ok: false, code: "AQ_BENCHMARK_OFFICIAL_SCORER_MISMATCH" };
  }

  if (
    baseline.corpus.benchmarkId !== candidate.corpus.benchmarkId
    || baseline.corpus.benchmarkVersion !== candidate.corpus.benchmarkVersion
    || baseline.corpus.manifest.manifestDigest !== candidate.corpus.manifest.manifestDigest
  ) {
    return { ok: false, code: "AQ_BENCHMARK_OFFICIAL_CORPUS_MISMATCH" };
  }

  const evaluation = buildOriginAnswerQualityBenchmarkEvaluationBundle(
    baseline.corpus.manifest,
    candidate.corpus.manifest,
    baseline.measuredRun,
    candidate.measuredRun,
  );
  if (!evaluation.ok) {
    return { ok: false, code: "AQ_BENCHMARK_OFFICIAL_EVALUATION_INVALID" };
  }

  const canonical = [
    baseline.scorerProvenanceDigest,
    evaluation.value.bundleDigest,
    evaluation.value.baselineGitSha,
    evaluation.value.candidateGitSha,
  ].join("\n");

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-official-benchmark-evaluation-bundle.v1",
      scorerProvenance: Object.freeze({ ...baseline.scorerProvenance }),
      scorerProvenanceDigest: baseline.scorerProvenanceDigest,
      evaluation: evaluation.value,
      officialBundleDigest: sha256(canonical),
    }),
  };
}
