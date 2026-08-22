import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
  type OriginProviderDataPolicy,
} from "../lib/orchestration/OriginExecutionPolicy.js";

export interface OriginChatMessage {
  role: "user" | "ai" | "assistant" | "model";
  content: string;
}

export interface OriginProviderExecutionRequest {
  plan: OriginExecutionPlan;
  messages: OriginChatMessage[];
  systemInstruction: string;
}

export interface OriginProviderRoutingEvidence {
  requestedModel: string;
  servedModel: string;
  strategy: string;
  provider: string;
  region?: string;
  attempt: 1;
  fallbackUsed: false;
}

export interface OriginProviderExecutionResult {
  text: string;
  actualCostUsd: 0;
  providerDataPolicy: OriginProviderDataPolicy;
  routingEvidence: OriginProviderRoutingEvidence;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd: 0;
  };
}

export function assertOriginZeroCostExecutionResult(
  result: OriginProviderExecutionResult,
  expectedModel: string = ORIGIN_OPENROUTER_FREE_MODEL,
): void {
  if (result.actualCostUsd !== 0 || result.usage?.costUsd !== 0) {
    throw new OriginProviderError(
      "PROVIDER_POLICY_VIOLATION",
      "無料モデルの実行で0ドル以外の利用額が報告されたため、回答を破棄しました。",
      502,
      false,
    );
  }
  const evidence = result.routingEvidence;
  if (
    expectedModel !== ORIGIN_OPENROUTER_FREE_MODEL
    || evidence.requestedModel !== expectedModel
    || evidence.servedModel !== expectedModel
    || evidence.strategy !== "fixed-free-model"
    || evidence.provider !== "OpenRouter"
    || evidence.attempt !== 1
    || evidence.fallbackUsed !== false
  ) {
    throw new OriginProviderError(
      "PROVIDER_ROUTING_UNVERIFIED",
      "固定無料モデルの応答証跡を確認できなかったため、回答を返しません。",
      502,
      false,
    );
  }
}

export type OriginProviderErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_POLICY_VIOLATION"
  | "PROVIDER_COST_UNVERIFIED"
  | "PROVIDER_ROUTING_UNVERIFIED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_INTERNAL_ERROR";

export interface OriginProviderDiagnostic {
  upstreamStatus?: number;
  upstreamErrorType?: string;
  transportFailure?: "timeout" | "network";
}

export class OriginProviderError extends Error {
  constructor(
    public readonly code: OriginProviderErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds?: number,
    public readonly diagnostic?: OriginProviderDiagnostic,
  ) {
    super(message);
    this.name = "OriginProviderError";
  }
}

export type OriginFetch = typeof fetch;

const MAX_COMPLETION_SEGMENTS = 3;

