// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ORIGIN_AQ_V2_AXES } from "./OriginAnswerExperienceV2.js";
import {
  ORIGIN_AQ_V2_RUBRIC,
  assertOriginAnswerExperienceRubricV2,
} from "./OriginAnswerExperienceRubricV2.js";

describe("AQ V2 scoring rubric", () => {
  it("defines an exact 0-4 band for every scored axis", () => {
    expect(() => assertOriginAnswerExperienceRubricV2()).not.toThrow();
    expect(Object.keys(ORIGIN_AQ_V2_RUBRIC).sort()).toEqual([...ORIGIN_AQ_V2_AXES].sort());
    for (const axis of ORIGIN_AQ_V2_AXES) {
      expect(ORIGIN_AQ_V2_RUBRIC[axis].bands.map(item => item.score)).toEqual([0, 1, 2, 3, 4]);
      expect(ORIGIN_AQ_V2_RUBRIC[axis].question.length).toBeGreaterThan(20);
    }
  });

  it("makes top scores demanding rather than simple absence-of-failure", () => {
    expect(ORIGIN_AQ_V2_RUBRIC.truth.bands[4].definition).toContain("evidence boundaries");
    expect(ORIGIN_AQ_V2_RUBRIC.structure.bands[4].definition).toContain("right order");
    expect(ORIGIN_AQ_V2_RUBRIC.visualReadability.bands[4].definition).toContain("across viewports");
  });
});
