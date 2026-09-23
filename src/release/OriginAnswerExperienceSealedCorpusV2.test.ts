// @vitest-environment node
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ORIGIN_AQ_V2_FAMILIES } from "./OriginAnswerExperienceV2.js";
import {
  ORIGIN_AQ_V2_SEALED_CORPUS_VERSION,
  parseOriginAnswerExperienceSealedCorpusGzipBase64V2,
  prepareOriginAnswerExperienceSealedCorpusV2,
  publicOriginAnswerExperienceCorpusEvidenceV2,
  type OriginAnswerExperienceSealedCorpusV2,
} from "./OriginAnswerExperienceSealedCorpusV2.js";

function corpus(): OriginAnswerExperienceSealedCorpusV2 {
  return {
    schemaVersion: ORIGIN_AQ_V2_SEALED_CORPUS_VERSION,
    corpusId: "aq-v2-synthetic",
    cases: ORIGIN_AQ_V2_FAMILIES.flatMap((family, familyIndex) =>
      Array.from({ length: 3 }, (_, index) => ({
        caseId: `aq2-${String(familyIndex + 1).padStart(2, "0")}-${index + 1}`,
        family,
        prompt: `SECRET PROMPT ${familyIndex + 1}-${index + 1}`,
        evaluatorNotes: `SECRET NOTES ${familyIndex + 1}-${index + 1}`,
      })),
    ),
  };
}

describe("AQ V2 sealed corpus", () => {
  it("derives a public manifest without leaking prompt or evaluator notes", () => {
    const prepared = prepareOriginAnswerExperienceSealedCorpusV2(corpus());
    const publicEvidence = JSON.stringify(publicOriginAnswerExperienceCorpusEvidenceV2(prepared));
    expect(prepared.publicManifest.cases).toHaveLength(48);
    expect(prepared.corpusDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(publicEvidence).not.toContain("SECRET PROMPT");
    expect(publicEvidence).not.toContain("SECRET NOTES");
  });

  it("parses gzip/base64 input and keeps a stable digest", () => {
    const source = corpus();
    const encoded = gzipSync(Buffer.from(JSON.stringify(source))).toString("base64");
    const first = parseOriginAnswerExperienceSealedCorpusGzipBase64V2(encoded);
    const second = prepareOriginAnswerExperienceSealedCorpusV2(source);
    expect(first.corpusDigest).toBe(second.corpusDigest);
  });

  it("fails closed when the frozen family shape is incomplete", () => {
    const source = corpus();
    expect(() => prepareOriginAnswerExperienceSealedCorpusV2({
      ...source,
      cases: source.cases.slice(0, -1),
    })).toThrow("AQ_V2_SEALED_SHAPE_INVALID");
  });
});
