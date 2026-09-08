import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import { sanitizePreEgress, sanitizePreEgressPayload } from "../services/securitySanitizer.js";
import {
  assertOriginZeroCostExecutionResult,
  originCompletionTokenBudget,
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient.js";
import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY } from "./zeroCostRoutingPolicy.js";

export interface OriginProviderStreamHandlers {
  onDelta: (text: string) => void;
}

export type OriginProviderStreamExecutor = (
  request: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
) => Promise<OriginProviderExecutionResult>;

type OpenRouterStreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: unknown;
  cost_details?: { upstream_inference_cost?: unknown };
  is_byok?: unknown;
};

type OpenRouterStreamChunk = {
  model?: unknown;
  choices?: Array<{
    delta?: { content?: unknown };
    finish_reason?: unknown;
    error?: { metadata?: { error_type?: unknown } };
  }>;
  error?: { metadata?: { error_type?: unknown } };
  usage?: OpenRouterStreamUsage;
  billing_tier?: unknown;
  is_free?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
};

const OPENROUTER_STREAM_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_CANONICAL_SERVED_MODEL = ORIGIN_OPENROUTER_FREE_MODEL.replace(/:free$/, "");
const MAX_STREAM_TIMEOUT_MS = 52_000;

const streamedText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => String((part as { text: string }).text))
    .join("");
};

const allowedServedModel = (value: unknown): value is string =>
  typeof value === "string"
  && (value === ORIGIN_OPENROUTER_FREE_MODEL || value === OPENROUTER_CANONICAL_SERVED_MODEL);

function policyFailure(code: "PROVIDER_POLICY_VIOLATION" | "PROVIDER_COST_UNVERIFIED", message: string): never {
  throw new OriginProviderError(code, message, 502, false);
}

function zeroIfPresent(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) policyFailure("PROVIDER_COST_UNVERIFIED", `${field} を検証できません。`);
  if (numeric !== 0) policyFailure("PROVIDER_POLICY_VIOLATION", `${field} が0ドル固定ポリシーを満たしません。`);
}

function assertStreamBillingMetadata(chunk: OpenRouterStreamChunk): void {
  if (chunk.billing_tier !== undefined && String(chunk.billing_tier).toLowerCase() !== "free") {
    policyFailure("PROVIDER_POLICY_VIOLATION", "有料の課金ティアが検出されました。");
  }
  if (chunk.is_free === false) policyFailure("PROVIDER_POLICY_VIOLATION", "無料モデルではない証跡が検出されました。");
  zeroIfPresent(chunk.pricing?.prompt, "pricing.prompt");
  zeroIfPresent(chunk.pricing?.completion, "pricing.completion");
  zeroIfPresent(chunk.usage?.cost_details?.upstream_inference_cost, "usage.cost_details.upstream_inference_cost");
  if (chunk.usage?.is_byok === true) policyFailure("PROVIDER_POLICY_VIOLATION", "BYOK課金経路は0ドル固定境界で許可されません。");
}

function providerErrorType(errorType: unknown): never {
  const diagnostic = { upstreamErrorType: String(errorType) };
  if (errorType === "rate_limit_exceeded") {
    throw new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, true, undefined, diagnostic);
  }
  if (errorType === "timeout") {
    throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, diagnostic);
  }
  if (errorType === "provider_overloaded" || errorType === "provider_unavailable") {
    throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, diagnostic);
  }
  throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true, undefined, diagnostic);
}

function httpFailure(status: number, retryAfterSeconds?: number): OriginProviderError {
  const diagnostic = { upstreamStatus: status };
  if (status === 401) return new OriginProviderError("PROVIDER_NOT_CONFIGURED", "Provider認証情報を確認できません。", 401, false, undefined, diagnostic);
  if (status === 402) return new OriginProviderError("PROVIDER_POLICY_VIOLATION", "無料実行として確認できない課金状態です。", 502, false, undefined, diagnostic);
  if (status === 429) return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, true, retryAfterSeconds, diagnostic);
  if (status === 400 || status === 404 || status === 422) return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, false, undefined, diagnostic);
  if (status === 408 || status === 504) return new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, diagnostic);
  return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, diagnostic);
}

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(1, Math.ceil((timestamp - Date.now()) / 1000)) : undefined;
}

function validateStreamPlan(plan: OriginExecutionPlan): void {
  if (!plan.freeOnly
    || plan.estimatedCostUsd !== 0
    || plan.providerId !== "openrouter-free"
    || plan.modelId !== ORIGIN_OPENROUTER_FREE_MODEL
    || plan.providerDataPolicy.allowProviderFallbacks !== false) {
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "0ドル固定ポリシーに適合しない実行計画です。", 400, false);
  }
}

function requestMessages(request: OriginProviderExecutionRequest) {
  return [
    { role: "system", content: sanitizePreEgress(request.systemInstruction) },
    ...request.messages.map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      content: sanitizePreEgress(message.content),
    })),
  ];
}

