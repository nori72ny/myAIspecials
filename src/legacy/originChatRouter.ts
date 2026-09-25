import { randomUUID } from "node:crypto";
import { Router } from "express";
import { createOriginAnswerEnvelope, type OriginAnswerEnvelope, type OriginAnswerEvidenceItem, type OriginAnswerVerificationStatus } from "../lib/orchestration/OriginAnswerEnvelope.js";
import { extractProvidedOriginEvidence } from "../lib/orchestration/OriginAnswerEvidence.js";
import { DEFAULT_ORIGIN_CONTEXT_POLICY, minimizeOriginContext, type OriginContextPolicy } from "../lib/orchestration/OriginContextPolicy.js";
import { buildOriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import type { OriginFreeModelEvidence } from "../lib/orchestration/OriginFreeModelCatalog.js";
import { decideOriginReviewForMessage } from "../lib/orchestration/OriginReviewPolicy.js";
import { classifyOriginRequestIntent, originIntentInputFromContext, type OriginRequestIntent } from "../lib/orchestration/OriginRequestIntent.js";
import { buildOriginAgentWorkPlan, type OriginAgentWorkPlan } from "../lib/orchestration/OriginAgentWorkPlan.js";
import { createOriginCapabilityGuide, isOriginCapabilityQuestion } from "../lib/orchestration/OriginCapabilityGuide.js";
import { originAnswerQualityInstruction, resolveOriginAnswerQualityPolicy } from "../lib/orchestration/OriginAnswerQualityPolicy.js";
import { resolveOriginAgentWorkPlan, type OriginResolvedWorkPlan } from "../lib/orchestration/OriginServiceRegistry.js";
import { executeOriginProvider, assertOriginZeroCostExecutionResult, OriginProviderError, type OriginProviderExecutionRequest, type OriginProviderExecutionResult } from "./originProviderClient.js";
import { researchCurrentInformation, type OriginResearchResult } from "./originResearchSource.js";
import { buildGroundedResearchReport } from "../research/groundedResearchV11.js";
import { buildGroundedResearchSynthesisInstruction, buildGroundedResearchSynthesisPrompt, validateGroundedResearchSynthesis } from "../research/groundedResearchSynthesisV12.js";
import { originChatSystemInstruction, requiresOriginGroundedResearch } from "./originChatResponsePolicy.js";
import { detectSensitiveConversation, hasOriginWeatherLocation, isOriginWeatherRequest, originClientPolicy, type OriginChatBody, validateOriginChatMessages } from "./originChatValidation.js";

export type OriginChatExecutor = (request: OriginProviderExecutionRequest) => Promise<OriginProviderExecutionResult>;
export type OriginResearchExecutor = (query: string) => Promise<OriginResearchResult>;
export interface OriginChatRouterOptions { env?: NodeJS.ProcessEnv; execute?: OriginChatExecutor; research?: OriginResearchExecutor; researchSynthesis?: OriginChatExecutor | null; now?: () => number; catalogNow?: () => number; freeModelCatalog?: readonly OriginFreeModelEvidence[]; contextPolicy?: OriginContextPolicy; createRequestId?: () => string; }
const MAX_PROVIDER_ATTEMPT_TIMEOUT_MS = 52_000;
function systemInstruction(intent?: OriginRequestIntent, workPlan?: OriginAgentWorkPlan, resolvedPlan?: OriginResolvedWorkPlan, answerQualityInstruction?: string): string {
  return originChatSystemInstruction(intent, workPlan, resolvedPlan, answerQualityInstruction);
}
function applicationRouting(requestId: string, reason: string, verificationStatus: OriginAnswerVerificationStatus = "not-required") { return { model: "ORIGIN アプリ内処理", reason, score: null, timeMs: 0, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, freeOnly: true, traceId: requestId, verificationStatus }; }
function requiresGroundedResearch(message: string): boolean { return requiresOriginGroundedResearch(message); }

function groundedResearchAnswer(query: string, result: OriginResearchResult) {
  const isEnglish = !/[ぁ-んァ-ヶ一-龠]/.test(query);
  const safeSources = result.sources.filter((source) => {
    try {
      const url = new URL(source.url);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }).slice(0, 8);
  if (!result.ok || safeSources.length === 0) {
    const content = isEnglish
      ? "ORIGIN could not retrieve usable public sources, so it will not guess current information."
      : "確認できる公開情報を取得できなかったため、現在の情報を推測して回答しません。";
    const reason = isEnglish
      ? "Grounded Research could not retrieve usable public evidence."
      : "Grounded Researchで確認可能な公開情報を取得できませんでした。";
    return {
      content,
      language: isEnglish ? "en" as const : "ja" as const,
      reason,
      evidence: [],
      limitations: [isEnglish ? "No current public source was verified for this request." : "この依頼について、現在の公開情報源を確認できていません。"],
      nextActions: [isEnglish ? "Try again later or provide a public source to analyze." : "時間をおいて再実行するか、確認したい公開情報源を提示してください。"],
      sourceCount: 0,
      provider: result.searchProvider,
      conflicts: 0,
      sources: safeSources,
      conflictDetails: [],
    };
  }

  const grounded = buildGroundedResearchReport(safeSources);
  const sources = safeSources;
  const evidenceBlocks = sources.map((source, index) => {
    const id = `S${index + 1}`;
    return `### ${id}: ${source.title}\n${source.excerpt}\n\n〔出典: [${id}](${source.url})〕`;
  });
  const conflictText = grounded.conflicts.length === 0
    ? (isEnglish ? "No structured-value mismatch was detected in the retrieved evidence." : "取得した証拠では、構造化値の不一致は検出されませんでした。")
    : grounded.conflicts.map((conflict) => `- ${conflict.topic}: ${conflict.values.join(" / ")} (${conflict.sourceIds.join(", ")})`).join("\n");

  const content = isEnglish
    ? `## Current public information\n\n${evidenceBlocks.join("\n\n")}\n\n## Cross-check notes\n${conflictText}`
    : `## 確認できた公開情報\n\n${evidenceBlocks.join("\n\n")}\n\n## 照合メモ\n${conflictText}`;
  const reason = isEnglish
    ? `Grounded Research retrieved ${grounded.sourceCount} public sources without a paid fallback.`
    : `Grounded Researchで公開情報を${grounded.sourceCount}件取得し、有料fallbackを使わず整理しました。`;

  return {
    content,
    language: isEnglish ? "en" as const : "ja" as const,
    reason,
    evidence: grounded.sources.map((source) => ({
      label: `${source.id}: ${source.title}`,
      sourceUrl: source.url,
      evidenceLevel: "provided" as const,
      checks: {
        safeUrl: "passed" as const,
        content: "not-run" as const,
        freshness: "not-run" as const,
        claimSupport: "not-run" as const,
      },
    })),
    limitations: [
      isEnglish
        ? "This is a bounded digest of retrieved public evidence, not an independent determination of factual truth or publisher authority."
        : "取得できた公開情報を範囲限定で整理したもので、事実の最終確定や媒体の権威性を独立判定したものではありません。",
    ],
    nextActions: grounded.conflicts.length > 0
      ? [isEnglish ? "Review the conflicting values against primary sources before making an important decision." : "重要な判断前に、不一致がある値を一次情報で再確認してください。"]
      : [],
    sourceCount: grounded.sourceCount,
    provider: result.searchProvider,
    conflicts: grounded.conflicts.length,
    sources,
    conflictDetails: grounded.conflicts,
  };
}
function firstAnswerBlock(content: string): string { const firstBlock = content.split(/\n\s*\n|\n/).map((part) => part.trim()).find(Boolean) ?? content.trim(); const withoutHeading = firstBlock.replace(/^#{1,6}\s+/, "").trim(); if (withoutHeading.length <= 500) return withoutHeading; const candidate = withoutHeading.slice(0, 500); const sentenceEnd = Math.max(candidate.lastIndexOf("。") + 1, candidate.lastIndexOf("！") + 1, candidate.lastIndexOf("？") + 1, candidate.lastIndexOf(". ") + 1); return sentenceEnd >= 40 ? candidate.slice(0, sentenceEnd).trim() : `${candidate.slice(0, 499).trimEnd()}…`; }
function answerEnvelope(content: string, language: "ja" | "en", verificationStatus: OriginAnswerVerificationStatus, verificationSummary: string, evidence: readonly OriginAnswerEvidenceItem[] = [], limitations: readonly string[] = [], nextActions: readonly string[] = []): OriginAnswerEnvelope { const result = createOriginAnswerEnvelope({ language, conclusion: firstAnswerBlock(content), answer: content, evidence, verification: { status: verificationStatus, independentReviewPerformed: verificationStatus === "passed", summary: verificationSummary }, limitations, nextActions }); if (result.ok === false) throw new Error(result.code); return result.value; }

export function createOriginChatRouter(options: OriginChatRouterOptions = {}) {
  const router = Router(); const env = options.env ?? process.env; const now = options.now ?? Date.now; const catalogNow = options.catalogNow ?? Date.now; const contextPolicy = options.contextPolicy ?? DEFAULT_ORIGIN_CONTEXT_POLICY; const createRequestId = options.createRequestId ?? (() => `origin-${now()}-${randomUUID()}`); const execute = options.execute ?? ((request: OriginProviderExecutionRequest) => executeOriginProvider(request, env)); const research = options.research ?? ((query: string) => researchCurrentInformation(query)); const researchSynthesis = options.researchSynthesis === null ? null : options.researchSynthesis ?? execute;
  router.post("/api/chat", async (req, res) => {
    const wantsStreaming = String(req.headers.accept ?? "").toLowerCase().includes("text/event-stream");
    if (wantsStreaming) {
      const originalJson = res.json.bind(res);
      res.json = ((payload: unknown) => {
        if (res.statusCode >= 200 && res.statusCode < 400 && payload && typeof payload === "object") {
          const record = payload as Record<string, unknown>;
          const answerEnvelope = record.answer && typeof record.answer === "object" ? record.answer as Record<string, unknown> : null;
          const content = typeof record.content === "string" ? record.content : answerEnvelope && typeof answerEnvelope.answer === "string" ? answerEnvelope.answer : "";
          if (content) {
            res.status(res.statusCode);
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("X-Origin-Free-Only", "true");
            res.setHeader("X-Origin-Cost-Usd", "0");
            res.setHeader("X-Origin-Billing-Tier", "free");
            res.flushHeaders?.();
            const chunks = content.match(/.{1,48}(?:\s|$)|.{1,48}/gs) ?? [content];
            let index = 0;
            const writeNext = () => {
              if (index >= chunks.length) { res.end(); return; }
              res.write(chunks[index++]);
              setTimeout(writeNext, 15);
            };
            writeNext();
            return res;
          }
        }
        return originalJson(payload);
      }) as typeof res.json;
    }
    const requestId = createRequestId(); const body = (req.body ?? {}) as OriginChatBody; const messages = validateOriginChatMessages(body.messages);
    if (!messages) return res.status(400).json({ code: "INVALID_CHAT_MESSAGES", message: "チャットメッセージの形式が正しくありません。", retryable: false, requestId });
    if (messages[messages.length - 1].role !== "user") return res.status(400).json({ code: "INVALID_CHAT_MESSAGES", message: "最後のメッセージはユーザーからのものである必要があります。", retryable: false, requestId });
    const lastUserMessage = messages[messages.length - 1].content; const groundedResearchRequired = requiresGroundedResearch(lastUserMessage);
    if (isOriginWeatherRequest(lastUserMessage)) { const isEnglish = /[a-zA-Z]/.test(lastUserMessage); if (!hasOriginWeatherLocation(lastUserMessage, body.userLocation)) { const content = isEnglish ? "Which location would you like to know the weather for?" : "どの地域の天気をお調べしますか？"; const reason = "地域確認のため外部AIを呼びませんでした。"; return res.json({ content, answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-required", reason), routing: applicationRouting(requestId, reason) }); } const content = isEnglish ? "Currently, no service is connected to retrieve the latest weather information." : "現在、最新の天気情報を取得するサービスが接続されていません。"; const reason = "最新データ取得サービスが未接続のため推測を実行しませんでした。"; return res.json({ content, answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-run", reason), routing: applicationRouting(requestId, reason, "not-run") }); }
    const sensitiveKinds = detectSensitiveConversation(messages); if (sensitiveKinds.length > 0) return res.status(422).json({ code: "SENSITIVE_INPUT_BLOCKED", messageKey: "errors.sensitiveInputBlocked", message: "秘密情報の可能性がある内容を検出したため、外部AIへの送信を停止しました。値を削除し、必要な内容だけを要約して再入力してください。", retryable: false, requestId, sensitiveKinds });
    const contextResult = minimizeOriginContext(messages, contextPolicy); if (contextResult.ok === false) return res.status(contextResult.code === "LATEST_MESSAGE_TOO_LARGE" ? 413 : 500).json({ code: contextResult.code, message: contextResult.message, retryable: false, requestId });
    if (groundedResearchRequired) {
      let researchResult: OriginResearchResult;
      try {
        researchResult = await research(lastUserMessage.trim());
      } catch {
        researchResult = { ok: false, sources: [], failure: { stage: "web-search", code: "NETWORK_FAILURE" } };
      }
      const grounded = groundedResearchAnswer(lastUserMessage, researchResult);
      let synthesisStatus = "not-run";
      let synthesisFailureCode: string | undefined;

      if (researchSynthesis && grounded.sources.length > 0) {
        const synthesisPlan = buildOriginExecutionPlan(
          { goal: lastUserMessage.trim(), requiresCodeChanges: false, requiresFreshResearch: true, containsSecrets: false },
          { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) },
          originClientPolicy(body),
          { freeModelCatalog: options.freeModelCatalog, nowMs: catalogNow() },
        );
        if (synthesisPlan.ok === true) {
          const synthesisStartedAt = now();
          try {
            const synthesisResult = await researchSynthesis({
              plan: { ...synthesisPlan.plan, timeoutMs: Math.min(synthesisPlan.plan.timeoutMs, MAX_PROVIDER_ATTEMPT_TIMEOUT_MS) },
              messages: [{
                role: "user",
                content: buildGroundedResearchSynthesisPrompt(
                  lastUserMessage,
                  grounded.sources,
                  grounded.conflictDetails,
                  grounded.language,
                ),
              }],
              systemInstruction: buildGroundedResearchSynthesisInstruction(grounded.language),
            });
            assertOriginZeroCostExecutionResult(synthesisResult, synthesisPlan.plan.modelId);
            const citationValidation = validateGroundedResearchSynthesis(synthesisResult.text, grounded.sources);
            if (citationValidation.ok === true) {
              const verificationReason = grounded.language === "en"
                ? "Citation structure was checked against the retrieved HTTPS evidence packet; factual truth and publisher authority were not independently verified."
                : "取得済みHTTPS証拠パケットとの引用構造一致を確認しました。主張の真偽や媒体の権威性を独立検証したものではありません。";
              const limitations = [
                grounded.language === "en"
                  ? "Citations were structurally validated against retrieved sources, but claim truth, completeness, and publisher authority were not independently verified."
                  : "引用先が取得済みソースと一致することは機械検証しましたが、主張の真偽・網羅性・媒体の権威性は独立検証していません。",
              ];
              if (grounded.conflicts > 0) {
                limitations.push(grounded.language === "en"
                  ? "Retrieved sources contain structured-value differences that require human review."
                  : "取得ソース間に構造化値の差異があり、人による確認が必要です。");
              }
              return res.json({
                content: synthesisResult.text,
                answer: answerEnvelope(synthesisResult.text, grounded.language, "not-run", verificationReason, grounded.evidence, limitations, grounded.nextActions),
                routing: {
                  model: synthesisPlan.plan.providerLabel,
                  reason: grounded.language === "en"
                    ? "Synthesized retrieved public evidence with one verified zero-cost model execution."
                    : "取得済み公開証拠を、検証済み$0モデル1回だけで統合しました。",
                  score: null,
                  timeMs: Math.max(0, now() - synthesisStartedAt),
                  cost: synthesisResult.actualCostUsd,
                  providerId: synthesisPlan.plan.providerId,
                  modelId: synthesisPlan.plan.modelId,
                  taskType: synthesisPlan.plan.taskType,
                  actualCostUsd: synthesisResult.actualCostUsd,
                  estimatedCostUsd: synthesisPlan.plan.estimatedCostUsd,
                  freeOnly: true,
                  traceId: requestId,
                  verificationStatus: "not-run",
                  answerMode: "research",
                  verificationLevel: "evidence-required",
                  sourceCount: grounded.sourceCount,
                  researchProvider: grounded.provider,
                  conflictCount: grounded.conflicts,
                  synthesisStatus: "citation-validated",
                  synthesisSourceCount: citationValidation.usedSourceIds.length,
                  providerDataPolicy: synthesisResult.providerDataPolicy,
                  providerRouting: synthesisResult.routingEvidence,
                  usage: synthesisResult.usage,
                  providerAttempts: 1,
                },
              });
            }
            synthesisStatus = "citation-validation-failed";
            synthesisFailureCode = citationValidation.code;
            console.warn("[origin-chat] research synthesis discarded", { requestId, code: citationValidation.code });
          } catch (error) {
            synthesisStatus = "provider-failed";
            synthesisFailureCode = error instanceof OriginProviderError ? error.code : "PROVIDER_INTERNAL_ERROR";
            console.warn("[origin-chat] research synthesis unavailable; deterministic digest retained", { requestId, code: synthesisFailureCode });
          }
        } else {
          synthesisStatus = "plan-unavailable";
          synthesisFailureCode = synthesisPlan.code;
        }
      } else if (!researchSynthesis) {
        synthesisStatus = "disabled";
      }

      const digestReason = synthesisStatus === "not-run"
        ? grounded.reason
        : grounded.language === "en"
          ? `${grounded.reason} AI synthesis was not adopted; the deterministic evidence digest is shown instead.`
          : `${grounded.reason} AI統合は採用せず、安全な証拠ダイジェストを表示しています。`;
      return res.json({
        content: grounded.content,
        answer: answerEnvelope(grounded.content, grounded.language, "not-run", digestReason, grounded.evidence, grounded.limitations, grounded.nextActions),
        routing: {
          ...applicationRouting(requestId, digestReason, "not-run"),
          answerMode: "research",
          verificationLevel: "evidence-required",
          sourceCount: grounded.sourceCount,
          researchProvider: grounded.provider,
          conflictCount: grounded.conflicts,
          synthesisStatus,
          ...(synthesisFailureCode ? { synthesisFailureCode } : {}),
        },
      });
    }
    if (isOriginCapabilityQuestion(lastUserMessage)) { const guide = createOriginCapabilityGuide(lastUserMessage); const reason = guide.language === "ja" ? "現在の公開版で利用できる機能と未接続機能を、ORIGINの製品仕様に基づいて案内しました。" : "Explained the current and unconnected capabilities from ORIGIN's product specification."; return res.json({ content: guide.content, answer: answerEnvelope(guide.content, guide.language, "not-required", reason, [], guide.limitations, guide.nextActions), routing: applicationRouting(requestId, reason) }); }
    const planningResult = buildOriginExecutionPlan({ goal: lastUserMessage.trim(), requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(lastUserMessage), requiresFreshResearch: false, containsSecrets: false }, { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) }, originClientPolicy(body), { freeModelCatalog: options.freeModelCatalog, nowMs: catalogNow() });
    if (planningResult.ok === false) return res.status(planningResult.code === "INVALID_EXECUTION_POLICY" ? 400 : 503).json({ code: planningResult.code, message: planningResult.message, retryable: false, requestId });
    const startedAt = now();
    try {
      const intentInput = originIntentInputFromContext(contextResult.window.messages); const requestIntent = classifyOriginRequestIntent(intentInput, planningResult.plan.taskType); const workPlan = buildOriginAgentWorkPlan(requestIntent); const resolvedPlan = resolveOriginAgentWorkPlan(workPlan); const reviewDecision = decideOriginReviewForMessage(planningResult.plan.taskType, lastUserMessage); const answerQualityPolicy = resolveOriginAnswerQualityPolicy({ intent: requestIntent, taskType: planningResult.plan.taskType, independentReviewRequired: reviewDecision.required });
      const providerRequest: OriginProviderExecutionRequest = { plan: { ...planningResult.plan, timeoutMs: Math.min(planningResult.plan.timeoutMs, MAX_PROVIDER_ATTEMPT_TIMEOUT_MS) }, messages: contextResult.window.messages, systemInstruction: systemInstruction(requestIntent, workPlan, resolvedPlan, originAnswerQualityInstruction(answerQualityPolicy)) };
      const result = await execute(providerRequest); assertOriginZeroCostExecutionResult(result, planningResult.plan.modelId);
      const verificationStatus: OriginAnswerVerificationStatus = reviewDecision.required ? "not-run" : "not-required"; const verificationReason = reviewDecision.required ? "独立確認が必要な依頼ですが、条件を満たす無料の別AIを利用できないため実施していません。" : "この依頼では、追加の独立確認を必須と判定していません。"; const limitations = reviewDecision.required ? ["独立した別AIによる確認を実施していないため、重要な判断にはそのまま使用しないでください。"] : []; const nextActions = reviewDecision.required ? ["条件を満たす無料の独立レビュー経路が利用可能になった後、再確認してください。"] : [];
      const evidence = extractProvidedOriginEvidence(result.text); const sourceEvidenceExpected = planningResult.plan.taskType === "research";
      if (evidence.length > 0) { limitations.push("表示した出典はAIが提示したもので、ORIGINによる内容確認はまだ実施していません。"); if (evidence.some((item) => item.claim === undefined)) limitations.push("一部の出典は、回答内のどの主張に対応するか明示されていません。"); nextActions.push("重要な判断の前に、出典リンクの内容と更新日を確認してください。"); } else if (sourceEvidenceExpected) { limitations.push("調査・最新情報に関する依頼ですが、回答内に確認可能なHTTPS出典が提示されていません。"); nextActions.push("一次情報の出典を確認してから判断してください。"); }
      console.info("[origin-chat] provider request completed", { requestId, durationMs: Math.max(0, now() - startedAt), modelId: planningResult.plan.modelId, costUsd: result.actualCostUsd });
      return res.json({ content: result.text, answer: answerEnvelope(result.text, /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en", verificationStatus, verificationReason, evidence, limitations, nextActions), routing: { model: planningResult.plan.providerLabel, reason: planningResult.plan.reason, score: null, timeMs: Math.max(0, now() - startedAt), cost: result.actualCostUsd, providerId: planningResult.plan.providerId, modelId: planningResult.plan.modelId, taskType: planningResult.plan.taskType, actualCostUsd: result.actualCostUsd, estimatedCostUsd: planningResult.plan.estimatedCostUsd, freeOnly: true, traceId: requestId, verificationStatus, verificationReason, reviewRequired: reviewDecision.required, reviewReasons: reviewDecision.reasons, answerMode: answerQualityPolicy.answerMode, verificationLevel: answerQualityPolicy.verificationLevel, modelEvidence: planningResult.plan.modelEvidence, providerDataPolicy: result.providerDataPolicy, providerRouting: result.routingEvidence, context: { policyVersion: contextResult.window.policyVersion, includedMessageCount: contextResult.window.includedMessageCount, includedCharacterCount: contextResult.window.includedCharacterCount, omittedMessageCount: contextResult.window.omittedMessageCount, omittedCharacterCount: contextResult.window.omittedCharacterCount }, usage: result.usage, providerAttempts: 1 } });
    } catch (error) {
      if (error instanceof OriginProviderError) {
        console.warn("[origin-chat] provider request failed", { requestId, durationMs: Math.max(0, now() - startedAt), code: error.code, status: error.status, retryable: error.retryable, diagnostic: error.diagnostic });
        res.setHeader("Cache-Control", "no-store");
        return res.status(error.status).json({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          retryAfterSeconds: error.retryAfterSeconds,
          requestId,
          retryAttempted: false,
        });
      }
      console.error("[origin-chat] unexpected provider failure", { requestId, durationMs: Math.max(0, now() - startedAt), errorName: "unexpected" });
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).json({ code: "PROVIDER_INTERNAL_ERROR", message: "無料AIとの通信に失敗しました。時間をおいて再度お試しください。", retryable: true, requestId, retryAttempted: false });
    }
  });
  return router;
}
