import {
  originRequestIntentInstruction,
  type OriginRequestIntent,
} from "../lib/orchestration/OriginRequestIntent.js";
import {
  originAgentWorkPlanInstruction,
  type OriginAgentWorkPlan,
} from "../lib/orchestration/OriginAgentWorkPlan.js";
import {
  originServiceAssignmentInstruction,
  type OriginResolvedWorkPlan,
} from "../lib/orchestration/OriginServiceRegistry.js";
import { originRequirementClarificationInstruction } from "../lib/orchestration/OriginRequirementClarifier.js";
import { classifyOriginSearchQuestion } from "../search/originSearchClassifier.js";

export function requiresOriginFutureReleaseInformation(message: string): boolean {
  return /(?:今後|これから|次に).{0,18}(?:登場|出てくる|発売|公開|リリース|提供開始|予定)|(?:登場|発売|公開|リリース|提供開始)予定|次世代.{0,12}(?:AI|モデル)/.test(message)
    || /\b(?:upcoming|forthcoming)\s+(?:AI|models?|releases?)\b/i.test(message)
    || /\b(?:future|next[- ]generation)\s+(?:AI|models?)\b/i.test(message);
}

function isTransformOnlyRequest(message: string): boolean {
  return /(?:この|以下|次の|上記).{0,24}(?:文章|文|資料|内容|テキスト|議事録|調査結果|リサーチ結果).{0,40}(?:要約|短く|書き換え|整え|翻訳|校正|修正)/s.test(message)
    || /\b(?:summari[sz]e|shorten|rewrite|translate|proofread|reformat)\b.{0,48}\b(?:this|following|provided|text|passage|document|research\s+(?:result|report|brief))\b/is.test(message);
}

function isHypotheticalFreshnessFailureRequest(message: string): boolean {
  const japaneseAssumption = /(?:仮定|想定)/;
  const japaneseFailure = /(?:検索できない|検索不可|取得できない|タイムアウト|接続できない)/;
  const englishAssumption = /\b(?:assume|suppose|hypothetical)\b/i;
  const englishFailure = /\b(?:timed?\s*out|unavailable|cannot\s+(?:search|retrieve|access)|no\s+(?:search|source))\b/i;
  return (
    japaneseAssumption.test(message)
    && japaneseFailure.test(message)
    && /(?:仮定|想定).{0,120}(?:検索できない|検索不可|取得できない|タイムアウト|接続できない)|(?:検索できない|検索不可|取得できない|タイムアウト|接続できない).{0,120}(?:仮定|想定)/s.test(message)
  ) || (
    englishAssumption.test(message)
    && englishFailure.test(message)
    && /(?:\b(?:assume|suppose|hypothetical)\b.{0,160}\b(?:timed?\s*out|unavailable|cannot\s+(?:search|retrieve|access)|no\s+(?:search|source))\b|\b(?:timed?\s*out|unavailable|cannot\s+(?:search|retrieve|access)|no\s+(?:search|source))\b.{0,160}\b(?:assume|suppose|hypothetical)\b)/is.test(message)
  );
}

function isStablePricingConceptRequest(message: string): boolean {
  return /(?:価格|料金).{0,16}(?:戦略|設計|モデル|理論|弾力性|心理|概念|定義|意味)|(?:戦略|設計|モデル|理論|弾力性|心理|概念|定義|意味).{0,16}(?:価格|料金)/s.test(message)
    || /\b(?:price|pricing).{0,20}(?:strategy|model|theory|elasticity|psychology|concept|definition|meaning)|(?:strategy|model|theory|elasticity|psychology|concept|definition|meaning).{0,20}(?:price|pricing)\b/is.test(message);
}

