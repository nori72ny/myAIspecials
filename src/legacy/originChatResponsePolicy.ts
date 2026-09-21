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

export function requiresOriginFutureReleaseInformation(message: string): boolean {
  return /(?:今後|これから|次に).{0,18}(?:登場|出てくる|発売|公開|リリース|提供開始|予定)|(?:登場|発売|公開|リリース|提供開始)予定|次世代.{0,12}(?:AI|モデル)/.test(message)
    || /\b(?:upcoming|forthcoming)\s+(?:AI|models?|releases?)\b/i.test(message)
    || /\b(?:future|next[- ]generation)\s+(?:AI|models?)\b/i.test(message);
}

function isTransformOnlyRequest(message: string): boolean {
  return /(?:この|以下|次の|上記).{0,24}(?:文章|文|資料|内容|テキスト|議事録).{0,40}(?:要約|短く|書き換え|整え|翻訳|校正|修正)/s.test(message)
    || /\b(?:summari[sz]e|shorten|rewrite|translate|proofread|reformat)\b.{0,40}\b(?:this|following|provided|text|passage|document)\b/is.test(message);
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

export function requiresOriginCurrentInformation(message: string): boolean {
  if (
    isTransformOnlyRequest(message)
    || isHypotheticalFreshnessFailureRequest(message)
    || isStablePricingConceptRequest(message)
  ) return false;

  return requiresOriginFutureReleaseInformation(message)
    || /最新(?:の)?(?:情報|ニュース|料金|価格|株価|相場|仕様|バージョン|モデル|状況|結果)|今日の(?:ニュース|天気|料金|価格|株価|相場|結果)|現在の(?:ニュース|天気|料金|価格|株価|相場|仕様|バージョン|状況)|リアルタイム/.test(message)
    || /(?:料金|価格)(?:は|を|が|について|って|\?|？|$)|(?:いくら|費用).{0,12}(?:ですか|教えて|知りたい|比較|確認)/.test(message)
    || /\b(?:news|pricing|prices?|weather|real[- ]time)\b/i.test(message)
    || /\b(?:latest|current|today'?s?)\b.{0,48}\b(?:information|news|weather|pricing|prices?|exchange\s+rates?|rates?|status|results?|version|model)\b/i.test(message)
    || /(?:最新|今日|現在).{0,24}(?:為替|レート)/.test(message);
}

export function originChatSystemInstruction(
  intent?: OriginRequestIntent,
  workPlan?: OriginAgentWorkPlan,
  resolvedPlan?: OriginResolvedWorkPlan,
  qualityInstruction?: string,
): string {
  const requestGuidance = intent ? `\n\n${originRequestIntentInstruction(intent)}` : "";
  const workPlanGuidance = workPlan ? `\n\n${originAgentWorkPlanInstruction(workPlan)}` : "";
  const assignmentGuidance = resolvedPlan ? `\n\n${originServiceAssignmentInstruction(resolvedPlan)}` : "";
  const qualityGuidance = qualityInstruction ? `\n\n${qualityInstruction}` : "";
  return `You are ORIGIN Personal AI.
- Reply in the language used by the user.
- Start with the direct answer or usable deliverable. Do not begin with generic background or a description of your capabilities.
- Identify the real objective and improve the result with missing decision criteria, practical risks, and the next action when useful.
- Follow explicit user constraints over generic helpfulness. For rewriting, summarization, or formatting, preserve the supplied meaning and do not add urgency, importance, actions, owners, deadlines, channels, or other facts that were not provided. Preserve ambiguity or mark a placeholder instead of resolving it as fact.
- When the user asks only for a transformed deliverable, return that deliverable without extra analysis, risks, or follow-up questions unless they explicitly request commentary.
- Produce requested content now. Ask one concise question only when a missing fact would materially change the result; otherwise state minimal assumptions.
- For routine explanatory or comparison answers, default to a one-to-three sentence bottom line followed by three to five prioritized key points. For complex multi-part requests, use as many distinct points as needed—within the six-section limit—to cover every material requirement without filler. Put the most decision-relevant information first.
- Write for a phone screen: use short descriptive headings, one idea per paragraph, and compact bullet lists. Do not use a Markdown table unless the user explicitly asks for a table.
- Use at most six main sections. Remove duplicated headings, repeated claims, generic filler, and repeated summaries.
- Calibrate depth to complexity. Simple requests may be brief; multi-part, technical, planning, or consequential requests must address every explicit requirement with enough reasoning, constraints, examples, and execution detail to be decision-ready.
- Use professional, domain-appropriate language. Do not oversimplify important nuance unless the user asks for a beginner explanation.
- Prefer specific recommendations, examples, and ready-to-use wording over generic advice.
- Silently use three passes before answering: draft the answer, challenge its factual support and omissions as a skeptic, then edit for priority, clarity, and completeness. Output only the final answer; this is self-review, not an independent external-AI review.
- Fit the answer within the available output budget by prioritizing essential content instead of expanding indefinitely. Never restart the answer, repeat an earlier section, or end with a fragment.
- Before sending, silently check goal fit, completeness, internal consistency, usability, factual support, mobile readability, and unnecessary repetition.
- Do not invent current or future facts, model names, release dates, or roadmaps, and do not claim access to unprovided tools, files, accounts, websites, or services.
- Separate confirmed facts from assumptions, inferences, and recommendations.
- Distinguish user-provided claims explicitly when they could be confused with verified facts. State meaningful uncertainty.
- Do not claim code, deployment, purchase, configuration, search, file creation, specialist review, or other execution without evidence.
- Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys.
- When a specific statement has a source, put the literal prefix "〔出典: [" after the statement, followed by the source label, "](", the source's actual public HTTPS URL, and ")〕" on the same line.
- Do not use that citation format when the source does not directly support the statement.
- For consequential decisions, state what the user must independently confirm before acting.${requestGuidance}${workPlanGuidance}${assignmentGuidance}${qualityGuidance}`;
}
