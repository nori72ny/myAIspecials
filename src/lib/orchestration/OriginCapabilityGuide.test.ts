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

  it("describes the capabilities that are actually connected in the current release", () => {
    const guide = createOriginCapabilityGuide("あなたは何ができますか？");

    expect(guide.language).toBe("ja");
    expect(guide.content).toContain("Grounded Research");
    expect(guide.content).toContain("PDF、DOCX、XLSX、PPTX");
    expect(guide.content).toContain("Web / App Builder");
    expect(guide.content).toContain("Agentic Coding");
    expect(guide.content).toContain("検証済みSVG");
    expect(guide.content).toContain("有料fallbackは行いません");
    expect(guide.content).not.toContain("リアルタイム検索、画像ファイル生成、スライドファイル生成、アプリやWebサイトの公開はまだ接続されていません");
    expect(guide.nextActions[0]).toContain("一文で入力");
  });

  it("states the remaining product boundaries instead of understating connected capabilities", () => {
    const guide = createOriginCapabilityGuide("あなたは何ができますか？");

    expect(guide.content).toContain("ラスター画像生成");
    expect(guide.content).toContain("Gitへ自動公開");
    expect(guide.content).toContain("MCP経由");
    expect(guide.limitations.join("\n")).toContain("自動Deploy");
  });

  it("provides the same truthful product boundary in English", () => {
    const guide = createOriginCapabilityGuide("What can ORIGIN do?");

    expect(guide.language).toBe("en");
    expect(guide.content).toContain("Grounded Research");
    expect(guide.content).toContain("PDF, DOCX, XLSX, and PPTX");
    expect(guide.content).toContain("Agentic Coding");
    expect(guide.content).toContain("MCP connections");
    expect(guide.content).toContain("fails closed");
  });
});