function normalizedContinuationLine(line: string): string {
  return line
    .trim()
    .replace(/^(?:#{1,6}|[-*+]|\d+[.)])\s+/, "")
    .replace(/[（(]\s*(?:続き|continued)\s*[）)]/gi, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function mergeContinuation(previous: string, continuation: string): string {
  const left = previous.trimEnd();
  const right = continuation.trimStart();
  const maximumOverlap = Math.min(left.length, right.length, 500);

  for (let length = maximumOverlap; length >= 20; length -= 1) {
    if (left.slice(-length) === right.slice(0, length)) {
      return `${left}${right.slice(length)}`.trim();
    }
  }

  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const firstRightLine = rightLines.findIndex((line) => line.trim().length > 0);
  if (
    firstRightLine >= 0
    && /^#{1,6}\s+/.test(rightLines[firstRightLine])
    && leftLines.some((line) =>
      normalizedContinuationLine(line) === normalizedContinuationLine(rightLines[firstRightLine]))
  ) {
    rightLines.splice(firstRightLine, 1);
    while (rightLines[0]?.trim() === "") rightLines.shift();
  }

  const maximumLineOverlap = Math.min(leftLines.length, rightLines.length, 20);
  for (let count = maximumLineOverlap; count >= 1; count -= 1) {
    const leftOverlap = leftLines.slice(-count).map(normalizedContinuationLine);
    const rightOverlap = rightLines.slice(0, count).map(normalizedContinuationLine);
    if (
      leftOverlap.every(Boolean)
      && leftOverlap.every((line, index) => line === rightOverlap[index])
    ) {
      return [...leftLines, ...rightLines.slice(count)].join("\n").trim();
    }
  }

  return `${left}\n\n${right}`.trim();
}

function normalizeMessages(messages: OriginChatMessage[], systemInstruction: string) {
  return [
    { role: "system", content: systemInstruction },
    ...messages.map((message) => ({
      role: message.role === "ai" || message.role === "assistant" || message.role === "model"
        ? "assistant"
        : "user",
      content: message.content,
    })),
  ];
}

export function originCompletionTokenBudget(
  taskType: OriginExecutionPlan["taskType"],
): number {
  switch (taskType) {
    case "implementation":
    case "documentation":
      return 2_400;
    case "research":
    case "review":
    case "architecture":
    case "security":
    case "current-information":
      return 1_800;
    default:
      return 1_200;
  }
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return undefined;
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1_000));
}

function mapHttpFailure(status: number, retryAfterSeconds?: number): OriginProviderError {
  const diagnostic: OriginProviderDiagnostic = { upstreamStatus: status };
  if (status === 401) {
    return new OriginProviderError(
      "PROVIDER_NOT_CONFIGURED",
      "無料AIの認証情報を確認できませんでした。",
      503,
      false,
      undefined,
      diagnostic,
    );
  }
  if (status === 402) {
    return new OriginProviderError(
      "PROVIDER_POLICY_VIOLATION",
      "無料モデルの利用に支払いが必要と判定されたため、実行を停止しました。",
      502,
      false,
      undefined,
      diagnostic,
    );
  }
  if (status === 403) {
    return new OriginProviderError(
      "PROVIDER_UNAVAILABLE",
      "無料AIを現在利用できません。",
      503,
      false,
      undefined,
      diagnostic,
    );
  }
  if (status === 404) {
    return new OriginProviderError(
      "PROVIDER_UNAVAILABLE",
      "安全条件を満たす無料AIの実行先を現在利用できません。",
      503,
      true,
      undefined,
      diagnostic,
    );
  }
  if (status === 429) {
    return new OriginProviderError(
      "PROVIDER_RATE_LIMITED",
      retryAfterSeconds
        ? `無料AIの利用上限に達しました。約${retryAfterSeconds}秒後に再試行できます。`
        : "無料AIの利用上限に達しました。時間をおいて再試行してください。",
      429,
      true,
      retryAfterSeconds,
      diagnostic,
    );
  }
  if (status === 408 || status === 504) {
    return new OriginProviderError(
      "PROVIDER_TIMEOUT",
      "無料AIの応答が時間内に完了しませんでした。",
      504,
      true,
      undefined,
      diagnostic,
    );
  }
  if (status === 502 || status === 503) {
    return new OriginProviderError(
      "PROVIDER_UNAVAILABLE",
      "無料AIを現在利用できません。",
      503,
      true,
      undefined,
      diagnostic,
    );
  }
  return new OriginProviderError(
    "PROVIDER_INTERNAL_ERROR",
    "無料AIの処理に失敗しました。",
    status >= 400 && status < 600 ? status : 500,
    status >= 500,
    undefined,
    diagnostic,
  );
}

function validateProviderPolicy(plan: OriginExecutionPlan): void {
  const policy = plan.providerDataPolicy;
  if (
    policy.allowProviderFallbacks !== true
    || policy.dataCollection !== "deny"
    || policy.requireZeroDataRetention !== false
  ) {
    throw new OriginProviderError(
      "PROVIDER_POLICY_VIOLATION",
      "固定無料モデル内の提供経路切替、データ収集拒否ポリシーに適合しない実行計画は使用できません。",
      400,
      false,
    );
  }
}

function verifiedZeroCost(value: unknown): 0 {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new OriginProviderError(
      "PROVIDER_COST_UNVERIFIED",
      "無料実行であることを利用明細から確認できなかったため、回答を返しません。",
      502,
      false,
    );
  }
  if (value !== 0) {
    throw new OriginProviderError(
      "PROVIDER_POLICY_VIOLATION",
      "無料モデルの実行で0ドルを超える利用額が報告されたため、回答を破棄しました。",
      502,
      false,
    );
  }
  return 0;
}

function assertProviderBillingRemainsFree(payload: {
  billing_tier?: unknown;
  billingTier?: unknown;
  is_free?: unknown;
  isFree?: unknown;
  pricing?: Record<string, unknown>;
  usage?: {
    cost?: unknown;
    cost_details?: Record<string, unknown>;
    is_byok?: unknown;
  };
}): void {
  const tier = payload.billing_tier ?? payload.billingTier;
  const explicitlyPaid = (typeof tier === "string" && !/^(?:free|zero)$/i.test(tier))
    || payload.is_free === false
    || payload.isFree === false
    || payload.usage?.is_byok === true;
  const chargeFields = [
    ...Object.entries(payload.usage?.cost_details ?? {}).filter(([key]) => /cost|price|charge/i.test(key)),
    ...Object.entries(payload.pricing ?? {}).filter(([key]) => /prompt|completion|request|image|reasoning|search|price|cost/i.test(key)),
  ];
  const additionalCharge = chargeFields.some(([, value]) => {
    if (typeof value !== "number" && typeof value !== "string") return false;
    const amount = typeof value === "string" && value.trim() ? Number(value) : value;
    return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
  });
  if (explicitlyPaid || additionalCharge) {
    throw new OriginProviderError(
      "PROVIDER_POLICY_VIOLATION",
      "無料モデルの応答に有料課金の兆候が含まれていたため、回答を破棄しました。",
      502,
      false,
    );
  }
}

function verifiedRoutingEvidence(
  requestedModel: string,
  responseModel: unknown,
): OriginProviderRoutingEvidence {
  const requestedFreeRouteIsVerified =
    requestedModel === ORIGIN_OPENROUTER_FREE_MODEL
    && requestedModel.endsWith(":free");
  const servedModel = typeof responseModel === "string" ? responseModel : "";

  if (
    !requestedFreeRouteIsVerified
    || servedModel !== requestedModel
    || !servedModel.endsWith(":free")
  ) {
    throw new OriginProviderError(
      "PROVIDER_ROUTING_UNVERIFIED",
      "実際に使用されたモデルとプロバイダーを確認できなかったため、回答を返しません。",
      502,
      false,
    );
  }

  return {
    requestedModel,
    servedModel,
    strategy: "fixed-free-model",
    provider: "OpenRouter",
    attempt: 1,
    fallbackUsed: false,
  };
}

type OriginProviderContent =
  | string
  | Array<{ type?: string; text?: string }>
  | null;

function extractProviderText(content: OriginProviderContent | undefined): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function mapProviderPayloadFailure(errorType: unknown): OriginProviderError | null {
  if (typeof errorType !== "string" || !errorType) return null;
  const diagnostic: OriginProviderDiagnostic = { upstreamErrorType: errorType };
  if (/^(?:payment_required|billing_required|insufficient_credits|paid_model|model_not_free)$/i.test(errorType)) {
    return new OriginProviderError(
      "PROVIDER_POLICY_VIOLATION",
      "無料モデルの利用に有料課金が必要と判定されたため、回答を返しません。",
      502,
      false,
      undefined,
      diagnostic,
    );
  }
  if (errorType === "rate_limit_exceeded") {
    return new OriginProviderError(
      "PROVIDER_RATE_LIMITED",
      "無料AIの利用上限に達しました。時間をおいて再試行してください。",
      429,
      true,
      undefined,
      diagnostic,
    );
  }
  if (errorType === "timeout") {
    return new OriginProviderError(
      "PROVIDER_TIMEOUT",
      "無料AIの応答が時間内に完了しませんでした。",
      504,
      true,
      undefined,
      diagnostic,
    );
  }
  if (errorType === "provider_overloaded" || errorType === "provider_unavailable") {
    return new OriginProviderError(
      "PROVIDER_UNAVAILABLE",
      "無料AIを現在利用できません。",
      503,
      true,
      undefined,
      diagnostic,
    );
  }
  return new OriginProviderError(
    "PROVIDER_INTERNAL_ERROR",
    "無料AIの処理に失敗しました。",
    502,
    false,
    undefined,
    diagnostic,
  );
}

export async function executeOriginProvider(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
): Promise<OriginProviderExecutionResult> {
  const isVerifiedFreeRoute =
    request.plan.modelId === ORIGIN_OPENROUTER_FREE_MODEL;
  if (request.plan.providerId !== "openrouter-free" || !isVerifiedFreeRoute) {
    throw new OriginProviderError(
      "PROVIDER_POLICY_VIOLATION",
      "無料限定ポリシーに適合しない実行先は使用できません。",
      400,
      false,
    );
  }
  validateProviderPolicy(request.plan);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OriginProviderError(
      "PROVIDER_NOT_CONFIGURED",
      "無料AIプロバイダーが設定されていません。",
      503,
      false,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.plan.timeoutMs);

  try {
    const baseMessages = normalizeMessages(request.messages, request.systemInstruction);
    let providerMessages = baseMessages;
    let completedText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for (let segment = 0; segment < MAX_COMPLETION_SEGMENTS; segment += 1) {
      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://myaispecials.ai.studio/",
          "X-OpenRouter-Title": "ORIGIN Personal",
        },
        body: JSON.stringify({
          model: request.plan.modelId,
          messages: providerMessages,
          // Bound each segment for latency. When the provider explicitly reports
          // a length stop, ORIGIN requests a continuation and returns nothing
          // until a complete answer has been verified.
          max_tokens: originCompletionTokenBudget(request.plan.taskType),
          reasoning: {
            // Keep reasoning effort explicit for the evidence-backed fixed
            // free route so the provider cannot reinterpret the request.
            effort: "medium",
            exclude: true,
          },
          temperature: 0.2,
          top_p: 0.9,
          provider: {
            // Prefer the fastest eligible endpoint, then let OpenRouter try
            // another endpoint for this exact fixed model if capacity is full.
            // The request contains one verified :free model only; served-model
            // equality and zero-cost checks still fail closed after completion.
            sort: "throughput",
            allow_fallbacks: request.plan.providerDataPolicy.allowProviderFallbacks,
            data_collection: request.plan.providerDataPolicy.dataCollection,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw mapHttpFailure(
          response.status,
          parseRetryAfterSeconds(response.headers.get("Retry-After")),
        );
      }

      const data = await response.json() as {
        model?: string;
        billing_tier?: string;
        billingTier?: string;
        is_free?: boolean;
        isFree?: boolean;
        pricing?: Record<string, unknown>;
        error?: { metadata?: { error_type?: string } };
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: OriginProviderContent };
          error?: { metadata?: { error_type?: string } };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          cost?: number;
          cost_details?: Record<string, unknown>;
          is_byok?: boolean;
        };
      };
      const choice = data.choices?.[0];
      const payloadFailure = mapProviderPayloadFailure(
        choice?.error?.metadata?.error_type ?? data.error?.metadata?.error_type,
      );
      if (payloadFailure) throw payloadFailure;

      const costUsd = verifiedZeroCost(data.usage?.cost);
      assertProviderBillingRemainsFree(data);
      const routingEvidence = verifiedRoutingEvidence(
        request.plan.modelId,
        data.model,
      );
      const segmentText = extractProviderText(choice?.message?.content);

      if (!segmentText) {
        throw new OriginProviderError(
          "PROVIDER_INVALID_RESPONSE",
          "無料AIから有効な回答を受け取れませんでした。",
          502,
          true,
        );
      }

      completedText = completedText
        ? mergeContinuation(completedText, segmentText)
        : segmentText;
      promptTokens += data.usage?.prompt_tokens ?? 0;
      completionTokens += data.usage?.completion_tokens ?? 0;
      totalTokens += data.usage?.total_tokens ?? 0;

      if (choice?.finish_reason !== "length") {
        return {
          text: completedText,
          actualCostUsd: costUsd,
          providerDataPolicy: request.plan.providerDataPolicy,
          routingEvidence,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd,
          },
        };
      }

      if (segment === MAX_COMPLETION_SEGMENTS - 1) {
        throw new OriginProviderError(
          "PROVIDER_INVALID_RESPONSE",
          "回答が長く、完了を確認できなかったため途中の内容は表示しません。依頼を分けて再実行してください。",
          502,
          true,
        );
      }

      providerMessages = [
        ...baseMessages,
        { role: "assistant", content: completedText },
        {
          role: "user",
          content: "直前の回答が出力上限で途切れました。新しい見出し、表、要約、前置きを作らず、途切れた箇所から最後まで不足部分だけを続けてください。すでに書いた文・項目・見出しは一切繰り返さず、短くても必ず完全な文で回答を終えてください。",
        },
      ];
    }

    throw new OriginProviderError(
      "PROVIDER_INVALID_RESPONSE",
      "回答の完了を確認できませんでした。",
      502,
      true,
    );
  } catch (error) {
    if (error instanceof OriginProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OriginProviderError(
        "PROVIDER_TIMEOUT",
        "無料AIの応答が時間内に完了しませんでした。",
        504,
        true,
        undefined,
        { transportFailure: "timeout" },
      );
    }
    throw new OriginProviderError(
      "PROVIDER_INTERNAL_ERROR",
      "無料AIとの通信に失敗しました。",
      500,
      true,
      undefined,
      { transportFailure: "network" },
    );
  } finally {
    clearTimeout(timeout);
  }
}
