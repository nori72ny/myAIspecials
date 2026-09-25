import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { DEFAULT_ORIGIN_CONTEXT_POLICY, minimizeOriginContext, type OriginContextPolicy } from "../lib/orchestration/OriginContextPolicy.js";
import { buildOriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import type { OriginFreeModelEvidence } from "../lib/orchestration/OriginFreeModelCatalog.js";
import { decideOriginReviewForMessage } from "../lib/orchestration/OriginReviewPolicy.js";
import { classifyOriginRequestIntent, originIntentInputFromContext, type OriginRequestIntent } from "../lib/orchestration/OriginRequestIntent.js";
import { buildOriginAgentWorkPlan, type OriginAgentWorkPlan } from "../lib/orchestration/OriginAgentWorkPlan.js";
import { isOriginCapabilityQuestion } from "../lib/orchestration/OriginCapabilityGuide.js";
import { originAnswerQualityInstruction, resolveOriginAnswerQualityPolicy } from "../lib/orchestration/OriginAnswerQualityPolicy.js";
import { resolveOriginAgentWorkPlan, type OriginResolvedWorkPlan } from "../lib/orchestration/OriginServiceRegistry.js";
import { OriginProviderError, type OriginProviderExecutionRequest } from "./originProviderClient.js";
import { executeOriginProviderStream, type OriginProviderStreamExecutor } from "./originProviderStreamClient.js";
import { originChatSystemInstruction, requiresOriginGroundedResearch } from "./originChatResponsePolicy.js";
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

function requiresGroundedResearch(message: string): boolean { return requiresOriginGroundedResearch(message); }

function systemInstruction(
  intent?: OriginRequestIntent,
  workPlan?: OriginAgentWorkPlan,
  resolvedPlan?: OriginResolvedWorkPlan,
  qualityInstruction?: string,
): string {
  return originChatSystemInstruction(intent, workPlan, resolvedPlan, qualityInstruction);
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
      || requiresGroundedResearch(lastUserMessage)
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
      const intentInput = originIntentInputFromContext(contextResult.window.messages);
      const requestIntent = classifyOriginRequestIntent(intentInput, planningResult.plan.taskType);
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
