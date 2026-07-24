import { describe, expect, it } from "vitest";

import {
  createOriginCapabilityGuide,
  isOriginCapabilityQuestion,
} from "./OriginCapabilityGuide";

describe("OriginCapabilityGuide", () => {
  it.each([
    "あなたは何ができるのですか？",
    "ORIGINのできることを教えて",
    "このサービスの機能一覧を教えて",
    "What can you do?",
  ])("detects a concise capability question: %s", (input) => {
    expect(isOriginCapabilityQuestion(input)).toBe(true);
  });

  it("does not intercept a concrete creation request", () => {
    expect(isOriginCapabilityQuestion(
      "あなたができる範囲で、新商品の提案書を完成させてください",
    )).toBe(false);
  });

  it("describes ORIGIN's broad outcome-oriented role without overstating execution", () => {
    const guide = createOriginCapabilityGuide("あなたは何ができますか？");

    expect(guide.language).toBe("ja");
    expect(guide.content).toContain("成果物まで作るAIエージェント");
    expect(guide.content).toContain("資料・提案書");
    expect(guide.content).toContain("スライド");
    expect(guide.content).toContain("Instagram投稿");
    expect(guide.content).toContain("画像・Web・アプリ");
    expect(guide.content).toContain("リアルタイム検索");
    expect(guide.content).toContain("まだ接続されていません");
    expect(guide.nextActions[0]).toContain("一文で入力");
  });

  it("provides the same truthful product boundary in English", () => {
    const guide = createOriginCapabilityGuide("What can ORIGIN do?");

    expect(guide.language).toBe("en");
    expect(guide.content).toContain("AI agent");
    expect(guide.content).toContain("Live search");
    expect(guide.content).toContain("not connected yet");
  });
});
