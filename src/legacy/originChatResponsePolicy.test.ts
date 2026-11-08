import { describe, expect, it } from "vitest";
import {
  originChatSystemInstruction,
  originGroqRouteSystemInstruction,
  requiresOriginGroundedResearch,
  requiresOriginCurrentInformation,
  requiresOriginFutureReleaseInformation,
} from "./originChatResponsePolicy";
import {
  estimateOriginGroqInputTokens,
  ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT,
} from "./originGroqProviderClient";

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

  // Regression (2026-11-07 production benchmark, SEARCH_BENCHMARK_2026-11-07):
  // these freshness questions were answered from stale memorized knowledge
  // with no sources because this gate returned false, while the search
  // classifier already assigned them a search type (policy / fresh_general /
  // news). They must reach grounded research; when no fresh source can be
  // verified the grounded path fails closed instead of asserting old values.
  it.each([
    ["現在の最低賃金（全国平均と東京都）と、いつの改定のものか教えてください"],
    ["児童手当の現在の支給額と対象年齢を教えてください"],
    ["日本の消費者物価指数の直近公表分の前年比と、その公表日を教えてください"],
    ["サッカー日本代表の直近の試合結果を教えてください"],
    ["直近1週間で、日銀の金融政策に関して発表・報道されたことはありますか？"],
  ])("routes benchmark freshness question to grounded research: %s", (message) => {
    expect(requiresOriginCurrentInformation(message)).toBe(true);
    expect(requiresOriginGroundedResearch(message)).toBe(true);
  });

  // The classifier delegation must not pull non-factual requests into the
  // research path: fresh_general alone (advice, personal scheduling) is not
  // enough without a signal type or a published-fact recency marker.
  it.each([
    ["今年の目標の立て方を教えてください"],
    ["直近の予定を整理してください"],
    ["最近の疲れを取る方法を教えてください"],
  ])("keeps non-factual request out of grounded research: %s", (message) => {
    expect(requiresOriginCurrentInformation(message)).toBe(false);
    expect(requiresOriginGroundedResearch(message)).toBe(false);
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
      "never spend the first turn asking only questions",
      "ask at most one or two focused questions",
      "Use follow-up answers to improve the existing draft",
      "For any creation request",
      "never repeat a question that the user has already answered",
      "If the request is already sufficiently specified, proceed immediately without unnecessary questions",
      "Preserve the requested medium",
      "do not substitute an image-generation prompt",
      "real image request is complete only when the image-generation runtime actually returns verified image bytes",
      "Name created items descriptively",
    ]) expect(instruction).toContain(phrase);
  });
});

describe("originGroqRouteSystemInstruction (route-3 compact instruction)", () => {
  const compact = originGroqRouteSystemInstruction();

  it("stays within the 2,000-3,000 character budget the Groq TPM gate can carry", () => {
    expect(compact.length).toBeGreaterThanOrEqual(2_000);
    expect(compact.length).toBeLessThanOrEqual(3_000);
    // The full standard instruction is several times larger; the compact variant
    // must remain a small fraction of it.
    expect(compact.length * 3).toBeLessThan(originChatSystemInstruction().length);
  });

  it("preserves the non-negotiable core of the full instruction", () => {
    for (const phrase of [
      "Reply in the language used by the user",
      "Version 1",
      "at most one or two high-impact refinement questions",
      "Treat explicit output-shape constraints as hard requirements",
      "Do not invent current or future facts",
      "Separate confirmed facts from assumptions, inferences, and recommendations",
      "〔出典: [",
      "never fabricate a source",
      "without evidence",
      "Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys",
      "do not turn a possible rule into a universal rule",
      "what the user must independently confirm before acting",
      "bottom line first",
      "no Markdown table unless the user asks for one",
    ]) {
      expect(compact).toContain(phrase);
    }
  });

  it("leaves comfortable completion headroom for the shortest question under the TPM gate estimate", () => {
    // The regression this locks: with the production-assembled standard instruction
    // (15,713 characters measured on the production code path), the estimator reads
    // about 7,871 tokens and even a minimal 256-token completion no longer fits
    // under the 8,000 tokens/minute ceiling, so route 3 skipped before sending.
    const productionAssembledEstimate = estimateOriginGroqInputTokens(["x".repeat(15_713), "日本の首都はどこですか？"]);
    expect(productionAssembledEstimate + 256).toBeGreaterThan(ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT);
    const compactEstimate = estimateOriginGroqInputTokens([compact, "日本の首都はどこですか？"]);
    expect(compactEstimate).toBeLessThanOrEqual(1_600);
    expect(compactEstimate + 256).toBeLessThan(ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT);
  });
});