async function streamOpenRouter(
  providerRequest: OriginProviderExecutionRequest,
  key: string,
  handlers: OriginProviderStreamHandlers,
  fetchImpl: OriginFetch,
): Promise<OriginProviderExecutionResult> {
  const controller = new AbortController();
  const timeoutMs = Math.min(
    MAX_STREAM_TIMEOUT_MS,
    Math.max(5_000, Number(providerRequest.plan.timeoutMs) || MAX_STREAM_TIMEOUT_MS),
  );
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(OPENROUTER_STREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://myaispecials.ai.studio/",
        "X-OpenRouter-Title": "ORIGIN Personal",
      },
      signal: controller.signal,
      body: JSON.stringify(sanitizePreEgressPayload({
        model: providerRequest.plan.modelId,
        messages: requestMessages(providerRequest),
        max_tokens: originCompletionTokenBudget(providerRequest.plan.taskType),
        temperature: 0.2,
        top_p: 0.9,
        stream: true,
        usage: { include: true },
        provider: ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY,
      })),
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof OriginProviderError) throw error;
    if ((error as Error)?.name === "AbortError") {
      throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, { transportFailure: "timeout" });
    }
    throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportFailure: "network" });
  }

  if (!response.ok) {
    clearTimeout(timer);
    throw httpFailure(response.status, retryAfter(response.headers.get("Retry-After")));
  }
  if (!response.body) {
    clearTimeout(timer);
    throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let servedModel = providerRequest.plan.modelId;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let finishReason: string | undefined;
  let doneSeen = false;
  let usageSeen = false;

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) return;
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trimStart();
    if (payload === "[DONE]") { doneSeen = true; return; }
    let chunk: OpenRouterStreamChunk;
    try {
      chunk = JSON.parse(payload) as OpenRouterStreamChunk;
    } catch {
      throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true);
    }

    const errorType = chunk.choices?.[0]?.error?.metadata?.error_type ?? chunk.error?.metadata?.error_type;
    if (errorType !== undefined) providerErrorType(errorType);
    assertStreamBillingMetadata(chunk);

    if (chunk.model !== undefined) {
      const candidate = typeof chunk.model === "string" ? chunk.model.trim() : "";
      if (!allowedServedModel(candidate)) {
        throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "OpenRouter無料モデルを確認できません。", 502, false, undefined, { upstreamErrorType: `served-model:${candidate || "missing"}` });
      }
      servedModel = candidate;
    }

    const delta = streamedText(chunk.choices?.[0]?.delta?.content);
    if (delta) {
      output += delta;
      handlers.onDelta(delta);
    }
    if (typeof chunk.choices?.[0]?.finish_reason === "string") finishReason = chunk.choices[0].finish_reason;
    if (chunk.usage) {
      usageSeen = true;
      promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
      completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      totalTokens = chunk.usage.total_tokens ?? totalTokens;
      if (chunk.usage.cost === undefined || chunk.usage.cost === null) {
        policyFailure("PROVIDER_COST_UNVERIFIED", "usage.cost を検証できません。");
      }
      zeroIfPresent(chunk.usage.cost, "usage.cost");
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
      if (doneSeen) break;
    }
    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);
  } catch (error) {
    if (error instanceof OriginProviderError) throw error;
    if ((error as Error)?.name === "AbortError") {
      throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, { transportFailure: "timeout" });
    }
    throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportFailure: "network" });
  } finally {
    clearTimeout(timer);
    try { await reader.cancel(); } catch { /* stream already completed */ }
  }

  if (!doneSeen || !usageSeen || !output.trim()) {
    throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true);
  }
  if (finishReason === "length") {
    throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "回答を完了できませんでした。", 502, true);
  }
  if (!allowedServedModel(servedModel)) {
    throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "OpenRouter無料モデルを確認できません。", 502, false);
  }

  const result: OriginProviderExecutionResult = {
    text: output,
    actualCostUsd: 0,
    providerDataPolicy: providerRequest.plan.providerDataPolicy,
    routingEvidence: {
      requestedModel: providerRequest.plan.modelId,
      servedModel,
      strategy: "adaptive-primary",
      provider: "OpenRouter",
      attempt: 1,
      fallbackUsed: false,
    },
    usage: { promptTokens, completionTokens, totalTokens, costUsd: 0 },
  };
  assertOriginZeroCostExecutionResult(result, providerRequest.plan.modelId, providerRequest.plan.providerId);
  return result;
}

export async function executeOriginProviderStream(
  providerRequest: OriginProviderExecutionRequest,
  handlers: OriginProviderStreamHandlers,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
): Promise<OriginProviderExecutionResult> {
  validateStreamPlan(providerRequest.plan);
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new OriginProviderError("PROVIDER_NOT_CONFIGURED", "利用可能な無料AIが設定されていません。", 503, false);
  return streamOpenRouter(providerRequest, key, handlers, fetchImpl);
}
