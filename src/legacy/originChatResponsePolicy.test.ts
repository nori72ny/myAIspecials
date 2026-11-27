import { describe, expect, it } from "vitest";
import {
  applyOriginUngroundedAssertionGate,
  detectOriginUngroundedCurrentAssertion,
  ORIGIN_REQUEST_CONTEXTS,
  originAnswerNeedsAssertionGate,
  originChatSystemInstruction,
  originCloudflareRouteSystemInstruction,
  originCurrentDateInstruction,
  originGroqRouteSystemInstruction,
  originIntentAwarenessInstruction,
  ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_JA,
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
import { ORIGIN_BUSINESS_PLANNING_BRIEFS } from "../lib/orchestration/OriginBusinessPlanningBriefs";
import {
  buildOriginBusinessPlanningInstruction,
  detectOriginBusinessPlanningKind,
  resolveOriginBusinessPlanning,
} from "../lib/orchestration/OriginBusinessPlanning";

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

  // S-PR-1 regression (F+G freshness regression 2026-11-13, fatal 6): the
  // exact phrasings that were answered from stale memory with confident
  // current-form assertions. Under the unified determination every one of
  // them must now route to search.
  it.each([
    ["現在の日本の内閣総理大臣は誰ですか？"],
    ["日銀の政策金利は今いくつですか？いつ決まったものですか？"],
    ["最新の有効求人倍率を教えてください。いつの分ですか？"],
    ["最新の完全失業率を教えてください。いつの分ですか？"],
    ["日本の総人口の最新の推計値と、その基準日を教えてください"],
    ["箱根駅伝の直近の優勝校はどこですか？"],
  ])("routes the F+G fatal phrasing to search (S-PR-1): %s", (message) => {
    expect(requiresOriginCurrentInformation(message)).toBe(true);
    expect(requiresOriginGroundedResearch(message)).toBe(true);
  });

  // S-PR-1 negative regressions: pure arithmetic over supplied values and
  // timeless historical facts must NOT route to search (the H-01 / G-01
  // self-destruct pattern, where the grounding layer shredded directly
  // answerable questions over unrelated retrieved values).
  it.each([
    ["税抜12,800円の商品を3個買うと、消費税10%込みでいくらになりますか？"],
    ["消費税が導入された当初の税率は何%でしたか？"],
  ])("keeps arithmetic and timeless facts off search (S-PR-1): %s", (message) => {
    expect(requiresOriginCurrentInformation(message)).toBe(false);
    expect(requiresOriginGroundedResearch(message)).toBe(false);
  });

  // R-PR-9b regression (R-PR-8 re-measurement fatals B-04/B-06/B-10/
  // E-09): institutional / numeric facts that fell through BOTH fixed
  // vocabularies — the search classifier's and this policy's — and were
  // asserted from model memory. The classifier's high-risk category
  // gate (RPR9_DESIGN_2026-11-15 §R9-B) now routes them to grounded
  // research through the unified determination.
  it.each([
    ["ふるさと納税の仕組みを、自己負担と上限の考え方を含めて説明してください。"],
    ["大人が1日にとる塩分の目安はどれくらいですか？"],
    ["赤ちゃんの予防接種は、いつ頃から始まりますか？"],
    ["2024年に始まった新しいNISAの年間投資枠と、生涯の上限を教えてください。"],
    ["塩分は1日何グラムまでが目安ですか？"],
    ["予防接種は何歳から受けられますか？"],
    ["健康保険の仕組みを教えてください"],
    ["掃除機の価格を教えてください"],
    ["日銀の総裁は誰ですか？"],
  ])("routes the R-PR-8 fatal shape to grounded research (R-PR-9b): %s", (message) => {
    expect(requiresOriginCurrentInformation(message)).toBe(true);
    expect(requiresOriginGroundedResearch(message)).toBe(true);
  });

  // The category gate must not pull definitions, recipes or advice
  // shapes into grounded research.
  it.each([
    ["ふるさと納税とは何ですか？"],
    ["塩分の多い料理のレシピを教えてください"],
    ["血圧が高いときの対処法を教えてください"],
    ["今さら聞けない、確定申告の基本を教えてください"],
  ])("keeps non-factual category-adjacent shapes off grounded research (R-PR-9b): %s", (message) => {
    expect(requiresOriginCurrentInformation(message)).toBe(false);
    expect(requiresOriginGroundedResearch(message)).toBe(false);
  });
});

describe("originCurrentDateInstruction (S-PR-1)", () => {
  it("injects today's date in Asia/Tokyo, not UTC", () => {
    // 2026-11-13T16:30:00Z is already 2026-11-14 01:30 in Tokyo.
    const instruction = originCurrentDateInstruction(Date.parse("2026-11-13T16:30:00Z"), "ja");
    expect(instruction).toContain("2026年11月14日");
    expect(instruction).toContain("（2026年11月14日時点）");
    expect(instruction).not.toContain("2026年11月13日");
  });

  it("carries the ISO date and the as-of form for English", () => {
    const instruction = originCurrentDateInstruction(Date.parse("2026-11-13T16:30:00Z"), "en");
    expect(instruction).toContain("2026-11-14");
    expect(instruction).toContain("(as of 2026-11-14)");
  });
});

