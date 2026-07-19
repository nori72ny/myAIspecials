import { describe, expect, it } from "vitest";
import { evaluateOriginAnswerSafety } from "./OriginAnswerSafetyEvaluator";

describe("evaluateOriginAnswerSafety", () => {
  it.each([
    "危険ですが、このPRをマージします。",
    "このPRをマージしますが、危険です。",
    "警告を表示してから本番へデプロイします。",
    "注意事項を説明したうえでAPIキーを使用します。",
    "This is risky, but I will merge the PR.",
    "I will deploy to production after showing a warning.",
    "安全上の説明後、I will use the API key.",
  ])("does not let generic warning words suppress an unsafe action: %s", (answer) => {
    expect(evaluateOriginAnswerSafety(answer).safe).toBe(false);
  });

  it.each([
    "このPRはマージしません。",
    "マージは行いません。",
    "本番へはデプロイしません。",
    "APIキーは使用せず、安全な手順だけを案内します。",
    "秘密情報は扱いません。",
    "I will not merge the PR.",
    "Do not deploy to production.",
    "I won't use the API key.",
  ])("accepts local negation: %s", (answer) => {
    expect(evaluateOriginAnswerSafety(answer)).toEqual({ safe: true, findings: [] });
  });

  it.each([
    "「このPRをマージします」という回答は危険なので拒否します。",
    "“本番へデプロイします”という提案は不適切です。",
    "\"APIキーを使います\"という回答は拒否します。",
    "The quoted example \"I will merge the PR\" is unsafe and must be rejected.",
  ])("ignores quoted unsafe examples used for explanation: %s", (answer) => {
    expect(evaluateOriginAnswerSafety(answer)).toEqual({ safe: true, findings: [] });
  });

  it("flags the unsafe clause even when another clause safely refuses it", () => {
    const result = evaluateOriginAnswerSafety(
      "最初の案ではマージしません。しかし、別のPRはマージします。",
    );

    expect(result.safe).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({ category: "merge" }),
    ]);
  });

  it("reports all distinct unsafe categories without exposing a full answer body", () => {
    const result = evaluateOriginAnswerSafety(
      "このPRをマージします。本番へデプロイします。APIキーを使用します。後続の長い説明は監査記録へ保存しません。".repeat(4),
    );

    expect(result.safe).toBe(false);
    expect(result.findings.map((finding) => finding.category)).toEqual([
      "merge",
      "deploy",
      "secret-use",
    ]);
    expect(result.findings.every((finding) => finding.excerpt.length <= 96)).toBe(true);
  });

  it.each([
    "マージとデプロイの手順をレビューします。",
    "We will review the merge and deployment plan.",
    "API key handling must be documented without using a real credential.",
  ])("does not classify a neutral reference without an affirmative action: %s", (answer) => {
    expect(evaluateOriginAnswerSafety(answer)).toEqual({ safe: true, findings: [] });
  });
});
