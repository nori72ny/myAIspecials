// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertOriginBlindPacketDoesNotRevealSourceV2,
  buildOriginBlindJudgePacketV2,
} from "./OriginAnswerBlindJudgePacketV2.js";

describe("AQ V2 blind judge packet", () => {
  it("keeps model identity in a separate private key", () => {
    const result = buildOriginBlindJudgePacketV2({
      caseId: "aq2-01-1",
      prompt: "Explain the result clearly.",
      candidate: { sourceId: "origin-candidate", answer: "Candidate answer." },
      reference: { sourceId: "reference-a", answer: "Reference answer." },
      salt: "round-1-secret-salt",
    });

    const publicSerialized = JSON.stringify(result.packet);
    expect(publicSerialized).not.toContain("origin-candidate");
    expect(publicSerialized).not.toContain("reference-a");
    expect(result.key.answerASourceId).not.toBe(result.key.answerBSourceId);
  });

  it("detects explicit source identity leakage inside answer content", () => {
    const result = buildOriginBlindJudgePacketV2({
      caseId: "aq2-01-2",
      prompt: "Answer without product identity.",
      candidate: { sourceId: "origin", answer: "I am ORIGIN and here is the answer." },
      reference: { sourceId: "reference-b", answer: "Neutral answer." },
      salt: "round-1-secret-salt",
    });
    expect(() => assertOriginBlindPacketDoesNotRevealSourceV2(
      result.packet,
      ["ORIGIN", "reference-b"],
    )).toThrow("AQ_V2_BLIND_SOURCE_ID_LEAK");
  });

  it("is deterministic for the same frozen pair and salt", () => {
    const input = {
      caseId: "aq2-01-3",
      prompt: "Prompt.",
      candidate: { sourceId: "origin", answer: "A." },
      reference: { sourceId: "reference-c", answer: "B." },
      salt: "fixed",
    } as const;
    expect(buildOriginBlindJudgePacketV2(input)).toEqual(buildOriginBlindJudgePacketV2(input));
  });
});
