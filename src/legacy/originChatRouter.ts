import { Router } from "express";
import {
  createOriginAnswerEnvelope,
  type OriginAnswerEnvelope,
  type OriginAnswerEvidenceItem,
  type OriginAnswerVerificationStatus,
} from "../lib/orchestration/OriginAnswerEnvelope";
import { extractProvidedOriginEvidence } from "../lib/orchestration/OriginAnswerEvidence";
import {
  DEFAULT_ORIGIN_CONTEXT_POLICY,
  minimizeOriginContext,
  type OriginContextPolicy,
} from "../lib/orchestration/OriginContextPolicy";
import { buildOriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";
import type { OriginFreeModelEvidence } from "../lib/orchestration/OriginFreeModelCatalog";
import { decideOriginReviewForMessage } from "../lib/orchestration/OriginReviewPolicy";
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
- When a specific statement has a source, put the literal prefix "〔出典: [" after the statement, followed by the source label, "](", the source's actual public HTTPS URL, and ")〕" on the same line.
- Do not use that citation format when the source does not directly support the statement.
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
  evidence: readonly OriginAnswerEvidenceItem[] = [],
  limitations: readonly string[] = [],
  nextActions: readonly string[] = [],
): OriginAnswerEnvelope {
  const result = createOriginAnswerEnvelope({
    language,
    conclusion: firstAnswerBlock(content),
    answer: content,
    evidence,
    verification: {
      status: verificationStatus,
      independentReviewPerformed: verificationStatus === "passed",
      summary: verificationSummary,
    },
    limitations,
    nextActions,
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
      const reviewDecision = decideOriginReviewForMessage(
        planningResult.plan.taskType,
        lastUserMessage,
      );
      const verificationStatus: OriginAnswerVerificationStatus = reviewDecision.required
        ? "not-run"
        : "not-required";
      const verificationReason = reviewDecision.required
        ? "独立確認が必要な依頼ですが、条件を満たす無料の別AIを利用できないため実施していません。"
        : "この依頼では、追加の独立確認を必須と判定していません。";
      const limitations = reviewDecision.required
        ? ["独立した別AIによる確認を実施していないため、重要な判断にはそのまま使用しないでください。"]
        : [];
      const nextActions = reviewDecision.required
        ? ["条件を満たす無料の独立レビュー経路が利用可能になった後、再確認してください。"]
        : [];
      const evidence = extractProvidedOriginEvidence(result.text);
      const sourceEvidenceExpected = planningResult.plan.taskType === "research"
        || planningResult.plan.taskType === "current-information";
      if (evidence.length > 0) {
        limitations.push("表示した出典はAIが提示したもので、ORIGINによる内容確認はまだ実施していません。");
        if (evidence.some((item) => item.claim === undefined)) {
          limitations.push("一部の出典は、回答内のどの主張に対応するか明示されていません。");
        }
        nextActions.push("重要な判断の前に、出典リンクの内容と更新日を確認してください。");
      } else if (sourceEvidenceExpected) {
        limitations.push("調査・最新情報に関する依頼ですが、回答内に確認可能なHTTPS出典が提示されていません。");
        nextActions.push("一次情報の出典を確認してから判断してください。");
      }
      return res.json({
        content: result.text,
        answer: answerEnvelope(
          result.text,
          /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en",
          verificationStatus,
          verificationReason,
          evidence,
          limitations,
          nextActions,
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
          verificationStatus,
          verificationReason,
          reviewRequired: reviewDecision.required,
          reviewReasons: reviewDecision.reasons,
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
