import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { DEFAULT_ORIGIN_CONTEXT_POLICY, minimizeOriginContext, type OriginContextPolicy } from "../lib/orchestration/OriginContextPolicy.js";
import { buildOriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import type { OriginFreeModelEvidence } from "../lib/orchestration/OriginFreeModelCatalog.js";
import { decideOriginReviewForMessage } from "../lib/orchestration/OriginReviewPolicy.js";
import { classifyOriginRequestIntent, originRequestIntentInstruction, type OriginRequestIntent } from "../lib/orchestration/OriginRequestIntent.js";
import { buildOriginAgentWorkPlan, originAgentWorkPlanInstruction, type OriginAgentWorkPlan } from "../lib/orchestration/OriginAgentWorkPlan.js";
import { isOriginCapabilityQuestion } from "../lib/orchestration/OriginCapabilityGuide.js";
import { originAnswerQualityInstruction, resolveOriginAnswerQualityPolicy } from "../lib/orchestration/OriginAnswerQualityPolicy.js";
import { originServiceAssignmentInstruction, resolveOriginAgentWorkPlan, type OriginResolvedWorkPlan } from "../lib/orchestration/OriginServiceRegistry.js";
import { OriginProviderError, type OriginProviderExecutionRequest } from "./originProviderClient.js";
import { executeOriginProviderStream, type OriginProviderStreamExecutor } from "./originProviderStreamClient.js";
import {
  detectSensitiveConversation,
  isOriginWeatherRequest,
  originClientPolicy,
  type OriginChatBody,
  validateOriginChatMessages,
} from "./originChatValidation.js";

export interface OriginStreamingChatRouterOptions {
  env?: NodeJS.ProcessEnv;
  streamExecute?: OriginProviderStreamExecutor;
  now?: () => number;
  catalogNow?: () => number;
  freeModelCatalog?: readonly OriginFreeModelEvidence[];
  contextPolicy?: OriginContextPolicy;
  createRequestId?: () => string;
}

const MAX_PROVIDER_ATTEMPT_TIMEOUT_MS = 52_000;

function requiresFutureReleaseInformation(message: string): boolean {
  return /(?:今後|これから|次に).{0,18}(?:登場|出てくる|発売|公開|リリース|提供開始|予定)|(?:登場|発売|公開|リリース|提供開始)予定|次世代.{0,12}(?:AI|モデル)/.test(message)
    || /\b(?:upcoming|forthcoming)\s+(?:AI|models?|releases?)\b/i.test(message)
    || /\b(?:future|next[- ]generation)\s+(?:AI|models?)\b/i.test(message);
}

function requiresCurrentInformation(message: string): boolean {
  return requiresFutureReleaseInformation(message)
    || /最新(?:の)?(?:情報|ニュース|料金|価格|株価|相場|仕様|バージョン|モデル|状況|結果)|今日の(?:ニュース|天気|料金|価格|株価|相場|結果)|現在の(?:ニュース|天気|料金|価格|株価|相場|仕様|バージョン|状況)|料金|価格|リアルタイム/.test(message)
    || /\b(?:news|pricing|prices?|weather|real[- ]time)\b/i.test(message)
    || /\b(?:latest|current|today'?s?)\s+(?:information|news|weather|pricing|prices?|rates?|status|results?|version|model)\b/i.test(message);
}

function systemInstruction(
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
- Follow explicit user constraints over generic helpfulness. For rewriting, summarization, or formatting, preserve the supplied meaning and do not add urgency, importance, actions, owners, deadlines, channels, or other facts that were not provided.
- When the user asks only for a transformed deliverable, return that deliverable without extra analysis unless they explicitly request commentary.
- Produce requested content now. Ask one concise question only when a missing fact would materially change the result; otherwise state minimal assumptions.
- For explanatory or comparison answers, make the opening block a one-to-three sentence bottom line, followed by three to five prioritized key points.
- Write for a phone screen: use short descriptive headings, one idea per paragraph, and compact bullet lists. Do not use a Markdown table unless the user explicitly asks for a table.
- Use at most six main sections. Remove duplicated headings, repeated claims, generic filler, and repeated summaries.
- Prefer specific recommendations, examples, and ready-to-use wording over generic advice.
- Silently draft, challenge factual support and omissions, then edit for priority, clarity, and completeness. Output only the final answer.
- Fit the answer within the available output budget. Never restart the answer, repeat an earlier section, or end with a fragment.
- Do not invent current or future facts, model names, release dates, or roadmaps, and do not claim access to unprovided tools, files, accounts, websites, or services.
- Separate confirmed facts from assumptions, inferences, and recommendations.
- Do not claim code, deployment, purchase, configuration, search, file creation, specialist review, or other execution without evidence.
- Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys.
- For consequential decisions, state what the user must independently confirm before acting.${requestGuidance}${workPlanGuidance}${assignmentGuidance}${qualityGuidance}`;
}

function wantsUpstreamStreaming(req: Request): boolean {
  return String(req.headers.accept ?? "").toLowerCase().includes("text/event-stream");
}

function sendSafeProviderFailure(res: Response, error: OriginProviderError, requestId: string) {
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

export function createOriginStreamingChatRouter(options: OriginStreamingChatRouterOptions = {}) {
  const router = Router();
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const catalogNow = options.catalogNow ?? Date.now;
  const contextPolicy = options.contextPolicy ?? DEFAULT_ORIGIN_CONTEXT_POLICY;
  const createRequestId = options.createRequestId ?? (() => `origin-stream-${now()}-${randomUUID()}`);
  const streamExecute = options.streamExecute ?? ((request, handlers) => executeOriginProviderStream(request, handlers, env));

  router.post("/api/chat", async (req, res, next: NextFunction) => {
    if (!wantsUpstreamStreaming(req)) return next();

    const body = (req.body ?? {}) as OriginChatBody;
    const messages = validateOriginChatMessages(body.messages);
    if (!messages || messages.at(-1)?.role !== "user") return next();

    const lastUserMessage = messages.at(-1)?.content ?? "";
    if (isOriginWeatherRequest(lastUserMessage)
      || isOriginCapabilityQuestion(lastUserMessage)
      || requiresCurrentInformation(lastUserMessage)
      || detectSensitiveConversation(messages).length > 0) {
      return next();
    }

    const contextResult = minimizeOriginContext(messages, contextPolicy);
    if (contextResult.ok === false) return next();

    const planningResult = buildOriginExecutionPlan(
      {
        goal: lastUserMessage.trim(),
        requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(lastUserMessage),
        requiresFreshResearch: false,
        containsSecrets: false,
      },
      { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) },
      originClientPolicy(body),
      { freeModelCatalog: options.freeModelCatalog, nowMs: catalogNow() },
    );
    if (planningResult.ok === false) return next();

    const requestId = createRequestId();
    const startedAt = now();
    let downstreamStarted = false;
    let providerDeltaCount = 0;

    try {
      const requestIntent = classifyOriginRequestIntent(lastUserMessage, planningResult.plan.taskType);
      const workPlan = buildOriginAgentWorkPlan(requestIntent);
      const resolvedPlan = resolveOriginAgentWorkPlan(workPlan);
      const reviewDecision = decideOriginReviewForMessage(planningResult.plan.taskType, lastUserMessage);
      const answerQualityPolicy = resolveOriginAnswerQualityPolicy({
        intent: requestIntent,
        taskType: planningResult.plan.taskType,
        independentReviewRequired: reviewDecision.required,
      });
      const providerRequest: OriginProviderExecutionRequest = {
        plan: {
          ...planningResult.plan,
          timeoutMs: Math.min(planningResult.plan.timeoutMs, MAX_PROVIDER_ATTEMPT_TIMEOUT_MS),
        },
        messages: contextResult.window.messages,
        systemInstruction: systemInstruction(
          requestIntent,
          workPlan,
          resolvedPlan,
          originAnswerQualityInstruction(answerQualityPolicy),
        ),
      };

      const result = await streamExecute(providerRequest, {
        onDelta: (delta) => {
          if (!delta) return;
          if (!downstreamStarted) {
            downstreamStarted = true;
            res.status(200);
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-store, no-transform");
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("X-Origin-Free-Only", "true");
            res.setHeader("X-Origin-Cost-Usd", "0");
            res.setHeader("X-Origin-Billing-Tier", "free");
            res.setHeader("X-Origin-Model-Id", planningResult.plan.modelId);
            res.setHeader("X-Origin-Stream-Source", "upstream");
            res.setHeader("X-Origin-Stream-Protocol", "origin-verified-sse-v1");
            res.flushHeaders?.();
          }
          providerDeltaCount += 1;
          res.write(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`);
        },
      });

      if (!downstreamStarted || !result.text.trim()) {
        throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true);
      }
      console.info("[origin-chat] upstream stream completed", {
        requestId,
        durationMs: Math.max(0, now() - startedAt),
        modelId: planningResult.plan.modelId,
        costUsd: result.actualCostUsd,
        providerDeltaCount,
      });
      res.write(`data: ${JSON.stringify({
        type: "complete",
        modelId: planningResult.plan.modelId,
        servedModel: result.routingEvidence.servedModel,
        costUsd: result.actualCostUsd,
        fallbackUsed: result.routingEvidence.fallbackUsed,
      })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    } catch (error) {
      const safeError = error instanceof OriginProviderError
        ? error
        : new OriginProviderError("PROVIDER_INTERNAL_ERROR", "無料AIとの通信に失敗しました。", 503, true);
      console.warn("[origin-chat] upstream stream failed", {
        requestId,
        durationMs: Math.max(0, now() - startedAt),
        code: safeError.code,
        status: safeError.status,
        retryable: safeError.retryable,
        diagnostic: safeError.diagnostic,
        downstreamStarted,
        providerDeltaCount,
      });
      if (!downstreamStarted && !res.headersSent) return sendSafeProviderFailure(res, safeError, requestId);
      res.end(`data: ${JSON.stringify({ type: "error" })}\n\n`);
      return;
    }
  });

  return router;
}
