import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityBenchmarkManifest } from "./OriginAnswerQualityBenchmarkManifest";
import {
  assertOriginBenchmarkComparableRuns,
  createOriginAnswerQualityBenchmarkRunProvenance,
} from "./OriginAnswerQualityBenchmarkRunProvenance";

function manifest() {
  const result = createOriginAnswerQualityBenchmarkManifest(
    "aq-post-heldout",
    "v1",
    [{
      caseId: "case-1",
      category: "current-factual",
      caseDigest: `sha256:${"a".repeat(64)}`,
    }],
  );
  if (!result.ok) throw new Error("invalid manifest");
  return result.value;
}

const sha = "f".repeat(40);

describe("OriginAnswerQualityBenchmarkRunProvenance", () => {
  it("binds a run to exact code, manifest, model, time window and zero cost", () => {
    const m = manifest();
    const result = createOriginAnswerQualityBenchmarkRunProvenance({
      runId: "aq-run-baseline-1",
      gitSha: sha,
      manifestDigest: m.manifestDigest,
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      freeOnly: true,
      totalCostUsd: 0,
      startedAt: "2026-09-18T10:00:00.000Z",
      completedAt: "2026-09-18T10:10:00.000Z",
    }, m);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(expect.objectContaining({
      schemaVersion: "origin.aq-benchmark-run.v1",
      gitSha: sha,
      totalCostUsd: 0,
      freeOnly: true,
    }));
  });

  it("rejects wrong manifest, paid runs and invalid time order", () => {
    const m = manifest();

    expect(createOriginAnswerQualityBenchmarkRunProvenance({
      runId: "aq-run-1",
      gitSha: sha,
      manifestDigest: `sha256:${"b".repeat(64)}`,
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      freeOnly: true,
      totalCostUsd: 0,
      startedAt: "2026-09-18T10:00:00.000Z",
      completedAt: "2026-09-18T10:10:00.000Z",
    }, m)).toEqual({ ok: false, code: "INVALID_BENCHMARK_RUN_PROVENANCE" });

    expect(createOriginAnswerQualityBenchmarkRunProvenance({
      runId: "aq-run-2",
      gitSha: sha,
      manifestDigest: m.manifestDigest,
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      freeOnly: true,
      totalCostUsd: 0.01 as 0,
      startedAt: "2026-09-18T10:00:00.000Z",
      completedAt: "2026-09-18T10:10:00.000Z",
    }, m)).toEqual({ ok: false, code: "INVALID_BENCHMARK_RUN_PROVENANCE" });

    expect(createOriginAnswerQualityBenchmarkRunProvenance({
      runId: "aq-run-3",
      gitSha: sha,
      manifestDigest: m.manifestDigest,
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      freeOnly: true,
      totalCostUsd: 0,
      startedAt: "2026-09-18T10:10:00.000Z",
      completedAt: "2026-09-18T10:00:00.000Z",
    }, m)).toEqual({ ok: false, code: "INVALID_BENCHMARK_RUN_PROVENANCE" });
  });

  it("requires the same manifest and model for before-after comparability", () => {
    const m = manifest();
    const baseline = createOriginAnswerQualityBenchmarkRunProvenance({
      runId: "aq-run-baseline",
      gitSha: "a".repeat(40),
      manifestDigest: m.manifestDigest,
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      freeOnly: true,
      totalCostUsd: 0,
      startedAt: "2026-09-18T10:00:00.000Z",
      completedAt: "2026-09-18T10:10:00.000Z",
    }, m);
    const candidate = createOriginAnswerQualityBenchmarkRunProvenance({
      runId: "aq-run-candidate",
      gitSha: "b".repeat(40),
      manifestDigest: m.manifestDigest,
      providerId: "openrouter-free",
      modelId: "example/free-model:free",
      freeOnly: true,
      totalCostUsd: 0,
      startedAt: "2026-09-18T11:00:00.000Z",
      completedAt: "2026-09-18T11:10:00.000Z",
    }, m);
    if (!baseline.ok || !candidate.ok) throw new Error("invalid fixture");

    expect(() => assertOriginBenchmarkComparableRuns(
      baseline.value,
      candidate.value,
    )).not.toThrow();

    expect(() => assertOriginBenchmarkComparableRuns(
      baseline.value,
      { ...candidate.value, modelId: "other/free-model:free" },
    )).toThrow("AQ_BENCHMARK_RUN_NOT_COMPARABLE");
  });
});
