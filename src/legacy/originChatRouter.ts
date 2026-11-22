import { randomUUID } from "node:crypto";
import { Router } from "express";
import { createOriginAnswerEnvelope, type OriginAnswerEnvelope, type OriginAnswerEvidenceItem, type OriginAnswerRichOutput, type OriginAnswerVerificationStatus } from "../lib/orchestration/OriginAnswerEnvelope.js";
import { extractProvidedOriginEvidence } from "../lib/orchestration/OriginAnswerEvidence.js";
import { DEFAULT_ORIGIN_CONTEXT_POLICY, minimizeOriginContext, type OriginContextPolicy } from "../lib/orchestration/OriginContextPolicy.js";
import { buildOriginExecutionPlan, type OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import type { OriginFreeModelEvidence } from "../lib/orchestration/OriginFreeModelCatalog.js";
import { decideOriginReviewForMessage } from "../lib/orchestration/OriginReviewPolicy.js";
import { classifyOriginRequestIntent, originIntentInputFromContext, type OriginRequestIntent } from "../lib/orchestration/OriginRequestIntent.js";
import { buildOriginAgentWorkPlan, type OriginAgentWorkPlan } from "../lib/orchestration/OriginAgentWorkPlan.js";
import { createOriginCapabilityGuide, isOriginCapabilityQuestion } from "../lib/orchestration/OriginCapabilityGuide.js";
import { originAnswerQualityInstruction, resolveOriginAnswerQualityPolicy } from "../lib/orchestration/OriginAnswerQualityPolicy.js";
import { applyOriginBusinessPlanningAuditGate } from "../lib/orchestration/OriginBusinessPlanningAudit.js";
import { applyOriginPublicationGate, publicationGateFiringKinds } from "../lib/orchestration/OriginPublicationGate.js";
import { applyOriginDateWeekdayVerificationGate } from "../lib/orchestration/OriginDateWeekdayVerification.js";
import { resolveOriginAgentWorkPlan, type OriginResolvedWorkPlan } from "../lib/orchestration/OriginServiceRegistry.js";
import { generateOriginSupervisorArtifactsV2, ORIGIN_SUPERVISOR_VERSION_V2 } from "../lib/orchestration/OriginSupervisorV2.js";
import { buildOriginProviderFailureDiagnostic, OriginProviderError, type OriginProviderExecutionRequest, type OriginProviderExecutionResult } from "./originProviderClient.js";
import { assertOriginZeroCostExecutionResultWithFailover, executeOriginProviderWithFailover } from "./originProviderFailover.js";
import { assertGroundedResearchRecordsZeroCost, createGroundedResearchRecordsRetryExecutorWithDetail } from "./originRecordsRetryRoute.js";
import { researchCurrentInformation, type OriginResearchResult, type OriginResearchSource } from "./originResearchSource.js";
import {
  createDefaultOriginResearchExecutor,
  fetchOriginWeatherAnswer,
  type OriginSearchGroundingDeps,
} from "../search/originSearchGrounding.js";
import { buildGroundedResearchPartialAnswer, buildGroundedResearchReport } from "../research/groundedResearchV11.js";
import {
  buildGroundedResearchAbstainAnswer,
  ensureGroundedResearchTerminalBody,
  researchAbstainReasonForResearchResult,
  researchLandingForAbstain,
  researchLandingForAdopted,
  researchLandingForPartialAnswer,
  type OriginResearchLanding,
} from "../research/groundedResearchOutcome.js";
import { adoptGroundedResearchSynthesis, buildGroundedResearchSynthesisInstruction, buildGroundedResearchSynthesisPrompt, diagnoseGroundedResearchSynthesisUnits, executeGroundedResearchSynthesisWithRetry, isGroundedResearchSynthesisRetryEnabled, type QuoteFirstAdoptionContext } from "../research/groundedResearchSynthesisV12.js";
import { buildQuoteFirstContractInstruction, buildQuoteFirstRegistry, buildQuoteFirstRegistrySection, resolveQuoteFirstMode } from "../research/groundedResearchQuoteFirst.js";
import { buildGroundedResearchEvidenceCards } from "../research/groundedResearchEvidenceCards.js";
import { classifyDirectAnswerVerificationTarget, classifyResearchAnswerVerificationTarget, resolveOriginAnswerVerificationEffectiveMode, runOriginAnswerVerificationShadow, verifyOriginAnswerCrossRoute, type OriginAnswerVerificationDailyUsageReader, type OriginAnswerVerificationSource } from "./originAnswerVerification.js";
import { resolveOriginIntentPremiseGuardEffectiveMode, runOriginIntentPremiseGuardShadow } from "./originIntentPremiseGuard.js";
import { executeGroundedResearchRecordsSynthesis, isGroundedResearchRecordsEnabled } from "../research/groundedResearchRecordsV13.js";
import { logRecoveryValueVoteShadow, resolveRecoveryValueVoteMode } from "../research/groundedResearchValueExtraction.js";
import { resolveRecoveryTemplateFallbackMode, tryRecoveryTemplateFallback, type RecoveryTemplateFallbackResult } from "../research/groundedResearchTemplateFallback.js";
import {
  analyzeRefusalLikeOutput,
  buildNonexistenceConditionalAnswer,
  buildProcedureConditionalAnswer,
  buildUndeterminedFutureAnswer,
  classifyRefusalForbiddenCategory,
  detectNamedEntity,
  detectUndeterminedFutureQuestion,
  resolveRecoveryRefusalValidationMode,
  RECOVERY_REFUSAL_RETRY_INSTRUCTION,
} from "../research/groundedResearchRefusalValidation.js";
import { applyOriginUngroundedAssertionGate, originChatSystemInstruction, originCloudflareRouteSystemInstruction, originCurrentDateInstruction, originGroqRouteSystemInstruction, requiresOriginGroundedResearchRouted } from "./originChatResponsePolicy.js";
import { rasterProviderRuntimeStatusV15 } from "../creative/rasterProviderRegistryV15.js";
import { hasOriginWeatherLocation, isOriginWeatherRequest, originClientPolicy, screenConversationForSend, type OriginChatBody, validateOriginChatMessages } from "./originChatValidation.js";

export type OriginChatExecutor = (request: OriginProviderExecutionRequest) => Promise<OriginProviderExecutionResult>;
export type OriginResearchExecutor = (query: string) => Promise<OriginResearchResult>;
export interface OriginChatRouterOptions { env?: NodeJS.ProcessEnv; execute?: OriginChatExecutor; research?: OriginResearchExecutor; researchSynthesis?: OriginChatExecutor | null; now?: () => number; catalogNow?: () => number; freeModelCatalog?: readonly OriginFreeModelEvidence[]; contextPolicy?: OriginContextPolicy; createRequestId?: () => string; searchGrounding?: OriginSearchGroundingDeps; answerVerification?: { verify?: typeof verifyOriginAnswerCrossRoute; readDailyNeuronsUsed?: OriginAnswerVerificationDailyUsageReader }; }
const MAX_PROVIDER_ATTEMPT_TIMEOUT_MS = 52_000;
/** Honest executed-route count: 1 unless the failover dispatcher actually executed a second verified free route. */
function providerAttemptCount(result: OriginProviderExecutionResult): number { return result.attempts?.length ?? 1; }
function systemInstruction(intent?: OriginRequestIntent, workPlan?: OriginAgentWorkPlan, resolvedPlan?: OriginResolvedWorkPlan, answerQualityInstruction?: string): string {
  return originChatSystemInstruction(intent, workPlan, resolvedPlan, answerQualityInstruction);
}
function applicationRouting(requestId: string, reason: string, verificationStatus: OriginAnswerVerificationStatus = "not-required") { return { model: "ORIGIN アプリ内処理", reason, score: null, timeMs: 0, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, costEvidenceStatus: "NOT_MEASURED", freeOnly: true, traceId: requestId, verificationStatus }; }
function requiresGroundedResearch(message: string, env?: NodeJS.ProcessEnv): boolean { return requiresOriginGroundedResearchRouted(message, { env }); }

/** The only sources an answer may cite: HTTPS, no URL credentials, bounded count. */
function safeOriginResearchSources(sources: readonly OriginResearchSource[]): OriginResearchSource[] {
  return sources.filter((source) => {
    try {
      const url = new URL(source.url);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }).slice(0, 8);
}

/** Maps research sources to the verification module's digest shape (title, domain, retrieval date, the excerpt actually used). */
function answerVerificationSources(sources: readonly OriginResearchSource[]): OriginAnswerVerificationSource[] {
  return sources.map((source) => {
    let domain = source.domain ?? "";
    if (!domain) {
      try { domain = new URL(source.url).hostname; } catch { domain = ""; }
    }
    return { title: source.title, domain, retrievedAt: source.retrievedAt, excerpt: source.excerpt };
  });
}

function groundedResearchAnswer(query: string, result: OriginResearchResult) {
  const isEnglish = !/[ぁ-んァ-ヶ一-龠]/.test(query);
  const safeSources = safeOriginResearchSources(result.sources);
  if (!result.ok || safeSources.length === 0) {
    const groundingFailure = result.groundingFailure;
    // Tier T4 (N-1, CONSULT_ADOPTION_DESIGN_2026-11-17 §1.4): the hold
    // body is no longer a fixed template — it states what was searched,
    // that nothing could be confirmed, and the concrete reason for this
    // request (no sources found / none fresh enough / retrieval failed
    // / monthly cap), in plain language with no internal vocabulary.
    const abstainReason = researchAbstainReasonForResearchResult(result);
    const content = buildGroundedResearchAbstainAnswer({
      query,
      language: isEnglish ? "en" : "ja",
      reason: abstainReason,
    });
    const reason = groundingFailure
      ? (isEnglish
        ? `Search grounding could not verify reliable sources (${groundingFailure}).`
        : `検索グラウンディングで信頼できる裏付けを確認できませんでした（${groundingFailure}）。`)
      : isEnglish
        ? "Grounded Research could not retrieve usable public evidence."
        : "Grounded Researchで確認可能な公開情報を取得できませんでした。";
    const groundingLimitation = groundingFailure === "no-fresh-sources"
      ? (isEnglish ? "Sources were retrieved, but every one was older than the freshness limit for this question type." : "情報を取得できましたが、いずれもこの質問種別の鮮度条件より古く、裏付けとして使えませんでした。")
      : groundingFailure === "monthly-cap-reached"
        ? (isEnglish ? "The monthly free-search budget for this month has been reached, so no search was executed." : "今月の検索予算（無料枠に対する自前上限）に達したため、検索を実行しませんでした。")
        : null;
    return {
      content,
      language: isEnglish ? "en" as const : "ja" as const,
      reason,
      evidence: [],
      limitations: [groundingLimitation ?? (isEnglish ? "No current public source was verified for this request." : "この依頼について、現在の公開情報源を確認できていません。")],
      nextActions: [isEnglish ? "Try again later or provide a public source to analyze." : "時間をおいて再実行するか、確認したい公開情報源を提示してください。"],
      sourceCount: 0,
      provider: result.searchProvider,
      conflicts: 0,
      sources: safeSources,
      conflictDetails: [],
      // Ladder landing (N-1 §1.2): tier T4, outcome ABSTAIN, with the
      // abstain reason carried as metadata for routing and logs.
      landing: researchLandingForAbstain(abstainReason),
    };
  }

  const grounded = buildGroundedResearchReport(query, safeSources);
  const sources = safeSources;
  // Fallback presentation (PKG-9 search-dump defect): this content is the
  // answer body only when the AI synthesis stage did not produce an
  // adoptable answer (provider failure, citation-validation failure, plan
  // unavailable, or synthesis disabled). It must never paste retrieved
  // page text into the answer: for number-critical question types the
  // excerpts are full extracted pages, navigation and advertising
  // boilerplate included, and presenting them verbatim made the search
  // results themselves pose as the answer (chat 100-question inspection
  // batch 1, A-02 / B-01 / B-05).
  // Synthesis-hygiene shape: the fallback states plainly that no
  // summarized answer is available, then shows the confirmed scope as
  // one card per source (id, domain, linked title, and a short quote
  // on the top three). The internal cross-check breakdown (照合メモ)
  // never appears in the user-facing body — it stays in logs and
  // routing metadata.
  // R-1 revision (RESEARCH_FLOOR_DESIGN_2026-11-17 §3): each of the
  // top sources also carries the source's excerpt as a bounded,
  // neutralized verbatim quote on its card, so the answer's core
  // reaches the user even when synthesis never ran. The quote is
  // never presented as a confirmed fact and the lead still directs
  // the user to the sources for details; the PKG-9 concern above is
  // addressed by the card form, the 120-char bound, and the
  // neutralization in buildGroundedResearchPartialAnswer, not by
  // pasting raw page text as the answer.
  // N-2b (N2_N5_IMPLEMENTATION_DESIGN_2026-11-17 §1.4): the quote is
  // the source's evidence-card claim sentences, selected against this
  // query, so the query is threaded through here.
  const content = buildGroundedResearchPartialAnswer(sources, isEnglish ? "en" : "ja", query);
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
        ? "Only the confirmed scope taken from source titles and the source list are shown; source article text is not reproduced. This is not an independent determination of factual truth or publisher authority."
        : "出典のタイトルから確認できる範囲と出典の一覧のみを表示し、出典記事の本文は転載していません。事実の最終確定や媒体の権威性を独立判定したものではありません。",
    ],
    nextActions: grounded.conflicts.length > 0
      ? [isEnglish ? "Review the conflicting values against primary sources before making an important decision." : "重要な判断前に、不一致がある値を一次情報で再確認してください。"]
      : [],
    sourceCount: grounded.sourceCount,
    provider: result.searchProvider,
    conflicts: grounded.conflicts.length,
    sources,
    conflictDetails: grounded.conflicts,
    // Default ladder landing when sources exist (N-1 §1.1): the
    // extractive partial answer is tier T3 / outcome PARTIAL. An
    // adopted synthesis overrides the landing to T0 at its return site.
    landing: researchLandingForPartialAnswer(),
  };
}
function firstAnswerBlock(content: string): string { const firstBlock = content.split(/\n\s*\n|\n/).map((part) => part.trim()).find(Boolean) ?? content.trim(); const withoutHeading = firstBlock.replace(/^#{1,6}\s+/, "").trim(); if (withoutHeading.length <= 500) return withoutHeading; const candidate = withoutHeading.slice(0, 500); const sentenceEnd = Math.max(candidate.lastIndexOf("。") + 1, candidate.lastIndexOf("！") + 1, candidate.lastIndexOf("？") + 1, candidate.lastIndexOf(". ") + 1); return sentenceEnd >= 40 ? candidate.slice(0, sentenceEnd).trim() : `${candidate.slice(0, 499).trimEnd()}…`; }
function answerEnvelope(content: string, language: "ja" | "en", verificationStatus: OriginAnswerVerificationStatus, verificationSummary: string, evidence: readonly OriginAnswerEvidenceItem[] = [], limitations: readonly string[] = [], nextActions: readonly string[] = [], richOutputs: readonly OriginAnswerRichOutput[] = []): OriginAnswerEnvelope { const result = createOriginAnswerEnvelope({ language, conclusion: firstAnswerBlock(content), answer: content, evidence, verification: { status: verificationStatus, independentReviewPerformed: verificationStatus === "passed", summary: verificationSummary }, limitations, nextActions, richOutputs }); if (result.ok === false) throw new Error(result.code); return result.value; }

export function createOriginChatRouter(options: OriginChatRouterOptions = {}) {
  const router = Router(); const env = options.env ?? process.env; const now = options.now ?? Date.now; const catalogNow = options.catalogNow ?? Date.now; const contextPolicy = options.contextPolicy ?? DEFAULT_ORIGIN_CONTEXT_POLICY; const createRequestId = options.createRequestId ?? (() => `origin-${now()}-${randomUUID()}`); const execute = options.execute ?? ((request: OriginProviderExecutionRequest) => executeOriginProviderWithFailover(request, env)); const searchGroundingDeps: OriginSearchGroundingDeps = { env, ...(options.searchGrounding ?? {}) }; const research = options.research ?? createDefaultOriginResearchExecutor(searchGroundingDeps, (query: string) => researchCurrentInformation(query)); const researchSynthesis = options.researchSynthesis === null ? null : options.researchSynthesis ?? execute;
  router.post("/api/chat", async (req, res) => {
    const wantsStreaming = String(req.headers.accept ?? "").toLowerCase().includes("text/event-stream");
    // Phased streaming (origin-phased-sse-v1): when the client asked for an
    // event stream, the grounded-research branch below reports its progress
    // as small SSE events so the long search wait is not silent. The stream
    // is committed only when the first phase is emitted; every response that
    // finishes before that (validation, weather, capability questions, and
    // all errors) keeps the exact legacy behavior. Phases and source
    // titles/domains are metadata only — answer text is written solely from
    // the finished, verified payload in the res.json interception below,
    // never as unverified fragments.
    let phaseStreamStarted = false;
    const writePhasedEvent = (event: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const startPhaseStream = () => {
      if (phaseStreamStarted) return;
      phaseStreamStarted = true;
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("X-Origin-Free-Only", "true");
      res.setHeader("X-Origin-Cost-Evidence", "NOT_MEASURED");
      res.setHeader("X-Origin-Stream-Source", "phased");
      res.setHeader("X-Origin-Stream-Protocol", "origin-phased-sse-v1");
      res.flushHeaders?.();
    };
    const emitResearchPhase = (phase: "searching" | "composing") => {
      if (!wantsStreaming) return;
      startPhaseStream();
      writePhasedEvent({ type: "phase", phase });
    };
    const emitResearchSources = (sources: readonly OriginResearchSource[]) => {
      if (!wantsStreaming || sources.length === 0) return;
      startPhaseStream();
      writePhasedEvent({
        type: "sources",
        sources: sources.map((source) => {
          let domain = source.domain ?? "";
          if (!domain) {
            try { domain = new URL(source.url).hostname; } catch { domain = ""; }
          }
          return { title: source.title, domain };
        }),
      });
    };
    if (wantsStreaming) {
      const originalJson = res.json.bind(res);
      res.json = ((payload: unknown) => {
        if (phaseStreamStarted) {
          const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
          const phaseAnswerEnvelope = record && record.answer && typeof record.answer === "object" ? record.answer as Record<string, unknown> : null;
          const phaseContent = record && typeof record.content === "string" ? record.content : phaseAnswerEnvelope && typeof phaseAnswerEnvelope.answer === "string" ? phaseAnswerEnvelope.answer : "";
          if (res.statusCode >= 200 && res.statusCode < 400 && phaseContent) {
            // Landing metadata (evaluation fix batch 2, 2026-11-20): the
            // phased stream otherwise drops the payload's routing record,
            // so the client cannot tell a tier-T3 extractive partial
            // answer (the "confirmed range + sources" fallback) from an
            // adopted answer. The research landing's tier/outcome are
            // metadata in the same sense as phases and source titles —
            // never answer text — and let the client offer a retry action
            // under a fallback answer. Payloads without a research
            // landing emit nothing, keeping the event sequence unchanged.
            const phaseRouting = record.routing && typeof record.routing === "object" ? record.routing as Record<string, unknown> : null;
            const researchTier = phaseRouting && typeof phaseRouting.researchTier === "string" ? phaseRouting.researchTier : null;
            const researchOutcome = phaseRouting && typeof phaseRouting.researchOutcome === "string" ? phaseRouting.researchOutcome : null;
            if (researchTier !== null || researchOutcome !== null) {
              writePhasedEvent({
                type: "outcome",
                ...(researchTier !== null ? { researchTier } : {}),
                ...(researchOutcome !== null ? { researchOutcome } : {}),
              });
            }
            const chunks = phaseContent.match(/.{1,48}(?:\s|$)|.{1,48}/gs) ?? [phaseContent];
            let index = 0;
            const writeNext = () => {
              if (index >= chunks.length) {
                writePhasedEvent({ type: "complete" });
                res.end("data: [DONE]\n\n");
                return;
              }
              writePhasedEvent({ type: "delta", text: chunks[index++] });
              setTimeout(writeNext, 15);
            };
            writeNext();
            return res;
          }
          if (res.statusCode >= 200 && res.statusCode < 400) {
            // Terminal guarantee (N-1, CONSULT_ADOPTION_DESIGN_2026-11-17
            // §1.4; failure type T-8 / case F-12): a 200 phased stream
            // must never end with zero deltas and no complete event. The
            // research branch's final assembly already guarantees a
            // non-empty body, so an empty 2xx payload here means an
            // unforeseen path produced one; land on the tier-T4 hold
            // text as the terminal body instead of an empty 200. The
            // warning log is the R-0 capture point for this condition
            // (delta 0, no complete) if it ever recurs.
            console.warn("[origin-chat] phased stream terminal guard fired", {
              deltaCount: 0,
              completeSent: false,
              statusCode: res.statusCode,
            });
            const terminalLanguage = phaseAnswerEnvelope && phaseAnswerEnvelope.language === "en" ? "en" : "ja";
            const terminalText = buildGroundedResearchAbstainAnswer({ query: "", language: terminalLanguage, reason: "provider-error" });
            const terminalChunks = terminalText.match(/.{1,48}(?:\s|$)|.{1,48}/gs) ?? [terminalText];
            let terminalIndex = 0;
            const writeTerminalNext = () => {
              if (terminalIndex >= terminalChunks.length) {
                writePhasedEvent({ type: "complete" });
                res.end("data: [DONE]\n\n");
                return;
              }
              writePhasedEvent({ type: "delta", text: terminalChunks[terminalIndex++] });
              setTimeout(writeTerminalNext, 15);
            };
            writeTerminalNext();
            return res;
          }
          // Defensive: no current research-branch exit produces an error
          // payload after phases started, but if one ever does, fail the
          // stream explicitly instead of corrupting it with raw JSON.
          writePhasedEvent({ type: "error", code: typeof record?.code === "string" ? record.code : "STREAM_ANSWER_UNAVAILABLE" });
          res.end("data: [DONE]\n\n");
          return res;
        }
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
            res.setHeader("X-Origin-Cost-Evidence", "NOT_MEASURED");
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
    const lastUserMessage = messages[messages.length - 1].content; const groundedResearchRequired = requiresGroundedResearch(lastUserMessage, env);
    if (isOriginWeatherRequest(lastUserMessage)) { const isEnglish = /[a-zA-Z]/.test(lastUserMessage); if (!hasOriginWeatherLocation(lastUserMessage, body.userLocation)) { const content = isEnglish ? "Which location would you like to know the weather for?" : "どの地域の天気をお調べしますか？"; const reason = "地域確認のため外部AIを呼びませんでした。"; return res.json({ content, answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-required", reason), routing: applicationRouting(requestId, reason) }); } const weather = await fetchOriginWeatherAnswer(lastUserMessage, body.userLocation, searchGroundingDeps); if (weather.ok) { const content = weather.text; const reason = isEnglish ? "Answered directly from the latest Open-Meteo forecast data without a model call." : "Open-Meteoの最新予報データから、モデルを使わずに回答しました。"; const weatherEvidence = [{ label: isEnglish ? `Open-Meteo weather forecast (${weather.forecast.place})` : `Open-Meteo 天気予報（${weather.forecast.place}）`, sourceUrl: weather.forecast.sourceUrl, evidenceLevel: "provided" as const, checks: { safeUrl: "passed" as const, content: "not-run" as const, freshness: "not-run" as const, claimSupport: "not-run" as const } }]; const weatherLimitations = [isEnglish ? "Forecast data by Open-Meteo (CC BY 4.0); conditions may change after retrieval." : "Open-Meteoの予報データ（CC BY 4.0）に基づきます。取得後に天気が変わる場合があります。"]; return res.json({ content, answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-run", reason, weatherEvidence, weatherLimitations), routing: { ...applicationRouting(requestId, reason, "not-run"), answerMode: "weather", weatherProvider: "Open-Meteo" } }); } const content = isEnglish ? "I tried to retrieve the latest weather information, but could not obtain it." : "最新の天気情報を取得しようとしましたが、取得できませんでした。"; const reason = isEnglish ? "Weather retrieval failed, so no forecast was guessed." : "天気情報を取得できなかったため、推測で回答しませんでした。"; return res.json({ content, answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-run", reason), routing: applicationRouting(requestId, reason, "not-run") }); }
    const screenResult = screenConversationForSend(messages);
    if (screenResult.outcome === "blocked") return res.status(422).json({ code: "SENSITIVE_INPUT_BLOCKED", messageKey: "errors.sensitiveInputBlocked", message: "秘密情報の可能性がある内容を検出したため、外部AIへの送信を停止しました。値を削除し、必要な内容だけを要約して再入力してください。", retryable: false, requestId, sensitiveKinds: screenResult.sensitiveKinds });
    if (screenResult.outcome === "sanitized") console.info("[origin-chat] sensitive input redacted from assistant history", { requestId, sensitiveKinds: screenResult.redactedKinds, redactionCount: screenResult.redactionCount, attribution: "assistant" });
    const sendMessages = screenResult.messages;
    const contextResult = minimizeOriginContext(sendMessages, contextPolicy); if (contextResult.ok === false) return res.status(contextResult.code === "LATEST_MESSAGE_TOO_LARGE" ? 413 : 500).json({ code: contextResult.code, message: contextResult.message, retryable: false, requestId });
    const intentInput = originIntentInputFromContext(contextResult.window.messages);
    const researchIntent = groundedResearchRequired ? classifyOriginRequestIntent(intentInput, "research") : null;
    const researchRequestedOutputs = researchIntent?.requestedOutputs ?? [];
    const researchNeedsDownstreamDeliverable = researchRequestedOutputs.some((output) => ["presentation", "document", "spreadsheet", "chart", "image", "application", "website", "dashboard"].includes(output));
    if (groundedResearchRequired) {
      // Grounded-stage start, recorded for the synthesis retry time gate
      // (SYNTHESIS_RETRY_DESIGN_2026-11-14 §2.4): the retry may fire only
      // while the stage is still inside its elapsed-time budget.
      const groundedStartedAt = now();
      emitResearchPhase("searching");
      let researchResult: OriginResearchResult;
      try {
        researchResult = await research(lastUserMessage.trim());
      } catch {
        researchResult = { ok: false, sources: [], failure: { stage: "web-search", code: "NETWORK_FAILURE" } };
      }
      // Recovery build Stage 1, PR-5: one bounded retry of the
      // research execution when it failed with a provider error
      // (F-13: the round-5 http_503 was transient by shape — the
      // same query succeeds on a later attempt). The retry is
      // deliberately narrow: it fires only when the result carries
      // BOTH a failure and groundingFailure "provider-error".
      // no-sources / no-fresh-sources are deterministic outcomes of
      // a completed search and are never retried, and the retry runs
      // at most once. Switch ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE:
      // off (default) does nothing; shadow logs that the retry would
      // fire and keeps the original result; enforce re-executes once
      // and continues with the retry's result, success or failure.
      const recoveryRefusalMode = resolveRecoveryRefusalValidationMode(env);
      if (
        recoveryRefusalMode !== "off" &&
        researchResult.failure &&
        researchResult.groundingFailure === "provider-error"
      ) {
        console.info("[origin-chat] recovery refusal validation", {
          requestId,
          recoveryRefusalSite: "research-retry",
          recoveryRefusalMode,
          recoveryRefusalKind: "provider-error-retry",
          recoveryRefusalFired: recoveryRefusalMode === "enforce",
        });
        if (recoveryRefusalMode === "enforce") {
          try {
            researchResult = await research(lastUserMessage.trim());
          } catch {
            researchResult = { ok: false, sources: [], failure: { stage: "web-search", code: "NETWORK_FAILURE" } };
          }
        }
      }
      // Stage timing (speed measurement 2026-11-16): the search stage
      // runs serially before any synthesis, and its duration was not
      // recorded anywhere. Numbers and counts only; no query or text.
      const researchSearchMs = Math.max(0, now() - groundedStartedAt);
      console.info("[origin-chat] research search completed", {
        requestId,
        searchMs: researchSearchMs,
        sourceCount: researchResult.sources.length,
        // Grounding aggregates (counts and codes only — no titles,
        // excerpts, or URLs): the freshness counts and, when the
        // generic pipeline produced a candidate set, the pre-gate
        // candidate observation, so a thin or empty result can be
        // attributed to the stage that dropped it. Absent when the
        // result did not come from the search-grounding pipeline.
        ...(researchResult.grounding ? { searchGrounding: researchResult.grounding } : {}),
      });
      // The sources event carries exactly the citable set the answer will
      // use (same safe filter as groundedResearchAnswer), titles/domains only.
      emitResearchSources(safeOriginResearchSources(researchResult.sources));
      emitResearchPhase("composing");
      const grounded = groundedResearchAnswer(lastUserMessage, researchResult);
      // Recovery build Stage 1, PR-3 (shadow only): record the
      // answer-type value vote over the grounded sources so the
      // confirmed-value quality is observable before PR-4 wires it
      // into answers. Default off; never alters the answer.
      if (resolveRecoveryValueVoteMode(env) === "shadow") {
        logRecoveryValueVoteShadow({
          requestId,
          question: lastUserMessage,
          sources: grounded.sources,
        });
      }
      // Recovery build Stage 1, PR-4: the template direct-answer
      // fallback. When the normal path produced no substantive
      // answer — the tier-T4 hold here (sourceCount 0), or the
      // tier-T3 extractive partial answer at the final assembly
      // below — a scalar value confirmed by PR-3's cross-source vote
      // over the FULL source set may be stated directly by a
      // deterministic template, with its as-of date and its sources.
      // The T4 site reads the freshness gate's dropped candidates
      // (researchResult.droppedSources): round 5's freshness
      // refusals were periodic official values discarded for the
      // page's age, and the fallback re-judges them by the value's
      // own publication point under PR-3/PR-4's confirmation rules.
      // Switch ORIGIN_RECOVERY_TEMPLATE_FALLBACK_MODE: off (default)
      // does nothing; shadow computes and logs the attempt and the
      // original answer is delivered byte-identically; enforce
      // delivers the template — but only after the publication gate
      // has also passed the template text, so the gate is never
      // bypassed (a held template does not fire, and the original
      // answer stands exactly as before this PR).
      const recoveryTemplateMode = resolveRecoveryTemplateFallbackMode(env);
      let recoveryTemplate: {
        content: string;
        attempt: RecoveryTemplateFallbackResult;
      } | null = null;
      const tryRecoveryTemplateAtSite = (
        site: "t4" | "t3",
        sources: readonly OriginResearchSource[],
      ): void => {
        if (recoveryTemplate || sources.length === 0) return;
        const attempt = tryRecoveryTemplateFallback({
          question: lastUserMessage,
          sources,
          mode: recoveryTemplateMode,
          nowMs: now(),
          language: grounded.language,
        });
        console.info("[origin-chat] recovery template fallback", {
          requestId,
          recoveryTemplateSite: site,
          recoveryTemplateMode,
          recoveryTemplateFired: attempt.fired,
          recoveryTemplateType: attempt.type,
          ...(attempt.voteStatus ? { recoveryVoteStatus: attempt.voteStatus } : {}),
          ...(attempt.reason ? { recoveryTemplateReason: attempt.reason } : {}),
          ...(attempt.resolution ? { recoveryTemplateResolution: attempt.resolution } : {}),
          recoveryTemplateDomainCount: attempt.domains.length,
          // The confirmed value is a number/code for the scalar
          // types (the same discipline as PR-3's shadow log); team
          // names are recorded as status and counts only.
          ...(attempt.fired && attempt.type !== "team_name"
            ? { recoveryTemplateValue: attempt.normalizedValue?.slice(0, 40) }
            : {}),
        });
        if (recoveryTemplateMode !== "enforce" || !attempt.fired || !attempt.text) return;
        const gate = applyOriginPublicationGate({
          requestId,
          answerText: attempt.text,
          query: lastUserMessage,
          language: grounded.language,
          env,
        });
        if (gate.held) {
          console.warn("[origin-chat] recovery template held by publication gate", {
            requestId,
            recoveryTemplateSite: site,
            publicationGateFiringKinds: gate.firingKinds,
          });
          return;
        }
        recoveryTemplate = { content: attempt.text, attempt };
      };
      if (recoveryTemplateMode !== "off" && grounded.sourceCount === 0) {
        tryRecoveryTemplateAtSite("t4", safeOriginResearchSources(researchResult.droppedSources ?? []));
      }
      // Recovery build Stage 1, PR-5: the conditional answers. When
      // the normal path produced no substantive answer and PR-4's
      // template did not fire either, a deterministic conditional
      // answer may replace the uninformative outcome:
      //  - T4 (and T3 below): the question names an entity that
      //    appears in NO source — neither the freshness gate's
      //    dropped candidates here nor the kept sources at the T3
      //    site — so the answer states nonexistence conditionally
      //    instead of listing unrelated sources (I-01/I-02/I-03);
      //  - T4: the question demands confirmed information about a
      //    future outcome that is not decided yet, so the answer
      //    states that no confirmed information exists (I-05);
      //  - T4: the question is in the refusal-forbidden procedure
      //    category, so the hold text gains the fixed official-
      //    window guidance (E-07). The landing stays T4/ABSTAIN —
      //    the conditional form asserts nothing.
      // Switch ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE: off does
      // nothing; shadow logs the attempt and delivers the original
      // answer byte-identically; enforce delivers the conditional
      // answer — but only after the publication gate has also
      // passed it, so the gate is never bypassed (a held conditional
      // does not fire, and the original answer stands exactly as
      // before this PR).
      let recoveryConditional: {
        content: string;
        kind: "nonexistence" | "undetermined";
      } | null = null;
      let recoveryProcedureConditional = false;
      const adoptRecoveryConditional = (
        site: "t4" | "t3",
        kind: "nonexistence" | "undetermined",
        text: string | null,
      ): void => {
        console.info("[origin-chat] recovery refusal validation", {
          requestId,
          recoveryRefusalSite: site,
          recoveryRefusalMode,
          recoveryRefusalKind: kind,
          recoveryRefusalFired: Boolean(text),
        });
        if (recoveryRefusalMode !== "enforce" || !text) return;
        const gate = applyOriginPublicationGate({
          requestId,
          answerText: text,
          query: lastUserMessage,
          language: grounded.language,
          env,
        });
        if (gate.held) {
          console.warn("[origin-chat] recovery conditional held by publication gate", {
            requestId,
            recoveryRefusalSite: site,
            recoveryRefusalKind: kind,
            publicationGateFiringKinds: gate.firingKinds,
          });
          return;
        }
        recoveryConditional = { content: text, kind };
      };
      if (recoveryRefusalMode !== "off" && grounded.sourceCount === 0 && !recoveryTemplate) {
        const entity = detectNamedEntity(lastUserMessage);
        const dropped = safeOriginResearchSources(researchResult.droppedSources ?? []);
        if (entity && dropped.length > 0) {
          adoptRecoveryConditional(
            "t4",
            "nonexistence",
            buildNonexistenceConditionalAnswer({
              question: lastUserMessage,
              entityName: entity,
              sources: dropped,
              language: grounded.language,
            }),
          );
        } else if (detectUndeterminedFutureQuestion(lastUserMessage)) {
          adoptRecoveryConditional(
            "t4",
            "undetermined",
            buildUndeterminedFutureAnswer({ question: lastUserMessage, language: grounded.language }),
          );
        } else if (classifyRefusalForbiddenCategory(lastUserMessage) === "procedure") {
          console.info("[origin-chat] recovery refusal validation", {
            requestId,
            recoveryRefusalSite: "t4",
            recoveryRefusalMode,
            recoveryRefusalKind: "procedure",
            recoveryRefusalFired: recoveryRefusalMode === "enforce",
          });
          if (recoveryRefusalMode === "enforce") recoveryProcedureConditional = true;
        }
      }
      if (grounded.sourceCount === 0 && !recoveryTemplate) {
        // Failure classification (synthesis-hygiene): record why this
        // request fail-closed to the could-not-confirm answer, without
        // logging any message or answer text. monthly-cap-reached means
        // the search was deliberately not executed (SEARCH_NOT_TRIGGERED);
        // an executor/grounding provider failure is PROVIDER_FAILED; a
        // completed search with no usable sources is SEARCH_NO_RESULTS.
        // Assertion-gate replacements on the non-grounded paths log
        // GATE_REPLACED at their own sites.
        const groundingFailure = researchResult.groundingFailure;
        const failClosedReasonCode = researchResult.failure || groundingFailure === "provider-error"
          ? "PROVIDER_FAILED"
          : groundingFailure === "monthly-cap-reached"
            ? "SEARCH_NOT_TRIGGERED"
            : "SEARCH_NO_RESULTS";
        console.warn("[origin-chat] grounded answer fail-closed", {
          requestId,
          searchMs: researchSearchMs,
          reasonCode: failClosedReasonCode,
          // Ladder landing (N-1 §1.2): this exit is always tier T4 /
          // outcome ABSTAIN; the reason rides the same log line so the
          // zero-source refusals (failure type T-2) stay attributable.
          researchTier: grounded.landing.tier,
          researchOutcome: grounded.landing.outcome,
          ...(grounded.landing.abstainReason ? { researchAbstainReason: grounded.landing.abstainReason } : {}),
          ...(groundingFailure ? { groundingFailure } : {}),
          ...(researchResult.failure ? { failureStage: researchResult.failure.stage, failureCode: researchResult.failure.code } : {}),
          // Same aggregates as the search-completed log: on this
          // zero-source path the candidate observation is what tells
          // provider sparsity apart from screen/freshness drops.
          ...(researchResult.grounding ? { searchGrounding: researchResult.grounding } : {}),
          // Flat scalar copies of the grounding aggregates (R-0): the
          // nested searchGrounding object collapses in serialized log
          // output, which is why the 2026-11-17 re-measurement could not
          // attribute the zero-source refusals (failure type T-2) to a
          // reason. Top-level counts survive, so the reason breakdown —
          // no candidates at all vs dropped as stale vs dropped as
          // undated — is recoverable per request. Counts and codes only.
          ...(researchResult.grounding
            ? {
                groundingVerifiedFreshCount: researchResult.grounding.verifiedFreshSourceCount,
                groundingUnknownDateCount: researchResult.grounding.unknownDateSourceCount,
                groundingDroppedStaleCount: researchResult.grounding.droppedStaleSourceCount,
                groundingDroppedUndatedCount: researchResult.grounding.droppedUndatedSourceCount,
                ...(researchResult.grounding.candidateStats
                  ? {
                      groundingCandidateTotalCount: researchResult.grounding.candidateStats.totalCount,
                      groundingCandidateDroppedByScreenCount: researchResult.grounding.candidateStats.droppedByScreenCount,
                      groundingCandidateDroppedByFreshnessCount: researchResult.grounding.candidateStats.droppedByFreshnessCount,
                    }
                  : {}),
              }
            : {}),
        });
      }
      let synthesisStatus = "not-run";
      let synthesisFailureCode: string | undefined;
      // Answer verification (V-PR-2): the text-path synthesis execution
      // is captured so the shadow verification at the T0 return and at
      // the final assembly can identify the serving route from the
      // execution that actually ran. Null whenever synthesis did not
      // execute (records path, disabled, plan unavailable).
      let synthesisExecutionResult: OriginProviderExecutionResult | null = null;
      let synthesisExecutionPlan: OriginExecutionPlan | null = null;

      if (researchSynthesis && grounded.sources.length > 0) {
        const synthesisPlan = buildOriginExecutionPlan(
          { goal: lastUserMessage.trim(), requiresCodeChanges: false, requiresFreshResearch: true, containsSecrets: false },
          { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) },
          originClientPolicy(body),
          { freeModelCatalog: options.freeModelCatalog, nowMs: catalogNow() },
        );
        if (synthesisPlan.ok === true) {
          const synthesisStartedAt = now();
          // Records path (SYNTHESIS_RECORDS_DESIGN_2026-11-14 §14.3,
          // R-PR-3): when no output form was requested (§7.4 keeps
          // supervisor-artifact and inline-form requests on the text
          // path), the shared records helper is offered the synthesis.
          // With the kill switch OFF it reports not-attempted and the
          // text path below runs exactly as before. With it ON, the
          // records outcome settles this branch: adoption returns the
          // rendered answer, and any records failure falls through to
          // the partial answer (fail-closed, §12) — the text path is
          // never run for a records-selected request.
          let recordsSettled = false;
          if (researchRequestedOutputs.length === 0) {
            try {
              const recordsOutcome = await executeGroundedResearchRecordsSynthesis(researchSynthesis, {
                plan: { ...synthesisPlan.plan, timeoutMs: Math.min(synthesisPlan.plan.timeoutMs, MAX_PROVIDER_ATTEMPT_TIMEOUT_MS) },
                query: lastUserMessage,
                sources: grounded.sources,
                language: grounded.language,
                enabled: isGroundedResearchRecordsEnabled(env),
                // The records assertion dispatches per result shape:
                // the retry's bare route-2/route-3 results are verified
                // by their own route's assertion (R-PR-5); composites
                // and bare route-1 results keep the standing assertion.
                assertZeroCost: (result) => assertGroundedResearchRecordsZeroCost(result, synthesisPlan.plan.modelId),
                // Fresh retry (§10): re-execute the records request on
                // the route after the one that served the initial
                // result; the time gate runs on this router's grounded
                // clock pair (groundedStartedAt / now). The detailed
                // executor (R-PR-8d) names the derivation stage when
                // no next route exists, recorded as retrySkipDetail.
                executeRetry: createGroundedResearchRecordsRetryExecutorWithDetail({ env, nowMs: catalogNow() }),
                startedAtMs: groundedStartedAt,
                now,
              });
              if (recordsOutcome.attempted) {
                recordsSettled = true;
                if (recordsOutcome.adopted === true && recordsOutcome.text !== undefined && recordsOutcome.result !== undefined) {
                  const recordsText = recordsOutcome.text;
                  const recordsResult = recordsOutcome.result;
                  console.info("[origin-chat] research records completed", {
                    requestId,
                    synthesisPath: "records",
                    // Ladder landing (N-1 §1.2): records adoption is tier
                    // T0; a partial records answer (confirmed range only)
                    // reports outcome PARTIAL instead of ANSWERED.
                    researchTier: researchLandingForAdopted(recordsOutcome.partial === true).tier,
                    researchOutcome: researchLandingForAdopted(recordsOutcome.partial === true).outcome,
                    ...recordsOutcome.metrics,
                  });
                  const verificationReason = grounded.language === "en"
                    ? "The answer was assembled deterministically from records whose quotes were verified verbatim against the retrieved HTTPS source information; factual truth and publisher authority were not independently verified."
                    : "取得した出典情報に対して逐語検証を通ったレコードだけから、アプリ側で決定的に組み立てました。主張の真偽や媒体の権威性を独立検証したものではありません。";
                  const limitations = [
                    grounded.language === "en"
                      ? "Every claim in the answer is backed by a verbatim quote checked against the retrieved source information, but claim truth, completeness, and publisher authority were not independently verified."
                      : "回答の各主張は、取得した出典情報と逐語照合した引用で裏付けられていますが、主張の真偽・網羅性・媒体の権威性は独立検証していません。",
                  ];
                  if (recordsOutcome.partial) {
                    // Partial-answer salvage (records improvement
                    // #2): the delivered text is verified material
                    // only, and its own lead note says so; the
                    // envelope records the same limitation.
                    limitations.push(grounded.language === "en"
                      ? "This answer shows only the range that could be confirmed; parts that could not be confirmed are not included."
                      : "この回答は確認できた範囲のみを示しており、確認できなかった部分は含めていません。");
                  }
                  if (grounded.conflicts > 0) {
                    limitations.push(grounded.language === "en"
                      ? "Retrieved sources contain structured-value differences that require human review."
                      : "取得ソース間に構造化値の差異があり、人による確認が必要です。");
                  }
                  let supervisorArtifacts: ReturnType<typeof generateOriginSupervisorArtifactsV2>;
                  let artifactFailureCode: string | undefined;
                  try {
                    supervisorArtifacts = generateOriginSupervisorArtifactsV2(
                      researchRequestedOutputs,
                      lastUserMessage,
                      recordsText,
                    );
                  } catch (error) {
                    artifactFailureCode = error instanceof Error && /^SUPERVISOR_[A-Z0-9_]+$/.test(error.message)
                      ? error.message
                      : "SUPERVISOR_ARTIFACT_GENERATION_FAILED";
                    supervisorArtifacts = {
                      version: ORIGIN_SUPERVISOR_VERSION_V2,
                      status: "partial",
                      artifacts: [],
                      richOutputs: [],
                      completedOutputs: [],
                      pendingOutputs: [],
                    };
                  }
                  return res.json({
                    content: recordsText,
                    artifacts: supervisorArtifacts.artifacts,
                    supervisor: {
                      version: ORIGIN_SUPERVISOR_VERSION_V2,
                      status: supervisorArtifacts.status,
                      freeOnly: true,
                      costUsd: 0,
                      paidFallbackUsed: false,
                      automaticProviderRetries: 0,
                      steps: [
                        {
                          id: "research",
                          status: "completed",
                          evidenceCount: grounded.sourceCount,
                          provider: grounded.provider,
                        },
                        {
                          id: "synthesis",
                          status: "completed",
                          citationValidated: true,
                          providerAttempts: providerAttemptCount(recordsResult),
                          providerTransportRequests: recordsResult.transportRequestCount,
                        },
                        {
                          id: "artifact",
                          status: supervisorArtifacts.status,
                          artifactCount: supervisorArtifacts.artifacts.length,
                          completedOutputs: supervisorArtifacts.completedOutputs,
                          pendingOutputs: supervisorArtifacts.pendingOutputs,
                          ...(artifactFailureCode ? { failureCode: artifactFailureCode } : {}),
                        },
                      ],
                    },
                    answer: answerEnvelope(
                      recordsText,
                      grounded.language,
                      "not-run",
                      verificationReason,
                      grounded.evidence,
                      limitations,
                      grounded.nextActions,
                      supervisorArtifacts.richOutputs,
                    ),
                    routing: {
                      model: synthesisPlan.plan.providerLabel,
                      reason: grounded.language === "en"
                        ? "Synthesized retrieved public evidence with one verified zero-cost model execution in records form, rendered deterministically by the app."
                        : "取得済み公開証拠を、検証済み$0モデル1回実行のレコード形式で取得し、アプリ側で決定的に組み立てました。",
                      score: null,
                      timeMs: Math.max(0, now() - synthesisStartedAt),
                      cost: recordsResult.actualCostUsd,
                      providerId: synthesisPlan.plan.providerId,
                      modelId: synthesisPlan.plan.modelId,
                      taskType: synthesisPlan.plan.taskType,
                      actualCostUsd: recordsResult.actualCostUsd,
                      costEvidenceStatus: "NOT_MEASURED",
                      estimatedCostUsd: synthesisPlan.plan.estimatedCostUsd,
                      freeOnly: true,
                      traceId: requestId,
                      verificationStatus: "not-run",
                      answerMode: "research",
                      verificationLevel: "evidence-required",
                      sourceCount: grounded.sourceCount,
                      researchProvider: grounded.provider,
                      conflictCount: grounded.conflicts,
                      ...(researchResult.grounding ? { searchGrounding: researchResult.grounding } : {}),
                      synthesisStatus: "records-validated",
                      synthesisPath: "records",
                      researchTier: "T0",
                      researchOutcome: recordsOutcome.partial ? "PARTIAL" : "ANSWERED",
                      synthesisSourceCount: recordsOutcome.usedSourceIds.length,
                      ...(recordsOutcome.partial ? { synthesisPartial: true } : {}),
                      providerDataPolicy: recordsResult.providerDataPolicy,
                      providerRouting: recordsResult.routingEvidence,
                      usage: recordsResult.usage,
                      providerAttempts: providerAttemptCount(recordsResult),
                      ...(recordsResult.attempts ? { providerRouteAttempts: recordsResult.attempts } : {}),
                      requestedOutputs: researchRequestedOutputs,
                      supervisorMode: researchRequestedOutputs.length > 0 ? ORIGIN_SUPERVISOR_VERSION_V2 : "research-only",
                      supervisorStatus: supervisorArtifacts.status,
                      generatedOutputs: supervisorArtifacts.completedOutputs,
                      pendingOutputs: supervisorArtifacts.pendingOutputs,
                      ...(artifactFailureCode ? { artifactFailureCode } : {}),
                      downstreamDeliverablePending: supervisorArtifacts.pendingOutputs.length > 0 || Boolean(artifactFailureCode),
                    },
                  });
                }
                synthesisStatus = "records-validation-failed";
                synthesisFailureCode = recordsOutcome.failureCode;
                console.warn("[origin-chat] research records discarded", {
                  requestId,
                  synthesisPath: "records",
                  code: recordsOutcome.failureCode,
                  // Landing after this discard is the tier-T3 extractive
                  // partial answer (N-1 §1.1).
                  researchTier: "T3",
                  researchOutcome: "PARTIAL",
                  ...recordsOutcome.metrics,
                });
              }
            } catch (error) {
              recordsSettled = true;
              synthesisStatus = "provider-failed";
              synthesisFailureCode = error instanceof OriginProviderError ? error.code : "PROVIDER_INTERNAL_ERROR";
              // Observability (RESEARCH_FLOOR_DESIGN_2026-11-17 §3 R-0):
              // the final code alone cannot attribute an unavailability
              // to a route, so the whitelisted failover-attempt summary
              // (per-route outcome / error code / upstream error code /
              // skip reason / duration) rides the log line. Log-only.
              console.warn("[origin-chat] research records unavailable; source-list fallback retained", {
                requestId,
                code: synthesisFailureCode,
                researchTier: "T3",
                researchOutcome: "PARTIAL",
                ...(error instanceof OriginProviderError ? { failureDiagnostic: buildOriginProviderFailureDiagnostic(error) } : {}),
              });
            }
          }
          if (!recordsSettled) try {
            // Quote-first generation contract (ORIGIN_QUOTE_FIRST_MODE,
            // default off; groundedResearchQuoteFirst.ts): in shadow /
            // enforce the request gains the quote registry and the
            // contract, and adoption runs under the quote-first
            // context. Off — or an empty evidence packet, where the
            // model would have nothing to quote — leaves the request
            // and the adoption gate exactly as before.
            const quoteFirstMode = resolveQuoteFirstMode(env);
            const quoteFirstRegistry = quoteFirstMode === "off"
              ? null
              : buildQuoteFirstRegistry(grounded.sources, lastUserMessage);
            const quoteFirstContext: QuoteFirstAdoptionContext | undefined =
              quoteFirstRegistry && quoteFirstRegistry.entries.length > 0 && quoteFirstMode !== "off"
                ? { mode: quoteFirstMode, registry: quoteFirstRegistry }
                : undefined;
            const synthesisRequest: OriginProviderExecutionRequest = {
              plan: { ...synthesisPlan.plan, timeoutMs: Math.min(synthesisPlan.plan.timeoutMs, MAX_PROVIDER_ATTEMPT_TIMEOUT_MS) },
              messages: [{
                role: "user",
                content: buildGroundedResearchSynthesisPrompt(
                  lastUserMessage,
                  grounded.sources,
                  grounded.conflictDetails,
                  grounded.language,
                  researchRequestedOutputs,
                  quoteFirstContext ? buildQuoteFirstRegistrySection(quoteFirstContext.registry, grounded.language) : undefined,
                ),
              }],
              systemInstruction: buildGroundedResearchSynthesisInstruction(
                grounded.language,
                researchRequestedOutputs,
                quoteFirstContext ? buildQuoteFirstContractInstruction(grounded.language) : undefined,
              )
                + "\n\n"
                + originCurrentDateInstruction(now(), grounded.language),
            };
            const initialSynthesisResult = await researchSynthesis(synthesisRequest);
            assertOriginZeroCostExecutionResultWithFailover(initialSynthesisResult, synthesisPlan.plan.modelId);
            // Adoption gate (synthesis salvage, §3; generalized to all
            // line-local failures 2026-11-16): the unchanged citation
            // validator decides; on a line-local failure the salvage helper
            // may remove the unit lines that individually fail validation
            // and re-run the same validator. Adopted text — salvaged or
            // not — has passed the identical gate.
            const initialAdoption = adoptGroundedResearchSynthesis(
              initialSynthesisResult.text,
              grounded.sources,
              quoteFirstContext ? { quoteFirst: quoteFirstContext } : undefined,
            );
            // Feedback retry (SYNTHESIS_RETRY_DESIGN_2026-11-14 §2): when
            // the adoption gate still rejects the synthesis, the shared
            // helper may make exactly one corrective retry — scan-based
            // rejection reasons only, never the failed draft itself, so
            // the model rewrites from scratch — inside
            // its time gate and kill switch. It returns the final verdict
            // and the execution result to consume; when the retry also
            // fails, the initial verdict stands unchanged.
            const retryOutcome = await executeGroundedResearchSynthesisWithRetry(researchSynthesis, {
              initialRequest: synthesisRequest,
              initialResult: initialSynthesisResult,
              initialAdoption,
              sources: grounded.sources,
              language: grounded.language,
              elapsedMs: Math.max(0, now() - groundedStartedAt),
              enabled: isGroundedResearchSynthesisRetryEnabled(env),
              quoteFirst: quoteFirstContext,
              assertZeroCost: (result) => assertOriginZeroCostExecutionResultWithFailover(result, synthesisPlan.plan.modelId),
              onRetryAttempt: (info) => console.info("[origin-chat] research synthesis retry attempted", {
                requestId,
                synthesisRetryAttempted: true,
                ...info,
              }),
            });
            const adoption = retryOutcome.adoption;
            if (adoption.quoteFirst) {
              // Quote-first observability: the binding report is
              // counts, codes, and the mode only — no answer text,
              // quote text, or question text (the same rule as every
              // synthesis log in this router). In shadow this line is
              // the ONLY effect the contract has on the request's
              // outcome; in enforce it also records delivered removals.
              console.info("[origin-chat] research synthesis quote-first", {
                requestId,
                ...adoption.quoteFirst,
              });
            }
            if (adoption.redactionRemnantsRemoved) {
              // Redaction-remnant scrub observability (A-02 fix):
              // counts only — no answer text, unit text, or marker
              // context is ever logged.
              console.info("[origin-chat] research synthesis redaction remnants scrubbed", {
                requestId,
                redactionRemnantsRemoved: adoption.redactionRemnantsRemoved,
                redactionUnitsDropped: adoption.redactionUnitsDropped ?? 0,
              });
            }
            // The execution result the rest of this branch consumes: the
            // retry's when a retry ran and was adopted, otherwise the
            // initial one.
            const synthesisResult = retryOutcome.result;
            synthesisExecutionResult = synthesisResult;
            synthesisExecutionPlan = synthesisRequest.plan;
            if (adoption.adopted === true) {
              const verificationReason = grounded.language === "en"
                ? "Citation structure was checked against the retrieved source information; factual truth and publisher authority were not independently verified."
                : "取得した出典情報との引用構造の一致を確認しました。主張の真偽や媒体の権威性を独立検証したものではありません。";
              const limitations = [
                grounded.language === "en"
                  ? "Citations were structurally validated against retrieved sources, but claim truth, completeness, and publisher authority were not independently verified."
                  : "引用先が取得済みソースと一致することは機械検証しましたが、主張の真偽・網羅性・媒体の権威性は独立検証していません。",
              ];
              if (adoption.salvaged) {
                // Partial-answer disclosure, worded exactly as the
                // records-path salvage (PR #1327) words it: the delivered
                // text is the verified remainder only, and the envelope
                // says so in plain language.
                limitations.push(grounded.language === "en"
                  ? "This answer shows only the range that could be confirmed; parts that could not be confirmed are not included."
                  : "この回答は確認できた範囲のみを示しており、確認できなかった部分は含めていません。");
              }
              if (grounded.conflicts > 0) {
                limitations.push(grounded.language === "en"
                  ? "Retrieved sources contain structured-value differences that require human review."
                  : "取得ソース間に構造化値の差異があり、人による確認が必要です。");
              }
              let supervisorArtifacts: ReturnType<typeof generateOriginSupervisorArtifactsV2>;
              let artifactFailureCode: string | undefined;
              try {
                supervisorArtifacts = generateOriginSupervisorArtifactsV2(
                  researchRequestedOutputs,
                  lastUserMessage,
                  adoption.text,
                );
              } catch (error) {
                artifactFailureCode = error instanceof Error && /^SUPERVISOR_[A-Z0-9_]+$/.test(error.message)
                  ? error.message
                  : "SUPERVISOR_ARTIFACT_GENERATION_FAILED";
                supervisorArtifacts = {
                  version: ORIGIN_SUPERVISOR_VERSION_V2,
                  status: "partial",
                  artifacts: [],
                  richOutputs: [],
                  completedOutputs: [],
                  pendingOutputs: researchRequestedOutputs.filter((output) =>
                    ["presentation", "document", "spreadsheet", "chart", "image", "application", "website", "dashboard"].includes(output)),
                };
              }
              if (supervisorArtifacts.pendingOutputs.length > 0 || artifactFailureCode) {
                limitations.push(grounded.language === "en"
                  ? `Some requested downstream outputs were not generated: ${supervisorArtifacts.pendingOutputs.join(", ") || "artifact generation blocked"}.`
                  : `一部の後段成果物は生成していません：${supervisorArtifacts.pendingOutputs.join("、") || "成果物生成を安全停止"}。`);
              }
              if (adoption.salvaged) {
                // Completion log for a salvaged adoption (§3.7): counts
                // only — no answer text, unit text, or question text. The
                // unit diagnostics describe the ORIGINAL synthesis text, so
                // uncitedUnits - removedUnits shows how close the text was.
                // After a feedback retry, the adopted text came from the
                // retry execution, so the diagnostics describe its text.
                const unitDiagnostics = diagnoseGroundedResearchSynthesisUnits(synthesisResult.text);
                console.info("[origin-chat] research synthesis completed", {
                  requestId,
                  synthesisSalvaged: true,
                  synthesisSalvageRemovedUnits: adoption.removedUnits,
                  ...(retryOutcome.retried ? { synthesisRetried: true } : {}),
                  totalFactualUnits: unitDiagnostics.totalFactualUnits,
                  citedUnits: unitDiagnostics.citedUnits,
                  uncitedUnits: unitDiagnostics.uncitedUnits,
                  uncitedUnitsWithUrlLike: unitDiagnostics.uncitedUnitsWithUrlLike,
                  // Ladder landing (N-1 §1.2): a salvaged adoption that
                  // passed the R-3 floor guard is tier T0 / ANSWERED.
                  researchTier: "T0",
                  researchOutcome: "ANSWERED",
                });
              }
              if (!adoption.salvaged) {
                // Completion log for a clean adoption (N-1): the landing
                // (tier T0 / outcome ANSWERED) is recorded for every
                // adopted synthesis, not only salvaged ones, so outcome
                // counts can be aggregated per request.
                console.info("[origin-chat] research synthesis completed", {
                  requestId,
                  synthesisSalvaged: false,
                  ...(retryOutcome.retried ? { synthesisRetried: true } : {}),
                  researchTier: "T0",
                  researchOutcome: "ANSWERED",
                });
              }
              // Answer verification (V-PR-2, shadow): an adopted
              // grounded synthesis is a class-A target. Shadow never
              // changes the delivered text; a clean cross-route pass
              // is the only outcome that touches the envelope (the
              // status becomes a truthful "passed"), and everything
              // else leaves the envelope exactly as assembled above —
              // the log line and the routing block carry the outcome.
              let t0VerificationStatus: OriginAnswerVerificationStatus = "not-run";
              let t0VerificationSummary = verificationReason;
              let t0AnswerVerification: Record<string, unknown> | null = null;
              if (resolveOriginAnswerVerificationEffectiveMode(env) === "shadow") {
                const verificationOutcome = await runOriginAnswerVerificationShadow({
                  requestId,
                  path: "research",
                  answerClass: "A",
                  question: lastUserMessage,
                  answerText: adoption.text,
                  sources: answerVerificationSources(grounded.sources),
                  generationResult: synthesisResult,
                  sourcePlan: synthesisRequest.plan,
                  language: grounded.language,
                }, { env, nowMs: now(), verify: options.answerVerification?.verify, readDailyNeuronsUsed: options.answerVerification?.readDailyNeuronsUsed });
                t0AnswerVerification = verificationOutcome.metadata;
                if (verificationOutcome.envelopeEffect === "pass") {
                  t0VerificationStatus = "passed";
                  t0VerificationSummary = grounded.language === "en"
                    ? "Citation structure was checked against the retrieved source information, and a different AI from the one that wrote this answer checked its content."
                    : "取得した出典情報との引用構造の一致を確認し、回答したAIとは別のAIが内容を確認しました。";
                }
              }
              return res.json({
                content: adoption.text,
                artifacts: supervisorArtifacts.artifacts,
                supervisor: {
                  version: ORIGIN_SUPERVISOR_VERSION_V2,
                  status: supervisorArtifacts.status,
                  freeOnly: true,
                  costUsd: 0,
                  paidFallbackUsed: false,
                  automaticProviderRetries: 0,
                  steps: [
                    {
                      id: "research",
                      status: "completed",
                      evidenceCount: grounded.sourceCount,
                      provider: grounded.provider,
                    },
                    {
                      id: "synthesis",
                      status: "completed",
                      citationValidated: true,
                      providerAttempts: providerAttemptCount(synthesisResult),
                  providerTransportRequests: synthesisResult.transportRequestCount,
                    },
                    {
                      id: "artifact",
                      status: supervisorArtifacts.status,
                      artifactCount: supervisorArtifacts.artifacts.length,
                      completedOutputs: supervisorArtifacts.completedOutputs,
                      pendingOutputs: supervisorArtifacts.pendingOutputs,
                      ...(artifactFailureCode ? { failureCode: artifactFailureCode } : {}),
                    },
                  ],
                },
                answer: answerEnvelope(
                  adoption.text,
                  grounded.language,
                  t0VerificationStatus,
                  t0VerificationSummary,
                  grounded.evidence,
                  limitations,
                  grounded.nextActions,
                  supervisorArtifacts.richOutputs,
                ),
                routing: {
                  model: synthesisPlan.plan.providerLabel,
                  reason: retryOutcome.retried
                    ? grounded.language === "en"
                      ? "Synthesized retrieved public evidence with verified zero-cost model executions: the initial run plus one validation-feedback retry."
                      : "取得済み公開証拠を、検証済み$0モデルの2回実行（初回と検証フィードバックによる再試行）で統合しました。"
                    : grounded.language === "en"
                      ? "Synthesized retrieved public evidence with one verified zero-cost model execution."
                      : "取得済み公開証拠を、検証済み$0モデル1回だけで統合しました。",
                  score: null,
                  timeMs: Math.max(0, now() - synthesisStartedAt),
                  cost: synthesisResult.actualCostUsd,
                  providerId: synthesisPlan.plan.providerId,
                  modelId: synthesisPlan.plan.modelId,
                  taskType: synthesisPlan.plan.taskType,
                  actualCostUsd: synthesisResult.actualCostUsd,
                  costEvidenceStatus: "NOT_MEASURED",
                  estimatedCostUsd: synthesisPlan.plan.estimatedCostUsd,
                  freeOnly: true,
                  traceId: requestId,
                  verificationStatus: t0VerificationStatus,
                  ...(t0AnswerVerification ? { answerVerification: t0AnswerVerification } : {}),
                  answerMode: "research",
                  verificationLevel: "evidence-required",
                  sourceCount: grounded.sourceCount,
                  researchProvider: grounded.provider,
                  conflictCount: grounded.conflicts,
                  ...(researchResult.grounding ? { searchGrounding: researchResult.grounding } : {}),
                  synthesisStatus: "citation-validated",
                  researchTier: "T0",
                  researchOutcome: "ANSWERED",
                  synthesisSourceCount: adoption.usedSourceIds.length,
                  ...(adoption.salvaged ? { synthesisSalvaged: true, synthesisSalvageRemovedUnits: adoption.removedUnits } : {}),
                  ...(retryOutcome.retried ? { synthesisRetried: true } : {}),
                  providerDataPolicy: synthesisResult.providerDataPolicy,
                  providerRouting: synthesisResult.routingEvidence,
                  usage: synthesisResult.usage,
                  providerAttempts: providerAttemptCount(synthesisResult),
                  ...(synthesisResult.attempts ? { providerRouteAttempts: synthesisResult.attempts } : {}),
                  requestedOutputs: researchRequestedOutputs,
                  supervisorMode: researchRequestedOutputs.length > 0 ? ORIGIN_SUPERVISOR_VERSION_V2 : "research-only",
                  supervisorStatus: supervisorArtifacts.status,
                  generatedOutputs: supervisorArtifacts.completedOutputs,
                  pendingOutputs: supervisorArtifacts.pendingOutputs,
                  ...(artifactFailureCode ? { artifactFailureCode } : {}),
                  downstreamDeliverablePending: supervisorArtifacts.pendingOutputs.length > 0 || Boolean(artifactFailureCode),
                },
              });
            }
            synthesisStatus = "citation-validation-failed";
            // The discard keeps the FIRST validation failure code (§3.7);
            // a salvage abort is recorded separately, counts and code only.
            synthesisFailureCode = adoption.failureCode;
            if (adoption.salvageAttempted) {
              console.warn("[origin-chat] research synthesis salvage aborted", {
                requestId,
                salvageAttempted: true,
                salvageRemovedUnits: adoption.salvageRemovedUnits,
                ...(adoption.salvageAbortCode ? { salvageAbortCode: adoption.salvageAbortCode } : {}),
                ...(adoption.remainingUncitedUnits !== undefined ? { remainingUncitedUnits: adoption.remainingUncitedUnits } : {}),
              });
            }
            // Discard diagnostics (counts only): how many factual units the
            // synthesis had, how many were uncited, and whether the uncited
            // ones were source-list-like lines rather than body sentences.
            // After a feedback retry, the retry outcome is recorded too —
            // its failure code, the retry text's unit counts, or the reason
            // an eligible retry did not fire — plus the initial dispatch
            // duration, so the retry time gate can be calibrated later
            // (SYNTHESIS_RETRY_DESIGN_2026-11-14 §2.6).
            const unitDiagnostics = diagnoseGroundedResearchSynthesisUnits(initialSynthesisResult.text);
            console.warn("[origin-chat] research synthesis discarded", {
              requestId,
              code: adoption.failureCode,
              // Landing after this discard is the tier-T3 extractive
              // partial answer (N-1 §1.1).
              researchTier: "T3",
              researchOutcome: "PARTIAL",
              totalFactualUnits: unitDiagnostics.totalFactualUnits,
              citedUnits: unitDiagnostics.citedUnits,
              uncitedUnits: unitDiagnostics.uncitedUnits,
              uncitedUnitsWithUrlLike: unitDiagnostics.uncitedUnitsWithUrlLike,
              ...(initialSynthesisResult.attempts
                ? { synthesisInitialDurationMs: initialSynthesisResult.attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0) }
                : {}),
              ...(retryOutcome.retried
                ? {
                    synthesisRetryAttempted: true,
                    ...(retryOutcome.retryFailureCode ? { synthesisRetryFailureCode: retryOutcome.retryFailureCode } : {}),
                    ...(retryOutcome.retryError ? { synthesisRetryError: true } : {}),
                    ...(retryOutcome.retryUnitDiagnostics
                      ? {
                          retryTotalFactualUnits: retryOutcome.retryUnitDiagnostics.totalFactualUnits,
                          retryCitedUnits: retryOutcome.retryUnitDiagnostics.citedUnits,
                          retryUncitedUnits: retryOutcome.retryUnitDiagnostics.uncitedUnits,
                          retryUncitedUnitsWithUrlLike: retryOutcome.retryUnitDiagnostics.uncitedUnitsWithUrlLike,
                        }
                      : {}),
                  }
                : {}),
              ...(retryOutcome.retrySkipped
                ? { synthesisRetrySkipped: retryOutcome.retrySkipped, synthesisRetryElapsedMs: retryOutcome.elapsedMs }
                : {}),
            });
          } catch (error) {
            synthesisStatus = "provider-failed";
            synthesisFailureCode = error instanceof OriginProviderError ? error.code : "PROVIDER_INTERNAL_ERROR";
            // Observability (RESEARCH_FLOOR_DESIGN_2026-11-17 §3 R-0):
            // same failover-attempt summary as the records path above, so
            // a PROVIDER_RATE_LIMITED unavailability (failure type T-1)
            // can be attributed to the route that actually failed.
            console.warn("[origin-chat] research synthesis unavailable; source-list fallback retained", {
              requestId,
              code: synthesisFailureCode,
              researchTier: "T3",
              researchOutcome: "PARTIAL",
              ...(error instanceof OriginProviderError ? { failureDiagnostic: buildOriginProviderFailureDiagnostic(error) } : {}),
            });
          }
        } else {
          synthesisStatus = "plan-unavailable";
          synthesisFailureCode = synthesisPlan.code;
        }
      } else if (!researchSynthesis) {
        synthesisStatus = "disabled";
      }

      // PR-4, T3 site: reaching this assembly means the synthesis
      // was not adopted (an adopted answer returns earlier), so the
      // body would be the tier-T3 extractive partial answer. Try the
      // template over ALL kept sources — not the partial answer's
      // top-three slice, whose cap is what starved round 5's F-03 of
      // its current value (PR-2 correction).
      if (recoveryTemplateMode !== "off" && grounded.sourceCount > 0) {
        tryRecoveryTemplateAtSite("t3", grounded.sources);
      }
      // PR-5, T3 site: the partial answer below would list excerpts
      // from the kept sources; when the question names an entity
      // that appears in NONE of them, those excerpts are about
      // other things (round 5's I-01/I-02/I-03 listed foldable-phone
      // articles, a different benefit system, a different subway
      // line), and the conditional nonexistence statement replaces
      // the partial answer instead.
      if (recoveryRefusalMode !== "off" && grounded.sourceCount > 0 && !recoveryTemplate) {
        const entity = detectNamedEntity(lastUserMessage);
        if (entity) {
          adoptRecoveryConditional(
            "t3",
            "nonexistence",
            buildNonexistenceConditionalAnswer({
              question: lastUserMessage,
              entityName: entity,
              sources: grounded.sources,
              language: grounded.language,
            }),
          );
        }
      }
      const digestReason = recoveryTemplate
        ? (grounded.language === "en"
          ? "Answered directly with the latest published value confirmed across multiple independent sources, with the sources shown."
          : "複数の独立した出典で一致した直近の公表値を、出典を明示して直接回答しました。")
        : recoveryConditional
          ? recoveryConditional.kind === "nonexistence"
            ? (grounded.language === "en"
              ? "Public sources were checked, but none showed that the named entity exists, so the answer states conditionally that it appears not to exist."
              : "公表情報を確認しましたが、設問の実体の存在を示す出典が見つからなかったため、不存在と考えられる旨を条件付きで明示しました。")
            : (grounded.language === "en"
              ? "The outcome is not decided yet, so the answer states that no confirmed information exists."
              : "結果がまだ確定していない事柄のため、確定情報は存在しない旨を明示しました。")
          : synthesisStatus === "not-run"
            ? grounded.reason
            : grounded.language === "en"
              ? `${grounded.reason} AI synthesis was not adopted; the retrieved source list is shown instead.`
              : `${grounded.reason} AI統合は採用せず、取得した出典の一覧を表示しています。`;
      const digestLimitations = recoveryTemplate
        ? [grounded.language === "en"
          ? "The value shown is the latest published figure confirmed across multiple sources. Please check the official announcement for the definitive information."
          : "表示した値は、複数の出典で一致した直近の公表値です。確定の情報は公式の発表でご確認ください。"]
        : recoveryConditional
          ? [recoveryConditional.kind === "nonexistence"
            ? (grounded.language === "en"
              ? "The existence check covered the public sources that could be retrieved; a different name or spelling may not be found."
              : "存在の確認は、取得できた公開情報の範囲で行っています。名称や表記が異なると、見つけられない場合があります。")
            : (grounded.language === "en"
              ? "Please check the official announcement once the result is final."
              : "結果が確定した後は、公式の発表でご確認ください。")]
          : researchNeedsDownstreamDeliverable
          ? [...grounded.limitations, grounded.language === "en"
            ? "The requested downstream deliverable was not generated because the bounded synthesis stage was unavailable; only retrieved evidence is shown."
            : "要求された後段成果物は、範囲限定の統合ステージを利用できなかったため生成しておらず、取得済み証拠だけを表示しています。"]
          : grounded.limitations;
      const responseEvidence = recoveryTemplate
        ? recoveryTemplate.attempt.confirmingSources.map((source) => ({
            label: source.title,
            sourceUrl: source.url,
            evidenceLevel: "provided" as const,
            checks: {
              safeUrl: "passed" as const,
              content: "not-run" as const,
              freshness: "not-run" as const,
              claimSupport: "not-run" as const,
            },
          }))
        : recoveryConditional
          ? // A conditional answer (nonexistence / undetermined)
            // cites no source: listing the retrieved-but-unrelated
            // sources as its evidence would repeat the round-5
            // failure it exists to correct.
            []
          : grounded.evidence;
      // Terminal guarantee (N-1, CONSULT_ADOPTION_DESIGN_2026-11-17
      // §1.4): this return is the research path's final assembly, and it
      // structurally cannot emit an empty or shell-only body (failure
      // type T-8 / case F-12). The grounded body is the tier-T4 hold
      // text when no sources were usable and the tier-T3 extractive
      // partial answer otherwise — both substantive by construction —
      // and the guard replaces anything else with the tier-T4 hold text
      // and re-lands the outcome on ABSTAIN.
      const recoveryBody =
        recoveryTemplate?.content ??
        recoveryConditional?.content ??
        (recoveryProcedureConditional
          ? buildProcedureConditionalAnswer({ baseText: grounded.content, language: grounded.language })
          : grounded.content);
      const terminal = ensureGroundedResearchTerminalBody(recoveryBody, () =>
        buildGroundedResearchAbstainAnswer({ query: lastUserMessage, language: grounded.language, reason: "provider-error" }));
      // PR-5 empty-body post-guard (F-12): a second, explicit
      // defense behind the terminal guard — this final assembly
      // must not emit an empty body even if the guard's fallback
      // contract ever changes. Round 5's F-12 was an HTTP 200 with
      // an empty body; whatever layer produced it, this exit now
      // rebuilds the tier-T4 hold text instead of delivering
      // emptiness.
      let terminalContent = terminal.content;
      let terminalGuardFired = terminal.guardFired;
      if (!terminalContent.trim()) {
        terminalContent = buildGroundedResearchAbstainAnswer({ query: lastUserMessage, language: grounded.language, reason: "provider-error" });
        terminalGuardFired = true;
        console.warn("[origin-chat] research terminal post-guard fired", {
          requestId,
          sourceCount: grounded.sourceCount,
        });
      }
      const landing: OriginResearchLanding = terminalGuardFired
        ? researchLandingForAbstain("provider-error")
        : recoveryTemplate || recoveryConditional
          ? researchLandingForAdopted(false)
          : grounded.landing;
      if (terminalGuardFired) {
        console.warn("[origin-chat] research terminal guard fired", {
          requestId,
          synthesisStatus,
          ...(synthesisFailureCode ? { synthesisFailureCode } : {}),
          sourceCount: grounded.sourceCount,
        });
      }
      // Landing log (N-1 §1.2): one line per research request that ends
      // on the fallback assembly, carrying the tier and the three-valued
      // outcome (plus the abstain reason on ABSTAIN), so landings can be
      // aggregated alongside the R-0 attempt attribution.
      console.info("[origin-chat] research outcome", {
        requestId,
        researchTier: landing.tier,
        researchOutcome: landing.outcome,
        ...(landing.abstainReason ? { researchAbstainReason: landing.abstainReason } : {}),
        synthesisStatus,
        ...(synthesisFailureCode ? { synthesisFailureCode } : {}),
        sourceCount: grounded.sourceCount,
        ...(recoveryTemplate ? { recoveryTemplate: true } : {}),
        ...(recoveryConditional ? { recoveryRefusalKind: recoveryConditional.kind } : {}),
        ...(recoveryProcedureConditional ? { recoveryProcedureConditional: true } : {}),
      });
      // Answer verification (V-PR-2, shadow): the tier-T3 extractive
      // partial answer is a class-A target when it carries N-2b claim
      // sentences and a synthesis execution ran (the cross-route pair
      // is identified from that execution). Tier-T4 holds, templates
      // and conditional answers are deterministic texts and are never
      // verified. Shadow never changes the delivered text; only a
      // clean pass touches the envelope, as at the T0 return.
      let finalVerificationStatus: OriginAnswerVerificationStatus = "not-run";
      let finalVerificationSummary = digestReason;
      let finalAnswerVerification: Record<string, unknown> | null = null;
      if (resolveOriginAnswerVerificationEffectiveMode(env) === "shadow") {
        const hasClaimSentences = grounded.sourceCount > 0
          && buildGroundedResearchEvidenceCards(lastUserMessage, grounded.sources).cards.some((card) => card.claimSentences.length > 0);
        const verificationTarget = classifyResearchAnswerVerificationTarget({
          site: "final",
          tier: landing.tier,
          deterministicLanding: terminalGuardFired || Boolean(recoveryTemplate) || Boolean(recoveryConditional) || recoveryProcedureConditional,
          hasClaimSentences,
          hasGenerationResult: synthesisExecutionResult !== null,
        });
        if (verificationTarget.targeted && synthesisExecutionResult && synthesisExecutionPlan) {
          const verificationOutcome = await runOriginAnswerVerificationShadow({
            requestId,
            path: "research",
            answerClass: "A",
            question: lastUserMessage,
            answerText: terminalContent,
            sources: answerVerificationSources(grounded.sources),
            generationResult: synthesisExecutionResult,
            sourcePlan: synthesisExecutionPlan,
            language: grounded.language,
          }, { env, nowMs: now(), verify: options.answerVerification?.verify, readDailyNeuronsUsed: options.answerVerification?.readDailyNeuronsUsed });
          finalAnswerVerification = verificationOutcome.metadata;
          if (verificationOutcome.envelopeEffect === "pass") {
            finalVerificationStatus = "passed";
            finalVerificationSummary = grounded.language === "en"
              ? "A different AI checked the content of the claims taken from the sources."
              : "出典から取り出した主張について、別のAIが内容を確認しました。";
          }
        }
      }
      return res.json({
        content: terminalContent,
        supervisor: {
          version: ORIGIN_SUPERVISOR_VERSION_V2,
          status: researchRequestedOutputs.length > 0 ? "partial" : "not-required",
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          automaticProviderRetries: 0,
          steps: [
            {
              id: "research",
              status: grounded.sourceCount > 0 || recoveryTemplate || recoveryConditional ? "completed" : "blocked",
              evidenceCount: Math.max(grounded.sourceCount, recoveryTemplate?.attempt.confirmingSources.length ?? 0),
              provider: grounded.provider,
            },
            {
              id: "synthesis",
              status: synthesisStatus === "not-run" ? "not-required" : "blocked",
              ...(synthesisFailureCode ? { failureCode: synthesisFailureCode } : {}),
              providerAttempts: synthesisStatus === "provider-failed" ? 1 : 0,
            },
            {
              id: "artifact",
              status: researchNeedsDownstreamDeliverable ? "not-run" : "not-required",
              artifactCount: 0,
              completedOutputs: [],
              pendingOutputs: researchNeedsDownstreamDeliverable ? researchRequestedOutputs : [],
            },
          ],
        },
        answer: answerEnvelope(terminalContent, grounded.language, finalVerificationStatus, finalVerificationSummary, responseEvidence, digestLimitations, grounded.nextActions),
        routing: {
          ...applicationRouting(requestId, digestReason, finalVerificationStatus),
          ...(finalAnswerVerification ? { answerVerification: finalAnswerVerification } : {}),
          answerMode: "research",
          verificationLevel: "evidence-required",
          sourceCount: grounded.sourceCount,
          researchProvider: grounded.provider,
          conflictCount: grounded.conflicts,
          ...(researchResult.grounding ? { searchGrounding: researchResult.grounding } : {}),
          synthesisStatus,
          ...(synthesisFailureCode ? { synthesisFailureCode } : {}),
          researchTier: landing.tier,
          researchOutcome: landing.outcome,
          ...(landing.abstainReason ? { researchAbstainReason: landing.abstainReason } : {}),
          ...(recoveryTemplate ? { recoveryTemplate: true } : {}),
          ...(recoveryConditional?.kind === "nonexistence" ? { recoveryNonexistence: true } : {}),
          ...(recoveryConditional?.kind === "undetermined" ? { recoveryUndetermined: true } : {}),
          ...(recoveryProcedureConditional ? { recoveryProcedureConditional: true } : {}),
          requestedOutputs: researchRequestedOutputs,
          supervisorMode: researchRequestedOutputs.length > 0 ? "research-output-contract-v1" : "research-only",
          downstreamDeliverablePending: researchNeedsDownstreamDeliverable,
        },
      });
    }
    if (isOriginCapabilityQuestion(lastUserMessage)) {
      let rasterTextToImageReady = false;
      let rasterImageEditingReady = false;
      try {
        const rasterRuntime = await rasterProviderRuntimeStatusV15(env);
        rasterTextToImageReady = rasterRuntime.textToImageReady;
        rasterImageEditingReady = rasterRuntime.editingReady;
      } catch {
        rasterTextToImageReady = false;
        rasterImageEditingReady = false;
      }
      const guide = createOriginCapabilityGuide(lastUserMessage, { rasterTextToImageReady, rasterImageEditingReady });
      const reason = guide.language === "ja"
        ? "現在の公開版で利用できる機能と未接続機能を、実行時の画像生成・画像編集ready状態を含むORIGINの製品仕様に基づいて案内しました。"
        : "Explained current and unconnected capabilities from ORIGIN's product specification, including live raster generation/edit readiness.";
      return res.json({
        content: guide.content,
        answer: answerEnvelope(guide.content, guide.language, "not-required", reason, [], guide.limitations, guide.nextActions),
        routing: applicationRouting(requestId, reason),
      });
    }
    const planningResult = buildOriginExecutionPlan({ goal: lastUserMessage.trim(), requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(lastUserMessage), requiresFreshResearch: false, containsSecrets: false }, { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) }, originClientPolicy(body), { freeModelCatalog: options.freeModelCatalog, nowMs: catalogNow() });
    if (planningResult.ok === false) return res.status(planningResult.code === "INVALID_EXECUTION_POLICY" ? 400 : 503).json({ code: planningResult.code, message: planningResult.message, retryable: false, requestId });
    const startedAt = now();
    try {
      const requestIntent = classifyOriginRequestIntent(intentInput, planningResult.plan.taskType); const workPlan = buildOriginAgentWorkPlan(requestIntent); const resolvedPlan = resolveOriginAgentWorkPlan(workPlan); const reviewDecision = decideOriginReviewForMessage(planningResult.plan.taskType, lastUserMessage); const answerQualityPolicy = resolveOriginAnswerQualityPolicy({ intent: requestIntent, taskType: planningResult.plan.taskType, independentReviewRequired: reviewDecision.required, promptText: intentInput });
      const fullSystemInstruction = systemInstruction(requestIntent, workPlan, resolvedPlan, originAnswerQualityInstruction(answerQualityPolicy)) + "\n\n" + originCurrentDateInstruction(now(), /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en");
      const providerRequest: OriginProviderExecutionRequest = { plan: { ...planningResult.plan, timeoutMs: Math.min(planningResult.plan.timeoutMs, MAX_PROVIDER_ATTEMPT_TIMEOUT_MS) }, messages: contextResult.window.messages, systemInstruction: fullSystemInstruction, cloudflareSystemInstruction: originCloudflareRouteSystemInstruction(fullSystemInstruction), groqSystemInstruction: originGroqRouteSystemInstruction(answerQualityPolicy.businessPlanning) };
      let result = await execute(providerRequest); assertOriginZeroCostExecutionResultWithFailover(result, planningResult.plan.modelId);
      // Recovery build Stage 1, PR-5: refusal output validation
      // with ONE bounded re-execution (J-05: the round-5 direct path
      // ended in a one-line model refusal for a benign question with
      // a lawful framing). When the finished output is refusal-like
      // — a fixed refusal phrase that IS the answer — the request is
      // re-executed once with the design's fixed minimal instruction
      // attached; the retry's output replaces the original only when
      // it is not itself refusal-like, and a failed retry likewise
      // keeps the original, which then goes through the gates below
      // exactly as before (never worse). The compact route-3
      // instruction is deliberately left untouched (its character
      // budget is a hard contract); a route-3 retry is a fresh
      // generation under the unchanged compact instruction. Switch
      // ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE: off (default) does
      // nothing; shadow logs the detection only — no extra provider
      // call, the answer is delivered byte-identically; enforce runs
      // the single retry. The publication gate's hold (I-04's shape)
      // is a gate outcome, not a model refusal, and is out of scope
      // here by design.
      const directRefusalMode = resolveRecoveryRefusalValidationMode(env);
      if (directRefusalMode !== "off") {
        const directLanguage = /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en";
        const refusalAnalysis = analyzeRefusalLikeOutput(result.text, directLanguage);
        if (refusalAnalysis.isRefusal) {
          console.info("[origin-chat] recovery refusal validation", {
            requestId,
            recoveryRefusalSite: "direct",
            recoveryRefusalMode: directRefusalMode,
            recoveryRefusalKind: "direct-retry",
            recoveryRefusalTooShort: refusalAnalysis.signals.tooShort,
            recoveryRefusalLanguageMismatch: refusalAnalysis.signals.languageMismatch,
            recoveryRefusalFired: directRefusalMode === "enforce",
          });
          if (directRefusalMode === "enforce") {
            try {
              const retryResult = await execute({
                ...providerRequest,
                systemInstruction: `${providerRequest.systemInstruction}\n\n${RECOVERY_REFUSAL_RETRY_INSTRUCTION}`,
                cloudflareSystemInstruction: providerRequest.cloudflareSystemInstruction
                  ? `${providerRequest.cloudflareSystemInstruction}\n\n${RECOVERY_REFUSAL_RETRY_INSTRUCTION}`
                  : providerRequest.cloudflareSystemInstruction,
              });
              assertOriginZeroCostExecutionResultWithFailover(retryResult, planningResult.plan.modelId);
              if (!analyzeRefusalLikeOutput(retryResult.text, directLanguage).isRefusal) {
                result = retryResult;
                console.info("[origin-chat] recovery refusal retry adopted", { requestId });
              } else {
                console.info("[origin-chat] recovery refusal retry also refusal-like; original kept", { requestId });
              }
            } catch {
              console.warn("[origin-chat] recovery refusal retry failed; original kept", { requestId });
            }
          }
        }
      }
      // Output-side assertion gate (S-PR-1): this direct path carries no
      // search grounding for the request, so a current-form assertion
      // about a volatile fact in the finished text is replaced with the
      // honest could-not-confirm form before anything downstream (evidence
      // extraction, envelope, response body) can see the raw text.
      const assertionGate = applyOriginUngroundedAssertionGate(lastUserMessage, result.text, false);
      if (assertionGate.replaced) console.info("[origin-chat] ungrounded current assertion replaced", { requestId, reasonCode: "GATE_REPLACED" });
      // Numeric audit gate (stage 1 shadow / stage 2 enforcement):
      // planning/marketing answers are re-checked deterministically.
      // In shadow mode (the default) the outcome is only logged and the
      // gated text is delivered as-is; in enforce mode
      // (ORIGIN_BUSINESS_PLANNING_AUDIT_MODE=enforce) the gate returns
      // the text to deliver — deterministically corrected figures plus
      // a plain-language disclosure note for what could not be fixed.
      const auditGate = applyOriginBusinessPlanningAuditGate({
        requestId,
        profile: answerQualityPolicy.businessPlanning,
        answerText: assertionGate.text,
        requestText: lastUserMessage,
        env,
        now: new Date(now()),
        language: /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en",
      });
      // Date/weekday verification: deterministically check the
      // answer's date+weekday pairs and any relative-date (base ± N
      // days) result against the calendar. In shadow mode (the
      // default, ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE) the outcome is
      // only logged and the text below is delivered as assembled; in
      // enforce mode the gate returns the re-verified corrected text.
      const dateGate = applyOriginDateWeekdayVerificationGate({
        requestId,
        answerText: auditGate.answerText,
        requestText: lastUserMessage,
        env,
        now: new Date(now()),
      });
      const answerText = dateGate.answerText;
      // Publication gate (EXTERNAL_CONSULT_STALE_ADOPTION_2026-11-17
      // adoptions 1–2; enforcement connection N-5b): scan the final
      // direct answer — after the assertion gate, the numeric audit
      // gate and the date/weekday verification — for
      // evidence-required claim shapes and check its statute
      // names against the bundled e-Gov list. In shadow mode (the
      // default) this is log-only (kinds and counts, never text) and
      // the answer below is delivered exactly as assembled. In enforce
      // mode (ORIGIN_PUBLICATION_GATE_MODE=enforce) a firing answer is
      // not published: the delivered text is the tier-T4 hold and the
      // landing rides the routing metadata below. A detector failure
      // skips detection instead of delaying or breaking the answer.
      const publicationGate = applyOriginPublicationGate({
        requestId,
        answerText,
        query: lastUserMessage,
        language: /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en",
        env,
      });
      const deliverableText = publicationGate.answerText;
      // Answer verification (V-PR-2, shadow; design sections 3-5):
      // after every deterministic gate has settled the text, the OTHER
      // production route cross-checks the answer. Shadow never changes
      // the delivered text — its only user-visible effect is an honest
      // envelope: a clean pass may be reported as "passed", and when a
      // check was attempted for a review-required answer, the not-run
      // wording states what actually happened instead of the
      // pre-feature "no route available" reason. Mode off (the
      // default) skips this block entirely and reproduces the
      // behaviour around it exactly.
      let directAnswerVerification: Record<string, unknown> | null = null;
      let directVerificationEnvelope: { status: OriginAnswerVerificationStatus; summary: string; limitation: string | null } | null = null;
      if (resolveOriginAnswerVerificationEffectiveMode(env) === "shadow") {
        const publicationGateFired = publicationGate.summary !== null
          && (publicationGateFiringKinds(publicationGate.summary).length > 0
            || publicationGate.summary.counts["official-price"] > 0);
        const verificationTarget = classifyDirectAnswerVerificationTarget({
          reviewRequired: reviewDecision.required,
          publicationGateFired,
          publicationGateHeld: publicationGate.held,
        });
        if (verificationTarget.targeted) {
          const verificationOutcome = await runOriginAnswerVerificationShadow({
            requestId,
            path: "direct",
            answerClass: verificationTarget.answerClass,
            question: lastUserMessage,
            answerText: deliverableText,
            generationResult: result,
            sourcePlan: providerRequest.plan,
            language: /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en",
          }, { env, nowMs: now(), verify: options.answerVerification?.verify, readDailyNeuronsUsed: options.answerVerification?.readDailyNeuronsUsed });
          directAnswerVerification = verificationOutcome.metadata;
          if (verificationOutcome.envelopeEffect === "pass") {
            directVerificationEnvelope = {
              status: "passed",
              summary: /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage)
                ? "回答したAIとは別のAIが内容を確認しました。"
                : "A different AI from the one that wrote this answer checked its content.",
              limitation: null,
            };
          } else if (reviewDecision.required) {
            directVerificationEnvelope = {
              status: "not-run",
              summary: verificationOutcome.notRunSummary,
              limitation: verificationOutcome.notRunLimitation,
            };
          }
        }
      }
      // Intent premise guard (I5-PR1, shadow; design INTENT_I5_DESIGN
      // sections 3-4): deterministic post-generation checks over the
      // premise ledger derived from this request's messages — C-1
      // old-value reuse, C-2 stable-fact applied value, C-4
      // fabricated-citation form. Shadow only logs counts and never
      // alters the delivered text; mode off (the default) skips this
      // block entirely, so behaviour is exactly as before. Held
      // answers are gate templates, not model premises, so they are
      // not checked.
      if (
        resolveOriginIntentPremiseGuardEffectiveMode(env) === "shadow" &&
        !publicationGate.held
      ) {
        runOriginIntentPremiseGuardShadow({
          requestId,
          messages,
          answerText: deliverableText,
          nowMs: now(),
        });
      }
      const verificationStatus: OriginAnswerVerificationStatus = directVerificationEnvelope?.status ?? (reviewDecision.required ? "not-run" : "not-required"); const verificationReason = directVerificationEnvelope?.summary ?? (reviewDecision.required ? "独立確認が必要な依頼ですが、条件を満たす無料の別AIを利用できないため実施していません。" : "この依頼では、追加の独立確認を必須と判定していません。"); const limitations = reviewDecision.required && directVerificationEnvelope?.status !== "passed" ? [directVerificationEnvelope?.limitation ?? "独立した別AIによる確認を実施していないため、重要な判断にはそのまま使用しないでください。"] : []; const nextActions = reviewDecision.required && !directVerificationEnvelope ? ["条件を満たす無料の独立レビュー経路が利用可能になった後、再確認してください。"] : [];
      // Truncated answers (PKG-2): the answer ended at the output limit even
      // after the bounded continuation, so it is delivered as a partial
      // answer with the incompleteness stated plainly in the envelope
      // (limitations + a "continue" next action) instead of being discarded.
      // The wording names the fact without internal vocabulary (no token
      // counts), in the conversation's language, matching the client notice.
      const answerLanguage = /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en";
      // When the publication gate held the answer, the delivered text
      // is the complete hold text, not a truncated answer — the
      // incompleteness note below would be wrong for it.
      if (result.truncated === true && !publicationGate.held) {
        limitations.push(answerLanguage === "ja"
          ? "この回答は長さの上限に達したため、途中で終わっています（未完です）。続きが必要な場合は「続き」と送ってください。"
          : "This answer reached the length limit and ends partway through (it is incomplete). Send \"continue\" if you need the rest.");
        nextActions.push(answerLanguage === "ja" ? "「続き」と送ると、この回答の続きを依頼できます。" : "Send \"continue\" to ask for the rest of this answer.");
      }
      const evidence = extractProvidedOriginEvidence(deliverableText); const sourceEvidenceExpected = planningResult.plan.taskType === "research";
      if (evidence.length > 0) { limitations.push("表示した出典はAIが提示したもので、ORIGINによる内容確認はまだ実施していません。"); if (evidence.some((item) => item.claim === undefined)) limitations.push("一部の出典は、回答内のどの主張に対応するか明示されていません。"); nextActions.push("重要な判断の前に、出典リンクの内容と更新日を確認してください。"); } else if (sourceEvidenceExpected) { limitations.push("調査・最新情報に関する依頼ですが、回答内に確認可能なHTTPS出典が提示されていません。"); nextActions.push("一次情報の出典を確認してから判断してください。"); }
      console.info("[origin-chat] provider request completed", { requestId, durationMs: Math.max(0, now() - startedAt), servedModel: result.routingEvidence.servedModel, fallbackUsed: result.routingEvidence.fallbackUsed, routeAttempts: (result.attempts ?? []).map((attempt) => ({ providerId: attempt.providerId, outcome: attempt.outcome, ...(attempt.durationMs !== undefined ? { durationMs: attempt.durationMs } : {}) })), modelId: planningResult.plan.modelId, costEvidenceStatus: "NOT_MEASURED", truncated: result.truncated === true });
      return res.json({ content: deliverableText, answer: answerEnvelope(deliverableText, /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en", verificationStatus, verificationReason, evidence, limitations, nextActions), routing: { model: planningResult.plan.providerLabel, reason: planningResult.plan.reason, score: null, timeMs: Math.max(0, now() - startedAt), cost: result.actualCostUsd, providerId: planningResult.plan.providerId, modelId: planningResult.plan.modelId, taskType: planningResult.plan.taskType, actualCostUsd: result.actualCostUsd, costEvidenceStatus: "NOT_MEASURED", estimatedCostUsd: planningResult.plan.estimatedCostUsd, freeOnly: true, traceId: requestId, verificationStatus, verificationReason, reviewRequired: reviewDecision.required, reviewReasons: reviewDecision.reasons, answerMode: answerQualityPolicy.answerMode, verificationLevel: answerQualityPolicy.verificationLevel, modelEvidence: planningResult.plan.modelEvidence, providerDataPolicy: result.providerDataPolicy, providerRouting: result.routingEvidence, context: { policyVersion: contextResult.window.policyVersion, includedMessageCount: contextResult.window.includedMessageCount, includedCharacterCount: contextResult.window.includedCharacterCount, omittedMessageCount: contextResult.window.omittedMessageCount, omittedCharacterCount: contextResult.window.omittedCharacterCount }, usage: result.usage, providerAttempts: providerAttemptCount(result), ...(result.attempts ? { providerRouteAttempts: result.attempts } : {}), providerTransportRequests: result.transportRequestCount, ...(result.truncated === true ? { answerTruncated: true } : {}), ...(publicationGate.landing?.abstainReason ? { publicationGateMode: publicationGate.mode, publicationGateAction: "held", researchTier: publicationGate.landing.tier, researchOutcome: publicationGate.landing.outcome, researchAbstainReason: publicationGate.landing.abstainReason } : {}), ...(directAnswerVerification ? { answerVerification: directAnswerVerification } : {}) } });
    } catch (error) {
      if (error instanceof OriginProviderError) {
        const failureDiagnostic = buildOriginProviderFailureDiagnostic(error);
        // The diagnostic is serialized to a flat JSON string: platform log viewers
        // collapse nested objects ("[Object]"), which previously made the per-route
        // failover breakdown unrecoverable from production logs.
        console.warn("[origin-chat] provider request failed", { requestId, durationMs: Math.max(0, now() - startedAt), code: error.code, status: error.status, retryable: error.retryable, diagnostic: JSON.stringify(failureDiagnostic) });
        res.setHeader("Cache-Control", "no-store");
        return res.status(error.status).json({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          retryAfterSeconds: error.retryAfterSeconds,
          providerTransportRequests: error.diagnostic?.transportRequestCount,
          requestId,
          retryAttempted: false,
          diagnostic: failureDiagnostic,
        });
      }
      console.error("[origin-chat] unexpected provider failure", { requestId, durationMs: Math.max(0, now() - startedAt), errorName: "unexpected" });
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).json({ code: "PROVIDER_INTERNAL_ERROR", message: "無料AIとの通信に失敗しました。時間をおいて再度お試しください。", retryable: true, requestId, retryAttempted: false });
    }
  });
  return router;
}