describe("ungrounded current-assertion gate (S-PR-1)", () => {
  it("arms only for volatile-fact questions that are not pinned to the past", () => {
    expect(originAnswerNeedsAssertionGate("日本の内閣総理大臣は誰ですか？")).toBe(true);
    expect(originAnswerNeedsAssertionGate("ドル円レートの仕組みを教えてください")).toBe(true);
    expect(originAnswerNeedsAssertionGate("消費税が導入された当初の税率は何%でしたか？")).toBe(false);
    expect(originAnswerNeedsAssertionGate("日本の首都はどこですか？")).toBe(false);
  });

  it("detects the F-01 shape: a currentness cue joined to a volatile topic", () => {
    const answer = "現在の日本の内閣総理大臣は石破茂（いしば しげる）氏です。\n（2024年11月時点）";
    expect(detectOriginUngroundedCurrentAssertion("日本の内閣総理大臣は誰ですか？", answer)).toBe(true);
  });

  it("detects an undated volatile value stated in the present tense", () => {
    const answer = "日本の総人口は約1億2,395万人です。高齢化が進んでいます。";
    expect(detectOriginUngroundedCurrentAssertion("日本の総人口はどれくらいですか？", answer)).toBe(true);
  });

  it("passes an answer that dates its volatile values", () => {
    const answer = "日本の総人口は、2024年4月時点で約1億2,395万人と推計されています。";
    expect(detectOriginUngroundedCurrentAssertion("日本の総人口はどれくらいですか？", answer)).toBe(false);
  });

  it("passes answers on non-volatile questions untouched", () => {
    const answer = "現在の日本の首都は東京です。";
    expect(detectOriginUngroundedCurrentAssertion("日本の首都はどこですか？", answer)).toBe(false);
  });

  it("passes timeless explanations that mention a topic without stating a value", () => {
    const answer = "日本の内閣総理大臣は国会で指名され、天皇に任命されます。";
    expect(detectOriginUngroundedCurrentAssertion("日本の内閣総理大臣はどうやって決まりますか？", answer)).toBe(false);
  });

  it("replaces an ungrounded assertion with the could-not-confirm form, and never touches grounded answers", () => {
    const question = "日本の内閣総理大臣は誰ですか？";
    const stale = "現在の日本の内閣総理大臣は石破茂氏です。";
    const applied = applyOriginUngroundedAssertionGate(question, stale, false);
    expect(applied.replaced).toBe(true);
    expect(applied.text).toBe(ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_JA);
    expect(applyOriginUngroundedAssertionGate(question, stale, true)).toEqual({ text: stale, replaced: false });
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
      // CB-6 (CODEBENCH_CB6_DESIGN_2026-11-25): the code-review
      // finding discipline and the leave-nothing-unused rule.
      "lead with the most consequential problem in that code",
      "every point must be traceable to a specific line or behavior of that code",
      "no problem actually present may be omitted to keep the list short",
      "Do not pad the review with generic checklist items",
      "state the operative reason it is a problem for this code's purpose",
      "Leave nothing unused",
      "remove imports or names carried over from the original",
      // CB-7 (CODE_E05_E02_DIAGNOSIS_2026-11-26): the conditional-
      // definition sentence on the definition/use rule.
      "A name assigned inside a `try` block may not exist when the `finally` block runs",
      "guard the cleanup so it never touches a name that might be unbound",
      // V-1 (CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27 section 4.2): the
      // verification-status form rule for code answers.
      "show the code's verification status as part of the answer's form",
      "Immediately after the code block, state in one sentence that the code has not been run to verify it",
      "「このコードは実行して確認していません。」",
      "Pair the code with the smallest check the user can run themselves",
      "the command to run it and the result to expect",
      "the expected results must include the boundary cases the original handles",
      "Present anything you worked out by reading or tracing the code as a traced expectation",
      "never as a result you observed by running it",
    ]) expect(instruction).toContain(phrase);
  });
});

