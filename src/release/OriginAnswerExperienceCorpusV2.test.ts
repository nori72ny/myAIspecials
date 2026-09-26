// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ORIGIN_ANSWER_EXPERIENCE_CASES_V2,
  validateOriginAnswerExperienceCorpusV2,
} from "./OriginAnswerExperienceCorpusV2.js";

describe("OriginAnswerExperienceCorpusV2", () => {
  it("freezes a balanced 24-case experience corpus", () => {
    expect(validateOriginAnswerExperienceCorpusV2()).toBe(true);
    expect(ORIGIN_ANSWER_EXPERIENCE_CASES_V2).toHaveLength(24);
    expect(new Set(ORIGIN_ANSWER_EXPERIENCE_CASES_V2.map((item) => item.family)).size).toBe(8);
  });

  it("requires mobile/tablet/desktop render evidence for every case", () => {
    for (const item of ORIGIN_ANSWER_EXPERIENCE_CASES_V2) {
      expect(item.renderViewports).toEqual([390, 768, 1440]);
    }
  });
});
