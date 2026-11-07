import {
  ORIGIN_GROQ_FREE_PROVIDER_ID,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  ORIGIN_GROQ_FREE_MODEL_ID,
  selectCurrentOriginGroqFreeModel,
  type OriginGroqFreeModelEvidence,
} from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
import { sanitizePreEgress } from "../services/securitySanitizer.js";
import {
  originCompletionTokenBudget,
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient.js";

/**
 * Groq route (free-provider failover Phase 3, third route).
 *
 * This executor is only reachable through originProviderFailover, after the OpenRouter
 * primary and the Cloudflare Workers AI route are both unavailable, and only while
 * GROQ_API_KEY is configured: without the key the route does not exist at all (the
 * dispatcher never attempts it and records no attempt for it), which is the current
 * production state. The route was verified live in the owner's Groq Console on
 * 2026-11-08 before implementation: the free account (organization "Personal", no
 * payment method registered) has ZDR enabled globally in Settings / Data Controls
 * (Global ZDR "Enabled", overriding API-specific settings; Inference APIs ZDR also
 * "Enabled"), and the free-plan limits for openai/gpt-oss-120b are 30 requests/minute,
 * 1,000 requests/day, 8,000 tokens/minute and 200,000 tokens/day. With no card on file,
 * exceeding the free limits errors (HTTP 429) instead of charging, so the route stays
 * strictly $0 as long as it only ever sends inside those limits.
 *
 * The tokens/minute ceiling is the binding constraint, so the executor enforces it
 * before sending: the input is estimated conservatively from the exact payload it
 * would send, the completion allowance is what remains under the ceiling, and when
 * even a minimal completion no longer fits, the route is skipped before any request
 * is sent (fail closed) instead of gambling on a mid-answer rate limit. The evidence
 * catalog entry is deliberately short-lived (reviewAfter 2026-11-22) and the route
 * fails closed when it expires, exactly like the other routes. The API key is used
 * only in the Authorization header; it never appears in results, errors, or logs.
 */

export const ORIGIN_GROQ_API_KEY_ENV = "GROQ_API_KEY" as const;

/** Free-plan tokens/minute ceiling for openai/gpt-oss-120b, verified 2026-11-08. */
export const ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT = 8_000;
export const ORIGIN_GROQ_MAX_REQUEST_TIMEOUT_MS = 52_000;
/** Below this completion headroom the answer would be uselessly truncated; skip instead. */
const MIN_GROQ_COMPLETION_TOKENS = 256;

const GROQ_API_BASE = "https://api.groq.com/openai/v1";

export type OriginGroqPreflightReason =
  | "not-configured"
  | "catalog-invalid"
  | "evidence-stale"
  | "token-budget-exceeded";

/**
 * The route was skipped before any inference was sent. Like the Cloudflare preflight
 * error, this is deliberately not an OriginProviderError: the dispatcher records the
 * skip and surfaces the earlier routes' error instead.
 */
export class OriginGroqPreflightError extends Error {
  constructor(public readonly reason: OriginGroqPreflightReason) {
    super(`Groq failover route skipped before execution: ${reason}`);
    this.name = "OriginGroqPreflightError";
  }
}

function validApiKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 20 && value.trim().length <= 4096;
}

/** The third route exists only while a plausible GROQ_API_KEY is configured. */
export function isOriginGroqRouteConfigured(env: NodeJS.ProcessEnv): boolean {
  return validApiKey(env[ORIGIN_GROQ_API_KEY_ENV]);
}

function resolveOriginGroqApiKey(env: NodeJS.ProcessEnv): string | null {
  const key = env[ORIGIN_GROQ_API_KEY_ENV];
  return validApiKey(key) ? (key as string).trim() : null;
}

/**
 * Conservative input-token estimate for the exact payload this route would send.
 * gpt-oss tokenization is roughly 4 characters per token for English and 1.3-2
 * characters per token for Japanese, so characters/2 overestimates English and tracks
 * Japanese closely; a small per-message overhead covers role wrappers. Overestimating
 * is the safe direction here: it can only skip the route earlier, never oversend.
 */
export function estimateOriginGroqInputTokens(payloadTexts: readonly string[]): number {
  let tokens = 0;
  for (const text of payloadTexts) {
    tokens += Math.ceil(text.length / 2) + 4;
  }
  return tokens;
}

function validateGroqPlan(plan: OriginExecutionPlan): void {
  if (!plan.freeOnly
    || plan.estimatedCostUsd !== 0
    || plan.providerId !== ORIGIN_GROQ_FREE_PROVIDER_ID
    || plan.modelId !== ORIGIN_GROQ_FREE_MODEL_ID
    || plan.providerDataPolicy.allowProviderFallbacks !== false
    || plan.providerDataPolicy.dataCollection !== "deny"
    || plan.providerDataPolicy.requireZeroDataRetention !== true) {
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "0ドル・ZDR固定ポリシーに適合しない実行計画です。", 400, false);
  }
}

