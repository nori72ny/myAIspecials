import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import { digestOriginAnswerQualityBenchmarkCase } from "./OriginAnswerQualityBenchmarkRunner";
import { ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES } from "./OriginAnswerQualityBenchmarkQualification";

describe("OriginAnswerQualityBenchmarkCorpus", () => {
  it("freezes exactly forty cases across ten families", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();

    expect(corpus.cases).toHaveLength(40);
    expect(corpus.manifest.cases).toHaveLength(40);
    expect(corpus.benchmarkId).toBe("aq-post-heldout-public");
    expect(corpus.benchmarkVersion).toBe("v1");

    for (const family of ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES) {
      expect(corpus.cases.filter((item) => item.category === family)).toHaveLength(4);
    }
  });

  it("meets language, mobile-length and multi-turn distribution floors", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();

    expect(corpus.cases.filter((item) => item.locale === "en").length).toBeGreaterThanOrEqual(10);
    expect(corpus.cases.filter((item) => item.mobileLength).length).toBeGreaterThanOrEqual(12);
    expect(corpus.cases.filter((item) => item.multiTurn).length).toBeGreaterThanOrEqual(10);
  });

  it("binds every public prompt to its manifest digest", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const manifestById = new Map(corpus.manifest.cases.map((item) => [item.caseId, item]));

    for (const item of corpus.cases) {
      expect(item.caseDigest).toBe(
        digestOriginAnswerQualityBenchmarkCase(item.caseId, item.category, item.prompt),
      );
      expect(manifestById.get(item.caseId)?.caseDigest).toBe(item.caseDigest);
    }
  });

  it("contains no final-held-out task identifiers or private corpus payload fields", () => {
    const corpus = createOriginAnswerQualityFrozenCorpus();
    const serialized = JSON.stringify(corpus);

    expect(serialized).not.toContain("ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64");
    expect(serialized).not.toContain("hiddenTests");
    expect(serialized).not.toContain("expectedPatch");
    expect(serialized).not.toContain("referencePatch");
  });
});
