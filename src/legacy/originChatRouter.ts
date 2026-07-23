import { Router } from "express";
import {
  createOriginAnswerEnvelope,
  type OriginAnswerEnvelope,
  type OriginAnswerVerificationStatus,
} from "../lib/orchestration/OriginAnswerEnvelope";
import {
  DEFAULT_ORIGIN_CONTEXT_POLICY,
  minimizeOriginContext,
  type OriginContextPolicy,
} from "../lib/orchestration/OriginContextPolicy";
import { buildOriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";
import type { OriginFreeModelEvidence } from "../lib/orchestration/OriginFreeModelCatalog";
import {
  executeOriginProvider,
  OriginProviderError,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient";
import {
  detectSensitiveConversation,
  hasOriginWeatherLocation,
  isOriginWeatherRequest,
  originClientPolicy,
  type OriginChatBody,
  validateOriginChatMessages,
} from "./originChatValidation";

export type OriginChatExecutor = (
  request: OriginProviderExecutionRequest,
) => Promise<OriginProviderExecutionResult>;

export interface OriginChatRouterOptions {
  env?: NodeJS.ProcessEnv;
  execute?: OriginChatExecutor;
  now?: () => number;
  catalogNow?: () => number;
  freeModelCatalog?: readonly OriginFreeModelEvidence[];
  contextPolicy?: OriginContextPolicy;
  createRequestId?: () => string;
}

function systemInstruction(): string {
  return `You are ORIGIN Personal AI.
- Reply in the language used by the user.
- Do not invent current facts or claim access to tools, files, accounts, websites, or services that were not supplied.
- State uncertainty and missing evidence clearly.
- Do not claim that code was merged, deployed, purchased, configured, or changed without execution evidence.
- Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys.
- Give the conclusion first, followed by the minimum useful explanation and next action.`;
}

function applicationRouting(requestId: string, reason: string) {
  return {
    model: "ORIGIN アプリ内処理",
    reason,
    score: null,
    timeMs: 0,
    cost: 0,
    actualCostUsd: 0,
    estimatedCostUsd: 0,
    freeOnly: true,
    traceId: requestId,
    verificationStatus: "not-required",
  };
}

function firstAnswerBlock(content: string): string {
  const firstBlock = content
    .split(/\n\s*\n|\n/)
    .map((part) => part.trim())
    .find(Boolean) ?? content.trim();
  const withoutHeading = firstBlock.replace(/^#{1,6}\s+/, "").trim();
  if (withoutHeading.length <= 500) return withoutHeading;

  const candidate = withoutHeading.slice(0, 500);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf("。") + 1,
    candidate.lastIndexOf("！") + 1,
    candidate.lastIndexOf("？") + 1,
    candidate.lastIndexOf(". ") + 1,
  );
  return sentenceEnd >= 40 ? candidate.slice(0, sentenceEnd).trim() : `${candidate.slice(0, 499).trimEnd()}…`;
}

function answerEnvelope(
  content: string,
  language: "ja" | "en",
  verificationStatus: OriginAnswerVerificationStatus,
  verificationSummary: string,
): OriginAnswerEnvelope {
  const result = createOriginAnswerEnvelope({
    language,
    conclusion: firstAnswerBlock(content),
    answer: content,
    evidence: [],
    verification: {
      status: verificationStatus,
      independentReviewPerformed: verificationStatus === "passed",
      summary: verificationSummary,
    },
    limitations: [],
    nextActions: [],
  });

  if (result.ok === false) throw new Error(result.code);
  return result.value;
}

export function createOriginChatRouter(options: OriginChatRouterOptions = {}) {
  const router = Router();
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const catalogNow = options.catalogNow ?? Date.now;
  const contextPolicy = options.contextPolicy ?? DEFAULT_ORIGIN_CONTEXT_POLICY;
  const createRequestId = options.createRequestId
    ?? (() => `origin-${now()}-${Math.random().toString(36).slice(2, 8)}`);
  const execute = options.execute
    ?? ((request: OriginProviderExecutionRequest) => executeOriginProvider(request, env));

  router.post("/api/chat", async (req, res) => {
    const requestId = createRequestId();
    const body = (req.body ?? {}) as OriginChatBody;
    const messages = validateOriginChatMessages(body.messages);

    if (!messages) {
      return res.status(400).json({
        code: "INVALID_CHAT_MESSAGES",
        message: "チャットメッセージの形式が正しくありません。",
        retryable: false,
        requestId,
      });
    }

    if (messages[messages.length - 1].role !== "user") {
      return res.status(400).json({
        code: "INVALID_CHAT_MESSAGES",
        message: "最後のメッセージはユーザーからのものである必要があります。",
        retryable: false,
        requestId,
      });
    }

    const lastUserMessage = messages[messages.length - 1].content;
    if (isOriginWeatherRequest(lastUserMessage)) {
      const isEnglish = /[a-zA-Z]/.test(lastUserMessage);
      if (!hasOriginWeatherLocation(lastUserMessage, body.userLocation)) {
        const content = isEnglish
          ? "Which location would you like to know the weather for?"
          : "どの地域の天気をお調べしますか？";
        const reason = "地域確認のため外部AIを呼びませんでした。";
        return res.json({
          content,
          answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-required", reason),
          routing: applicationRouting(requestId, reason),
        });
      }
      const content = isEnglish
        ? "Currently, no service is connected to retrieve the latest weather information."
        : "現在、最新の天気情報を取得するサービスが接続されていません。";
      const reason = "最新データ取得サービスが未接続のため推測を実行しませんでした。";
      return res.json({
        content,
        answer: answerEnvelope(content, isEnglish ? "en" : "ja", "not-required", reason),
        routing: applicationRouting(requestId, reason),
      });
    }

    const sensitiveKinds = detectSensitiveConversation(messages);
    if (sensitiveKinds.length > 0) {
      return res.status(422).json({
        code: "SENSITIVE_INPUT_BLOCKED",
        messageKey: "errors.sensitiveInputBlocked",
        message: "秘密情報の可能性がある内容を検出したため、外部AIへの送信を停止しました。値を削除し、必要な内容だけを要約して再入力してください。",
        retryable: false,
        requestId,
        sensitiveKinds,
      });
    }

    const contextResult = minimizeOriginContext(messages, contextPolicy);
    if (contextResult.ok === false) {
      return res.status(contextResult.code === "LATEST_MESSAGE_TOO_LARGE" ? 413 : 500).json({
        code: contextResult.code,
        message: contextResult.message,
        retryable: false,
        requestId,
      });
    }

    const planningResult = buildOriginExecutionPlan(
      {
        goal: lastUserMessage.trim(),
        requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(lastUserMessage),
        requiresFreshResearch: /最新|調査|料金|current|research/i.test(lastUserMessage),
        containsSecrets: false,
      },
      { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) },
      originClientPolicy(body),
      {
        freeModelCatalog: options.freeModelCatalog,
        nowMs: catalogNow(),
      },
    );

    if (planningResult.ok === false) {
      return res.status(planningResult.code === "INVALID_EXECUTION_POLICY" ? 400 : 503).json({
        code: planningResult.code,
        message: planningResult.message,
        retryable: false,
        requestId,
      });
    }

    const startedAt = now();
    try {
      const result = await execute({
        plan: planningResult.plan,
        messages: contextResult.window.messages,
        systemInstruction: systemInstruction(),
      });
      const verificationReason = "Phase 1では独立検証と統合をまだ実行していません。";
      return res.json({
        content: result.text,
        answer: answerEnvelope(
          result.text,
          /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en",
          "not-run",
          verificationReason,
        ),
        routing: {
          model: planningResult.plan.providerLabel,
          reason: planningResult.plan.reason,
          score: null,
          timeMs: Math.max(0, now() - startedAt),
          cost: result.actualCostUsd,
          providerId: planningResult.plan.providerId,
          modelId: planningResult.plan.modelId,
          taskType: planningResult.plan.taskType,
          actualCostUsd: result.actualCostUsd,
          estimatedCostUsd: planningResult.plan.estimatedCostUsd,
          freeOnly: true,
          traceId: requestId,
          verificationStatus: "not-run",
          verificationReason,
          modelEvidence: planningResult.plan.modelEvidence,
          providerDataPolicy: result.providerDataPolicy,
          providerRouting: result.routingEvidence,
          context: {
            policyVersion: contextResult.window.policyVersion,
            includedMessageCount: contextResult.window.includedMessageCount,
            includedCharacterCount: contextResult.window.includedCharacterCount,
            omittedMessageCount: contextResult.window.omittedMessageCount,
            omittedCharacterCount: contextResult.window.omittedCharacterCount,
          },
          usage: result.usage,
        },
      });
    } catch (error) {
      if (error instanceof OriginProviderError) {
        return res.status(error.status).json({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          requestId,
        });
      }
      return res.status(500).json({
        code: "PROVIDER_INTERNAL_ERROR",
        message: "無料AIとの通信に失敗しました。",
        retryable: true,
        requestId,
      });
    }
  });

  return router;
}
