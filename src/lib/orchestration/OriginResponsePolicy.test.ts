import { describe, expect, it } from "vitest";

import { classifyOriginRequestIntent } from "./OriginRequestIntent";
import { originResponsePolicyInstruction, resolveOriginResponsePolicy } from "./OriginResponsePolicy";

describe("OriginResponsePolicy", () => {
  it("keeps ordinary conversation natural and answer-first", () => {
    const intent = classifyOriginRequestIntent("考えを整理するのを手伝ってください", "review");
    const policy = resolveOriginResponsePolicy({ intent, taskType: "review", userMessage: "考えを整理するのを手伝ってください" });

    expect(policy.structure).toBe("conversation");
    expect(policy.tone).toBe("conversational");
    expect(policy.preferParagraphs).toBe(true);
    expect(policy.directAnswerFirst).toBe(true);
  });

  it("uses deep technical presentation for detailed architecture work", () => {
    const message = "この認証設計を詳しくレビューして、問題と修正方針を説明してください";
    const intent = classifyOriginRequestIntent(message, "architecture");
    const policy = resolveOriginResponsePolicy({ intent, taskType: "architecture", userMessage: message });

    expect(policy.depth).toBe("deep");
    expect(policy.structure).toBe("technical");
    expect(policy.tone).toBe("professional");
  });

  it("does not force a table when the user explicitly forbids tables", () => {
    const message = "AとBを比較してください。表なしで文章で説明してください";
    const intent = classifyOriginRequestIntent(message, "research");
    const policy = resolveOriginResponsePolicy({ intent, taskType: "research", userMessage: message });

    expect(policy.allowTables).toBe(false);
    expect(policy.structure).toBe("comparison");
  });

  it("honors explicit no-bullets formatting", () => {
    const message = "箇条書きなしで、短く説明してください";
    const intent = classifyOriginRequestIntent(message, "review");
    const policy = resolveOriginResponsePolicy({ intent, taskType: "review", userMessage: message });

    expect(policy.depth).toBe("concise");
    expect(policy.allowBullets).toBe(false);
    expect(policy.explicitFormatRequested).toBe(true);
  });

  it("treats deliverables as deliverable-first instead of adding meta commentary", () => {
    const message = "社内向け報告書を作成してください";
    const intent = classifyOriginRequestIntent(message, "documentation");
    const policy = resolveOriginResponsePolicy({ intent, taskType: "documentation", userMessage: message });

    expect(policy.structure).toBe("deliverable");
    expect(policy.directAnswerFirst).toBe(false);
    expect(policy.tone).toBe("professional");
  });

  it("keeps presentation subordinate to correctness, evidence, and safety", () => {
    const intent = classifyOriginRequestIntent("最新情報を調査してください", "current-information");
    const policy = resolveOriginResponsePolicy({ intent, taskType: "current-information", userMessage: "最新情報を調査してください" });
    const instruction = originResponsePolicyInstruction(policy);

    expect(instruction).toContain("never override factuality, safety, citations, or tool evidence");
    expect(instruction).toContain("Keep evidence/citations adjacent");
    expect(instruction).toContain("Avoid repeated conclusions");
  });

  it("preserves exact-format requests as hard requirements", () => {
    const message = "JSONのみで3項目返してください";
    const intent = classifyOriginRequestIntent(message, "review");
    const policy = resolveOriginResponsePolicy({ intent, taskType: "review", userMessage: message });
    const instruction = originResponsePolicyInstruction(policy);

    expect(policy.explicitFormatRequested).toBe(true);
    expect(instruction).toContain("hard requirement");
    expect(instruction).toContain("Do not add wrappers");
  });
});
