import { describe, expect, it } from "vitest";

import {
  assertOriginBenchmarkManifestMatch,
  createOriginAnswerQualityBenchmarkManifest,
} from "./OriginAnswerQualityBenchmarkManifest";

const cases = [
  {
    caseId: "case-current-1",
    category: "current-factual" as const,
    caseDigest: `sha256:${"a".repeat(64)}`,
  },
  {
    caseId: "case-conflict-1",
    category: "contradiction-detection" as const,
    caseDigest: `sha256:${"b".repeat(64)}`,
  },
];

describe("OriginAnswerQualityBenchmarkManifest", () => {
  it("creates a deterministic manifest independent of input ordering", () => {
    const one = createOriginAnswerQualityBenchmarkManifest("aq-post-heldout", "v1", cases);
    const two = createOriginAnswerQualityBenchmarkManifest(
      "aq-post-heldout",
      "v1",
      [...cases].reverse(),
    );
    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(one.value.manifestDigest).toBe(two.value.manifestDigest);
  });

  it("rejects duplicate case IDs and invalid digests", () => {
    expect(createOriginAnswerQualityBenchmarkManifest(
      "aq-post-heldout",
      "v1",
      [cases[0], cases[0]],
    )).toEqual({ ok: false, code: "INVALID_BENCHMARK_MANIFEST" });

    expect(createOriginAnswerQualityBenchmarkManifest(
      "aq-post-heldout",
      "v1",
      [{ ...cases[0], caseDigest: "not-a-digest" }],
    )).toEqual({ ok: false, code: "INVALID_BENCHMARK_MANIFEST" });
  });

  it("requires baseline and candidate to use the exact same benchmark manifest", () => {
    const baseline = createOriginAnswerQualityBenchmarkManifest("aq-post-heldout", "v1", cases);
    const candidate = createOriginAnswerQualityBenchmarkManifest("aq-post-heldout", "v1", cases);
    if (!baseline.ok || !candidate.ok) throw new Error("invalid fixture");

    expect(() => assertOriginBenchmarkManifestMatch(
      baseline.value,
      candidate.value,
    )).not.toThrow();
  });

  it("rejects case substitution between baseline and candidate", () => {
    const baseline = createOriginAnswerQualityBenchmarkManifest("aq-post-heldout", "v1", cases);
    const candidate = createOriginAnswerQualityBenchmarkManifest(
      "aq-post-heldout",
      "v1",
      [
        cases[0],
        {
          ...cases[1],
          caseDigest: `sha256:${"c".repeat(64)}`,
        },
      ],
    );
    if (!baseline.ok || !candidate.ok) throw new Error("invalid fixture");

    expect(() => assertOriginBenchmarkManifestMatch(
      baseline.value,
      candidate.value,
    )).toThrow("AQ_BENCHMARK_MANIFEST_MISMATCH");
  });
});