describe("originGroqRouteSystemInstruction (route-3 compact instruction)", () => {
  const compact = originGroqRouteSystemInstruction();

  it("stays within the 2,000-6,700 character budget the Groq TPM gate can carry", () => {
    expect(compact.length).toBeGreaterThanOrEqual(2_000);
    expect(compact.length).toBeLessThanOrEqual(6_700);
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
      // CB-4 (CODEBENCH_CB4_DESIGN_2026-11-23): the defining-behavior
      // rule (with its confusion-point supplement) and the
      // review/rewrite equivalence and definition/use rules, carried
      // on this route for the first time, in condensed form.
      "state each concept's defining behavior as a sentence",
      "name well-known confusion points (such as whether it blocks execution) explicitly",
      "trace the original's actual behavior first",
      "rows with no matching detail rows stay in the result with the value the original produced",
      "aggregate from the full set, not the detail side alone",
      "Never claim the results are the same where a case differs",
      "make the code do what the prose claims",
      "use every name exactly as it was defined",
      "trace each example once for definition/use mismatches that would throw an error when run",
      // CB-5 (CODEBENCH_CB5_DESIGN_2026-11-23): the await
      // non-blocking canon and the scope, governing, and
      // API-conventions additions, in condensed form.
      "await suspends only the async function and does not block the thread",
      "each example must define every name it uses",
      "a name defined inside one function is not available in another",
      "govern every description of the original",
      "keep the API conventions the given code shows",
      "do not switch dialects",
      // CB-6 (CODEBENCH_CB6_DESIGN_2026-11-25): the code-review
      // finding discipline and the leave-nothing-unused rule, in
      // condensed form.
      "lead with the supplied code's most consequential problem",
      "report every problem actually present in it",
      "never pad with generic checklist items",
      "say in one line when a part is already correct",
      "State the operative reason each problem fails here",
      "Leave nothing unused",
      "remove imports the replacement no longer uses",
      // CB-7 (CODE_E05_E02_DIAGNOSIS_2026-11-26): the conditional-
      // definition sentence on the definition/use rule, in
      // condensed form.
      "Names assigned inside `try` may be unbound in `finally`",
      "initialize before `try` or guard the cleanup",
      // V-1 (CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27 section 4.2): the
      // verification-status form rule for code answers, in
      // condensed form.
      "state its verification status as part of the form",
      "immediately after the code block, one sentence that the code has not been run to verify it",
      "「このコードは実行して確認していません。」",
      "the smallest check the user can run",
      "Present traced results as traced expectations, never as observed outcomes",
    ]) {
      expect(compact).toContain(phrase);
    }
  });

  it("leaves comfortable completion headroom for the shortest question under the TPM gate estimate", () => {
    // The regression this locks: with the production-assembled standard instruction
    // (15,713 characters measured on the production code path), the estimator reads
    // about 7,871 tokens and even a minimal 256-token completion no longer fits
    // under the 8,000 tokens/minute ceiling, so route 3 skipped before sending.
    // Pin history: the compact bound was 1,600 while the base budget was
    // 3,000 characters. I-4 (INTENT_I4_DESIGN_2026-11-21) raised the base
    // budget to 3,800; at that cap the estimator reads ceil(3800/2)+4 =
    // 1,904 tokens for the instruction alone and 1,914 with this shortest
    // question, so the pin sits at 2,000 - and even cap + question + a
    // 256-token completion (~2,170) stays far under the ceiling below.
    // CB-4 (CODEBENCH_CB4_DESIGN_2026-11-23) raised the base budget to
    // 4,800 so this route could carry the defining-behavior,
    // equivalence, and definition/use rules; at that cap the estimator
    // reads ceil(4800/2)+4 = 2,404 tokens for the instruction alone
    // and about 2,414 with this shortest question, so the pin sits at
    // 2,500 - and even cap + question + a 256-token completion
    // (~2,670) stays far under the ceiling below.
    // CB-5 (CODEBENCH_CB5_DESIGN_2026-11-23) raised the base budget to
    // 5,600 so this route could carry the await non-blocking canon and
    // the scope, governing, and API-conventions additions; at that cap
    // the estimator reads ceil(5600/2)+4 = 2,804 tokens for the
    // instruction alone and about 2,814 with this shortest question, so
    // the pin sits at 2,900 - and even cap + question + a 256-token
    // completion (~3,070) stays far under the ceiling below.
    // CB-6 (CODEBENCH_CB6_DESIGN_2026-11-25) raised the base budget to
    // 6,000 so this route could carry the code-review finding
    // discipline and the leave-nothing-unused rule; at that cap the
    // estimator reads ceil(6000/2)+4 = 3,004 tokens for the instruction
    // alone and about 3,014 with this shortest question, so the pin
    // sits at 3,100 - and even cap + question + a 256-token completion
    // (~3,270) stays far under the ceiling below.
    // CB-7 (CODE_E05_E02_DIAGNOSIS_2026-11-26) raised the base budget
    // to 6,200 so this route could carry the conditional-definition
    // sentence on the definition/use rule; at that cap the estimator
    // reads ceil(6200/2)+4 = 3,104 tokens for the instruction alone
    // and about 3,114 with this shortest question, so the pin sits at
    // 3,200 - and even cap + question + a 256-token completion
    // (~3,370) stays far under the ceiling below.
    // V-1 (CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27) raised the base
    // budget to 6,700 so this route could carry the
    // verification-status form rule for code answers; at that cap
    // the estimator reads ceil(6700/2)+4 = 3,354 tokens for the
    // instruction alone and about 3,364 with this shortest question,
    // so the pin sits at 3,400 - and even cap + question + a
    // 256-token completion (~3,620) stays far under the ceiling
    // below. The measured estimate after the change is 3,272.
    const productionAssembledEstimate = estimateOriginGroqInputTokens(["x".repeat(15_713), "日本の首都はどこですか？"]);
    expect(productionAssembledEstimate + 256).toBeGreaterThan(ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT);
    const compactEstimate = estimateOriginGroqInputTokens([compact, "日本の首都はどこですか？"]);
    expect(compactEstimate).toBeLessThanOrEqual(3_400);
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
    expect(compact.length).toBeLessThanOrEqual(6_700);
    expect(estimateOriginGroqInputTokens([compact, "日本の首都はどこですか？"])).toBeLessThanOrEqual(3_400);
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
    expect(compact.length).toBeLessThanOrEqual(6_700);
    expect(estimateOriginGroqInputTokens([compact, "日本の首都はどこですか？"])).toBeLessThanOrEqual(3_400);
  });

  it("pins false-premise correction: correct first at the start, then answer under the corrected premise (I-2)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "False factual premises",
      "a premise stated as fact that is wrong",
      "correct it at the very start of the answer, before answering",
      "then give the requested answer under the corrected premise",
      "Never build any part of the answer (procedures, documents, deadlines, figures) on the false premise",
      "never end the turn with the correction alone",
      "the correction comes first and any premise phrase is built on the corrected premise",
      "the table takes the corrected value, never the user's mistaken one",
      "Opinions and judgments",
      "only verifiable facts are corrected",
    ]) expect(section).toContain(phrase);
  });

  it("pins the certainty-graded correction forms and the neutral tone (I-2)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "Grade the correction by certainty",
      "state plainly that it is wrong and give the correct content",
      "give the correct value with its point in time",
      "確認できる範囲では〜のようです",
      "do not assert the correction as fact",
      "treat it under the existing research rules instead of guessing",
      "a premise reset that lets the work proceed, not a reproach",
      "do not pad it with apologies or preamble",
    ]) expect(section).toContain(phrase);
  });

  // The I-1 measurement (SCORES-I1) produced three fatal shapes, all of
  // them an uncritical acceptance of a user-stated false premise. Premise
  // truth is judged by the model, not by deterministic code, so at unit
  // level the counter-rule for each trap shape is pinned in the instruction
  // text; the live behavior is measured by the I-1 scenario set.
  it("pins the counter-rule for the FP-01 trap: procedures for a program that does not exist (I-2)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "a program, benefit, or procedure that does not exist",
      "Never build any part of the answer (procedures, documents, deadlines, figures) on the false premise",
    ]) expect(section).toContain(phrase);
  });

  it("pins the counter-rule for the FP-02 trap: a wrong rate stated as fact is corrected before calculating (I-2)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "or a wrong start date, amount, rate, or deadline",
      "correct it at the very start of the answer, before answering",
      "then give the requested answer under the corrected premise",
    ]) expect(section).toContain(phrase);
  });

  it("pins the FP-04 counter-shape: a hypothetical premise is answered as posed, with no correction (I-2)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "Do not correct: a hypothetical or fictional request",
      "a premise the user deliberately sets as an assumption",
      "calculate and reason on the assumed value exactly as asked",
    ]) expect(section).toContain(phrase);
  });

  it("pins the counter-rule for the REP-01 trap: a re-stated wrong premise never re-enters later answers (I-2)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "the same error already corrected earlier in this conversation",
      "do not repeat the correction",
      "keep answering on the corrected premise even if the user states the wrong one again",
    ]) expect(section).toContain(phrase);
  });

  it("pins the remaining false-premise exceptions: immaterial details and unjudgeable claims (I-2)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "a detail whose error does not change the conclusion",
      "anything you cannot judge wrong with reasonable confidence",
      "never correct on speculation",
    ]) expect(section).toContain(phrase);
  });

  it("pins correction-as-replacement: the old premise's structure, figures, and wording are discarded (I-2)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "Corrections replace; they do not accumulate",
      "any new statement on the same point is a replacement",
      "discard everything built on the old premise (structure, figures, wording, options) and rebuild on the new premise alone",
      "the opening premise phrase shows only the new premise",
      "naming the old and new side by side is allowed only in that one answer",
      "A partial correction replaces only the part it touches",
      "rebuild its premise table on the new premises too",
    ]) expect(section).toContain(phrase);
  });

  it("pins the single alternative reading on the premise phrase, with its firing conditions (I-2)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "One alternative reading may ride on that premise phrase",
      "attach at most one alternative",
      "もし○○のつもりなら、その形にも直せます",
      "Attach none when only one reading is plausible",
      "where no premise phrase is stated in the first place (factual questions, calculations, transformations)",
    ]) expect(section).toContain(phrase);
  });

  // I-4 (INTENT_I4_DESIGN_2026-11-21) narrowed the exception this test
  // pinned as "Hypotheticals and assumptions stand as posed": in the I-1
  // R2 re-measurement the unbounded exception swallowed the correction
  // rule itself (FP-02, REP-01), so the pin now carries the limited
  // form. The full I-4 pin set lives in the I-4 tests below.
  it("carries the condensed false-premise and replacement rules on the route-3 compact instruction (I-2)", () => {
    const compact = originGroqRouteSystemInstruction();
    for (const phrase of [
      "If a premise stated as fact is wrong (a wrong date, rate, amount, or nonexistent program)",
      "correct it briefly first and answer under the corrected premise",
      "never build on it",
      "Assumptions stand as posed only when explicitly framed as an assumption or hypothetical",
      "Corrections replace the old premise: rebuild on the new one alone",
    ]) expect(compact).toContain(phrase);
    expect(compact.length).toBeLessThanOrEqual(6_700);
    expect(estimateOriginGroqInputTokens([compact, "日本の首都はどこですか？"])).toBeLessThanOrEqual(3_400);
  });

  // The I-1 measurement's REP-02 was fatal: the turn-2 correction
  // (50 -> 30 people) was applied, but in turn 3 the user re-presented
  // the old premise as a bare question ("50人だと椅子は何脚いるかな")
  // and the answer reverted to 50. Premise handling is judged by the
  // model, so at unit level the counter-rule for the multi-turn shape
  // is pinned in the instruction text; the live behavior is measured
  // by the I-1 scenario set (INTENT_I3_DESIGN_2026-11-21 section 2).
  it("pins corrected-premise persistence: a re-presented old premise never re-enters (I-3, REP-02)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "Corrected premises stay corrected",
      "Once a premise has been corrected in this conversation",
      "the corrected premise stays operative for the rest of the conversation",
      "If the user later asks again in the old premise's wording",
      "do not rebuild any part of the answer on the old premise",
      "do not repeat the correction",
      "do not name the old and new premises side by side again",
      "answer the underlying question on the corrected premise",
      "at most one brief anchor naming only the corrected premise",
      "訂正済みの30人で見ると、",
    ]) expect(section).toContain(phrase);
  });

  it("pins both correction origins for persistence: user-corrected and assistant-corrected alike (I-3, REP-01/REP-02)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "by the user, or by you under the false-premise rule",
    ]) expect(section).toContain(phrase);
  });

  it("pins the persistence fences: explicit hypothetical framing and explicit change-back (I-3)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "A bare restatement of the old premise is not a hypothetical",
      "when the user explicitly frames it as one",
      "answer that part as a clearly hypothetical aside",
      "the working premise stays corrected",
      "もし50人だったら",
      "参考に50人の場合も",
      "An explicit instruction to change it back",
      "やっぱり50人に戻して",
      "is itself a new correction and replaces in the other direction",
    ]) expect(section).toContain(phrase);
  });

  it("pins stated-background and form-preference persistence across distance (I-3, DIST-01/DIST-02 shapes)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "Stated backgrounds and standing preferences persist for the whole conversation",
      "however many unrelated topics intervene",
      "When a later request is one they bear on",
      "build the answer on them without being reminded",
      "keep a stated form preference in force until the user changes it",
    ]) expect(section).toContain(phrase);
  });

  it("pins the negative side of persistence: irrelevant backgrounds are never dragged in (I-3, DIST-03/DIST-04 shapes)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "When they do not bear on the request, do not drag them in",
      "circumstances shared in a personal context are never premises, constraints, or asides in a work answer",
      "a work context is never carried into a personal answer",
    ]) expect(section).toContain(phrase);
  });

  // I-4 replaced the condensed persistence tail this test pinned ("use
  // them when they bear on the request; never drag them in when they do
  // not"): R2 showed the general form leaves the relevance judgment
  // entirely to the model, and DIST-04 failed through it. The split form
  // - the user's own attributes versus personal topics - is pinned by
  // the I-4 tests below.
  it("carries the condensed persistence rules on the route-3 compact instruction (I-3)", () => {
    const compact = originGroqRouteSystemInstruction();
    for (const phrase of [
      "A corrected premise stays in force",
      "answer on the corrected one with at most a brief anchor",
      "never rebuild on the old one, never repeat the correction",
      "a hypothetical framed as one may be answered as one",
      "Stated backgrounds and form preferences persist across topics",
    ]) expect(compact).toContain(phrase);
    expect(compact.length).toBeLessThanOrEqual(6_700);
    expect(estimateOriginGroqInputTokens([compact, "日本の首都はどこですか？"])).toBeLessThanOrEqual(3_400);
  });

  // The I-1 R2 re-measurement (production bc1c1918, I-3 live) found the
  // distance bar down (66.7% -> 33.3%) with DIST-04 fatal in a new shape
  // - a personal topic (the child's school exams) became the audience
  // and subject of all three work proposals - and the false-premise bar
  // unmoved at three, in the same shapes as R1. The analysis
  // (INTENT_I4_DESIGN_2026-11-21) traced both to the compact text: the
  // persistence bullet never separated the user's own attributes from
  // personal topics, its negative side survived only as a general
  // "never drag them in", and the false-premise exception was wide
  // enough to swallow asserted facts and imperatives alike. I-4 is the
  // structural fix; premise truth is still judged by the model, so at
  // unit level the counter-rules are pinned in the instruction text and
  // the live behavior is measured by the I-1 scenario set.
  it("pins the attribute/topic split in the full instruction: attributes travel, personal topics do not (I-4, D-1)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "but they come in two kinds",
      "The user's own attributes - their occupation, role, or continuing situation",
      "bear on later requests in that attribute's own domain",
      "a background counts as the user's own attribute only when the user states it as their own business or role",
      "a topic merely discussed is not an attribute",
      "Topics, worries, and circumstances shared in a personal context stay inside that context",
      "are never its audience, market, or subject",
    ]) expect(section).toContain(phrase);
  });

  it("pins the vacuum rule in the full instruction: an unnamed target is never filled from personal topics (I-4, D-3)", () => {
    const section = originIntentAwarenessInstruction();
    for (const phrase of [
      "When a work request does not name the industry, product, or audience it is for",
      "do not fill that gap from topics shared in a personal context",
      "state the target you are assuming explicitly as an assumption",
      "only when it would fundamentally change the deliverable's form",
    ]) expect(section).toContain(phrase);
  });

  it("pins the narrowed assumption exception and the certainty line on the route-3 compact instruction (I-4, F-1/F-2)", () => {
    const compact = originGroqRouteSystemInstruction();
    for (const phrase of [
      "Assumptions stand as posed only when explicitly framed as an assumption or hypothetical",
      "「仮に」「もし」",
      "a future or conditional framing (「〜になった場合」) counts as one",
      "A value asserted as true is not an assumption",
      "even in an instruction like 'calculate at 15%'",
      "If you cannot confirm a named program or value exists, say so plainly",
      "確認できる範囲では、その名称の制度は確認できません",
      "offer the real alternatives",
      "never write procedures or figures for it",
      "Never correct on speculation",
    ]) expect(compact).toContain(phrase);
    // The false-premise rule is its own bullet now, no longer sharing
    // one with the replacement and persistence rules.
    expect(compact).toContain("\n- If a premise stated as fact is wrong");
    expect(compact).toContain("\n- Corrections replace the old premise");
    // The unbounded exception form is gone.
    expect(compact).not.toContain("Hypotheticals and assumptions stand as posed");
    expect(compact.length).toBeLessThanOrEqual(6_700);
    expect(estimateOriginGroqInputTokens([compact, "日本の首都はどこですか？"])).toBeLessThanOrEqual(3_400);
  });

  it("pins the attribute/topic split and the vacuum rule on the route-3 compact instruction (I-4, D-1/D-2/D-3)", () => {
    const compact = originGroqRouteSystemInstruction();
    for (const phrase of [
      "the user's own attributes (occupation, role) bear on requests in their own domain",
      "A topic from a personal conversation is never the audience, market, or premise of a work answer",
      "If a work request names no industry, product, or audience, do not infer one from personal topics",
      "state the assumed target as an assumption",
      "or ask about it once",
    ]) expect(compact).toContain(phrase);
    // The general negative form measured too weak in R2 is gone.
    expect(compact).not.toContain("never drag them in when they do not");
    expect(compact.length).toBeLessThanOrEqual(6_700);
  });
});

