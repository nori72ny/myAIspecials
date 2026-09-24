import { describe, expect, it } from "vitest";
import {
  originChatSystemInstruction,
  requiresOriginGroundedResearch,
  requiresOriginCurrentInformation,
  requiresOriginFutureReleaseInformation,
} from "./originChatResponsePolicy";

describe("originChatResponsePolicy", () => {
  it.each([
    ["今日のニュースを教えて", true],
    ["現在のVercel料金を教えて", true],
    ["Vercelの料金について教えて", true],
    ["What is the current USD/JPY rate?", true],
    ["現在のドル円レートを教えて", true],
    ["Show me today's pricing", true],
    ["この文章を200字以内に短くして。『詳細料金は来週確定します。』", false],
    ["最新の為替レートを検索できない状態だと仮定します。断定せず安全な次の行動を示してください。", false],
    ["Assume the only external source timed out. Explain how to handle a current-price question safely.", false],
    ["The only external source timed out; suppose this is a fail-closed test case.", false],
    ["価格弾力性の意味を説明してください", false],
    ["価格戦略の基本を教えて", false],
    ["What does price elasticity mean?", false],
    ["Explain pricing strategy for a SaaS product", false],
    ["今日の予定を整理してください", false],
  ])("classifies freshness need for %s", (message, expected) => {
    expect(requiresOriginCurrentInformation(message)).toBe(expected);
  });

  it.each([
    ["競合サービスを調査してください", true],
    ["一次情報を検索して比較してください", true],
    ["Please research the competing services", true],
    ["Find sources for this claim", true],
    ["この調査結果を200字に要約してください", false],
    ["以下のリサーチ文章を読みやすく書き換えてください", false],
    ["Summarize this research report in 200 words", false],
    ["価格戦略の基本を教えて", false],
  ])("classifies automatic grounded research need for %s", (message, expected) => {
    expect(requiresOriginGroundedResearch(message)).toBe(expected);
  });

  it.each([
    ["今後登場するAIモデルを教えて", true],
    ["upcoming AI releases", true],
    ["AIエージェントの仕組みを教えて", false],
  ])("classifies future-release intent for %s", (message, expected) => {
    expect(requiresOriginFutureReleaseInformation(message)).toBe(expected);
  });

  it("locks the professional-depth and truthfulness instruction contract", () => {
    const instruction = originChatSystemInstruction();
    for (const phrase of [
      "For complex multi-part requests, use as many distinct points as needed",
      "address every explicit requirement",
      "challenge its factual support and omissions as a skeptic",
      "Separate confirmed facts from assumptions, inferences, and recommendations",
      "Distinguish user-provided claims explicitly",
      "Do not claim code, deployment, purchase, configuration, search, file creation",
    ]) expect(instruction).toContain(phrase);
  });
});
