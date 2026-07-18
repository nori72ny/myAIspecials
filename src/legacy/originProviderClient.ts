import type { OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";

export interface OriginChatMessage {
  role: "user" | "ai" | "assistant" | "model";
  content: string;
}

export interface OriginProviderExecutionRequest {
  plan: OriginExecutionPlan;
  messages: OriginChatMessage[];
  systemInstruction: string;
}

export interface OriginProviderExecutionResult {
  text: string;
  actualCostUsd: 0;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export type OriginProviderErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_POLICY_VIOLATION"
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
  ) {
    super(message);
    this.name = "OriginProviderError";
  }
}

export type OriginFetch = typeof fetch;

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

function mapHttpFailure(status: number): OriginProviderError {
  if (status === 429) {
    return new OriginProviderError(
      "PROVIDER_RATE_LIMITED",
      "無料AIの利用上限に達しました。時間をおいて再試行してください。",
      429,
      true,
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

export async function executeOriginProvider(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
): Promise<OriginProviderExecutionResult> {
  if (request.plan.providerId !== "openrouter-free" || !request.plan.modelId.endsWith(":free")) {
    throw new OriginProviderError(
      "PROVIDER_POLICY_VIOLATION",
      "無料限定ポリシーに適合しない実行先は使用できません。",
      400,
      false,
    );
  }

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
    const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://origin.local",
        "X-Title": "ORIGIN Personal",
      },
      body: JSON.stringify({
        model: request.plan.modelId,
        messages: normalizeMessages(request.messages, request.systemInstruction),
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw mapHttpFailure(response.status);

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";

    if (!text) {
      throw new OriginProviderError(
        "PROVIDER_INVALID_RESPONSE",
        "無料AIから有効な回答を受け取れませんでした。",
        502,
        true,
      );
    }

    return {
      text,
      actualCostUsd: 0,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
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
