import {
  ORIGIN_GROQ_FREE_PROVIDER_ID,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  isOriginGroqFreeModelId,
  ORIGIN_GROQ_FREE_MODEL_ID,
  ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
  selectCurrentOriginGroqFreeModelById,
  type OriginGroqFreeModelEvidence,
  type OriginGroqFreeModelId,
} from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
import { sanitizePreEgress } from "../services/securitySanitizer.js";
import {
  originCompletionTokenBudget,
  OriginProviderError,
  safeOriginUpstreamErrorCode,
  type OriginChatMessage,
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
 *
 * Route activation (2026-11-08): as first shipped, this gate made the route
 * structurally inert — the assembled standard chat instruction is about 15,700
 * characters, which the conservative estimator reads as about 7,900 tokens, leaving
 * less than the minimal completion under the 8,000 tokens/minute ceiling, so every
 * standard chat skipped before sending. The chat dispatchers now carry a compact
 * route-specific system instruction on the request (groqSystemInstruction, built by
 * originGroqRouteSystemInstruction in originChatResponsePolicy.ts), and this executor
 * sends that substitute — plus a history trimmed oldest-first to a route input
 * budget — instead of the full-size payload. Routes 1 and 2 are untouched: they
 * never read the substitute field, and requests that do not carry it (such as the
 * grounded-research synthesis) keep the previous behavior on this route exactly.
 *
 * In-route model rotation (2026-11-08): Groq measures the free-plan limits per
 * model, so openai/gpt-oss-20b is a separate quota bucket from the primary
 * openai/gpt-oss-120b. When — and only when — the primary model was actually sent
 * and failed with a rate-limit error or an upstream 5xx overload error, the
 * executor retries once on openai/gpt-oss-20b inside this same route call, under
 * a plan re-derived from that model's own current catalog evidence and with the
 * same per-model pre-send TPM gate and served-model identity check. The dispatch
 * total budget still bounds the route as a whole (the failover dispatcher's
 * bounded fetch aborts in-flight requests when the window expires), so the
 * rotation spends only the budget that remains. Preflight skips, policy or
 * routing-integrity failures, auth failures, and timeouts never rotate: their
 * outcome is surfaced exactly as before. Rotation is invisible outside the
 * route except through the result's routing evidence (requested/served model)
 * and the shared transport count, which honestly counts both sends.
 */

export const ORIGIN_GROQ_API_KEY_ENV = "GROQ_API_KEY" as const;

/** Free-plan tokens/minute ceiling for openai/gpt-oss-120b, verified 2026-11-08. */
export const ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT = 8_000;
/**
 * Free-plan tokens/minute ceiling for the rotation model openai/gpt-oss-20b,
 * taken from Groq's official rate-limits table (checked 2026-11-08), which lists
 * the same 8,000 tokens/minute as the primary model. The organization's own
 * effective value has not been re-verified in the console yet (see the catalog
 * evidence), so this figure only feeds the pre-send estimate: if the real
 * ceiling is lower, the request errors (HTTP 429) instead of charging and no
 * answer is produced from an unverified condition.
 */
export const ORIGIN_GROQ_ROTATION_TOKENS_PER_MINUTE_LIMIT = 8_000;

/** Per-model pre-send tokens/minute ceiling used by the TPM gate below. */
export function originGroqTokensPerMinuteLimit(modelId: OriginGroqFreeModelId): number {
  return modelId === ORIGIN_GROQ_FREE_ROTATION_MODEL_ID
    ? ORIGIN_GROQ_ROTATION_TOKENS_PER_MINUTE_LIMIT
    : ORIGIN_GROQ_TOKENS_PER_MINUTE_LIMIT;
}
/**
 * Route-3 payload discipline: after trimming, the estimated input (system instruction
 * plus kept history) must fit this budget, so at least 2,000 tokens of completion
 * headroom remain under the tokens/minute ceiling before the plan's own completion
 * budget is even considered. Trimming drops the oldest messages first and always
 * keeps the final message (the current user turn); when that message alone exceeds
 * the budget nothing is trimmed away and the TPM gate below decides honestly.
 */
export const ORIGIN_GROQ_ROUTE_INPUT_TOKEN_BUDGET = 6_000;
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

/**
 * Trims conversation history for the third route only: drops the oldest messages
 * until the estimated input (system instruction plus kept messages) fits
 * ORIGIN_GROQ_ROUTE_INPUT_TOKEN_BUDGET. The final message is always kept, even when
 * it alone exceeds the budget — dropping the user's current turn would be worse than
 * an honest gate decision. Routes 1 and 2 never see the trimmed window; the caller's
 * message list is not mutated.
 */
export function trimOriginGroqRouteHistory(
  messages: readonly OriginChatMessage[],
  systemInstruction: string,
): OriginChatMessage[] {
  let kept = [...messages];
  while (
    kept.length > 1
    && estimateOriginGroqInputTokens([systemInstruction, ...kept.map((message) => message.content)])
      > ORIGIN_GROQ_ROUTE_INPUT_TOKEN_BUDGET
  ) {
    kept = kept.slice(1);
  }
  return kept;
}

function validateGroqPlan(plan: OriginExecutionPlan): void {
  if (!plan.freeOnly
    || plan.estimatedCostUsd !== 0
    || plan.providerId !== ORIGIN_GROQ_FREE_PROVIDER_ID
    || !isOriginGroqFreeModelId(plan.modelId)
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

export function assertOriginGroqExecutionResult(result: OriginProviderExecutionResult, expectedModelId?: OriginGroqFreeModelId): void {
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
    || !isOriginGroqFreeModelId(evidence.requestedModel)
    || evidence.servedModel !== evidence.requestedModel
    || (expectedModelId !== undefined && evidence.servedModel !== expectedModelId)
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
  error?: { code?: unknown; type?: unknown; message?: unknown };
}

/**
 * Parses the provider's Retry-After response header (delta-seconds or an
 * HTTP-date) with the same semantics as the primary provider client, so a
 * rate-limit failure can carry the provider's own stated wait to the chat
 * API response. Returns undefined when the header is absent or unparsable:
 * no wait is ever invented here.
 */
const retryAfterSecondsFromHeader = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(1, Math.ceil((timestamp - Date.now()) / 1000)) : undefined;
};

function inferenceFailure(status: number, body: GroqChatCompletionEnvelope | null, retryAfterSeconds?: number): OriginProviderError {
  const errorText = `${String(body?.error?.code ?? "")} ${String(body?.error?.message ?? "")}`.toLowerCase();
  // Keep the provider's raw error code (never the message text) so a classified
  // failure stays identifiable in diagnostics.
  const upstreamErrorCode = safeOriginUpstreamErrorCode(body?.error?.code) ?? safeOriginUpstreamErrorCode(body?.error?.type);
  const diagnostic = { upstreamStatus: status, ...(upstreamErrorCode ? { upstreamErrorCode } : {}) };
  if (status === 429 || /rate.?limit|too many requests|tokens per minute|requests per/.test(errorText)) {
    return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, retryAfterSeconds, diagnostic);
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

/**
 * One send against one catalog model, with every route invariant enforced for
 * that model: plan/policy validation, current per-model evidence, the pre-send
 * TPM gate against that model's ceiling, and served-model identity. The shared
 * transport counter honestly accumulates sends across a rotation.
 */
async function executeGroqModelAttempt(
  providerRequest: OriginProviderExecutionRequest,
  plan: OriginExecutionPlan,
  apiKey: string,
  fetchImpl: OriginFetch,
  options: OriginGroqExecutionOptions,
  transport: { count: number },
): Promise<OriginProviderExecutionResult> {
  validateGroqPlan(plan);
  if (providerRequest.requiredTool) {
    // Required-tool contracts stay on the primary route: the strict single-call tool
    // contract has not been verified against this route's model.
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "必須ツール付きリクエストはフェイルオーバー対象外です。", 400, false);
  }
  const modelId = plan.modelId as OriginGroqFreeModelId;
  const nowMs = options.nowMs ?? Date.now();
  const selection = selectCurrentOriginGroqFreeModelById(options.catalog, modelId, nowMs);
  if (selection.ok === false) {
    throw new OriginGroqPreflightError(selection.code === "FREE_MODEL_CATALOG_INVALID" ? "catalog-invalid" : "evidence-stale");
  }
  if (!planEvidenceIsCurrent(plan, selection.model, nowMs)) {
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "実行計画の無料証拠がカタログと一致しません。", 400, false);
  }

  // Route-3 payload: the compact substitute instruction when the dispatcher
  // provided one, and a history trimmed to the route's input budget. Both are
  // local to this executor — the request object (and therefore routes 1 and 2)
  // keeps the full instruction and the full history window. Trimming estimates
  // from the sanitized texts, so the gate below still measures the exact payload.
  const effectiveSystemInstruction = sanitizePreEgress(
    providerRequest.groqSystemInstruction ?? providerRequest.systemInstruction,
  );
  const sanitizedHistory = providerRequest.messages.map((message) => ({
    ...message,
    content: sanitizePreEgress(message.content),
  }));
  const routeMessages = trimOriginGroqRouteHistory(sanitizedHistory, effectiveSystemInstruction);
  const messages = [
    { role: "system", content: effectiveSystemInstruction },
    ...routeMessages.map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
    })),
  ];
  // TPM gate, enforced before anything is sent: estimate the input from the exact
  // payload above and cap the completion at whatever headroom remains under the
  // model's free-plan tokens/minute ceiling. When even a minimal completion no
  // longer fits, the request would predictably hit the rate limit, so the route
  // is skipped.
  const estimatedInputTokens = estimateOriginGroqInputTokens(messages.map((message) => message.content));
  const completionBudget = Math.min(
    originCompletionTokenBudget(plan.taskType),
    originGroqTokensPerMinuteLimit(modelId) - estimatedInputTokens,
  );
  if (completionBudget < MIN_GROQ_COMPLETION_TOKENS) {
    throw new OriginGroqPreflightError("token-budget-exceeded");
  }

  const timeoutMs = Math.min(ORIGIN_GROQ_MAX_REQUEST_TIMEOUT_MS, Math.max(5_000, Number(plan.timeoutMs) || ORIGIN_GROQ_MAX_REQUEST_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    transport.count += 1;
    response = await fetchImpl(`${GROQ_API_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
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
  if (!response.ok || !body) throw inferenceFailure(response.status, body, retryAfterSecondsFromHeader(response.headers.get("Retry-After")));
  // Served-model identity: the response must name the exact model this attempt
  // requested — the same standard the primary model has always been held to.
  if (body.model !== modelId) {
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
    providerDataPolicy: plan.providerDataPolicy,
    routingEvidence: {
      requestedModel: modelId,
      servedModel: modelId,
      strategy: "verified-free-failover",
      provider: "Groq",
      attempt: 3,
      fallbackUsed: true,
    },
    usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, costUsd: 0 },
  };
  assertOriginGroqExecutionResult(result, modelId);
  return result;
}

/**
 * Rotation is reserved for failures that say "this model's bucket is full or
 * the model is overloaded": a classified rate limit, or an upstream 5xx
 * overload response. Network failures carry no upstream status (the other
 * model sits behind the same API host, so rotating would not help), and
 * timeouts, auth failures, and integrity failures never rotate.
 */
function isGroqRotationTrigger(error: OriginProviderError): boolean {
  if (error.code === "PROVIDER_RATE_LIMITED") return true;
  if (error.code !== "PROVIDER_UNAVAILABLE") return false;
  const upstreamStatus = error.diagnostic?.upstreamStatus;
  return typeof upstreamStatus === "number" && upstreamStatus >= 500;
}

/**
 * Derives the rotation plan from the rotation model's own current catalog
 * evidence. Returns null when that evidence is not current, in which case the
 * primary model's failure is surfaced unchanged (fail closed).
 */
function buildGroqRotationPlan(
  providerRequest: OriginProviderExecutionRequest,
  options: OriginGroqExecutionOptions,
): OriginExecutionPlan | null {
  const nowMs = options.nowMs ?? Date.now();
  const selection = selectCurrentOriginGroqFreeModelById(options.catalog, ORIGIN_GROQ_FREE_ROTATION_MODEL_ID, nowMs);
  if (selection.ok === false) return null;
  const entry = selection.model;
  return {
    ...providerRequest.plan,
    modelId: entry.modelId,
    modelEvidence: {
      providerId: entry.providerId,
      verifiedAt: entry.verifiedAt,
      reviewAfter: entry.reviewAfter,
      sourceUrl: entry.sourceUrl,
    },
  };
}

function withTransportCount(error: unknown, transport: { count: number }): unknown {
  if (error instanceof OriginGroqPreflightError) return error;
  if (error instanceof OriginProviderError) {
    return new OriginProviderError(error.code, error.message, error.status, error.retryable, error.retryAfterSeconds, {
      ...error.diagnostic,
      transportRequestCount: transport.count,
    });
  }
  return error;
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
    return await executeGroqModelAttempt(providerRequest, providerRequest.plan, apiKey, fetchImpl, options, transport);
  } catch (error) {
    if (error instanceof OriginProviderError
      && providerRequest.plan.modelId === ORIGIN_GROQ_FREE_MODEL_ID
      && isGroqRotationTrigger(error)) {
      const rotationPlan = buildGroqRotationPlan(providerRequest, options);
      if (rotationPlan) {
        try {
          return await executeGroqModelAttempt(providerRequest, rotationPlan, apiKey, fetchImpl, options, transport);
        } catch (rotationError) {
          throw withTransportCount(rotationError, transport);
        }
      }
    }
    throw withTransportCount(error, transport);
  }
}