describe("routing calibration (2026-11-16 measurement)", () => {
  // Gate decisions for the shapes the fixed-100 re-measurement found
  // misrouted in both directions. True = the grounded-research path
  // must verify before answering; false = the normal path answers
  // directly and must not refuse for lack of sources.
  it.each([
    // Statutory tables / rules asserted wrongly from memory (fatals).
    ["有給休暇は、入社してどれくらいで何日もらえますか？勤続年数ごとの付与日数を教えてください。", true], // A-03
    ["借金の時効は原則何年ですか？民法のルールを教えてください。", true], // E-02
    // Past-pinned officeholder: type stays stable, category promotes.
    ["1990年当時の日本の首相は誰でしたか？", true], // G-02
    // Possibly nonexistent named entity: grounded path fails closed.
    ["『みなとみらい環状線』はいつ開業しましたか？", true], // I-03
    // Pension routing was already correct; the fix is retrieval-side.
    ["国民年金は原則何歳から受け取れますか？早めたり遅らせたりはできますか？", true], // B-02
    // Supplied-value arithmetic: no grounding, no refusal.
    ["15%引きで8,500円だった商品の、元の値段はいくらですか？", false], // H-05
    ["定員40人の75%は何人いますか？", false], // H-09
    ["原価800円に25%の利益を乗せると、売値はいくらですか？", false], // H-10
    // Self-contained calculation / conversion (2026-11-17
    // re-measurement): every input is inside the question — a ratio
    // split and a supplied-rate conversion. Both were promoted by the
    // bare いくらですか fallback and self-destructed on unrelated
    // sources (H-06 discarded over a Wikipedia page about North
    // Korea; H-08 answered that the sources held no exchange rate).
    ["30万円を3対2の割合で2人に分けると、それぞれいくらですか？", false], // H-06
    ["1ドル=150円のとき、350ドルは日本円でいくらですか？", false], // H-08
    // Amount × percentage → result amount (round 7, Q6-01,
    // ANSWER_ROUND7_DIAGNOSIS_2026-11-27): every input is inside
    // the question, so it is arithmetic. All three exemptions
    // missed the shape — the 万 broke the amount pattern and the
    // bare いくらですか cue matched nothing — and the bare price
    // fallback at the bottom of the policy promoted it into
    // grounded research, where a source-retrieval failure refused
    // the whole answer (production: "9000万円の6.2%はいくらです
    // か？" → 正答558万円, refused twice).
    ["9000万円の6.2%はいくらですか？", false], // Q6-01
    ["5000万円の10%はいくらですか？", false],
    ["9000万円の10%引きはいくらですか？", false],
    ["100万円の3割はいくらですか？", false],
    // Counter-shape: a supplied amount with NO percentage is a
    // price question, not arithmetic, and stays grounded.
    ["9000万円の家はいくらですか？", true],
    // Counter-shapes: a question that names the exchange rate itself
    // as its subject, or demands the latest rate, is a rate
    // verification demand and stays grounded.
    ["現在のドル円の為替レートはいくらですか？", true],
    ["最新の為替レートで、350ドルは日本円でいくらですか？", true],
    ["為替レートが1ドル=150円のとき、350ドルは日本円でいくらですか？", true],
    // Personal deliberation: no published fact to ground.
    ["今の仕事を続けるか転職するか迷っています。考え方の整理を手伝ってください。", false], // J-01
    // Counter-shapes that must not move.
    ["消費税が導入された当初の税率は何%でしたか？", false],
    ["ふるさと納税とは何ですか？", false],
    ["初代のアメリカ大統領は誰ですか？", false],
    ["有給休暇の取り方を教えてください", false],
    ["現在の競合価格を調べて、新サービスを月額5,000円か8,000円にするか比較してください。", true],
  ])("requiresOriginGroundedResearch(%s) === %s", (message, expected) => {
    expect(requiresOriginGroundedResearch(message)).toBe(expected);
    expect(requiresOriginCurrentInformation(message)).toBe(expected);
  });
});

