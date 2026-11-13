import { describe, expect, it } from "vitest";
import {
  ORIGIN_REQUEST_CONTEXTS,
  originChatSystemInstruction,
  originGroqRouteSystemInstruction,
  originIntentAwarenessInstruction,
  requiresOriginGroundedResearch,
  requiresOriginCurrentInformation,
  requiresOriginFutureReleaseInformation,
} from "./originChatResponsePolicy";
import {
  estimateOriginGroqInputTokens,
  ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT,
} from "./originGroqProviderClient";
import {
  classifyOriginRequestIntent,
  originIntentInputFromContext,
} from "../lib/orchestration/OriginRequestIntent";
import { buildOriginAgentWorkPlan } from "../lib/orchestration/OriginAgentWorkPlan";
import { resolveOriginAgentWorkPlan } from "../lib/orchestration/OriginServiceRegistry";
import { decideOriginReviewForMessage } from "../lib/orchestration/OriginReviewPolicy";
import {
  originAnswerQualityInstruction,
  resolveOriginAnswerQualityPolicy,
} from "../lib/orchestration/OriginAnswerQualityPolicy";

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

  // Regression (2026-11-13 production, PROPOSAL_CHAT_TRIAGE_2026-11-13
  // cause D): the bare (料金|価格)(は|を|が|…) branch pulled a plain
  // follow-up statement — the exact second message of the production
  // proposal conversation — into the grounded-research gate, which
  // answered with the no-sources refusal. A price word now needs a
  // question / confirmation marker shortly after it; price questions
  // keep routing to current information.
  it.each([
    ["このサービスの料金はいくらですか", true],
    ["最新のガソリン価格を教えてください", true],
    ["電気料金が値上がりしたか確認したい", true],
    ["強みは、導入が簡単で月額料金が安いことです。トーンは丁寧で信頼感のある形でお願いします。", false],
  ])("requires question context for a bare price mention: %s", (message, expected) => {
    expect(requiresOriginCurrentInformation(message)).toBe(expected);
  });

  it("does not route the production proposal follow-up statement to grounded research", () => {
    expect(requiresOriginGroundedResearch("強みは、導入が簡単で月額料金が安いことです。トーンは丁寧で信頼感のある形でお願いします。")).toBe(false);
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
      "a Markdown table only when it makes comparison easier",
      "in Japanese, use the polite desu/masu register by default",
      "give the point in time a time-sensitive value is as of",
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

describe("assembled chat instruction (router composition)", () => {
  // Mirrors how both chat routers assemble the provider system instruction:
  // base instruction + intent, requirement, work-plan, assignment, and
  // quality sections. Three directives used to appear twice in that
  // composition (once in the base, once in the quality section); the
  // deduplication keeps each of them exactly once, so the instruction's
  // meaning is unchanged while every request carries ~325 fewer characters.
  const assemble = (message: string, taskType: "review" | "documentation") => {
    const intentInput = originIntentInputFromContext([{ role: "user", content: message }]);
    const intent = classifyOriginRequestIntent(intentInput, taskType);
    const workPlan = buildOriginAgentWorkPlan(intent);
    const resolvedPlan = resolveOriginAgentWorkPlan(workPlan);
    const review = decideOriginReviewForMessage(taskType, message);
    const quality = resolveOriginAnswerQualityPolicy({
      intent,
      taskType,
      independentReviewRequired: review.required,
    });
    return originChatSystemInstruction(intent, workPlan, resolvedPlan, originAnswerQualityInstruction(quality));
  };

  it.each([
    ["こんにちは", "review"],
    ["企画書の草案を作って", "documentation"],
  ] as const)("carries each deduplicated directive exactly once for %s", (message, taskType) => {
    const assembled = assemble(message, taskType);
    for (const line of [
      "- Prefer specific recommendations, examples, and ready-to-use wording over generic advice.",
      "- Do not claim code, deployment, purchase, configuration, search, file creation, specialist review, or other execution without evidence.",
      "- Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys.",
    ]) {
      expect(assembled.split(line).length - 1).toBe(1);
    }
  });
});

describe("instruction consistency (PKG-5: rubric alignment and route parity)", () => {
  // The evaluation rubric (ANSWER_QUALITY_EVAL) scores the polite desu/masu
  // register as ORIGIN's standard and an explicit as-of point for fresh
  // values, but until PKG-5 neither instruction stated either rule — the
  // measuring side and the making side disagreed (AUDIT2026 AQ §2.3).
  it("fixes the polite Japanese register in the full instruction", () => {
    expect(originChatSystemInstruction()).toContain(
      "When answering in Japanese, use the polite desu/masu register (です・ます調) as the standard tone",
    );
  });

  it("requires an as-of point for time-sensitive values in the full instruction", () => {
    const instruction = originChatSystemInstruction();
    expect(instruction).toContain("attach the point in time it is as of");
    expect(instruction).toContain("If the as-of point is unknown, say so instead of presenting the value as current");
  });

  it("unifies the table rule on the quality policy's conditional allowance", () => {
    const instruction = originChatSystemInstruction();
    expect(instruction).toContain(
      "Use a Markdown table only when it makes the answer easier to compare or scan than prose or a list",
    );
    expect(instruction).not.toContain("Do not use a Markdown table unless the user explicitly asks for a table");
    // Assembled with the quality policy, the two table rules must not contradict:
    // the base prohibition is gone and the policy's conditional line stands.
    const intent = classifyOriginRequestIntent("AとBを比較して", "review");
    const quality = resolveOriginAnswerQualityPolicy({ intent, taskType: "review", independentReviewRequired: false });
    const assembled = originChatSystemInstruction(intent, undefined, undefined, originAnswerQualityInstruction(quality));
    expect(assembled).not.toContain("Do not use a Markdown table unless the user explicitly asks");
    expect(assembled).toContain("Use a table or list only when it makes the answer easier to compare or execute");
  });

  // The creation-only bullets of the base instruction, identified by the same
  // prefixes the gating filter matches on. Pinning them here guards the gate
  // against wording drift in the base text.
  const creationGuidancePhrases = [
    "Treat requirement discovery as part of the work",
    "Build an internal requirement brief",
    "Before a substantial custom deliverable",
    "After producing a first version, treat user feedback as new requirements",
    "Preserve the requested medium",
    "When the user requests an image, do not substitute",
    "When extending or converting something created earlier",
    "For custom web or app deliverables, do not stop at a bare form or demo",
    "Name created items descriptively",
  ];

  it("carries every creation-guidance bullet in the full instruction by default", () => {
    const lines = originChatSystemInstruction().split("\n");
    for (const phrase of creationGuidancePhrases) {
      expect(lines.some((line) => line.startsWith(`- ${phrase}`))).toBe(true);
    }
  });

  it("omits the creation rulebook for a plain conversational question but keeps the core guarantees", () => {
    const intent = classifyOriginRequestIntent("日本の首都はどこですか？", "review");
    expect(intent.interactionMode).toBe("conversation");
    const instruction = originChatSystemInstruction(intent);
    for (const phrase of creationGuidancePhrases) {
      expect(instruction).not.toContain(phrase);
    }
    for (const phrase of [
      "Reply in the language used by the user",
      "use the polite desu/masu register (です・ます調) as the standard tone",
      "attach the point in time it is as of",
      "Silently use three passes before answering",
      "Do not claim code, deployment, purchase, configuration, search, file creation",
      "Request-context awareness",
      // Clarification and follow-up refinement discipline stays universal:
      // it governs reviews and consultations too, not only creation.
      "Decide which missing items would materially change the next revision",
      "Use follow-up answers to improve the existing draft",
    ]) expect(instruction).toContain(phrase);
  });

  it("keeps the creation rulebook for deliverable requests and for creation capabilities in conversation mode", () => {
    const deliverable = classifyOriginRequestIntent("企画書の草案を作って", "documentation");
    expect(deliverable.interactionMode).toBe("deliverable");
    // A writing request classifies as conversation mode (no catalog output),
    // but the writing capability must still pull the creation rulebook in.
    const writing = classifyOriginRequestIntent("取引先へのお詫びの文章を書いて", "documentation");
    expect(writing.interactionMode).toBe("conversation");
    expect(writing.requiredCapabilities).toContain("writing");
    for (const intent of [deliverable, writing]) {
      const instruction = originChatSystemInstruction(intent);
      for (const phrase of creationGuidancePhrases) {
        expect(instruction).toContain(phrase);
      }
    }
  });
});

describe("answer-quality follow-ups (PKG-9 batch 1: safety standards and form/length discipline)", () => {
  // Batch 1 of the 100-question measurement (accuracy 8.55 / expression 7.45
  // against the 9.0 bar) exposed two systematic failures. B-08 answered a
  // food-heating question with U.S. center temperatures presented as the
  // standard while Japan's standard (core 75°C for at least one minute) was
  // absent — a fatal defect. The A-series creation answers overrode explicit
  // form/length specifications (「簡潔に」, 「項目だけ」, 「短い文章で」) with a
  // fixed pattern of two versions plus premise notes and follow-up questions.
  // These tests pin the two counter-rules in both instructions.
  it("anchors safety and health guidance values in the full instruction to Japan's official standards", () => {
    const instruction = originChatSystemInstruction();
    for (const phrase of [
      "For safety- or health-related guidance values, use Japan's official public standards as the basis",
      "heat food until its core reaches 75°C and keep it at that temperature for at least one minute",
      "state its country or authority explicitly",
      "never present it as the Japanese standard",
    ]) expect(instruction).toContain(phrase);
  });

  it("makes a specified form or length the top priority in the full instruction, with a single-version default", () => {
    const instruction = originChatSystemInstruction();
    for (const phrase of [
      "that specification takes top priority",
      "no multiple versions or patterns, no premise statement or background explanation, and no follow-up refinement questions",
      "This overrides the Version-1 refinement questions and the opening context phrase",
      "default to presenting a single version rather than several patterns",
    ]) expect(instruction).toContain(phrase);
  });

  it("keeps both rules for a plain conversational question (they are not creation-gated)", () => {
    const intent = classifyOriginRequestIntent("日本の首都はどこですか？", "review");
    expect(intent.interactionMode).toBe("conversation");
    const instruction = originChatSystemInstruction(intent);
    expect(instruction).toContain("use Japan's official public standards as the basis");
    expect(instruction).toContain("that specification takes top priority");
  });

  it("carries both rules on the route-3 compact instruction within its budget", () => {
    const compact = originGroqRouteSystemInstruction();
    for (const phrase of [
      "Safety/health values follow Japan's official standards",
      "core 75°C, at least one minute",
      "label foreign ones by country, never as Japan's",
      "Specified form or length (brief, items only, one line) is strict",
      "no added versions, premises, or follow-up questions; otherwise one version only",
    ]) expect(compact).toContain(phrase);
    expect(compact.length).toBeLessThanOrEqual(3_000);
    expect(estimateOriginGroqInputTokens([compact, "日本の首都はどこですか？"])).toBeLessThanOrEqual(1_600);
  });
});

describe("intent awareness (request-context adaptation)", () => {
  it("fixes the context taxonomy, with unknown as the unchanged fallback", () => {
    expect(ORIGIN_REQUEST_CONTEXTS).toEqual([
      "business",
      "private",
      "learning",
      "creative",
      "consultation",
      "unknown",
    ]);
  });

  it("is carried exactly once by the full instruction, with or without other guidance", () => {
    for (const instruction of [originChatSystemInstruction(), originChatSystemInstruction(classifyOriginRequestIntent("企画書の草案を作って", "documentation"))]) {
      expect(instruction.split("Request-context awareness").length - 1).toBe(1);
      expect(instruction).toContain(originIntentAwarenessInstruction());
    }
  });

  it("pins inference by purpose, per-context adaptation, and user override", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "silently infer the context of the request",
      "work/business, personal/everyday life, learning or research, creative work, or casual consultation",
      "Judge by purpose and setting, not by topic or task type",
      "An explicit statement by the user about the context always overrides the inference",
      "Adapt tone, structure, and formality to the inferred context",
      "conclusion and recommendation first",
      "key point first, then why, then an example",
      "acknowledge the situation first",
    ]) expect(section).toContain(phrase);
  });

  it("pins the premise format: one short opening phrase, no label, no meta commentary", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "name it in one short opening phrase in the user's language at the start of the first sentence",
      "仕事で使う前提で言うと、",
      "never expose the category name, the inference process, or any meta commentary about intent detection",
      "When the context does not change the answer, state nothing about it",
    ]) expect(section).toContain(phrase);
  });

  it("pins the clarification gate: all three conditions, and never for facts, calculations, or transformations", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "Ask back instead of answering only when all three hold",
      "would fundamentally change the answer's direction, form, or deliverable",
      "cannot be inferred with reasonable confidence",
      "no sensible default can simply be stated as an opening assumption",
      "Simple factual questions, calculations, and transformations (rewriting, summarization, translation) never qualify",
    ]) expect(section).toContain(phrase);
  });

  it("pins the clarification format and its suppression rules", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "ask exactly one short question",
      "offer two or three concrete choices when that helps",
      "return only that question",
      "do not attach an answer built on a guessed context",
      "Creation requests keep the Version-1-first rule",
      "at most once, never in two consecutive answers",
      "never repeat a fork the user has already answered, moved past, or delegated",
      "the opening assumption is preferred over a question",
    ]) expect(section).toContain(phrase);
  });

  it("pins correction handling and the neutral fallback so quality never degrades", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "If the user corrects an assumed context, switch immediately",
      "fall back to the neutral standard style of this instruction and change nothing",
    ]) expect(section).toContain(phrase);
  });

  it("carries the condensed rule on the route-3 compact instruction within its budget", () => {
    const compact = originGroqRouteSystemInstruction();
    for (const phrase of [
      "Adapt tone and structure to the request's context: work, personal, learning, creative, or casual",
      "Name the assumed context in one short opening phrase when it shapes the answer",
      "ask one short question with choices instead",
      "once per topic, never repeat",
      "If unclear, keep the neutral style",
    ]) expect(compact).toContain(phrase);
    expect(compact.length).toBeLessThanOrEqual(3_000);
    expect(estimateOriginGroqInputTokens([compact, "日本の首都はどこですか？"])).toBeLessThanOrEqual(1_600);
  });
});
