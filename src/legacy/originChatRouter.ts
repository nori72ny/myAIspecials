import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  createOriginAnswerEnvelope,
  type OriginAnswerEnvelope,
  type OriginAnswerEvidenceItem,
  type OriginAnswerVerificationStatus,
} from "../lib/orchestration/OriginAnswerEnvelope.js";
import { extractProvidedOriginEvidence } from "../lib/orchestration/OriginAnswerEvidence.js";
import {
  DEFAULT_ORIGIN_CONTEXT_POLICY,
  minimizeOriginContext,
  type OriginContextPolicy,
} from "../lib/orchestration/OriginContextPolicy.js";
import { buildOriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import type { OriginFreeModelEvidence } from "../lib/orchestration/OriginFreeModelCatalog.js";
import { decideOriginReviewForMessage } from "../lib/orchestration/OriginReviewPolicy.js";
import {
  classifyOriginRequestIntent,
  originRequestIntentInstruction,
  type OriginRequestIntent,
} from "../lib/orchestration/OriginRequestIntent.js";
import {
  buildOriginAgentWorkPlan,
  originAgentWorkPlanInstruction,
  type OriginAgentWorkPlan,
} from "../lib/orchestration/OriginAgentWorkPlan.js";
import {
  createOriginCapabilityGuide,
  isOriginCapabilityQuestion,
} from "../lib/orchestration/OriginCapabilityGuide.js";
import {
  originServiceAssignmentInstruction,
  resolveOriginAgentWorkPlan,
  type OriginResolvedWorkPlan,
} from "../lib/orchestration/OriginServiceRegistry.js";
import {
  executeOriginProvider,
  OriginProviderError,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient.js";
import {
  detectSensitiveConversation,
  hasOriginWeatherLocation,
  isOriginWeatherRequest,
  originClientPolicy,
  type OriginChatBody,
  validateOriginChatMessages,
} from "./originChatValidation.js";

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

function systemInstruction(
  intent?: OriginRequestIntent,
  workPlan?: OriginAgentWorkPlan,
  resolvedPlan?: OriginResolvedWorkPlan,
): string {
  const requestGuidance = intent ? `\n\n${originRequestIntentInstruction(intent)}` : "";
  const workPlanGuidance = workPlan ? `\n\n${originAgentWorkPlanInstruction(workPlan)}` : "";
  const assignmentGuidance = resolvedPlan
    ? `\n\n${originServiceAssignmentInstruction(resolvedPlan)}`
    : "";
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
- Before sending, silently check goal fit, factual support, completeness, internal consistency, mobile readability, usability, and unnecessary repetition.
- Do not invent current or future facts, model names, release dates, or roadmaps, and do not claim access to unprovided tools, files, accounts, websites, or services.
- Separate confirmed facts, user-provided claims, assumptions, inferences, and recommendations with explicit labels when they could be confused. State meaningful uncertainty.
- Do not claim code, deployment, purchase, configuration, search, file creation, specialist review, or other execution without evidence.
- Never request, reproduce, or expose credentials, API keys, tokens, passwords, or private keys.
- When a specific statement has a source, put the literal prefix "〔出典: [" after the statement, followed by the source label, "](", the source's actual public HTTPS URL, and ")〕" on the same line.
- Do not use that citation format when the source does not directly support the statement.
- For consequential decisions, state what the user must independently confirm before acting.${requestGuidance}${workPlanGuidance}${assignmentGuidance}`;
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

function requiresFutureReleaseInformation(message: string): boolean {
  return /(?:今後|これから|次に).{0,18}(?:登場|出てくる|発売|公開|リリース|提供開始|予定)|(?:登場|発売|公開|リリース|提供開始)予定|次世代.{0,12}(?:AI|モデル)/.test(message)
    || /\b(?:upcoming|forthcoming)\s+(?:AI|models?|releases?)\b/i.test(message)
    || /\b(?:future|next[- ]generation)\s+(?:AI|models?)\b/i.test(message);
}

function requiresCurrentInformation(message: string): boolean {
  return requiresFutureReleaseInformation(message)
    || /最新(?:の)?(?:情報|ニュース|料金|価格|株価|相場|仕様|バージョン|モデル|状況|結果)|今日の(?:ニュース|天気|料金|価格|株価|相場|結果)|現在の(?:ニュース|天気|料金|価格|株価|相場|仕様|バージョン|状況)|料金|価格|リアルタイム/.test(message)
    || /\b(?:news|pricing|prices?|weather|real[- ]time)\b/i.test(message)
    || /\b(?:latest|current|today'?s?)\s+(?:information|news|weather|pricing|prices?|rates?|status|results?|version|model)\b/i.test(message)
    // Short alphabetic acronyms/terms (e.g. AIO, SEO, GEO, DX) followed by "対策" or a definition-seeking
    // suffix are frequently marketing/business terms whose meaning shifts over time. Answering these from
    // static training knowledge risks confidently stating an outdated or fabricated definition, so treat
    // them the same as other time-sensitive requests rather than letting the model guess.
    || /[A-Za-zＡ-Ｚａ-ｚ]{2,10}(?:対策|とは|の意味|って何|とは何)/.test(message);
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
    ?? (() => `origin-${now()}-${randomUUID()}`);
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
    const futureReleaseInformationRequired = requiresFutureReleaseInformation(lastUserMessage);
    const currentInformationRequired = requiresCurrentInformation(lastUserMessage);
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

    if (currentInformationRequired) {
      const isEnglish = !/[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage);
      const content = futureReleaseInformationRequired
        ? (isEnglish
          ? "Bottom line: ORIGIN cannot responsibly name or date upcoming AI releases without checking current official announcements. Live search is not connected in this release, so it will not present rumors or possibly outdated model names as confirmed facts.\n\n## What matters most\n\n- **Confirmed releases:** require a current primary-source announcement from the developer.\n- **Announced plans:** must be separated from products that are already generally available.\n- **Rumors and forecasts:** must be labeled as unverified and must not be mixed into the confirmed list.\n\n## What you can do now\n\nPaste official announcement links or text. ORIGIN can then compare the supplied material by status, expected timing, capability, cost, and adoption relevance."
          : "結論：今後登場するAIの具体名や時期は、最新の公式発表を確認せずに断定できません。この版ではライブ検索が未接続のため、噂や古い可能性があるモデル名を「確定情報」として並べません。\n\n## 最も重要な判断基準\n\n- **提供開始済み**：開発元の最新の一次情報で確認できるもの\n- **公式予告**：発表済みでも、一般提供前のもの\n- **噂・予測**：未確認として明示し、確定情報と混ぜないもの\n\n## 今できること\n\n公式発表のURLまたは本文を貼り付ければ、確度・予想時期・能力・費用・ORIGINへの採用価値の順で、重複なく比較できます。")
        : (isEnglish
          ? "ORIGIN cannot verify current information in this release because live search is not connected. It will not answer from potentially outdated knowledge."
          : "この版では最新情報を確認する検索機能が接続されていないため、古い可能性がある知識だけでは回答しません。");
      const reason = isEnglish
        ? "Live search is not connected, so external AI execution was skipped."
        : "最新情報の検索機能が未接続のため、外部AIを実行しませんでした。";
      const limitations = [futureReleaseInformationRequired
        ? (isEnglish
          ? "Future time-sensitive claims were not retrieved or checked."
          : "将来の時点に依存する主張は取得・確認していません。")
        : (isEnglish
          ? "Current facts, prices, news, and other time-sensitive information were not retrieved or checked."
          : "現在の事実、料金、ニュースなど、時点に依存する情報は取得・確認していません。")];
      const nextActions = [futureReleaseInformationRequired
        ? (isEnglish
          ? "Paste current primary-source links or text and ORIGIN can organize and compare only the supplied evidence."
          : "最新の一次情報のURLまたは本文を貼り付けると、提示された根拠だけを整理・比較できます。")
        : (isEnglish
          ? "Paste the relevant text from an official source and ORIGIN can organize or compare that supplied content."
          : "公式情報の本文または必要部分を貼り付けると、その内容を整理・比較できます。")];
      return res.json({
        content,
        answer: answerEnvelope(
          content,
          isEnglish ? "en" : "ja",
          "not-required",
          reason,
          [],
          limitations,
          nextActions,
        ),
        routing: applicationRouting(requestId, reason),
      });
    }

    if (isOriginCapabilityQuestion(lastUserMessage)) {
      const guide = createOriginCapabilityGuide(lastUserMessage);
      const reason = guide.language === "ja"
        ? "現在の公開版で利用できる機能と未接続機能を、ORIGINの製品仕様に基づいて案内しました。"
        : "Explained the current and unconnected capabilities from ORIGIN's product specification.";
      return res.json({
        content: guide.content,
        answer: answerEnvelope(
          guide.content,
          guide.language,
          "not-required",
          reason,
          [],
          guide.limitations,
          guide.nextActions,
        ),
        routing: applicationRouting(requestId, reason),
      });
    }

    const planningResult = buildOriginExecutionPlan(
      {
        goal: lastUserMessage.trim(),
        requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(lastUserMessage),
        requiresFreshResearch: false,
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
      const requestIntent = classifyOriginRequestIntent(
        lastUserMessage,
        planningResult.plan.taskType,
      );
      const workPlan = buildOriginAgentWorkPlan(requestIntent);
      const resolvedPlan = resolveOriginAgentWorkPlan(workPlan);
      const result = await execute({
        plan: planningResult.plan,
        messages: contextResult.window.messages,
        systemInstruction: systemInstruction(requestIntent, workPlan, resolvedPlan),
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
      const sourceEvidenceExpected = planningResult.plan.taskType === "research";
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
      console.info("[origin-chat] provider request completed", {
        requestId,
        durationMs: Math.max(0, now() - startedAt),
        modelId: planningResult.plan.modelId,
        costUsd: result.actualCostUsd,
      });
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
        console.warn("[origin-chat] provider request failed", {
          requestId,
          durationMs: Math.max(0, now() - startedAt),
          code: error.code,
          status: error.status,
          retryable: error.retryable,
          diagnostic: error.diagnostic,
        });
        return res.status(error.status).json({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          retryAfterSeconds: error.retryAfterSeconds,
          diagnostic: error.diagnostic,
          requestId,
        });
      }
      console.error("[origin-chat] unexpected provider failure", {
        requestId,
        durationMs: Math.max(0, now() - startedAt),
        errorName: error instanceof Error ? error.name : "unknown",
      });
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