describe("planning routing (2026-11-16 production measurement BP-3 / BP-6)", () => {
  // The fixed planning/marketing briefs ask for framework answers, not
  // retrieved facts: every brief stays on the normal path, where the
  // planning profile's assumption discipline governs its figures. In
  // production (aade75ea) BP-3 and BP-6 were pulled into the grounded
  // path and failed closed with the 35-character no-sources hold —
  // BP-3 via the unfenced 「いま」 inside 「検討しています」 (fenced by
  // the routing calibration above), BP-6 via 「仕様書」 + 「新製品」
  // matching the price-with-product signal pair.
  it.each(ORIGIN_BUSINESS_PLANNING_BRIEFS.map((brief) => [brief.id, brief.prompt, brief.expectedKind] as const))(
    "%s stays on the normal path",
    (_id, prompt, expectedKind) => {
      expect(detectOriginBusinessPlanningKind(prompt)).toBe(expectedKind);
      expect(requiresOriginGroundedResearch(prompt)).toBe(false);
      expect(requiresOriginCurrentInformation(prompt)).toBe(false);
    },
  );

  // The exemption's boundary: a planning-shaped request that itself
  // demands current external facts keeps the grounded path.
  it.each([
    // Planning detection fires (市場規模) but the latest figure itself is demanded.
    "学習塾向け予約システム市場の最新の市場規模を教えてください。",
    // Current competitor pricing is a live fact, planning frame or not.
    "学習塾向け予約システム市場で、現在の競合の料金はいくらですか。",
    // A spec request that also asks for researched current prices.
    "新製品ローンチのマーケティング仕様書を作って。最新の競合製品の価格も調べて入れてください。",
  ])("explicit current-fact demand stays grounded: %s", (message) => {
    expect(requiresOriginGroundedResearch(message)).toBe(true);
    expect(requiresOriginCurrentInformation(message)).toBe(true);
  });
});

