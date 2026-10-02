import { describe, expect, it } from "vitest";
import {
  originChatSystemInstruction,
  requiresOriginGroundedResearch,
  requiresOriginCurrentInformation,
  requiresOriginFutureReleaseInformation,
} from "./originChatResponsePolicy";

describe("originChatResponsePolicy", () => {
  it.each([
    ['商品を20%値引きした後、値引き後の価格を25%値上げしました。元の価格と同じになりますか？元の価格を1000円として計算し、結論と計算式を日本語で簡潔に説明してください。', false],
    ['価格が1,000円の商品を20％値引きした金額を計算してください。', false],
    ['Calculate the final price for a $100 item after a 20 percent discount.', false],
    ['今日の価格が1000円の商品を20%値引きした金額を計算してください。', true],
    ['最新の為替で1000円を換算し、価格を20%増やして計算してください。', true],
    ['現在の税率で1000円の価格を計算し20%引きしてください。', true],
    ['価格が1000円の商品を20%引きした金額を計算し、最新の価格を調べてください。', true],
    ['Calculate the current price of a $100 item with a 20% discount.', true],
    ['Find sources and calculate the price of a $100 item with a 20% discount.', true],
    ['商品の価格を教えてください。', true],
  ])('separates supplied arithmetic from external pricing: %s', (message, research) => {
    expect(requiresOriginGroundedResearch(message)).toBe(research);
  });

  it.each([
    ["今日のニュースを教えて", true],
    ["今日のAIニュースを教えて", true],
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
    ["今日のAIニュースを教えて", true],
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
      "Build an internal requirement brief from the conversation before finalizing",
      "Ask one to three focused questions per turn",
      "Continue the clarification loop across turns",
      "never repeat a question that the user has already answered",
      "If the request is already sufficiently specified, proceed immediately without unnecessary questions",
      "Preserve the requested medium",
      "do not substitute an image-generation prompt",
      "real image request is complete only when the image-generation runtime actually returns verified image bytes",
      "Name created items descriptively",
    ]) expect(instruction).toContain(phrase);
  });
});
