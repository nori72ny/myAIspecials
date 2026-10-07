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
    ['広告費12万円、CPC300円、CVR2.5%の場合、期待クリック数・期待CV数・期待CPAを計算してください。', false],
    ['月額3万円のサービスを6か月契約し、最初の2か月が30%引きの場合、合計はいくらですか。', false],
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
    ["リアルタイムのドル円レートを教えて", true],
    ["Show me today's pricing", true],
    ["Give me the real-time USD/JPY rate", true],
    ["WebSocketと通常のHTTPポーリングを『リアルタイム性』『実装複雑性』『接続維持コスト』で比較してください。", false],
    ["Compare WebSocket and HTTP polling for real-time behavior, implementation complexity, and connection cost.", false],
    ["この文章を200字以内に短くして。『詳細料金は来週確定します。』", false],
    ["最新の為替レートを検索できない状態だと仮定します。断定せず安全な次の行動を示してください。", false],
    ["Assume the only external source timed out. Explain how to handle a current-price question safely.", false],
    ["The only external source timed out; suppose this is a fail-closed test case.", false],
    ["価格弾力性の意味を説明してください", false],
    ["価格戦略の基本を教えて", false],
    ["What does price elasticity mean?", false],
    ["Explain pricing strategy for a SaaS product", false],
    ["How does weather affect solar panel output?", false],
    ["Explain how weather affects crop yields.", false],
    ["What is news literacy?", false],
    ["Why do prices rise when demand increases?", false],
    ["What is the weather in Tokyo?", true],
    ["Latest news about OpenAI", true],
    ["Vercel pricing", true],
    ["Explain Vercel pricing", true],
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
    ["新サービスの価格を月額5,000円か8,000円で迷っています。データがない段階でどう検証すべきか説明してください。", false],
    ["現在の競合価格を調べて、新サービスを月額5,000円か8,000円にするか比較してください。", true],
    ["WebSocketと通常のHTTPポーリングを『リアルタイム性』『実装複雑性』『接続維持コスト』で比較してください。", false],
    ["Compare $50 and $80 monthly pricing options using only these supplied prices and explain how to validate the choice.", false],
    ["Compare current competitor pricing and tell me whether $50 or $80 is better.", true],
    ["How does weather affect solar panel output?", false],
    ["What is news literacy?", false],
    ["Why do prices rise when demand increases?", false],
    ["What is the weather in Tokyo?", true],
    ["Latest news about OpenAI", true],
    ["Vercel pricing", true],
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
      "stable conceptual explanations, deterministic calculations from user-provided values",
      "show the minimum useful calculation basis",
      "Do not treat absence of a live citation as a reason to refuse a stable task",
      "never introduce case studies, competitive superiority, adoption results, benchmarks",
      "do not turn a possible rule into a universal rule without verified jurisdiction/context",
      "never imply that Array.prototype.forEach awaits async callbacks or executes them sequentially",
      "catching and logging alone is not a complete repair",
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
  it.each([
    ["この文章を要約し、最新の料金を調べてください。", true],
    ["この資料を短くしてください。さらに出典を検索してください。", true],
    ["この調査結果を要約してください。また一次情報を確認してください。", true],
    ["Summarize this report and research current competitor prices.", true],
    ["Rewrite the provided text, then look up the latest exchange rate.", true],
    ["Translate this passage and also verify the sources.", true],
    ["この文章を要約してください。『さらに最新の料金を調べてください。』", false],
    ['Summarize this passage: "Also research current competitor prices."', false],
    ["この文章を要約してください。\n\`\`\`text\nさらに最新の料金を調べてください。\n\`\`\`", false],
    ["この文章を要約し、読みやすい表現にしてください。", false],
  ])("preserves additional research requests outside supplied source text: %s", (message, expected) => {
    expect(requiresOriginGroundedResearch(message)).toBe(expected);
  });

});