describe("originGroqRouteSystemInstruction planning augmentation (round-2 adjudication follow-up)", () => {
  // The round-2 production measurement (2026-11-16) served all seven
  // planning briefs from route 3, whose substitute instruction was
  // request-independent: the mandatory planning parts never reached the
  // model and every brief failed mustInclude with no owner/deadline
  // anywhere. These tests pin the fix: the base substitute is untouched,
  // and a detected planning profile appends the compact playbook.
  const base = originGroqRouteSystemInstruction();

  it("leaves the base substitute byte-identical when no planning profile is given", () => {
    expect(originGroqRouteSystemInstruction()).toBe(base);
    expect(originGroqRouteSystemInstruction(null)).toBe(base);
    expect(originGroqRouteSystemInstruction(undefined)).toBe(base);
    expect(base.length).toBeGreaterThanOrEqual(2_000);
    expect(base.length).toBeLessThanOrEqual(6_700);
    expect(base).not.toContain("Business planning rules for this request");
  });

  it("deck variant: drops the premise table and required parts from the addendum, keeping the number discipline (DOCUMENT_WAVE2 unit 1)", () => {
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS) {
      const profile = resolveOriginBusinessPlanning(brief.prompt)!;
      const deck = originGroqRouteSystemInstruction(profile, { forDeck: true });
      expect(deck.startsWith(base), brief.id).toBe(true);
      expect(deck, brief.id).not.toContain("Premise table first");
      expect(deck, brief.id).not.toContain("Required parts:");
      expect(deck, brief.id).toContain("- Numbers:");
      // Without the option the addendum is the standard one.
      expect(originGroqRouteSystemInstruction(profile), brief.id).toContain("Premise table first");
    }
    // The option alone (no profile) changes nothing.
    expect(originGroqRouteSystemInstruction(null, { forDeck: true })).toBe(base);
    expect(originGroqRouteSystemInstruction(undefined, { forDeck: true })).toBe(base);
  });

  it("appends the compact playbook after the unchanged base for every fixed brief", () => {
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS) {
      const profile = resolveOriginBusinessPlanning(brief.prompt)!;
      const augmented = originGroqRouteSystemInstruction(profile);
      expect(augmented.startsWith(base), brief.id).toBe(true);
      expect(augmented, brief.id).toContain(`kind: ${profile.kind}`);
      for (const part of brief.mustInclude) {
        expect(augmented, `${brief.id} augmented must contain ${part}`).toContain(part);
      }
    }
  });

  it("keeps the combined payload inside the route's functional token budget for every fixed brief", () => {
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS) {
      const augmented = originGroqRouteSystemInstruction(resolveOriginBusinessPlanning(brief.prompt)!);
      // The addendum is bounded on its own, and the whole route-3 payload
      // (instruction + the user's request) estimates to well under the
      // 6,000-token input budget the Groq executor trims history against,
      // leaving most of the 8,000 tokens/minute ceiling for completion.
      // Pin history: the addendum bound was 1,700, the combined bound
      // 4,700, and the token estimate 2,400 until 2026-11-18, when the
      // addendum gained the compressed premise table, the current-date
      // line, and the compact calendar anchor (633 characters) on the
      // measured basis of BUSINESS_ANCHOR_DIAGNOSIS_2026-11-18 — route 3
      // had served 14/14 measured briefs without them. Measured after
      // the change (BP-7, the largest brief): addendum 2,303 characters,
      // combined 5,275, estimated input 2,678 tokens at the gate's
      // characters/2. The pins sit just above those maxima, with
      // headroom only for the anchor's date-dependent length variation.
      // I-4 (2026-11-21) raised the base substitute's budget from 3,000
      // to 3,800 characters (base measured 3,710 after the change), so
      // the combined and estimate pins rose with it: measured maxima are
      // now combined 6,100 characters and an estimated 3,090 input
      // tokens - still well inside the route's 6,000-token input budget.
      // The addendum bound is unchanged.
      // CB-4 (CODEBENCH_CB4_DESIGN_2026-11-23) raised the base
      // substitute's budget from 3,800 to 4,800 characters (base
      // measured 4,659 after the change) to carry the
      // defining-behavior, equivalence, and definition/use rules on
      // route 3, so the combined and estimate pins rose with it:
      // measured maxima are now combined 7,049 characters and an
      // estimated 3,565 input tokens - still about sixty percent of
      // the route's 6,000-token input budget.
      // CB-5 (CODEBENCH_CB5_DESIGN_2026-11-23) raised the base
      // substitute's budget from 4,800 to 5,600 characters (base
      // measured 5,352 after the change) to carry the await
      // non-blocking canon and the scope, governing, and
      // API-conventions additions on route 3, so the combined and
      // estimate pins rose with it: measured maxima are now combined
      // 7,742 characters and an estimated 3,911 input tokens - still
      // about sixty-five percent of the route's 6,000-token input
      // budget.
      // CB-6 (CODEBENCH_CB6_DESIGN_2026-11-25) raised the base
      // substitute's budget from 5,600 to 6,000 characters (base
      // measured 5,912 after the change) to carry the code-review
      // finding discipline and the leave-nothing-unused rule on
      // route 3, so the combined and estimate pins rose with it:
      // measured maxima are now combined 8,302 characters and an
      // estimated 4,191 input tokens - still about seventy percent
      // of the route's 6,000-token input budget. The addendum bound
      // is unchanged (measured maximum 2,390).
      // CB-7 (CODE_E05_E02_DIAGNOSIS_2026-11-26) raised the base
      // substitute's budget from 6,000 to 6,200 characters (base
      // measured 6,016 after the change) to carry the conditional-
      // definition sentence on the definition/use rule, so the
      // measured maxima are now combined 8,406 characters and an
      // estimated 4,243 input tokens - still about seventy percent
      // of the route's 6,000-token input budget. The combined and
      // estimate pins below are unchanged: they still sit above the
      // new maxima. The addendum bound is unchanged.
      // V-1 (CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27) raised the base
      // substitute's budget from 6,200 to 6,700 characters (base
      // measured 6,516 after the change) to carry the
      // verification-status form rule for code answers on route 3,
      // so the combined and estimate pins rose with it: measured
      // maxima are now combined 8,906 characters and an estimated
      // 4,493 input tokens - still about seventy-five percent of
      // the route's 6,000-token input budget. The addendum bound is
      // unchanged (measured maximum 2,390).
      expect(augmented.length - base.length, brief.id).toBeLessThanOrEqual(2_400);
      expect(augmented.length, brief.id).toBeLessThanOrEqual(8_950);
      expect(estimateOriginGroqInputTokens([augmented, brief.prompt]), brief.id).toBeLessThanOrEqual(4_550);
    }
  });
});

