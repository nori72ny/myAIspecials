const TOTAL_BUDGET_MS = 100_000;
const DEFAULT_RETRY_DELAYS_MS = [200, 500, 1000];
const MAX_RETRIES = 3;

async function executeWithRetry(executeFn, request) {
  const startTime = Date.now();
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const elapsed = Date.now() - startTime;
    const remainingBudget = Math.max(5000, TOTAL_BUDGET_MS - elapsed);
    const timeoutForAttempt = Math.min(25_000, remainingBudget);
    try {
      return await executeFn(request, timeoutForAttempt);
    } catch (err) {
      lastError = err;
      const status = err?.status ?? err?.statusCode ?? 0;
      const code = err?.code ?? "";
      const retryable = status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || code === "PROVIDER_RATE_LIMITED" || code === "PROVIDER_TIMEOUT" || code === "PROVIDER_UNAVAILABLE" || code === "PROVIDER_INTERNAL_ERROR";
      if (retryable && attempt < MAX_RETRIES) {
        const delay = Math.min(err?.retryAfterSeconds ? err.retryAfterSeconds * 1000 : DEFAULT_RETRY_DELAYS_MS[attempt], 10_000);
        if (elapsed + delay + 1000 < TOTAL_BUDGET_MS) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      throw err;
    }
  }
  throw lastError;
}

