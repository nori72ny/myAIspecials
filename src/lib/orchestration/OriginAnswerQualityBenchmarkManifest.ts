import { createHash } from "node:crypto";

import type { OriginAnswerQualityBenchmarkCategory } from "./OriginAnswerQualityBenchmark.js";

export interface OriginAnswerQualityBenchmarkCaseManifest {
  readonly caseId: string;
  readonly category: OriginAnswerQualityBenchmarkCategory;
  readonly caseDigest: string;
}

export interface OriginAnswerQualityBenchmarkManifest {
  readonly schemaVersion: "origin.aq-benchmark-manifest.v1";
  readonly benchmarkId: string;
  readonly benchmarkVersion: string;
  readonly cases: readonly OriginAnswerQualityBenchmarkCaseManifest[];
  readonly manifestDigest: string;
}

export type OriginAnswerQualityBenchmarkManifestResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkManifest }
  | { ok: false; code: "INVALID_BENCHMARK_MANIFEST" };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function createOriginAnswerQualityBenchmarkManifest(
  benchmarkId: string,
  benchmarkVersion: string,
  cases: readonly OriginAnswerQualityBenchmarkCaseManifest[],
): OriginAnswerQualityBenchmarkManifestResult {
  if (
    !ID.test(benchmarkId)
    || !ID.test(benchmarkVersion)
    || cases.length === 0
    || cases.length > 512
  ) {
    return { ok: false, code: "INVALID_BENCHMARK_MANIFEST" };
  }

  const seen = new Set<string>();
  const normalized: OriginAnswerQualityBenchmarkCaseManifest[] = [];
  for (const item of cases) {
    if (!ID.test(item.caseId) || !DIGEST.test(item.caseDigest) || seen.has(item.caseId)) {
      return { ok: false, code: "INVALID_BENCHMARK_MANIFEST" };
    }
    seen.add(item.caseId);
    normalized.push(Object.freeze({ ...item }));
  }

  const canonical = [...normalized]
    .sort((a, b) => a.caseId.localeCompare(b.caseId))
    .map((item) => `${item.caseId}\t${item.category}\t${item.caseDigest}`)
    .join("\n");

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-manifest.v1",
      benchmarkId,
      benchmarkVersion,
      cases: Object.freeze([...normalized]),
      manifestDigest: sha256(`${benchmarkId}\n${benchmarkVersion}\n${canonical}`),
    }),
  };
}

export function assertOriginBenchmarkManifestMatch(
  baseline: OriginAnswerQualityBenchmarkManifest,
  candidate: OriginAnswerQualityBenchmarkManifest,
): void {
  if (
    baseline.benchmarkId !== candidate.benchmarkId
    || baseline.benchmarkVersion !== candidate.benchmarkVersion
    || baseline.manifestDigest !== candidate.manifestDigest
    || baseline.cases.length !== candidate.cases.length
  ) {
    throw new Error("AQ_BENCHMARK_MANIFEST_MISMATCH");
  }
}