describe("originCloudflareRouteSystemInstruction (route-2 compressed instruction)", () => {
  // Mirrors how both chat routers assemble the routes 1-2 instruction —
  // base + intent, requirement, work-plan, assignment, and quality
  // sections, with the current-date instruction appended — and then derive
  // the route-2 variant from that exact string.
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
      promptText: intentInput,
    });
    return originChatSystemInstruction(intent, workPlan, resolvedPlan, originAnswerQualityInstruction(quality))
      + "\n\n" + originCurrentDateInstruction(Date.UTC(2026, 10, 16, 12), "ja");
  };

  // Lines the route-2 variant removes for every request shape. Each one is
  // a restatement whose rule stays in the variant (the kept carriers are
  // pinned by the next test); removing any OTHER dynamic-section line, or
  // one of these lines losing its kept carrier, must fail loudly here.
  // Since capacity stage 2 the variant additionally substitutes a compact
  // base for the full base text; the base region is therefore checked by
  // the rule-preservation test below instead of line identity.
  const REDUNDANT_LINES_ALWAYS = [
    "- Do not say that an agent, specialist, tool, search, service, or artifact was used unless the execution record proves it.",
    "- Never present an uncreated file, uncalled service, unverified search, or unexecuted review as completed.",
    "- A partial or unavailable assignment must never be described as executed.",
    "- Deliverable First after clarification: when the user asks for something usable, first resolve only the material unknowns that would change the result. Then start with the finished output. Remove capability descriptions and generic preambles unless requested.",
    "- Depth calibration: concise means removing repetition, not removing substance. A short answer is appropriate only when it fully resolves the request. Multi-part, technical, planning, or consequential work must address every explicit requirement with enough concrete reasoning, constraints, examples, and execution detail to be decision-ready.",
    "- Write for a capable adult using professional, domain-appropriate language. Do not flatten important nuance or use childlike explanations unless the user asks for a beginner version.",
    "- Respect an explicit request for brevity or depth. For complex requests with no length preference, prioritize a complete, professionally reasoned answer over a short summary; use paragraphs, lists, tables, and fenced code where each helps the user act.",
    "- Silently evaluate correctness, relevance, completeness, freshness, evidence, calibration, actionability, and clarity before sending.",
  ];
  // Additional restatements that only exist in the creation/deliverable
  // assembly (creation rulebook and requirement-discovery section).
  const REDUNDANT_LINES_CREATION = [
    "- Treat requirement discovery as part of the work, not as friction, but it must not delay a useful first result. For custom creations, produce a working Version 1 first using low-risk defaults, mark assumptions and sample data, then request only one or two refinements. Do not make a question-only first turn.",
    "- Never spend the first turn on questions alone for a creation request. After the first draft, ask at most one or two focused questions, ordered by impact. Prefer concrete choices or examples when that reduces user effort.",
    "- Never ask the same requirement twice after the user has answered it. Carry accepted requirements forward into later turns and into the final deliverable.",
    "- These dimensions are prompts for judgment, not a mandatory questionnaire. For creation requests, produce a usable Version 1 first with low-risk defaults; ask only about unknowns that materially change the next revision.",
    "- Use clarification to improve the existing draft. Continue only while material uncertainty remains; do not delay an initial usable result while waiting for complete requirements.",
  ];
  // Restatement that only exists in the plain conversational assembly
  // (the requirement section's short form).
  const REDUNDANT_LINES_CONVERSATIONAL = [
    "- Answer directly unless a genuinely material ambiguity emerges.",
  ];

  const countLines = (text: string) => {
    const counts = new Map<string, number>();
    for (const line of text.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  };

  // The base's last line; everything after it in an assembly is dynamic
  // per-request content (intent, requirement, work-plan, assignment,
  // quality, and awareness sections plus the date instruction).
  const BASE_TAIL_MARKER = "- For consequential decisions, state what the user must independently confirm before acting.";
  const tailOf = (text: string) => text.slice(text.indexOf(BASE_TAIL_MARKER) + BASE_TAIL_MARKER.length);

  it("removes the redundant restatements and leaves every dynamic-section line untouched (conversational)", () => {
    const full = assemble("1から100までの素数をすべて教えてください。", "review");
    const variant = originCloudflareRouteSystemInstruction(full);
    const redundant = [...REDUNDANT_LINES_ALWAYS, ...REDUNDANT_LINES_CONVERSATIONAL];
    for (const line of redundant) {
      expect(full.split(line).length - 1).toBe(1);
      expect(variant).not.toContain(line);
    }
    // The dynamic tail survives byte-identically except for the removed
    // restatements: compression never rewrites per-request content.
    const expectedTail = tailOf(full)
      .split("\n")
      .filter((line) => !redundant.includes(line))
      .join("\n");
    expect(tailOf(variant)).toBe(expectedTail);
    expect(variant.startsWith("You are ORIGIN Personal AI.")).toBe(true);
    expect(full.length - variant.length).toBeGreaterThanOrEqual(1_400);
  });

  it("carries every base rule in the compact variant, with the creation rulebook gated as in the full base", () => {
    const conversational = originCloudflareRouteSystemInstruction(assemble("1から100までの素数をすべて教えてください。", "review"));
    const creation = originCloudflareRouteSystemInstruction(assemble("新商品の企画書を作ってください。", "documentation"));
    // One phrase per rule of the full base: if compression ever drops or
    // weakens a rule, the missing phrase fails here. Quality canon
    // (evidence, verification, wording discipline) is pinned verbatim.
    for (const phrase of [
      "Reply in the language used by the user",
      "polite desu/masu register (です・ます調) as the standard tone",
      "never spend the first turn asking only questions",
      "用途に合わせて調整するため、以下の1〜2点をお知らせください",
      "Identify the real objective and improve the result with missing decision criteria",
      "Follow explicit user constraints over generic helpfulness",
      "Preserve ambiguity or mark a placeholder instead of resolving it as fact",
      "Treat explicit output-shape constraints as hard requirements",
      "that specification takes top priority",
      "When the user asks only for a transformed deliverable, return that deliverable without extra analysis",
      "Decide which missing items would materially change the next revision",
      "Do not dump a long generic questionnaire on the user",
      "Use follow-up answers to improve the existing draft instead of restarting the process",
      "never repeat a question that the user has already answered",
      "choose sensible low-risk defaults, state the important assumptions briefly, and proceed",
      "prefer useful assumptions over interrogation",
      "default to a one-to-three sentence bottom line followed by three to five prioritized key points",
      "Write for a phone screen",
      "Use at most six main sections",
      "Calibrate depth to complexity. Simple requests may be brief",
      "Use professional, domain-appropriate language. Do not oversimplify important nuance unless the user asks for a beginner explanation.",
      "Prefer specific recommendations, examples, and ready-to-use wording over generic advice",
      "Silently use three passes before answering",
      "Fit the answer within the available output budget",
      "Before sending, silently check goal fit, completeness, internal consistency, usability, factual support, mobile readability, and unnecessary repetition",
      "Do not invent current or future facts, model names, release dates, or roadmaps",
      "attach the point in time it is as of",
      "Separate confirmed facts from assumptions, inferences, and recommendations",
      "answerable without live web retrieval unless the user explicitly asks for current external facts",
      "show the minimum useful calculation basis from the user's supplied values",
      "state each asked-about concept's defining behavior explicitly as a sentence",
      "Where a concept has a well-known point of confusion",
      "name that point explicitly",
      "first trace what the original code actually does",
      "never attribute to the original a behavior it does not have",
      "check it against the original on those same boundary cases",
      "aggregate from the full set with an outer join rather than from the detail side alone",
      "Make the replacement code actually implement every property the explanation claims for it",
      "use every name exactly as it was defined",
      "trace each example once for definition/use mismatches that would throw an error if the example were run",
      // CB-5 (CODEBENCH_CB5_DESIGN_2026-11-23): the await
      // non-blocking canon, the scope and self-containment
      // addition, the governing addition, and the API-conventions
      // rule, carried verbatim from the full base.
      "await suspends only the async function and does not block the thread",
      "Each example must define every name it uses",
      "a name defined inside one function is not available in another",
      "govern every description of the original",
      "keep the API conventions the given code shows",
      "do not switch dialects",
      // CB-6 (CODEBENCH_CB6_DESIGN_2026-11-25): the code-review
      // finding discipline and the leave-nothing-unused rule,
      // carried verbatim from the full base.
      "lead with the most consequential problem in that code",
      "every point must be traceable to a specific line or behavior of that code",
      "no problem actually present may be omitted to keep the list short",
      "Do not pad the review with generic checklist items",
      "state the operative reason it is a problem for this code's purpose",
      "Leave nothing unused",
      "remove imports or names carried over from the original",
      // CB-7 (CODE_E05_E02_DIAGNOSIS_2026-11-26): the conditional-
      // definition sentence on the definition/use rule, carried
      // verbatim from the full base.
      "A name assigned inside a `try` block may not exist when the `finally` block runs",
      "guard the cleanup so it never touches a name that might be unbound",
      // V-1 (CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27 section 4.2): the
      // verification-status form rule for code answers, carried
      // verbatim from the full base.
      "show the code's verification status as part of the answer's form",
      "Immediately after the code block, state in one sentence that the code has not been run to verify it",
      "「このコードは実行して確認していません。」",
      "Pair the code with the smallest check the user can run themselves",
      "the command to run it and the result to expect",
      "the expected results must include the boundary cases the original handles",
      "Present anything you worked out by reading or tracing the code as a traced expectation",
      "never as a result you observed by running it",
      "state that basis compactly when it helps the user inspect the reasoning",
      "never introduce case studies, competitive superiority, adoption results, benchmarks, customer outcomes, certifications",
      "do not turn a possible rule into a universal rule without verified jurisdiction/context",
      "core reaches 75°C",
      "Array.prototype.forEach awaits async callbacks",
      "catching and logging alone is not a complete repair",
      "Distinguish user-provided claims explicitly when they could be confused with verified facts",
      "Do not claim code, deployment, purchase, configuration, search, file creation, specialist review, or other execution without evidence",
      "Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys",
      "〔出典: [",
      "For consequential decisions, state what the user must independently confirm before acting",
    ]) {
      expect(conversational).toContain(phrase);
      expect(creation).toContain(phrase);
    }
    // The creation rulebook is present in the creation variant and gated
    // out of the conversational one, exactly as in the full instruction.
    for (const phrase of [
      "Build an internal requirement brief from the conversation before finalizing",
      "ask for confirmation only if getting them wrong would cause meaningful rework",
      "After producing a first version, treat user feedback as new requirements",
      "Preserve the requested medium",
      "When the user requests an image, do not substitute an image-generation prompt",
      "preserve its purpose, fields, data, accepted wording, and useful behavior",
      "do not stop at a bare form or demo when the request implies a usable product",
      "Name created items descriptively from their purpose",
    ]) {
      expect(creation).toContain(phrase);
      expect(conversational).not.toContain(phrase);
    }
  });

  it("keeps the carrier line of every removed restatement, and the behavioral core, exactly once", () => {
    const variant = originCloudflareRouteSystemInstruction(assemble("1から100までの素数をすべて教えてください。", "review"));
    for (const phrase of [
      // Kept carriers of the removed restatements.
      "Decide which missing items would materially change the next revision",
      "Calibrate depth to complexity. Simple requests may be brief",
      "Use professional, domain-appropriate language. Do not oversimplify important nuance unless the user asks for a beginner explanation.",
      "that specification takes top priority",
      "Silently use three passes before answering",
      "Before sending, silently check goal fit, completeness, internal consistency, usability, factual support, mobile readability, and unnecessary repetition",
      "Do not claim code, deployment, purchase, configuration, search, file creation, specialist review, or other execution without evidence",
      "clearly state what was not executed",
      "Only assigned services may be treated as available",
      // Behavioral core that must survive any prompt compression.
      "Reply in the language used by the user",
      "polite desu/masu register",
      "never spend the first turn asking only questions",
      "Treat explicit output-shape constraints as hard requirements",
      "Use follow-up answers to improve the existing draft",
      "Do not invent current or future facts, model names, release dates, or roadmaps",
      "Separate confirmed facts from assumptions, inferences, and recommendations",
      "〔出典: [",
      "Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys",
      "do not turn a possible rule into a universal rule without verified jurisdiction/context",
      "core reaches 75°C",
      "For consequential decisions, state what the user must independently confirm before acting",
      "Request-context awareness (infer why the user is asking, then adapt the answer):",
      "Ask back instead of answering only when all three hold",
      "現在の日付（Asia/Tokyo）は",
    ]) {
      expect(variant).toContain(phrase);
    }
    // The deduplicated no-fake-execution directive survives exactly once:
    // its three section-local restatements are gone, the base carrier stays.
    expect(variant.split("without evidence").length - 1).toBeGreaterThanOrEqual(1);
    expect(variant.split("- Do not claim code, deployment, purchase, configuration").length - 1).toBe(1);
  });

  it("removes the creation-rulebook restatements for a deliverable request and keeps the rulebook's unique rules", () => {
    const full = assemble("新商品の企画書を作ってください。", "documentation");
    const variant = originCloudflareRouteSystemInstruction(full);
    for (const line of [...REDUNDANT_LINES_ALWAYS, ...REDUNDANT_LINES_CREATION]) {
      expect(full.split(line).length - 1).toBe(1);
      expect(variant).not.toContain(line);
    }
    for (const phrase of [
      "Build an internal requirement brief from the conversation before finalizing",
      "Preserve the requested medium",
      "When the user requests an image, do not substitute",
      "For custom web or app deliverables, do not stop at a bare form or demo",
      "After producing a first version, treat user feedback as new requirements",
    ]) {
      expect(variant).toContain(phrase);
    }
  });

  it("leaves the planning/marketing protocol byte-identical in the variant", () => {
    const message = "中小企業向け経費精算SaaSのマーケティング計画を作ってください。月額5,000円で、1年で導入300社が目標です。施策ごとの予算配分と数値目標も入れてください。";
    const intentInput = originIntentInputFromContext([{ role: "user", content: message }]);
    const intent = classifyOriginRequestIntent(intentInput, "review");
    const profile = resolveOriginBusinessPlanning(intentInput, intent);
    expect(profile).not.toBeNull();
    const planningInstruction = buildOriginBusinessPlanningInstruction(profile!);
    const variant = originCloudflareRouteSystemInstruction(assemble(message, "review"));
    // Every line of the protocol — required parts, number discipline and
    // sanity, ownership and deadlines, assumption labelling — survives.
    for (const line of planningInstruction.split("\n")) {
      expect(variant).toContain(line);
    }
    expect(variant).toContain("Required parts for this kind — a checklist, not a suggestion");
    expect(variant).toContain("Number discipline (hard rule)");
    expect(variant).toContain("Ownership and deadlines (required for this kind)");
    expect(variant).toContain("仮置き（仮定）");
  });

  it("is a no-op on text that carries none of the redundant lines", () => {
    const compact = originGroqRouteSystemInstruction();
    expect(originCloudflareRouteSystemInstruction(compact)).toBe(compact);
    expect(originCloudflareRouteSystemInstruction("")).toBe("");
  });
});