function planEvidenceIsCurrent(plan: OriginExecutionPlan, selected: OriginGroqFreeModelEvidence, nowMs: number): boolean {
  const planVerifiedAt = Date.parse(plan.modelEvidence?.verifiedAt ?? "");
  const planReviewAfter = Date.parse(plan.modelEvidence?.reviewAfter ?? "");
  return plan.modelEvidence?.providerId === ORIGIN_GROQ_FREE_PROVIDER_ID
    && plan.modelEvidence?.sourceUrl === selected.sourceUrl
    && Number.isFinite(planVerifiedAt)
    && Number.isFinite(planReviewAfter)
    && planVerifiedAt === Date.parse(selected.verifiedAt)
    && planReviewAfter === Date.parse(selected.reviewAfter)
    && nowMs >= planVerifiedAt
    && nowMs <= planReviewAfter;
}

export function assertOriginGroqExecutionResult(result: OriginProviderExecutionResult): void {
  const fail = (code: "PROVIDER_COST_UNVERIFIED" | "PROVIDER_POLICY_VIOLATION" | "PROVIDER_ROUTING_UNVERIFIED" | "PROVIDER_TRANSPORT_UNVERIFIED", message: string): never => {
    throw new OriginProviderError(code, message, 502, false);
  };
  if (!result || typeof result !== "object") fail("PROVIDER_COST_UNVERIFIED", "実行結果を検証できません。");
  if (typeof result.actualCostUsd !== "number" || !Number.isFinite(result.actualCostUsd)) fail("PROVIDER_COST_UNVERIFIED", "actualCostUsd を検証できません。");
  if (result.actualCostUsd !== 0 || !Object.is(result.actualCostUsd, 0)) fail("PROVIDER_POLICY_VIOLATION", "actualCostUsd が厳密な$0ポリシーを満たしません。");
  if (typeof result.usage?.costUsd !== "number" || !Number.isFinite(result.usage.costUsd)) fail("PROVIDER_COST_UNVERIFIED", "usage.costUsd を検証できません。");
  if (result.usage.costUsd !== 0 || !Object.is(result.usage.costUsd, 0)) fail("PROVIDER_POLICY_VIOLATION", "usage.costUsd が厳密な$0ポリシーを満たしません。");
  if (!Number.isSafeInteger(result.transportRequestCount) || Number(result.transportRequestCount) < 1) {
    fail("PROVIDER_TRANSPORT_UNVERIFIED", "実際のProvider HTTP送信回数を確認できません。");
  }
  const evidence = result.routingEvidence;
  if (!evidence
    || evidence.provider !== "Groq"
    || evidence.requestedModel !== ORIGIN_GROQ_FREE_MODEL_ID
    || evidence.servedModel !== ORIGIN_GROQ_FREE_MODEL_ID
    || evidence.strategy !== "verified-free-failover"
    || evidence.fallbackUsed !== true
    || evidence.attempt !== 3) {
    fail("PROVIDER_ROUTING_UNVERIFIED", "許可された無料Provider/Modelの証跡を確認できません。");
  }
  if (result.providerDataPolicy.allowProviderFallbacks !== false
    || result.providerDataPolicy.dataCollection !== "deny"
    || result.providerDataPolicy.requireZeroDataRetention !== true) {
    fail("PROVIDER_POLICY_VIOLATION", "0ドル・ZDR固定ポリシーに適合しない実行結果です。");
  }
}

interface GroqChatCompletionEnvelope {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  error?: { code?: unknown; message?: unknown };
}

function inferenceFailure(status: number, body: GroqChatCompletionEnvelope | null): OriginProviderError {
  const errorText = `${String(body?.error?.code ?? "")} ${String(body?.error?.message ?? "")}`.toLowerCase();
  const diagnostic = { upstreamStatus: status };
  if (status === 429 || /rate.?limit|too many requests|tokens per minute|requests per/.test(errorText)) {
    return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, undefined, diagnostic);
  }
  if (status === 401 || status === 403) {
    return new OriginProviderError("PROVIDER_NOT_CONFIGURED", "Provider認証情報を確認できません。", 401, false, undefined, diagnostic);
  }
  if (status === 408 || status === 504) {
    return new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, diagnostic);
  }
  if (status >= 500) {
    return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, diagnostic);
  }
  return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, false, undefined, diagnostic);
}

