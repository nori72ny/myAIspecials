import type { OriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest.js";

export interface OriginAnswerQualityBenchmarkRunProvenance {
  readonly schemaVersion: "origin.aq-benchmark-run.v1";
  readonly runId: string;
  readonly gitSha: string;
  readonly manifestDigest: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly freeOnly: true;
  readonly totalCostUsd: 0;
  readonly startedAt: string;
  readonly completedAt: string;
}

export type OriginAnswerQualityBenchmarkRunResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkRunProvenance }
  | { ok: false; code: "INVALID_BENCHMARK_RUN_PROVENANCE" };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function validIso(value: string): boolean {
  return ISO_UTC.test(value) && Number.isFinite(Date.parse(value));
}

export function createOriginAnswerQualityBenchmarkRunProvenance(
  input: Omit<OriginAnswerQualityBenchmarkRunProvenance, "schemaVersion">,
  manifest: OriginAnswerQualityBenchmarkManifest,
): OriginAnswerQualityBenchmarkRunResult {
  if (
    !ID.test(input.runId)
    || !SHA40.test(input.gitSha)
    || !DIGEST.test(input.manifestDigest)
    || input.manifestDigest !== manifest.manifestDigest
    || !ID.test(input.providerId)
    || !ID.test(input.modelId)
    || input.freeOnly !== true
    || input.totalCostUsd !== 0
    || !validIso(input.startedAt)
    || !validIso(input.completedAt)
    || Date.parse(input.completedAt) < Date.parse(input.startedAt)
  ) {
    return { ok: false, code: "INVALID_BENCHMARK_RUN_PROVENANCE" };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-run.v1",
      ...input,
    }),
  };
}

export function assertOriginBenchmarkComparableRuns(
  baseline: OriginAnswerQualityBenchmarkRunProvenance,
  candidate: OriginAnswerQualityBenchmarkRunProvenance,
): void {
  if (
    baseline.manifestDigest !== candidate.manifestDigest
    || baseline.providerId !== candidate.providerId
    || baseline.modelId !== candidate.modelId
    || baseline.freeOnly !== true
    || candidate.freeOnly !== true
    || baseline.totalCostUsd !== 0
    || candidate.totalCostUsd !== 0
  ) {
    throw new Error("AQ_BENCHMARK_RUN_NOT_COMPARABLE");
  }
}