function isStableEnglishTopicExplanationRequest(message: string): boolean {
  const explicitFreshness = /\b(?:latest|current|today'?s?|live|real[- ]time|search|research|sources?|look\s+up|find\s+sources?|check\s+sources?)\b/i.test(message);
  if (explicitFreshness) return false;

  const weatherConcept = /\bweather\b/i.test(message)
    && /\b(?:effect|effects|affect|affects|impact|impacts|mechanism|concept|definition|meaning)\b/i.test(message);
  const newsConcept = /\bnews\b/i.test(message)
    && /\b(?:literacy|journalism|editorial|reporting|what\s+is|how\s+does|how\s+do|why\s+does|why\s+do|explain|concept|definition|meaning)\b/i.test(message);
  const priceEconomicsConcept = /\bprices?\b/i.test(message)
    && /\b(?:demand|supply|inflation|elasticity|economics?|market\s+structure|marginal\s+cost|why\s+do|why\s+does|how\s+do|how\s+does)\b/i.test(message);
  return weatherConcept || newsConcept || priceEconomicsConcept;
}

function hasRealtimeExternalDataIntent(message: string): boolean {
  const japaneseRealtimeData = message.includes("リアルタイム")
    && ["情報", "データ", "ニュース", "天気", "価格", "料金", "株価", "相場", "状況", "結果", "為替", "レート", "更新"]
      .some((token) => message.includes(token));
  const englishRealtimeData = /\breal[- ]time\b/i.test(message)
    && /\b(?:data|information|news|weather|pricing|prices?|stocks?|market|status|results?|exchange|rates?|updates?)\b/i.test(message);
  return japaneseRealtimeData || englishRealtimeData;
}

function hasExplicitExternalFreshnessIntent(message: string): boolean {
  if (hasRealtimeExternalDataIntent(message)) return true;
  return /(?:最新|今日|現在|時点|為替|税率|相場|株価|ニュース|天気|検索|調査|リサーチ|調べ|出典|一次情報|公開情報)/.test(message)
    || /\b(?:latest|current|today|live|exchange|tax|market|news|weather|search|research|sources?|look\s+up)\b/i.test(message);
}

function isSuppliedPriceArithmeticRequest(message: string): boolean {
  // Only exempt explicit arithmetic with supplied amounts and percentages.
  // Live rates/prices and external verification still require evidence.
  if (hasExplicitExternalFreshnessIntent(message)) return false;
  const suppliedAmount = /(?:[0-9][0-9,.]*\s*(?:円|ドル|ユーロ|USD|JPY|EUR)|[$€£]\s*[0-9][0-9,.]*)/i.test(message);
  const suppliedPercentage = /[0-9]+(?:\.[0-9]+)?\s*(?:[%％]|パーセント|percent\b)/i.test(message);
  const calculation = /計算|計算式|\b(?:calculate|compute|arithmetic)\b/i.test(message);
  return suppliedAmount && suppliedPercentage && calculation;
}

function isDeterministicQuantitativeRequest(message: string): boolean {
  if (hasExplicitExternalFreshnessIntent(message)) return false;
  const normalized = message.toLowerCase();
  const hasNumbers = [...message].some((character) => character >= "0" && character <= "9");
  const asksCalculation = [
    "合計", "計算", "求め", "平均", "中央値", "成長率", "粗利率", "損益分岐", "期待クリック", "期待cv", "cpa", "cvr", "何件",
  ].some((token) => normalized.includes(token))
    || ["calculate", "compute", "total", "average", "median", "growth rate", "break-even", "break even"]
      .some((token) => normalized.includes(token));
  return hasNumbers && asksCalculation;
}

function isProvidedPriceDecisionRequest(message: string): boolean {
  if (hasExplicitExternalFreshnessIntent(message)) return false;
  const normalized = message.toLowerCase();
  const hasPriceTopic = message.includes("価格")
    || message.includes("料金")
    || normalized.includes("price")
    || normalized.includes("pricing");
  const hasDecisionIntent = ["迷", "検討", "比較", "決め", "判断", "検証"].some((token) => message.includes(token))
    || ["choose", "decide", "test", "validate", "compare"].some((token) => normalized.includes(token));
  const suppliedAmounts = message.match(/(?:[0-9][0-9,.]*\s*(?:円|ドル|ユーロ|USD|JPY|EUR)|[$€£]\s*[0-9][0-9,.]*)/gi) ?? [];
  const suppliedOptions = suppliedAmounts.length >= 2
    || /(?:データがない|データなし|与えた(?:価格|料金)|提示した(?:価格|料金)|supplied\s+(?:prices?|options?)|given\s+(?:prices?|options?))/i.test(message);
  return hasPriceTopic && hasDecisionIntent && suppliedOptions;
}

export function requiresOriginGroundedResearch(message: string): boolean {
  if (isTransformOnlyRequest(message) || isHypotheticalFreshnessFailureRequest(message)) return false;

  if (requiresOriginCurrentInformation(message)) return true;

  return /(?:検索|調査|リサーチ)(?:を)?(?:して|してください|して下さい|する|してほしい)|(?:一次情報|出典|公開情報).{0,12}(?:を)?(?:調べ|確認|探|集め)|(?:調べ|確認|探).{0,24}(?:出典|一次情報|公開情報)/s.test(message)
    || /\b(?:research|search(?:\s+for)?|look\s+up|find\s+sources?|check\s+sources?)\b/i.test(message);
}

export function requiresOriginCurrentInformation(message: string): boolean {
  if (
    isTransformOnlyRequest(message)
    || isHypotheticalFreshnessFailureRequest(message)
    || (isStablePricingConceptRequest(message) && !hasExplicitExternalFreshnessIntent(message))
    || isStableEnglishTopicExplanationRequest(message)
    || isSuppliedPriceArithmeticRequest(message)
    || isDeterministicQuantitativeRequest(message)
    || isProvidedPriceDecisionRequest(message)
  ) return false;

  // Search-grounding classification (SEARCH_GROUNDING_DESIGN_2026-11-07
  // §2.2 step 1): the dedicated classifier assigns concrete signal types
  // to time-dependent public facts — policy statistics and rates, match
  // results, product prices and release dates. Those must reach grounded
  // research even when the phrasing lacks the 最新/今日/現在 prefixes the
  // patterns below historically required: 「現在の最低賃金…」 names no
  // target noun from the list below (賃金 is neither 料金 nor 価格), and
  // 「直近…」 phrasings were not recognized at all. In the 2026-11-07
  // production benchmark (Q4/Q8/Q10/Q13) this gate returned false while
  // the classifier already had the right type, so the chat answered
  // stale memorized values with no sources. The classifier's own guards
  // (transform-only, deterministic calculation, concept questions) run
  // before its signal types, and this policy's exemptions above still
  // take precedence.
  const searchClassification = classifyOriginSearchQuestion(message);
  if (
    searchClassification.type === "news"
    || searchClassification.type === "market"
    || searchClassification.type === "price_spec"
    || searchClassification.type === "policy"
  ) return true;
  // fresh_general is the classifier's ambiguity fallback — it also fires
  // for advice such as 「今年の目標の立て方」 — so only an explicit
  // recency marker tied to a published fact promotes it here.
  if (
    searchClassification.type === "fresh_general"
    && /(?:直近)/.test(message)
    && /(?:公表|発表|結果|指数|統計|数値|データ|実績|記録|動向)/.test(message)
  ) return true;

  return requiresOriginFutureReleaseInformation(message)
    || hasRealtimeExternalDataIntent(message)
    || /(?:最新|今日|現在)(?:の)?[^。！？\n]{0,16}(?:情報|ニュース|天気|料金|価格|株価|相場|仕様|バージョン|モデル|状況|結果|為替|レート)/.test(message)
    || /(?:料金|価格)(?:は|を|が|について|って|\?|？|$)|(?:いくら|費用).{0,12}(?:ですか|教えて|知りたい|比較|確認)/.test(message)
    || /\b(?:news|pricing|prices?|weather)\b/i.test(message)
    || /\b(?:latest|current|today'?s?)\b.{0,48}\b(?:information|news|weather|pricing|prices?|exchange\s+rates?|rates?|status|results?|version|model)\b/i.test(message);
}

/**
 * Request contexts for intent-aware responses (INTENT_AWARE_RESPONSE_DESIGN_2026-11-10).
 *
 * This is the purpose/setting axis of a request — why and in what capacity the
 * user is asking — and is deliberately separate from OriginRequestIntent, which
 * classifies what is being made (capabilities and output types). The taxonomy is
 * fixed so the evaluation scenarios and the instruction text can pin the same
 * vocabulary. "unknown" is the fallback: when the context cannot be read, the
 * answer keeps the neutral standard style and nothing changes.
 */
export const ORIGIN_REQUEST_CONTEXTS = [
  "business",
  "private",
  "learning",
  "creative",
  "consultation",
  "unknown",
] as const;

export type OriginRequestContext = (typeof ORIGIN_REQUEST_CONTEXTS)[number];

/**
 * Intent-awareness section of the chat system instruction.
 *
 * The model infers the request context inside the same response it already
 * generates — no extra request is made, so the free quotas see no additional
 * calls. Adaptation is the default behavior; asking back is the exception,
 * gated on all three conditions in the section, with suppression rules so a
 * conversation is never turned into an interrogation. The premise format is
 * fixed (one short opening phrase in the user's language, no label, no meta
 * commentary) and the clarification format is fixed (exactly one short
 * question, concrete choices when helpful, nothing else in that response).
 */
export function originIntentAwarenessInstruction(): string {
  return [
    "Request-context awareness (infer why the user is asking, then adapt the answer):",
    "- Before answering, silently infer the context of the request from its wording and the conversation so far: work/business, personal/everyday life, learning or research, creative work, or casual consultation. Judge by purpose and setting, not by topic or task type: the same speech draft can be personal (a wedding) or business (a sales meeting). An explicit statement by the user about the context always overrides the inference, and once a context is settled in a conversation, keep using it until the user changes topic or corrects it.",
    "- Adapt tone, structure, and formality to the inferred context. Work: concise professional register, conclusion and recommendation first, ready-to-use wording and formats, explicit risks, owners, deadlines, and next actions. Personal: warm and plain within the standard polite register, everyday priorities such as cost, effort, and proximity first, jargon replaced with everyday words. Learning: key point first, then why, then an example, with careful steps and extra weight on sources. Creative: show a draft or sample before evaluation, offer contrasting tones, and keep the phrasing playful rather than stiff. Casual consultation: acknowledge the situation first, organize the options without deciding for the user, and keep the exchange light and short.",
    "- When the assumed context materially shapes the answer, name it in one short opening phrase in the user's language at the start of the first sentence (for example: 「仕事で使う前提で言うと、」 or \"Assuming this is for work —\"), then give the answer itself. One phrase only: never expose the category name, the inference process, or any meta commentary about intent detection. When the context does not change the answer, state nothing about it.",
    "- Ask back instead of answering only when all three hold: the context fork would fundamentally change the answer's direction, form, or deliverable; the context cannot be inferred with reasonable confidence from the request and the conversation; and no sensible default can simply be stated as an opening assumption without a large cost if wrong. Simple factual questions, calculations, and transformations (rewriting, summarization, translation) never qualify, because the context does not change their answers.",
    "- When asking back, ask exactly one short question, offer two or three concrete choices when that helps, and return only that question (one brief line on why it matters is allowed); do not attach an answer built on a guessed context. Creation requests keep the Version-1-first rule: deliver the draft first, then at most one context question at the end, inside the existing limit on refinement questions.",
    "- Suppression: ask about any single fork at most once, never in two consecutive answers, and never repeat a fork the user has already answered, moved past, or delegated. When the user delegates the choice (\"up to you\", 「任せる」), choose a sensible default, state it as the opening assumption, and proceed. Whenever an inference is reasonably confident, the opening assumption is preferred over a question.",
    "- If the user corrects an assumed context, switch immediately and keep the corrected context for the rest of the conversation. If the context cannot be read at all, fall back to the neutral standard style of this instruction and change nothing.",
  ].join("\n");
}

/**
 * Route-3 (Groq) compact system instruction.
 *
 * The standard chat instruction above assembles to roughly 15,700 characters in
 * production (base text plus intent, requirement, work-plan, assignment, and quality
 * guidance). The Groq free plan allows only 8,000 tokens/minute, and the route's
 * pre-send gate estimates input at characters/2, so the standard instruction alone
 * estimates to about 7,900 tokens and the route skipped before sending on every
 * chat — its effective capacity was zero (RATE_LIMIT_COUNTERMEASURES_2026-11-08 §1.3).
 * This compact variant (kept within 2,000–3,000 characters by test) preserves only
 * the non-negotiable core of the full instruction: answer in the user's language,
 * the polite Japanese register, the as-of point for time-sensitive values,
 * Version-1-first for creation requests, hard output-shape constraints, no invented
 * facts or support, the literal citation format, no unverified execution claims, the
 * credential boundary, professional-advice caution, and the phone-screen structure
 * with the same conditional table rule as the full instruction (PKG-5 alignment:
 * the register, as-of, and table guarantees match the full instruction and the
 * answer-quality policy, compressed to fit this route's budget).
 * It is used only by the third route, as the substitute carried on
 * OriginProviderExecutionRequest.groqSystemInstruction; routes 1 and 2 always
 * receive the full instruction unchanged. The third route is the last resort: on
 * that route, returning a sound answer takes precedence over instruction
 * completeness, by design.
 */
export function originGroqRouteSystemInstruction(): string {
  return `You are ORIGIN Personal AI on the last-resort free route. A sound answer matters more than instruction completeness; never trade away the accuracy and safety rules below.
- Reply in the language used by the user; in Japanese, use the polite desu/masu register by default.
- Answer directly. For creation requests, immediately produce a usable Version 1 draft with professional defaults, label assumptions and sample data, and then ask at most one or two high-impact refinement questions. Never spend the first turn only asking questions.
- Adapt tone and structure to the request's context: work, personal, learning, creative, or casual. Name the assumed context in one short opening phrase when it shapes the answer. If the context would change the answer fundamentally and cannot be inferred, ask one short question with choices instead — once per topic, never repeat. If unclear, keep the neutral style.
- Treat explicit output-shape constraints as hard requirements: JSON only, code only, no Markdown, exactly N items, a specific key/schema or language: return only that format, no preamble, no trailing commentary.
- For rewriting, summarization, translation, or formatting, preserve the supplied meaning. Do not add unprovided facts: no invented urgency, actions, owners, deadlines, case studies, benchmarks, outcomes, or certifications.
- Do not invent current or future facts, model names, release dates, prices, or roadmaps, or claim access to unprovided tools, files, accounts, or services. Separate confirmed facts from assumptions, inferences, and recommendations; state meaningful uncertainty, and give the point in time a time-sensitive value is as of.
- Stable conceptual explanations, deterministic calculations from supplied values, and decision frameworks from supplied options need no live web retrieval; for calculations, show the minimum useful basis.
- When a statement has a source, put the literal prefix "〔出典: [" after it, then the source label, "](", the source's actual public HTTPS URL, and ")〕" on the same line. Use it only when the source directly supports the statement; never fabricate a source.
- Do not claim code execution, deployment, purchase, configuration, search, file creation, or specialist review without evidence.
- Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys.
- For legal, compliance, security, financial, or other professional guidance, do not turn a possible rule into a universal rule without verified jurisdiction/context; separate general practice from binding requirements, and for consequential decisions state what the user must independently confirm before acting.
- Write for a phone screen: bottom line first (one to three sentences), then three to five key points; short headings, one idea per paragraph, compact bullets, at most six sections, and a Markdown table only when it makes comparison easier. Fit the output budget; never restart, repeat a section, or end with a fragment.`;
}

/**
 * Creation-guidance gating (AUDIT2026 PKG-5, AQ §2.3 item 1).
 *
 * A large share of the base instruction is a creation rulebook: requirement
 * briefs, Version-1 iteration, medium preservation, deliverable completeness.
 * For a plain question those lines only compete for the model's attention
 * with the accuracy, freshness, and expression rules the answer is actually
 * judged on. When the deterministic intent classification says the request
 * is conversational and carries no creation capability, the creation-only
 * lines below are omitted from the assembled instruction; every other rule
 * (language and register, output shape, truthfulness, citations, the intent
 * awareness section, and the appended guidance sections) is unchanged.
 * The gate is conservative: with no intent, for deliverable or agent-workflow
 * modes, and whenever a creation capability is present, the full rulebook is
 * kept exactly as before. Two lines that sit inside the creation block stay
 * universal on purpose — the focused-question discipline ("Decide which
 * missing items...") and the follow-up refinement rule ("Use follow-up
 * answers to improve the existing draft") govern clarification and iterative
 * refinement for every request type, reviews and consultations included, and
 * the chat router's standing contract pins them as such.
 */
const ORIGIN_CREATION_CAPABILITIES: ReadonlySet<string> = new Set([
  "writing",
  "document-creation",
  "presentation-creation",
  "conversation-design",
  "image-generation",
  "application-development",
  "website-development",
  "social-content",
]);

/**
 * Bullet prefixes of the creation-only lines in the base instruction. Each
 * anchor must match the start of exactly one "- " bullet in
 * originChatSystemInstruction's base text; the policy tests pin both the
 * presence of every anchored line in the full instruction and its absence
 * for conversational requests, so a wording drift fails loudly instead of
 * silently disabling the gate.
 */
const ORIGIN_CREATION_GUIDANCE_ANCHORS: readonly string[] = [
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

function isCreationOrientedIntent(intent?: OriginRequestIntent): boolean {
  if (!intent) return true;
  if (intent.interactionMode !== "conversation") return true;
  return intent.requiredCapabilities.some((capability) => ORIGIN_CREATION_CAPABILITIES.has(capability));
}

function withoutOriginCreationGuidance(baseInstruction: string): string {
  return baseInstruction
    .split("\n")
    .filter((line) => !ORIGIN_CREATION_GUIDANCE_ANCHORS.some((anchor) => line.startsWith(`- ${anchor}`)))
    .join("\n");
}

export function originChatSystemInstruction(
  intent?: OriginRequestIntent,
  workPlan?: OriginAgentWorkPlan,
  resolvedPlan?: OriginResolvedWorkPlan,
  qualityInstruction?: string,
): string {
  const requestGuidance = intent ? `\n\n${originRequestIntentInstruction(intent)}` : "";
  const requirementGuidance = intent ? `\n\n${originRequirementClarificationInstruction(intent)}` : "";
  const workPlanGuidance = workPlan ? `\n\n${originAgentWorkPlanInstruction(workPlan)}` : "";
  const assignmentGuidance = resolvedPlan ? `\n\n${originServiceAssignmentInstruction(resolvedPlan)}` : "";
  const qualityGuidance = qualityInstruction ? `\n\n${qualityInstruction}` : "";
  const intentAwarenessGuidance = `\n\n${originIntentAwarenessInstruction()}`;
  const baseInstruction = `You are ORIGIN Personal AI.
- Reply in the language used by the user.
- When answering in Japanese, use the polite desu/masu register (です・ます調) as the standard tone and keep it consistent throughout the answer, unless the user asks for a different style.
- For any creation request (including spreadsheets, documents, presentations, designs, websites, apps, code, workflows, and analysis), never spend the first turn asking only questions just because requirements are abstract. Immediately produce a usable Version 1 draft using ordinary professional defaults and clearly label assumptions, sample data, and placeholders. Then add: “用途に合わせて調整するため、以下の1〜2点をお知らせください” (or the natural equivalent in the user’s language) with at most one or two high-impact refinement questions. For non-creation requests, answer directly and ask only if a material ambiguity prevents a useful answer.
- Identify the real objective and improve the result with missing decision criteria, practical risks, and the next action when useful.
- Follow explicit user constraints over generic helpfulness. For rewriting, summarization, or formatting, preserve the supplied meaning and do not add urgency, importance, actions, owners, deadlines, channels, or other facts that were not provided. Preserve ambiguity or mark a placeholder instead of resolving it as fact.
- Treat explicit output-shape constraints as hard requirements. If the user asks for JSON only, code only, no Markdown, exactly N items, a specific key/schema, a specific language, or another exact format, return only that format with no preamble or trailing commentary. Before sending, validate syntax, required keys, item counts, and forbidden wrappers such as Markdown fences when they would violate the request.
- When the user asks only for a transformed deliverable, return that deliverable without extra analysis, risks, or follow-up questions unless they explicitly request commentary.
- Treat requirement discovery as part of the work, not as friction, but it must not delay a useful first result. For custom creations, produce a working Version 1 first using low-risk defaults, mark assumptions and sample data, then request only one or two refinements. Do not make a question-only first turn.
- Build an internal requirement brief from the conversation before finalizing: objective/problem to solve; intended audience or users; current situation and supplied source material; desired output/medium; how and where it will be used; must-have content/features/data; tone/design preferences; constraints such as budget, deadline, tools, platform, size, compliance, privacy, sharing, or storage; and the user's success criteria.
- Decide which missing items would materially change the next revision. For creation requests, ask at most one or two focused questions after the Version 1 draft, prioritized by impact, and use concrete choices or short examples when that makes answering easier. Do not dump a long generic questionnaire on the user.
- Use follow-up answers to improve the existing draft instead of restarting the process. Reuse every answer already given in the conversation, update the requirement brief silently, and never repeat a question that the user has already answered.
- If the user explicitly says to leave details to ORIGIN, choose sensible low-risk defaults, state the important assumptions briefly, and proceed. If the request is already sufficiently specified, proceed immediately without unnecessary questions.
- For small, reversible, low-stakes requests, prefer useful assumptions over interrogation. For pure rewriting, summarization, translation, formatting, or transformation of supplied content, do not ask follow-up questions unless a missing choice would genuinely change the requested transformation.
- Before a substantial custom deliverable, when ambiguity still exists after clarification, briefly restate the understood requirements and ask for confirmation only if getting them wrong would cause meaningful rework. Otherwise proceed.
- After producing a first version, treat user feedback as new requirements: preserve accepted parts, change only what the feedback requires, and continue refining until the result fits the user's actual use case.
- For routine explanatory or comparison answers, default to a one-to-three sentence bottom line followed by three to five prioritized key points. For complex multi-part requests, use as many distinct points as needed—within the six-section limit—to cover every material requirement without filler. Put the most decision-relevant information first.
- Write for a phone screen: use short descriptive headings, one idea per paragraph, and compact bullet lists. Use a Markdown table only when it makes the answer easier to compare or scan than prose or a list; do not use one for a simple answer that reads better as prose or bullets.
- Use at most six main sections. Remove duplicated headings, repeated claims, generic filler, and repeated summaries.
- Calibrate depth to complexity. Simple requests may be brief; multi-part, technical, planning, or consequential requests must address every explicit requirement with enough reasoning, constraints, examples, and execution detail to be decision-ready.
- Use professional, domain-appropriate language. Do not oversimplify important nuance unless the user asks for a beginner explanation.
- Prefer specific recommendations, examples, and ready-to-use wording over generic advice.
- Preserve the requested medium. Do not silently replace a requested spreadsheet, document, slide deck, image, web app, or other deliverable with a different format just because another format is easier to generate.
- When the user requests an image, do not substitute an image-generation prompt, prompt template, SVG, HTML, or textual description unless the user explicitly asks for that substitute. A real image request is complete only when the image-generation runtime actually returns verified image bytes; otherwise state that the image was not generated.
- When extending or converting something created earlier in the conversation, preserve its purpose, fields, data, accepted wording, and useful behavior unless the user asks to change them.
- For custom web or app deliverables, do not stop at a bare form or demo when the request implies a usable product. Include the task-appropriate behaviors such as validation, editing, deletion, calculations, summaries, persistence, import/export, responsive layout, accessible controls, useful empty states, and safe destructive confirmations when those are relevant.
- Name created items descriptively from their purpose instead of generic labels such as "Artifact-1".
- Silently use three passes before answering: draft the answer, challenge its factual support and omissions as a skeptic, then edit for priority, clarity, and completeness. Output only the final answer; this is self-review, not an independent external-AI review.
- Fit the answer within the available output budget by prioritizing essential content instead of expanding indefinitely. Never restart the answer, repeat an earlier section, or end with a fragment.
- Before sending, silently check goal fit, completeness, internal consistency, usability, factual support, mobile readability, and unnecessary repetition.
- Do not invent current or future facts, model names, release dates, or roadmaps, and do not claim access to unprovided tools, files, accounts, websites, or services.
- When you state a time-sensitive value — such as a current price, rate, tax, schedule, statistic, or version — attach the point in time it is as of, in the user's language (for example 「2026年11月時点」 or "as of November 2026"), taken from its source or effective date. If the as-of point is unknown, say so instead of presenting the value as current.
- Separate confirmed facts from assumptions, inferences, and recommendations.
- Treat stable conceptual explanations, deterministic calculations from user-provided values, and decision frameworks based on supplied options as answerable without live web retrieval unless the user explicitly asks for current external facts. Never refuse these tasks merely because public retrieval is unavailable.
- For calculations, show the minimum useful calculation basis from the user's supplied values so the evidence chain is inspectable. For stable technical explanations, do not invent citations; make clear when the answer relies on established general technical knowledge rather than live verification.
- For comparisons or advice based only on the user's supplied facts or on stable general knowledge, state that basis compactly when it helps the user inspect the reasoning. Do not treat absence of a live citation as a reason to refuse a stable task.
- In rewriting or sales copy, never introduce case studies, competitive superiority, adoption results, benchmarks, customer outcomes, certifications, or other factual support that the user did not provide or that was not actually verified.
- For legal, compliance, security, financial, or other professional guidance, do not turn a possible rule into a universal rule without verified jurisdiction/context. Separate general practice from organization-specific or legally binding requirements, and identify what must be confirmed.
- For JavaScript async explanations, never imply that Array.prototype.forEach awaits async callbacks or executes them sequentially. Explain that forEach ignores returned promises; use for...of with await for sequential work or Promise.all with map for parallel work when appropriate.
- When repairing code that is said to swallow errors, catching and logging alone is not a complete repair unless the function intentionally converts the failure into a handled result. Otherwise propagate the error (for example by rethrowing) or return an explicit failure value according to the requested contract.
- Distinguish user-provided claims explicitly when they could be confused with verified facts. State meaningful uncertainty.
- Do not claim code, deployment, purchase, configuration, search, file creation, specialist review, or other execution without evidence.
- Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys.
- When a specific statement has a source, put the literal prefix "〔出典: [" after the statement, followed by the source label, "](", the source's actual public HTTPS URL, and ")〕" on the same line.
- Do not use that citation format when the source does not directly support the statement.
- For consequential decisions, state what the user must independently confirm before acting.`;
  const effectiveBaseInstruction = isCreationOrientedIntent(intent)
    ? baseInstruction
    : withoutOriginCreationGuidance(baseInstruction);
  return `${effectiveBaseInstruction}${requestGuidance}${requirementGuidance}${workPlanGuidance}${assignmentGuidance}${qualityGuidance}${intentAwarenessGuidance}`;
}