function extractUsage(body: GroqChatCompletionEnvelope): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const usage = body.usage;
  const promptTokens = Number.isSafeInteger(usage?.prompt_tokens) && Number(usage?.prompt_tokens) >= 0 ? Number(usage?.prompt_tokens) : 0;
  const completionTokens = Number.isSafeInteger(usage?.completion_tokens) && Number(usage?.completion_tokens) >= 0 ? Number(usage?.completion_tokens) : 0;
  const totalTokens = Number.isSafeInteger(usage?.total_tokens) && Number(usage?.total_tokens) >= 0 ? Number(usage?.total_tokens) : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

export interface OriginGroqExecutionOptions {
  catalog?: readonly OriginGroqFreeModelEvidence[];
  nowMs?: number;
}

export async function executeOriginGroqProvider(
  providerRequest: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
  options: OriginGroqExecutionOptions = {},
): Promise<OriginProviderExecutionResult> {
  const apiKey = resolveOriginGroqApiKey(env);
  if (!apiKey) throw new OriginGroqPreflightError("not-configured");

  const transport = { count: 0 };
  try {
    validateGroqPlan(providerRequest.plan);
    if (providerRequest.requiredTool) {
      // Required-tool contracts stay on the primary route: the strict single-call tool
      // contract has not been verified against this route's model.
      throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "必須ツール付きリクエストはフェイルオーバー対象外です。", 400, false);
    }
    const nowMs = options.nowMs ?? Date.now();
    const selection = selectCurrentOriginGroqFreeModel(options.catalog, nowMs);
    if (selection.ok === false) {
      throw new OriginGroqPreflightError(selection.code === "FREE_MODEL_CATALOG_INVALID" ? "catalog-invalid" : "evidence-stale");
    }
    if (!planEvidenceIsCurrent(providerRequest.plan, selection.model, nowMs)) {
      throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "実行計画の無料証拠がカタログと一致しません。", 400, false);
    }

    const messages = [
      { role: "system", content: sanitizePreEgress(providerRequest.systemInstruction) },
      ...providerRequest.messages.map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        content: sanitizePreEgress(message.content),
      })),
    ];
    // TPM gate, enforced before anything is sent: estimate the input from the exact
    // payload above and cap the completion at whatever headroom remains under the
    // free plan's 8,000 tokens/minute. When even a minimal completion no longer fits,
    // the request would predictably hit the rate limit, so the route is skipped.
    const estimatedInputTokens = estimateOriginGroqInputTokens(messages.map((message) => message.content));
    const completionBudget = Math.min(
      originCompletionTokenBudget(providerRequest.plan.taskType),
      ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT - estimatedInputTokens,
    );
    if (completionBudget < MIN_GROQ_COMPLETION_TOKENS) {
      throw new OriginGroqPreflightError("token-budget-exceeded");
    }

    const timeoutMs = Math.min(ORIGIN_GROQ_MAX_REQUEST_TIMEOUT_MS, Math.max(5_000, Number(providerRequest.plan.timeoutMs) || ORIGIN_GROQ_MAX_REQUEST_TIMEOUT_MS));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      transport.count += 1;
      response = await fetchImpl(`${GROQ_API_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: ORIGIN_GROQ_FREE_MODEL_ID,
          messages,
          max_tokens: completionBudget,
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, { transportFailure: "timeout" });
      }
      throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportFailure: "network" });
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => null) as GroqChatCompletionEnvelope | null;
    if (!response.ok || !body) throw inferenceFailure(response.status, body);
    // Served-model identity: the response must name the exact fixed free model.
    if (body.model !== ORIGIN_GROQ_FREE_MODEL_ID) {
      throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "許可された無料Provider/Modelの証跡を確認できません。", 502, false, undefined, { upstreamStatus: response.status });
    }
    const content = body.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true);
    const usage = extractUsage(body);
    const result: OriginProviderExecutionResult = {
      text,
      transportRequestCount: transport.count,
      actualCostUsd: 0,
      providerDataPolicy: providerRequest.plan.providerDataPolicy,
      routingEvidence: {
        requestedModel: ORIGIN_GROQ_FREE_MODEL_ID,
        servedModel: ORIGIN_GROQ_FREE_MODEL_ID,
        strategy: "verified-free-failover",
        provider: "Groq",
        attempt: 3,
        fallbackUsed: true,
      },
      usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, costUsd: 0 },
    };
    assertOriginGroqExecutionResult(result);
    return result;
  } catch (error) {
    if (error instanceof OriginGroqPreflightError) throw error;
    if (error instanceof OriginProviderError) {
      throw new OriginProviderError(error.code, error.message, error.status, error.retryable, error.retryAfterSeconds, {
        ...error.diagnostic,
        transportRequestCount: transport.count,
      });
    }
    throw error;
  }
}
