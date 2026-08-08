import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
  type OriginProviderDataPolicy,
} from "../lib/orchestration/OriginExecutionPolicy";

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

export class OriginProviderError extends Error {
  constructor(
    public readonly code: OriginProviderErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "OriginProviderError";
  }
}

export type OriginFetch = typeof fetch;

const MAX_COMPLETION_SEGMENTS = 3;

function mergeContinuation(previous: string, continuation: string): string {
  const left = previous.trimEnd();
  const right = continuation.trimStart();
  const maximumOverlap = Math.min(left.length, right.length, 500);

  for (let length = maximumOverlap; length >= 20; length -= 1) {
    if (left.slice(-length) === right.slice(0, length)) {
      return `${left}${right.slice(length)}`.trim();
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
  if (status === 401) {
    return new OriginProviderError(
      "PROVIDER_NOT_CONFIGURED",
      "無料AIの認証情報を確認できませんでした。",
      503,
      false,
    );
  }
  if (status === 402 || status === 403) {
    return new OriginProviderError(
      "PROVIDER_UNAVAILABLE",
      "無料AIを現在利用できません。",
      503,
      false,
    );
  }
  if (status === 404) {
    return new OriginProviderError(
      "PROVIDER_UNAVAILABLE",
      "安全条件を満たす無料AIの実行先を現在利用できません。",
      503,
      true,
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
    );
  }
  if (status === 408 || status === 504) {
    return new OriginProviderError(
      "PROVIDER_TIMEOUT",
      "無料AIの応答が時間内に完了しませんでした。",
      504,
      true,
    );
  }
  if (status === 502 || status === 503) {
    return new OriginProviderError(
      "PROVIDER_UNAVAILABLE",
      "無料AIを現在利用できません。",
      503,
      true,
    );
  }
  return new OriginProviderError(
    "PROVIDER_INTERNAL_ERROR",
    "無料AIの処理に失敗しました。",
    status >= 400 && status < 600 ? status : 500,
    status >= 500,
  );
}

function validateProviderPolicy(plan: OriginExecutionPlan): void {
  const policy = plan.providerDataPolicy;
  if (
    policy.allowProviderFallbacks !== false
    || policy.dataCollection !== "deny"
    || policy.requireZeroDataRetention !== false
  ) {
    throw new OriginProviderError(
      "PROVIDER_POLICY_VIOLATION",
      "無料ルーターのデータ収集拒否またはフォールバック禁止ポリシーに適合しない実行計画は使用できません。",
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

function verifiedRoutingEvidence(
  requestedModel: string,
  responseModel: unknown,
): OriginProviderRoutingEvidence {
  const requestedFreeRouteIsVerified =
    requestedModel === ORIGIN_OPENROUTER_FREE_MODEL;
  const servedModel = typeof responseModel === "string" ? responseModel : "";

  if (
    !requestedFreeRouteIsVerified
    || servedModel !== requestedModel
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
  if (errorType === "rate_limit_exceeded") {
    return new OriginProviderError(
      "PROVIDER_RATE_LIMITED",
      "無料AIの利用上限に達しました。時間をおいて再試行してください。",
      429,
      true,
    );
  }
  if (errorType === "timeout") {
    return new OriginProviderError(
      "PROVIDER_TIMEOUT",
      "無料AIの応答が時間内に完了しませんでした。",
      504,
      true,
    );
  }
  if (errorType === "provider_overloaded" || errorType === "provider_unavailable") {
    return new OriginProviderError(
      "PROVIDER_UNAVAILABLE",
      "無料AIを現在利用できません。",
      503,
      true,
    );
  }
  return new OriginProviderError(
    "PROVIDER_INTERNAL_ERROR",
    "無料AIの処理に失敗しました。",
    502,
    false,
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
            effort: "low",
            exclude: true,
          },
          temperature: 0.2,
          top_p: 0.9,
          provider: {
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
        };
      };
      const choice = data.choices?.[0];
      const payloadFailure = mapProviderPayloadFailure(
        choice?.error?.metadata?.error_type ?? data.error?.metadata?.error_type,
      );
      if (payloadFailure) throw payloadFailure;

      const costUsd = verifiedZeroCost(data.usage?.cost);
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
          content: "直前の回答が出力上限で途切れました。重複や前置きを入れず、途切れた箇所から最後まで続けてください。",
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
      );
    }
    throw new OriginProviderError(
      "PROVIDER_INTERNAL_ERROR",
      "無料AIとの通信に失敗しました。",
      500,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
