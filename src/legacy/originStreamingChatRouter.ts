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
import { buildOriginProviderFailureDiagnostic, OriginProviderError, type OriginProviderExecutionRequest } from "./originProviderClient.js";
import { type OriginProviderStreamExecutor } from "./originProviderStreamClient.js";
import { executeOriginProviderStreamWithFailover } from "./originProviderFailover.js";
import { originChatSystemInstruction, originGroqRouteSystemInstruction, requiresOriginGroundedResearch } from "./originChatResponsePolicy.js";
import {
  buildProposalDeckChatArtifact,
  isProposalDeckChatRequest,
  PROPOSAL_DECK_FAILURE_NOTE,
  PROPOSAL_DECK_SKELETON_INSTRUCTION,
} from "./originProposalDeckChat.js";
import type { OriginSupervisorArtifactPayloadV2 } from "../lib/orchestration/OriginSupervisorV2.js";
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
    diagnostic: buildOriginProviderFailureDiagnostic(error),
  });
}

export function createOriginStreamingChatRouter(options: OriginStreamingChatRouterOptions = {}) {
  const router = Router();
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const catalogNow = options.catalogNow ?? Date.now;
  const contextPolicy = options.contextPolicy ?? DEFAULT_ORIGIN_CONTEXT_POLICY;
  const createRequestId = options.createRequestId ?? (() => `origin-stream-${now()}-${randomUUID()}`);
  const streamExecute = options.streamExecute ?? ((request, handlers) => executeOriginProviderStreamWithFailover(request, handlers, env));

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
      // PR-3a: proposal/presentation requests additionally carry the fixed
      // deck skeleton in the (routes 1-2) system instruction so the single
      // ordinary generation can be converted into a deck afterwards. The
      // compact Groq instruction is deliberately left untouched (its
      // 2,000-3,000 character budget is a hard contract); a route-3 answer
      // simply will not match the skeleton and produces no file.
      const deckRequested = isProposalDeckChatRequest(requestIntent, intentInput);
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
        ) + (deckRequested ? `\n\n${PROPOSAL_DECK_SKELETON_INSTRUCTION}` : ""),
        groqSystemInstruction: originGroqRouteSystemInstruction(),
        // Progressive display for responses that need no verification: the
        // upstream executor forwards each fragment as it is generated (after
        // that fragment's own routing/billing checks), so the first characters
        // appear within seconds instead of after the full generation. Requests
        // the review policy flags keep the original behavior — no text is
        // released until the stream terminates and every check has passed.
        // Admission is unchanged either way: the client still accepts the
        // answer only on the verified completion event below.
        streamRelease: reviewDecision.required ? "hold-until-verified" : "incremental",
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
            res.setHeader("X-Origin-Cost-Evidence", "NOT_MEASURED");
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
      // A truncated result (PKG-2) is a completed exchange with an incomplete
      // answer: the log records the fact so the measurement track (PKG-9) can
      // count truncation rates, and the completion event carries the flag so
      // the client keeps the displayed partial text and appends the explicit
      // incomplete notice instead of treating the answer as finished.
      // PR-3a: for a proposal-deck request, convert the finished answer into
      // a PPTX artifact deterministically (skeleton parse → build → self-check
      // → render; no extra model call, $0). On any failure no file is attached
      // and a short note rides as a final delta instead, so the user can tell
      // the file was not produced. The artifact payload matches the
      // Supervisor/parseOriginArtifacts contract verbatim and is added as the
      // last key of the completion event; non-deck completions stay
      // byte-identical to before.
      let deckArtifact: OriginSupervisorArtifactPayloadV2 | undefined;
      let deckFailureCode: string | undefined;
      let deckViolationCodes: readonly string[] | undefined;
      if (deckRequested) {
        const outcome = buildProposalDeckChatArtifact(result.text);
        if (outcome.status === "created") {
          deckArtifact = outcome.artifact;
        } else {
          deckFailureCode = outcome.failureCode;
          deckViolationCodes = outcome.violationCodes;
        }
      }
      console.info("[origin-chat] upstream stream completed", {
        requestId,
        durationMs: Math.max(0, now() - startedAt),
        modelId: planningResult.plan.modelId,
        costEvidenceStatus: "NOT_MEASURED",
        providerDeltaCount,
        truncated: result.truncated === true,
        proposalDeck: deckRequested ? (deckArtifact ? "created" : "failed") : "not-requested",
        ...(deckFailureCode ? { proposalDeckFailureCode: deckFailureCode } : {}),
        ...(deckViolationCodes ? { proposalDeckViolationCodes: deckViolationCodes } : {}),
      });
      if (deckRequested && !deckArtifact) {
        res.write(`data: ${JSON.stringify({ type: "delta", text: PROPOSAL_DECK_FAILURE_NOTE })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({
        type: "complete",
        modelId: planningResult.plan.modelId,
        servedModel: result.routingEvidence.servedModel,
        costEvidenceStatus: "NOT_MEASURED",
        fallbackUsed: result.routingEvidence.fallbackUsed,
        ...(result.truncated === true ? { truncated: true } : {}),
        ...(deckArtifact ? { artifacts: [deckArtifact] } : {}),
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
        diagnostic: JSON.stringify(buildOriginProviderFailureDiagnostic(safeError)),
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
