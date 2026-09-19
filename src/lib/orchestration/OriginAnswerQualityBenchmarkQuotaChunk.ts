import { createHash } from "node:crypto";

import {
  createOriginAnswerQualityBenchmarkManifest,
  type OriginAnswerQualityBenchmarkManifest,
} from "./OriginAnswerQualityBenchmarkManifest.js";
import type {
  OriginAnswerQualityBenchmarkCorpusCase,
  OriginAnswerQualityBenchmarkFrozenCorpus,
} from "./OriginAnswerQualityBenchmarkCorpus.js";

export const ORIGIN_AQ_FREE_DAILY_REQUEST_LIMIT = 50;
export const ORIGIN_AQ_CHUNK_MAX_CASES = 4;
export const ORIGIN_AQ_MAX_RUNTIME_PROVIDER_REQUESTS_PER_CASE = 7;
export const ORIGIN_AQ_MAX_EVALUATOR_REQUESTS_PER_CASE = 4;
export const ORIGIN_AQ_FREE_REQUEST_RESERVE = 6;

export interface OriginAnswerQualityBenchmarkQuotaChunkPlan {
  readonly schemaVersion: "origin.aq-benchmark-quota-chunk-plan.v1";
  readonly parentBenchmarkId: "aq-post-heldout-public";
  readonly parentBenchmarkVersion: "v1";
  readonly parentManifestDigest: string;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly cases: readonly OriginAnswerQualityBenchmarkCorpusCase[];
  readonly chunkManifest: OriginAnswerQualityBenchmarkManifest;
  readonly theoreticalMaxRequests: number;
  readonly dailyRequestLimit: 50;
  readonly reservedRequests: 6;
  readonly planDigest: string;
}

export type OriginAnswerQualityBenchmarkQuotaChunkPlanResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkQuotaChunkPlan }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_CHUNK_INDEX_INVALID"
        | "AQ_BENCHMARK_CHUNK_REQUEST_BUDGET_INVALID";
    };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function theoreticalRequests(caseCount: number): number {
  return caseCount * (
    ORIGIN_AQ_MAX_RUNTIME_PROVIDER_REQUESTS_PER_CASE
    + ORIGIN_AQ_MAX_EVALUATOR_REQUESTS_PER_CASE
  );
}

function chunkCases(
  corpus: OriginAnswerQualityBenchmarkFrozenCorpus,
  chunkIndex: number,
): readonly OriginAnswerQualityBenchmarkCorpusCase[] | null {
  const chunkCount = Math.ceil(corpus.cases.length / ORIGIN_AQ_CHUNK_MAX_CASES);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount) {
    return null;
  }

  const start = chunkIndex * ORIGIN_AQ_CHUNK_MAX_CASES;
  return Object.freeze(
    corpus.cases.slice(start, start + ORIGIN_AQ_CHUNK_MAX_CASES),
  );
}

export function createOriginAnswerQualityBenchmarkQuotaChunkPlan(
  corpus: OriginAnswerQualityBenchmarkFrozenCorpus,
  chunkIndex: number,
): OriginAnswerQualityBenchmarkQuotaChunkPlanResult {
  const cases = chunkCases(corpus, chunkIndex);
  if (!cases) {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_INDEX_INVALID" };
  }

  const maxRequests = theoreticalRequests(cases.length);
  if (
    maxRequests + ORIGIN_AQ_FREE_REQUEST_RESERVE
    > ORIGIN_AQ_FREE_DAILY_REQUEST_LIMIT
  ) {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_REQUEST_BUDGET_INVALID" };
  }

  const chunkManifestResult = createOriginAnswerQualityBenchmarkManifest(
    `${corpus.benchmarkId}.chunk-${chunkIndex + 1}`,
    corpus.benchmarkVersion,
    cases.map(({ caseId, category, caseDigest }) => ({
      caseId,
      category,
      caseDigest,
    })),
  );
  if (!chunkManifestResult.ok) {
    return { ok: false, code: "AQ_BENCHMARK_CHUNK_REQUEST_BUDGET_INVALID" };
  }

  const chunkCount = Math.ceil(corpus.cases.length / ORIGIN_AQ_CHUNK_MAX_CASES);
  const canonical = [
    corpus.benchmarkId,
    corpus.benchmarkVersion,
    corpus.manifest.manifestDigest,
    chunkIndex,
    chunkCount,
    maxRequests,
    ORIGIN_AQ_FREE_DAILY_REQUEST_LIMIT,
    ORIGIN_AQ_FREE_REQUEST_RESERVE,
    chunkManifestResult.value.manifestDigest,
    ...cases.map((item) => item.caseDigest),
  ].join("\n");

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-quota-chunk-plan.v1",
      parentBenchmarkId: corpus.benchmarkId,
      parentBenchmarkVersion: corpus.benchmarkVersion,
      parentManifestDigest: corpus.manifest.manifestDigest,
      chunkIndex,
      chunkCount,
      cases,
      chunkManifest: chunkManifestResult.value,
      theoreticalMaxRequests: maxRequests,
      dailyRequestLimit: ORIGIN_AQ_FREE_DAILY_REQUEST_LIMIT,
      reservedRequests: ORIGIN_AQ_FREE_REQUEST_RESERVE,
      planDigest: sha256(canonical),
    }),
  };
}

export function assertOriginAnswerQualityBenchmarkQuotaChunkUsage(
  plan: OriginAnswerQualityBenchmarkQuotaChunkPlan,
  runtimeProviderRequests: number,
  evaluatorRequests: number,
): void {
  if (
    !Number.isInteger(runtimeProviderRequests)
    || runtimeProviderRequests < 0
    || !Number.isInteger(evaluatorRequests)
    || evaluatorRequests < 0
  ) {
    throw new Error("AQ_BENCHMARK_CHUNK_REQUEST_USAGE_INVALID");
  }

  const used = runtimeProviderRequests + evaluatorRequests;
  if (
    used > plan.theoreticalMaxRequests
    || used + plan.reservedRequests > plan.dailyRequestLimit
  ) {
    throw new Error("AQ_BENCHMARK_CHUNK_REQUEST_BUDGET_EXCEEDED");
  }
}
