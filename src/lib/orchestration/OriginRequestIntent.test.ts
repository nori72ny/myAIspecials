import { describe, expect, it } from "vitest";

import {
  classifyOriginRequestIntent,
  originIntentInputFromContext,
  originRequestIntentInstruction,
  type OriginRequestIntentCatalog,
} from "./OriginRequestIntent";

describe("OriginRequestIntent", () => {
  it("combines capabilities and deliverables for a complex marketing request", () => {
    const intent = classifyOriginRequestIntent(
      "Instagram広告のKPIを分析し、比較表とグラフで提案書を作ってください",
      "research",
    );

    expect(intent.interactionMode).toBe("deliverable");
    expect(intent.requiredCapabilities).toEqual([
      "document-creation",
      "social-content",
      "data-analysis",
    ]);
    expect(intent.requestedOutputs).toEqual(["proposal", "chart", "comparison"]);
    expect(intent.suggestedOutputs).toEqual([]);
  });

  it.each([
    ["資料を作成してください", "document-creation", "document"],
    ["スライドを作成してください", "presentation-creation", "presentation"],
    ["営業用のトークスクリプトを作ってください", "conversation-design", "talk-script"],
    ["バナー画像を作ってください", "image-generation", "image"],
    ["アプリを開発してください", "application-development", "application"],
    ["ウェブアプリで売上を管理できるようにしてください", "application-development", "application"],
    ["検索のみ行い、調査結果をまとめてください", "research", "research-result"],
    ["Instagram投稿内容を作ってください", "social-content", "social-post"],
    ["ホームページを制作してください", "website-development", "website"],
  ])("classifies %s without reducing requests to chat", (input, capability, output) => {
    const intent = classifyOriginRequestIntent(input, "review");

    expect(intent.requiredCapabilities).toContain(capability);
    expect(intent.requestedOutputs).toContain(output);
    expect(intent.interactionMode).toBe("deliverable");
  });

  it("distinguishes an agent workflow from a single deliverable", () => {
    const intent = classifyOriginRequestIntent(
      "市場を調査して、構成を決め、ホームページを完成まで制作してください",
      "research",
    );

    expect(intent.interactionMode).toBe("agent-workflow");
    expect(intent.requiredCapabilities).toEqual(
      expect.arrayContaining(["research", "writing", "website-development"]),
    );
    expect(intent.requestedOutputs).toContain("website");
  });

  it("supports future services through an extended catalog", () => {
    const catalog: OriginRequestIntentCatalog = {
      capabilities: [{ id: "video-generation", patterns: [/動画生成/] }],
      outputs: [{ id: "video", patterns: [/動画生成/] }],
      agentWorkflowSignals: [],
    };
    const intent = classifyOriginRequestIntent("新商品の動画生成", "review", catalog);

    expect(intent.requiredCapabilities).toEqual(["video-generation"]);
    expect(intent.requestedOutputs).toEqual(["video"]);
    expect(intent.interactionMode).toBe("deliverable");
  });

  it("keeps classification separate from execution evidence", () => {
    const instruction = originRequestIntentInstruction(
      classifyOriginRequestIntent("アプリを開発してください", "implementation"),
    );

    expect(instruction).toContain("guidance only; not execution evidence");
    expect(instruction).toContain("Requested interaction mode: deliverable");
    expect(instruction).toContain("Do not say that an agent");
  });

  it("preserves the earlier creation intent when the user answers a clarification with a short choice", () => {
    const input = originIntentInputFromContext([
      { role: "user", content: "ウェブアプリで売上を管理できるようにしてください" },
      { role: "assistant", content: "簡易版と複数人利用版のどちらにしますか？ 1. 簡易版 2. 複数人利用版" },
      { role: "user", content: "1" },
    ]);
    const intent = classifyOriginRequestIntent(input, "review");

    expect(input).toContain("ウェブアプリ");
    expect(intent.requiredCapabilities).toContain("application-development");
    expect(intent.requestedOutputs).toContain("application");
    expect(intent.interactionMode).toBe("deliverable");
  });

  it("does not contaminate a clear new request with stale conversation intent", () => {
    const input = originIntentInputFromContext([
      { role: "user", content: "ウェブアプリを作ってください" },
      { role: "assistant", content: "用途を確認します。" },
      { role: "user", content: "この文章を100字に要約してください" },
    ]);

    expect(input).toBe("この文章を100字に要約してください");
  });

  it("returns a minimal classification for a plain conversation", () => {
    expect(classifyOriginRequestIntent(
      "考えを整理するのを手伝ってください",
      "review",
    )).toEqual({
      primaryTask: "review",
      interactionMode: "conversation",
      requiredCapabilities: [],
      requestedOutputs: [],
      suggestedOutputs: [],
    });
  });
});
