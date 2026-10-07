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

export function requiresOriginFutureReleaseInformation(message: string): boolean {
  return /(?:今後|これから|次に).{0,18}(?:登場|出てくる|発売|公開|リリース|提供開始|予定)|(?:登場|発売|公開|リリース|提供開始)予定|次世代.{0,12}(?:AI|モデル)/.test(message)
    || /\b(?:upcoming|forthcoming)\s+(?:AI|models?|releases?)\b/i.test(message)
    || /\b(?:future|next[- ]generation)\s+(?:AI|models?)\b/i.test(message);
}

function isTransformOnlyRequest(message: string): boolean {
  const transformsSuppliedContent = /(?:この|以下|次の|上記).{0,24}(?:文章|文|資料|内容|テキスト|議事録|調査結果|リサーチ結果).{0,40}(?:要約|短く|書き換え|整え|翻訳|校正|修正)/s.test(message)
    || /\b(?:summari[sz]e|shorten|rewrite|translate|proofread|reformat)\b.{0,48}\b(?:this|following|provided|text|passage|document|research\s+(?:result|report|brief))\b/is.test(message);
  if (!transformsSuppliedContent) return false;

  // An explicit additional research task must not be suppressed by the
  // transformation shortcut. Quoted/fenced source text is not a task request.
  const requestText = message.replace(/```[\s\S]*?```|「[^」]*」|『[^』]*』|"[^"\n]*"/g, " ");
  const additionalResearch = /(?:また|さらに|加えて|併せて|あわせて|その上で|そのうえで|それとは別に|[、，。！？\n]).{0,80}(?:検索(?:して|する)|調査(?:して|する)|リサーチ(?:して|する)|調べ(?:て|る)|(?:出典|一次情報|公開情報).{0,16}確認)/s.test(requestText)
    || /\b(?:and(?:\s+also)?|also|additionally|in\s+addition|then)\s+(?:please\s+)?(?:research|search(?:\s+for)?|look\s+up|find\s+sources?|check\s+sources?|verify)\b/i.test(requestText)
    || /(?:^|[.!?\n])\s*(?:[-*]\s+|\d+[.)]\s+)?(?:please\s+)?(?:research|search(?:\s+for)?|look\s+up|find\s+sources?|check\s+sources?|verify\s+(?:the\s+)?sources?)\b/i.test(requestText);
  const additionalCurrentFacts = /(?:また|さらに|加えて|併せて|あわせて|その上で|そのうえで|それとは別に|[、，。！？\n]).{0,80}(?:最新|今日|現在)(?:の)?[^。！？\n]{0,16}(?:情報|ニュース|天気|料金|価格|株価|相場|仕様|バージョン|モデル|状況|結果|為替|レート)[^。！？\n]{0,24}(?:教え|確認|調べ|示し|提示)/s.test(requestText)
    || /(?:\b(?:and(?:\s+also)?|also|additionally|then)\s+|[.!?\n]\s*)(?:please\s+)?(?:tell|show|give|check|confirm|find)\b[^.!?\n]{0,48}\b(?:latest|current|today'?s?)\b[^.!?\n]{0,32}\b(?:information|news|weather|pricing|prices?|exchange\s+rates?|rates?|status|results?|versions?|models?)\b/i.test(requestText);
  return !additionalResearch && !additionalCurrentFacts;
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
    || /\b(?:research|search(?:\s+for)?|look\s+up|find\s+sources?|check\s+sources?|verify\s+(?:the\s+)?sources?)\b/i.test(message);
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

  return requiresOriginFutureReleaseInformation(message)
    || hasRealtimeExternalDataIntent(message)
    || /(?:最新|今日|現在)(?:の)?[^。！？\n]{0,16}(?:情報|ニュース|天気|料金|価格|株価|相場|仕様|バージョン|モデル|状況|結果|為替|レート)/.test(message)
    || /(?:料金|価格)(?:は|を|が|について|って|\?|？|$)|(?:いくら|費用).{0,12}(?:ですか|教えて|知りたい|比較|確認)/.test(message)
    || /\b(?:news|pricing|prices?|weather)\b/i.test(message)
    || /\b(?:latest|current|today'?s?)\b.{0,48}\b(?:information|news|weather|pricing|prices?|exchange\s+rates?|rates?|status|results?|version|model)\b/i.test(message);
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
  return `You are ORIGIN Personal AI.
- Reply in the language used by the user.
- When the request is sufficiently specified, start with the direct answer or usable deliverable. When material information is still missing, start with the focused clarification questions needed to resolve it. Do not begin with generic background or a description of your capabilities.
- Identify the real objective and improve the result with missing decision criteria, practical risks, and the next action when useful.
- Follow explicit user constraints over generic helpfulness. For rewriting, summarization, or formatting, preserve the supplied meaning and do not add urgency, importance, actions, owners, deadlines, channels, or other facts that were not provided. Preserve ambiguity or mark a placeholder instead of resolving it as fact.
- Treat explicit output-shape constraints as hard requirements. If the user asks for JSON only, code only, no Markdown, exactly N items, a specific key/schema, a specific language, or another exact format, return only that format with no preamble or trailing commentary. Before sending, validate syntax, required keys, item counts, and forbidden wrappers such as Markdown fences when they would violate the request.
- When the user asks only for a transformed deliverable, return that deliverable without extra analysis, risks, or follow-up questions unless they explicitly request commentary.
- Treat requirement discovery as part of the work, not as friction. For requests whose quality materially depends on missing context—especially planning, recommendations, documents, spreadsheets, presentations, designs, websites, apps, code, workflows, analysis, or other custom creations—do not rush into a final answer or deliverable.
- Build an internal requirement brief from the conversation before finalizing: objective/problem to solve; intended audience or users; current situation and supplied source material; desired output/medium; how and where it will be used; must-have content/features/data; tone/design preferences; constraints such as budget, deadline, tools, platform, size, compliance, privacy, sharing, or storage; and the user's success criteria.
- Decide which missing items would materially change the result. Ask only those. Ask one to three focused questions per turn, prioritized by impact, and use concrete choices or short examples when that makes answering easier. Do not dump a long generic questionnaire on the user.
- Continue the clarification loop across turns until the material unknowns are resolved. Reuse every answer already given in the conversation, update the requirement brief silently, and never repeat a question that the user has already answered.
- If the user explicitly says to leave details to ORIGIN, choose sensible low-risk defaults, state the important assumptions briefly, and proceed. If the request is already sufficiently specified, proceed immediately without unnecessary questions.
- If one part is blocked by a genuinely material unknown, complete the independent, reversible parts with the information already supplied and clearly identify the remaining blocker. Do not invent required facts or imply the blocked work was completed.
- For small, reversible, low-stakes requests, prefer useful assumptions over interrogation. For pure rewriting, summarization, translation, formatting, or transformation of supplied content, do not ask follow-up questions unless a missing choice would genuinely change the requested transformation.
- Before a substantial custom deliverable, when ambiguity still exists after clarification, briefly restate the understood requirements and ask for confirmation only if getting them wrong would cause meaningful rework. Otherwise proceed.
- After producing a first version, treat user feedback as new requirements: preserve accepted parts, change only what the feedback requires, and continue refining until the result fits the user's actual use case.
- For routine explanatory or comparison answers, start with a concise direct answer and add only the key points needed. For complex multi-part requests, use as many distinct points as needed to cover every material requirement without filler. Put the most decision-relevant information first.
- Write for a phone screen: use one idea per paragraph, descriptive headings when useful, and compact lists. Use a compact Markdown table when it makes options or exact mappings easier to compare; use prose when a table would be wide, repetitive, or unnecessary. Follow the user's explicit format preference.
- Use only as many sections as the task needs. Remove duplicated headings, repeated claims, generic filler, and repeated summaries; do not omit a requested item to fit an arbitrary section count.
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
- For consequential decisions, state what the user must independently confirm before acting.${requestGuidance}${requirementGuidance}${workPlanGuidance}${assignmentGuidance}${qualityGuidance}`;
}