import { randomUUID } from "node:crypto";
import { Router } from "express";
import { createOriginAnswerEnvelope, type OriginAnswerEnvelope, type OriginAnswerEvidenceItem, type OriginAnswerVerificationStatus } from "../lib/orchestration/OriginAnswerEnvelope.js";
import { extractProvidedOriginEvidence } from "../lib/orchestration/OriginAnswerEvidence.js";
import { DEFAULT_ORIGIN_CONTEXT_POLICY, minimizeOriginContext, type OriginContextPolicy } from "../lib/orchestration/OriginContextPolicy.js";
import { buildOriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import type { OriginFreeModelEvidence } from "../lib/orchestration/OriginFreeModelCatalog.js";
import { decideOriginReviewForMessage } from "../lib/orchestration/OriginReviewPolicy.js";
import { classifyOriginRequestIntent, originRequestIntentInstruction, type OriginRequestIntent } from "../lib/orchestration/OriginRequestIntent.js";
import { buildOriginAgentWorkPlan, originAgentWorkPlanInstruction, type OriginAgentWorkPlan } from "../lib/orchestration/OriginAgentWorkPlan.js";
import { createOriginCapabilityGuide, isOriginCapabilityQuestion } from "../lib/orchestration/OriginCapabilityGuide.js";
import { originAnswerQualityInstruction, resolveOriginAnswerQualityPolicy } from "../lib/orchestration/OriginAnswerQualityPolicy.js";
import { originServiceAssignmentInstruction, resolveOriginAgentWorkPlan, type OriginResolvedWorkPlan } from "../lib/orchestration/OriginServiceRegistry.js";
import { executeOriginProvider, assertOriginZeroCostExecutionResult, OriginProviderError, type OriginProviderExecutionRequest, type OriginProviderExecutionResult } from "./originProviderClient.js";
import { detectSensitiveConversation, hasOriginWeatherLocation, isOriginWeatherRequest, originClientPolicy, type OriginChatBody, validateOriginChatMessages } from "./originChatValidation.js";

export type OriginChatExecutor = (request: OriginProviderExecutionRequest) => Promise<OriginProviderExecutionResult>;
export interface OriginChatRouterOptions { env?: NodeJS.ProcessEnv; execute?: OriginChatExecutor; now?: () => number; catalogNow?: () => number; freeModelCatalog?: readonly OriginFreeModelEvidence[]; contextPolicy?: OriginContextPolicy; createRequestId?: () => string; }
const MAX_PROVIDER_ATTEMPT_TIMEOUT_MS = 52_000;
const MODEL_BUSY_MESSAGE = "現在無料APIの利用が一時的に集中しています。費用0円ポリシーを維持したままバックアップエンジンで安全に同期中です。数秒おいて再度お試しください。";
const RETRYABLE_PROVIDER_CODES = new Set(["PROVIDER_RATE_LIMITED", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "PROVIDER_INTERNAL_ERROR"]);
function shouldRetryProvider(error: unknown): boolean { return error instanceof OriginProviderError && error.retryable && RETRYABLE_PROVIDER_CODES.has(error.code); }
function systemInstruction(intent?: OriginRequestIntent, workPlan?: OriginAgentWorkPlan, resolvedPlan?: OriginResolvedWorkPlan, answerQualityInstruction?: string): string {
  const requestGuidance = intent ? `\n\n${originRequestIntentInstruction(intent)}` : "";
  const workPlanGuidance = workPlan ? `\n\n${originAgentWorkPlanInstruction(workPlan)}` : "";
  const assignmentGuidance = resolvedPlan ? `\n\n${originServiceAssignmentInstruction(resolvedPlan)}` : "";
  const qualityGuidance = answerQualityInstruction ? `\n\n${answerQualityInstruction}` : "";
  return `You are ORIGIN Personal AI.
- Reply in the language used by the user.
- Start with the direct answer or usable deliverable. Do not begin with generic background or a description of your capabilities.
- Identify the real objective and improve the result with missing decision criteria, practical risks, and the next action when useful.
- Follow explicit user constraints over generic helpfulness. For rewriting, summarization, or formatting, preserve the supplied meaning and do not add urgency, importance, actions, owners, deadlines, channels, or other facts that were not provided. Preserve ambiguity or mark a placeholder instead of resolving it as fact.
- When the user asks only for a transformed deliverable, return that deliverable without extra analysis, risks, or follow-up questions unless they explicitly request commentary.
- Produce requested content now. Ask one concise question only when a missing fact would materially change the result; otherwise state minimal assumptions.
- For explanatory or comparison answers, make the opening block a one-to-three sentence bottom line, followed by three to five prioritized key points. Put the most decision-relevant information first.
- Write for a phone screen: use short descriptive headings, one idea per paragraph, and compact bullet lists. Do not use a Markdown table unless the user explicitly asks for a table.
- Use at most six main sections. Remove duplicated headings, repeated claims, generic filler, and repeated summaries.
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
function applicationRouting(requestId: string, reason: string, verificationStatus: OriginAnswerVerificationStatus = "not-required") { return { model: "ORIGIN アプリ内処理", reason, score: null, timeMs: 0, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, freeOnly: true, traceId: requestId, verificationStatus }; }
function requiresFutureReleaseInformation(message: string): boolean { return /(?:今後|これから|次に).{0,18}(?:登場|出てくる|発売|公開|リリース|提供開始|予定)|(?:登場|発売|公開|リリース|提供開始)予定|次世代.{0,12}(?:AI|モデル)/.test(message) || /\b(?:upcoming|forthcoming)\s+(?:AI|models?|releases?)\b/i.test(message) || /\b(?:future|next[- ]generation)\s+(?:AI|models?)\b/i.test(message); }
function futureAiDirectionGuidance(isEnglish: boolean): string { if (isEnglish) return `Bottom line: specific upcoming product names and release dates cannot be confirmed without current official-source search. However, five broad directions are worth watching. These are technology trends, not a confirmed release schedule.\n\n## Five important directions\n\n1. **Autonomous AI agents:** systems that plan multi-step work, use tools, and complete tasks with human approval.\n2. **Real-time multimodal AI:** unified understanding and generation across text, voice, images, video, and screen context.\n3. **Smaller on-device models:** faster and more private AI that runs on phones, PCs, vehicles, and business devices.\n4. **Physical AI:** models that connect perception and reasoning to robots, vehicles, and industrial equipment.\n5. **Verification and governance:** source checking, permission controls, audit trails, and human approval becoming part of the product itself.\n\n## What matters most for ORIGIN\n\n- **Official-source search:** verify current announcements before naming products or dates.\n- **Capability-based routing:** select models by search, reasoning, coding, media, cost, and privacy rather than by brand name.\n- **Cross-checking:** separate answer generation, criticism, source validation, and final editing.\n- **Replaceable integrations:** add or remove future models without redesigning ORIGIN.\n\n## Confidence\n\n- **Confirmed product releases:** none were checked in this answer.\n- **Trend analysis:** the five directions above are general technical expectations.\n- **Rumors:** intentionally excluded.\n\nOnce live search is connected, ORIGIN should add a dated, primary-source-verified release list above this trend analysis.`; return `結論：今後登場する具体的な製品名や公開時期は、最新の公式情報を検索しなければ確定できません。一方、今後のAIで特に重要になる方向性は5つあります。以下は「発売予定一覧」ではなく、一般的な技術動向です。\n\n## 注目すべき5つの方向性\n\n1. **自律型AIエージェント**：複数工程を計画し、ツールを使い、人の承認を受けながら仕事を完了するAI\n2. **リアルタイム・マルチモーダルAI**：文章・音声・画像・動画・画面情報を一体で理解、生成するAI\n3. **小型・オンデバイスAI**：スマホ、PC、車、業務端末の中で高速かつプライバシーを保って動くAI\n4. **フィジカルAI**：認識と推論をロボット、自動車、製造設備などの物理動作へつなぐAI\n5. **検証・統制AI**：出典確認、権限管理、監査記録、人間の承認を製品機能として組み込むAI\n\n## ORIGINで最優先にすべきこと\n\n- **公式情報を検索する機能**：製品名や公開日を回答する前に、開発元の最新発表を確認する\n- **能力ベースのAI選択**：ブランド名ではなく、検索・推論・コード・画像・費用・プライバシーで選ぶ\n- **役割を分けた検証**：回答生成、批判、出典確認、最終編集を分離する\n- **交換可能な接続方式**：新しいAIが登場してもORIGIN全体を作り直さず追加・削除できるようにする\n\n## 情報の確度\n\n- **確認済みの個別製品**：この回答では確認していません\n- **技術動向**：上記5項目は一般的な将来予測です\n- **噂・未確認モデル名**：誤認防止のため掲載していません\n\nライブ検索を接続した後は、この技術動向の前に「確認日付き・一次情報確認済みの公開予定一覧」を追加するのが適切です。`; }
/** Current-information routing is intentionally driven by freshness signals, not by stable acronym/definition syntax. */
function requiresCurrentInformation(message: string): boolean { return requiresFutureReleaseInformation(message) || /最新(?:の)?(?:情報|ニュース|料金|価格|株価|相場|仕様|バージョン|モデル|状況|結果)|今日の(?:ニュース|天気|料金|価格|株価|相場|結果)|現在の(?:ニュース|天気|料金|価格|株価|相場|仕様|バージョン|状況)|料金|価格|リアルタイム/.test(message) || /\b(?:news|pricing|prices?|weather|real[- ]time)\b/i.test(message) || /\b(?:latest|current|today'?s?)\s+(?:information|news|weather|pricing|prices?|rates?|status|results?|version|model)\b/i.test(message); }
function firstAnswerBlock(content: string): string { const firstBlock = content.split(/\n\s*\n|\n/).map((part) => part.trim()).find(Boolean) ?? content.trim(); const withoutHeading = firstBlock.replace(/^#{1,6}\s+/, "").trim(); if (withoutHeading.length <= 500) return withoutHeading; const candidate = withoutHeading.slice(0, 500); const sentenceEnd = Math.max(candidate.lastIndexOf("。") + 1, candidate.lastIndexOf("！") + 1, candidate.lastIndexOf("？") + 1, candidate.lastIndexOf(". ") + 1); return sentenceEnd >= 40 ? candidate.slice(0, sentenceEnd).trim() : `${candidate.slice(0, 499).trimEnd()}…`; }
function answerEnvelope(content: string, language: "ja" | "en", verificationStatus: OriginAnswerVerificationStatus, verificationSummary: string, evidence: readonly OriginAnswerEvidenceItem[] = [], limitations: readonly string[] = [], nextActions: readonly string[] = []): OriginAnswerEnvelope { const result = createOriginAnswerEnvelope({ language, conclusion: firstAnswerBlock(content), answer: content, evidence, verification: { status: verificationStatus, independentReviewPerformed: verificationStatus === "passed", summary: verificationSummary }, limitations, nextActions }); if (result.ok === false) throw new Error(result.code); return result.value; }

export function createOriginChatRouter(options: OriginChatRouterOptions = {}) {
  const router = Router(); const env = options.env ?? process.env; const now = options.now ?? Date.now; const catalogNow = options.catalogNow ?? Date.now; const contextPolicy = options.contextPolicy ?? DEFAULT_ORIGIN_CONTEXT_POLICY; const createRequestId = options.createRequestId ?? (() => `origin-${now()}-${randomUUID()}`); const execute = options.execute ?? ((request: OriginProviderExecutionRequest) => executeOriginProvider(request, env));
  router.post("/api/chat", async (req, res) => {
    const requestId = createRequestId(); const body = (req.body ?? {}) as OriginChatBody; const messages = validateOriginChatMessages(body.messages);
    if (!messages) return res.status(400).json({ code: "INVALID_CHAT_MESSAGES", message: "チャットメッセージの形式が正しくありません。", retryable: false, requestId });
    if (messages[messages.length - 1].role !== "user") return res.status(400).json({ code: "INVALID_CHAT_MESSAGES", message: "最後のメッセージはユーザーからのものである必要があります。", retryable: false, requestId });
    const lastUserMessage = messages[messages.length - 1].content; const futureReleaseInformationRequired = requiresFutureReleaseInformation(lastUserMessage); const currentInformationRequired = requiresCurrentInformation(lastUserMessage);
    if (isOriginWeatherRequest(lastUserMessage)) { const isEnglish = /[a-zA-Z]/.test(lastUserMessage); if (!hasOriginWeatherLocation(lastUserMessage, body.userLocation)) { const content = isEnglish ? "Which location would you like to know the weather for?" : "どの地域の天気をお調べしますか？"; const reason = "地域確認のため外部AIを呼びませんでした。"; return res.json({ content, answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-required", reason), routing: applicationRouting(requestId, reason) }); } const content = isEnglish ? "Currently, no service is connected to retrieve the latest weather information." : "現在、最新の天気情報を取得するサービスが接続されていません。"; const reason = "最新データ取得サービスが未接続のため推測を実行しませんでした。"; return res.json({ content, answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-run", reason), routing: applicationRouting(requestId, reason, "not-run") }); }
    const sensitiveKinds = detectSensitiveConversation(messages); if (sensitiveKinds.length > 0) return res.status(422).json({ code: "SENSITIVE_INPUT_BLOCKED", messageKey: "errors.sensitiveInputBlocked", message: "秘密情報の可能性がある内容を検出したため、外部AIへの送信を停止しました。値を削除し、必要な内容だけを要約して再入力してください。", retryable: false, requestId, sensitiveKinds });
    const contextResult = minimizeOriginContext(messages, contextPolicy); if (contextResult.ok === false) return res.status(contextResult.code === "LATEST_MESSAGE_TOO_LARGE" ? 413 : 500).json({ code: contextResult.code, message: contextResult.message, retryable: false, requestId });
    if (currentInformationRequired) { const isEnglish = !/[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage); const content = futureReleaseInformationRequired ? futureAiDirectionGuidance(isEnglish) : (isEnglish ? "ORIGIN cannot verify current information in this release because live search is not connected. It will not answer from potentially outdated knowledge." : "この版では最新情報を確認する検索機能が接続されていないため、古い可能性がある知識だけでは回答しません。"); const reason = futureReleaseInformationRequired ? (isEnglish ? "Live search is not connected. No specific future product was verified; only clearly labeled general trends were provided." : "最新情報の検索機能が未接続のため、個別製品は確認せず、一般的な技術動向だけを明示して回答しました。") : (isEnglish ? "Live search is not connected, so current facts were not verified." : "最新情報の検索機能が未接続のため、現在の事実確認を実施しませんでした。"); const limitations = [futureReleaseInformationRequired ? (isEnglish ? "No specific upcoming product name or release date was retrieved or checked." : "今後登場する個別製品名や公開時期は取得・確認していません。") : (isEnglish ? "Current facts, prices, news, and other time-sensitive information were not retrieved or checked." : "現在の事実、料金、ニュースなど、時点に依存する情報は取得・確認していません。")]; const nextActions = [futureReleaseInformationRequired ? (isEnglish ? "After live search is connected, add a dated release list verified against primary sources." : "ライブ検索接続後、確認日付きで一次情報を照合した公開予定一覧を追加します。") : (isEnglish ? "Paste the relevant text from an official source and ORIGIN can organize or compare that supplied content." : "公式情報の本文または必要部分を貼り付けると、その内容を整理・比較できます。")]; return res.json({ content, answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-run", reason, [], limitations, nextActions), routing: applicationRouting(requestId, reason, "not-run") }); }
    if (isOriginCapabilityQuestion(lastUserMessage)) { const guide = createOriginCapabilityGuide(lastUserMessage); const reason = guide.language === "ja" ? "現在の公開版で利用できる機能と未接続機能を、ORIGINの製品仕様に基づいて案内しました。" : "Explained the current and unconnected capabilities from ORIGIN's product specification."; return res.json({ content: guide.content, answer: answerEnvelope(guide.content, guide.language, "not-required", reason, [], guide.limitations, guide.nextActions), routing: applicationRouting(requestId, reason) }); }
    const planningResult = buildOriginExecutionPlan({ goal: lastUserMessage.trim(), requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(lastUserMessage), requiresFreshResearch: false, containsSecrets: false }, { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) }, originClientPolicy(body), { freeModelCatalog: options.freeModelCatalog, nowMs: catalogNow() });
    if (planningResult.ok === false) return res.status(planningResult.code === "INVALID_EXECUTION_POLICY" ? 400 : 503).json({ code: planningResult.code, message: planningResult.message, retryable: false, requestId });
    const startedAt = now(); let providerRetryAttempted = false;
    try {
      const requestIntent = classifyOriginRequestIntent(lastUserMessage, planningResult.plan.taskType); const workPlan = buildOriginAgentWorkPlan(requestIntent); const resolvedPlan = resolveOriginAgentWorkPlan(workPlan); const reviewDecision = decideOriginReviewForMessage(planningResult.plan.taskType, lastUserMessage); const answerQualityPolicy = resolveOriginAnswerQualityPolicy({ intent: requestIntent, taskType: planningResult.plan.taskType, independentReviewRequired: reviewDecision.required });
      const providerRequest: OriginProviderExecutionRequest = { plan: { ...planningResult.plan, timeoutMs: Math.min(planningResult.plan.timeoutMs, MAX_PROVIDER_ATTEMPT_TIMEOUT_MS) }, messages: contextResult.window.messages, systemInstruction: systemInstruction(requestIntent, workPlan, resolvedPlan, originAnswerQualityInstruction(answerQualityPolicy)) };
      const result = await executeWithRetry(execute, providerRequest); assertOriginZeroCostExecutionResult(result, planningResult.plan.modelId);
      const verificationStatus: OriginAnswerVerificationStatus = reviewDecision.required ? "not-run" : "not-required"; const verificationReason = reviewDecision.required ? "独立確認が必要な依頼ですが、条件を満たす無料の別AIを利用できないため実施していません。" : "この依頼では、追加の独立確認を必須と判定していません。"; const limitations = reviewDecision.required ? ["独立した別AIによる確認を実施していないため、重要な判断にはそのまま使用しないでください。"] : []; const nextActions = reviewDecision.required ? ["条件を満たす無料の独立レビュー経路が利用可能になった後、再確認してください。"] : [];
      const evidence = extractProvidedOriginEvidence(result.text); const sourceEvidenceExpected = planningResult.plan.taskType === "research";
      if (evidence.length > 0) { limitations.push("表示した出典はAIが提示したもので、ORIGINによる内容確認はまだ実施していません。"); if (evidence.some((item) => item.claim === undefined)) limitations.push("一部の出典は、回答内のどの主張に対応するか明示されていません。"); nextActions.push("重要な判断の前に、出典リンクの内容と更新日を確認してください。"); } else if (sourceEvidenceExpected) { limitations.push("調査・最新情報に関する依頼ですが、回答内に確認可能なHTTPS出典が提示されていません。"); nextActions.push("一次情報の出典を確認してから判断してください。"); }
      console.info("[origin-chat] provider request completed", { requestId, durationMs: Math.max(0, now() - startedAt), modelId: planningResult.plan.modelId, costUsd: result.actualCostUsd });
      return res.json({ content: result.text, answer: answerEnvelope(result.text, /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en", verificationStatus, verificationReason, evidence, limitations, nextActions), routing: { model: planningResult.plan.providerLabel, reason: planningResult.plan.reason, score: null, timeMs: Math.max(0, now() - startedAt), cost: result.actualCostUsd, providerId: planningResult.plan.providerId, modelId: planningResult.plan.modelId, taskType: planningResult.plan.taskType, actualCostUsd: result.actualCostUsd, estimatedCostUsd: planningResult.plan.estimatedCostUsd, freeOnly: true, traceId: requestId, verificationStatus, verificationReason, reviewRequired: reviewDecision.required, reviewReasons: reviewDecision.reasons, answerMode: answerQualityPolicy.answerMode, verificationLevel: answerQualityPolicy.verificationLevel, modelEvidence: planningResult.plan.modelEvidence, providerDataPolicy: result.providerDataPolicy, providerRouting: result.routingEvidence, context: { policyVersion: contextResult.window.policyVersion, includedMessageCount: contextResult.window.includedMessageCount, includedCharacterCount: contextResult.window.includedCharacterCount, omittedMessageCount: contextResult.window.omittedMessageCount, omittedCharacterCount: contextResult.window.omittedCharacterCount }, usage: result.usage, providerAttempts: providerRetryAttempted ? 2 : 1 } });
    } catch (error) {
      if (error instanceof OriginProviderError) {
        console.warn("[origin-chat] provider request failed", { requestId, durationMs: Math.max(0, now() - startedAt), code: error.code, status: error.status, retryable: error.retryable, diagnostic: error.diagnostic });
        if (shouldRetryProvider(error)) {
          const isEnglish = !/[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage); const content = isEnglish ? "Free AI capacity is temporarily busy. ORIGIN is keeping the $0 cost policy and safe synchronization active. Please try again in a few seconds." : MODEL_BUSY_MESSAGE; const reason = isEnglish ? "All currently available zero-cost provider retry paths were exhausted; no paid provider was selected." : "無料プロバイダーの再試行経路を使い切りました。有料プロバイダーへは切り替えず、0円ポリシーを維持しました。";
          return res.status(200).json({ status: 200, content, message: content, answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-run", reason), routing: { ...applicationRouting(requestId, reason, "not-run"), providerAttempts: MAX_RETRIES + 1, retryAttempted: true, resilience: "zero-cost-graceful-envelope" } });
        }
        const providerError = error as OriginProviderError;
        return res.status(providerError.status >= 500 ? 200 : providerError.status).json(providerError.status >= 500 ? { status: 200, content: MODEL_BUSY_MESSAGE, message: MODEL_BUSY_MESSAGE, answer: answerEnvelope(MODEL_BUSY_MESSAGE, "ja", "not-run", "無料経路の障害をUIエラーに変換せず、$0ポリシーを維持しました。"), routing: applicationRouting(requestId, "無料経路の障害をUIエラーに変換せず、$0ポリシーを維持しました。", "not-run"), resilience: "zero-cost-graceful-envelope" } : { code: providerError.code, message: providerError.message, retryable: providerError.retryable, retryAfterSeconds: providerError.retryAfterSeconds, diagnostic: providerError.diagnostic, requestId, retryAttempted: providerRetryAttempted });
      }
      console.error("[origin-chat] unexpected provider failure", { requestId, durationMs: Math.max(0, now() - startedAt), errorName: error instanceof Error ? error.name : "unknown" });
      return res.status(200).json({ status: 200, content: MODEL_BUSY_MESSAGE, message: MODEL_BUSY_MESSAGE, answer: answerEnvelope(MODEL_BUSY_MESSAGE, "ja", "not-run", "予期しない無料経路障害をUIエラーに変換せず、$0ポリシーを維持しました。"), routing: applicationRouting(requestId, "予期しない無料経路障害をUIエラーに変換せず、$0ポリシーを維持しました。", "not-run"), resilience: "zero-cost-graceful-envelope" });
    }
  });
  return router;
}
