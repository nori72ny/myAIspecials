import { describe, expect, it } from "vitest";

import { auditOriginAnswerUxStatic } from "./OriginAnswerUxStaticAudit";

describe("OriginAnswerUxStaticAudit", () => {
  it("does not penalize a compact direct answer", () => {
    const result = auditOriginAnswerUxStatic("可能です。設定画面で通知をオフにしてください。", "通知をオフにできますか？");
    expect(result.findings).toEqual([]);
  });

  it("flags generic preamble", () => {
    const result = auditOriginAnswerUxStatic("以下にまとめます。\n\n設定を開き、通知をオフにしてください。");
    expect(result.findings.map((finding) => finding.code)).toContain("GENERIC_PREAMBLE");
  });

  it("flags question repetition near the answer opening", () => {
    const question = "ORIGINの回答構成をスマホ向けに改善するにはどうすればよいですか？";
    const result = auditOriginAnswerUxStatic(`${question}\n\nまず本文幅と見出し密度を調整します。`, question);
    expect(result.findings.map((finding) => finding.code)).toContain("QUESTION_REPETITION");
  });

  it("flags over-sectioning and excessive bold on short answers", () => {
    const answer = [
      "## A", "**重要**です。", "## B", "**重要**です。", "## C", "**重要**です。",
      "## D", "**重要**です。", "## E", "**重要**です。", "## F", "**重要**です。",
      "**重要**です。", "**重要**です。",
    ].join("\n");
    const codes = auditOriginAnswerUxStatic(answer).findings.map((finding) => finding.code);
    expect(codes).toContain("OVER_SECTIONED");
    expect(codes).toContain("EXCESSIVE_BOLD");
  });

  it("flags list spam when most visible lines are bullets", () => {
    const answer = Array.from({ length: 12 }, (_, index) => `- 項目${index + 1}`).join("\n");
    expect(auditOriginAnswerUxStatic(answer).findings.map((finding) => finding.code)).toContain("LIST_SPAM");
  });

  it("flags table abuse for small prose that is forced into a large table", () => {
    const answer = [
      "|項目|内容|",
      "|---|---|",
      "|A|短文|",
      "|B|短文|",
      "|C|短文|",
      "|D|短文|",
    ].join("\n");
    expect(auditOriginAnswerUxStatic(answer).findings.map((finding) => finding.code)).toContain("TABLE_ABUSE");
  });
});
