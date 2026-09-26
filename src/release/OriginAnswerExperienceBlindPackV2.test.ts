// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildOriginAnswerExperienceBlindPackV2,
  unblindOriginAnswerExperienceJudgmentsV2,
} from "./OriginAnswerExperienceBlindPackV2.js";

const pairs = Array.from({ length: 8 }, (_, index) => ({
  caseId: `case-${index + 1}`,
  surface: (["chat", "research", "coding", "artifact"] as const)[index % 4],
  prompt: `Prompt ${index + 1}`,
  candidateAnswer: `Candidate answer ${index + 1}`,
  competitorId: index % 2 === 0 ? "competitor-one" : "competitor-two",
  competitorAnswer: `Competitor answer ${index + 1}`,
}));

describe("OriginAnswerExperienceBlindPackV2", () => {
  it("creates an exactly balanced A/B presentation for an even case count", () => {
    const pack = buildOriginAnswerExperienceBlindPackV2({
      judgeId: "judge-alpha",
      seed: "frozen-seed-v1",
      pairs,
    });
    const a = pack.answerKey.filter((item) => item.candidatePresentedAs === "A").length;
    const b = pack.answerKey.filter((item) => item.candidatePresentedAs === "B").length;
    expect(a).toBe(4);
    expect(b).toBe(4);
  });

  it("does not expose candidate/competitor labels in review items", () => {
    const pack = buildOriginAnswerExperienceBlindPackV2({
      judgeId: "judge-alpha",
      seed: "frozen-seed-v1",
      pairs,
    });
    const serialized = JSON.stringify(pack.reviewItems);
    expect(serialized).not.toContain("candidatePresentedAs");
    expect(serialized).not.toContain("competitorId");
    expect(serialized).not.toContain("candidateDigest");
  });

  it("unblinds A/B/tie judgments against the private answer key", () => {
    const pack = buildOriginAnswerExperienceBlindPackV2({
      judgeId: "judge-beta",
      seed: "frozen-seed-v1",
      pairs,
    });
    const judgments = pack.answerKey.map((key, index) => ({
      blindId: key.blindId,
      winner: index === 0 ? "tie" as const : key.candidatePresentedAs,
    }));
    const rows = unblindOriginAnswerExperienceJudgmentsV2({ pack, judgments });
    expect(rows[0].winner).toBe("tie");
    expect(rows.slice(1).every((row) => row.winner === "candidate")).toBe(true);
  });

  it("fails closed on duplicate pair identity and missing judgments", () => {
    expect(() => buildOriginAnswerExperienceBlindPackV2({
      judgeId: "judge-alpha",
      seed: "frozen-seed-v1",
      pairs: [pairs[0], pairs[0]],
    })).toThrow("ANSWER_EXPERIENCE_BLIND_PAIR_DUPLICATE");

    const pack = buildOriginAnswerExperienceBlindPackV2({
      judgeId: "judge-alpha",
      seed: "frozen-seed-v1",
      pairs,
    });
    expect(() => unblindOriginAnswerExperienceJudgmentsV2({
      pack,
      judgments: [],
    })).toThrow("ANSWER_EXPERIENCE_BLIND_JUDGMENT_COUNT_MISMATCH");
  });
});
