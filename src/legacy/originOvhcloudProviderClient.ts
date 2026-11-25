import {
  ORIGIN_OVHCLOUD_FREE_PROVIDER_ID,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  isOriginOvhcloudFreeModelId,
  selectCurrentOriginOvhcloudFreeModelById,
  type OriginOvhcloudFreeModelEvidence,
  type OriginOvhcloudFreeModelId,
} from "../lib/orchestration/OriginOvhcloudFreeModelCatalog.js";
import { sanitizePreEgress } from "../services/securitySanitizer.js";
import {
  originCompletionTokenBudget,
  OriginProviderError,
  safeOriginFinishReason,
  safeOriginUpstreamErrorCode,
  type OriginFetch,
  type OriginProviderDiagnostic,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
  type OriginRateLimitSnapshot,
} from "./originProviderClient.js";
import {
  parseOriginRateLimitHeaders,
  recordOriginRateLimitObservation,
} from "./originProviderCapacityLedger.js";

/**
 * OVHcloud route (free-provider failover Phase 4, fourth and final route).
 *
 * This executor is only reachable through originProviderFailover, after the
 * Cloudflare Workers AI route AND the Groq route both ended
 * availability-down in the same dispatch, and only for requests a caller
 * explicitly marked as lightweight and non-confidential
 * (ovhcloudFallbackEligible). The owner approved adopting the OVHcloud AI
 * Endpoints anonymous tier as an auxiliary route on 2026-11-25, on the
 * strength of the evidence in OriginOvhcloudFreeModelCatalog: zero data
 * retention stated on the official product page and contractually in
 * Annex 10 of the Public Cloud specific conditions (the Batch API is an
 * exception to that annex and is never used here), no signup, no API key
 * and no card for the anonymous tier, a limit of 2 requests/minute/IP/
 * model, and no billing path at all — no account and no balance exist,
 * so exceeding the limit returns HTTP 429 and nothing can ever charge.
 *
 * The route is deliberately minimal, matching how thin the anonymous
 * allocation is (a sibling model returned 429 immediately in the
 * 2026-11-25 live probe): exactly one send per dispatch, no retry, no
 * in-route rotation, a short request-timeout cap, and no credential of
 * any kind on the wire (the request carries no Authorization header).
 * It exists only while the kill switch ORIGIN_OVH_FAILOVER_ENABLED is
 * exactly "true" — the default is OFF, and this executor refuses to run
 * while the switch is off, mirroring the Cloudflare client's own
 * not-enabled preflight. Explicit official wording on commercial use of
 * the anonymous tier has not been confirmed, so the eligibility mark is
 * the route's privacy boundary: conversation text and personal data are
 * never sent to it, and required-tool contracts never reach it either.
 */

export const ORIGIN_OVHCLOUD_FAILOVER_ENV = "ORIGIN_OVH_FAILOVER_ENABLED" as const;

/** True only for the exact value "true"; unset or any other value keeps the fourth route off. */
export function isOriginOvhcloudFailoverEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_OVHCLOUD_FAILOVER_ENV] === "true";
}

/**
 * Request-timeout cap for the fourth route. The anonymous tier is a
 * last-resort receiver for lightweight calls, so a single send never
 * waits longer than this; the failover dispatcher's remaining total
 * budget bounds it further in practice.
 */
export const ORIGIN_OVHCLOUD_MAX_REQUEST_TIMEOUT_MS = 20_000;

const OVHCLOUD_API_BASE = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1";

export type OriginOvhcloudPreflightReason =
  | "not-enabled"
  | "catalog-invalid"
  | "evidence-stale";

/**
 * The route was skipped before any inference was sent. Like the Groq and
 * Cloudflare preflight errors, this is deliberately not an
 * OriginProviderError: the dispatcher records the skip and surfaces the
 * earlier routes' error instead.
 */
export class OriginOvhcloudPreflightError extends Error {
  constructor(public readonly reason: OriginOvhcloudPreflightReason) {
    super(`OVHcloud failover route skipped before execution: ${reason}`);
    this.name = "OriginOvhcloudPreflightError";
  }
}

function validateOvhcloudPlan(plan: OriginExecutionPlan): void {
  if (!plan.freeOnly
    || plan.estimatedCostUsd !== 0
    || plan.providerId !== ORIGIN_OVHCLOUD_FREE_PROVIDER_ID
    || !isOriginOvhcloudFreeModelId(plan.modelId)
    || plan.providerDataPolicy.allowProviderFallbacks !== false
    || plan.providerDataPolicy.dataCollection !== "deny"
    || plan.providerDataPolicy.requireZeroDataRetention !== true) {
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "0ドル・ZDR固定ポリシーに適合しない実行計画です。", 400, false);
  }
}

function planEvidenceIsCurrent(plan: OriginExecutionPlan, selected: OriginOvhcloudFreeModelEvidence, nowMs: number): boolean {
  const planVerifiedAt = Date.parse(plan.modelEvidence?.verifiedAt ?? "");
  const planReviewAfter = Date.parse(plan.modelEvidence?.reviewAfter ?? "");
  return plan.modelEvidence?.providerId === ORIGIN_OVHCLOUD_FREE_PROVIDER_ID
    && plan.modelEvidence?.sourceUrl === selected.sourceUrl
    && Number.isFinite(planVerifiedAt)
    && Number.isFinite(planReviewAfter)
    && planVerifiedAt === Date.parse(selected.verifiedAt)
    && planReviewAfter === Date.parse(selected.reviewAfter)
    && nowMs >= planVerifiedAt
    && nowMs <= planReviewAfter;
}

export function assertOriginOvhcloudExecutionResult(result: OriginProviderExecutionResult, expectedModelId?: OriginOvhcloudFreeModelId): void {
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
    || evidence.provider !== "OVHcloud"
    || !isOriginOvhcloudFreeModelId(evidence.requestedModel)
    || evidence.servedModel !== evidence.requestedModel
    || (expectedModelId !== undefined && evidence.servedModel !== expectedModelId)
    || evidence.strategy !== "verified-free-failover"
    || evidence.fallbackUsed !== true
    || evidence.attempt !== 4) {
    fail("PROVIDER_ROUTING_UNVERIFIED", "許可された無料Provider/Modelの証跡を確認できません。");
  }
  if (result.providerDataPolicy.allowProviderFallbacks !== false
    || result.providerDataPolicy.dataCollection !== "deny"
    || result.providerDataPolicy.requireZeroDataRetention !== true) {
    fail("PROVIDER_POLICY_VIOLATION", "0ドル・ZDR固定ポリシーに適合しない実行結果です。");
  }
}

interface OvhcloudChatCompletionEnvelope {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } };
  error?: { code?: unknown; type?: unknown; message?: unknown };
}

/**
 * Parses the provider's Retry-After response header (delta-seconds or an
 * HTTP-date) with the same semantics as the other route clients, so a
 * rate-limit failure can carry the provider's own stated wait. Returns
 * undefined when the header is absent or unparsable: no wait is invented.
 */
const retryAfterSecondsFromHeader = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(1, Math.ceil((timestamp - Date.now()) / 1000)) : undefined;
};

/**
 * Capacity observation, mirroring the Groq route: parses any rate-limit
 * headers this attempt's response carried and records them in the
 * capacity ledger under the model that was actually sent. Observation
 * only — nothing here changes what is sent or how a failure is
 * classified. The anonymous tier may report no such headers, in which
 * case nothing is recorded.
 */
function recordOvhcloudRateLimitObservation(
  modelId: OriginOvhcloudFreeModelId,
  headers: Headers,
  status: number,
): OriginRateLimitSnapshot | undefined {
  const rateLimit = parseOriginRateLimitHeaders(headers);
  if (rateLimit) {
    recordOriginRateLimitObservation({
      providerId: ORIGIN_OVHCLOUD_FREE_PROVIDER_ID,
      modelId,
      snapshot: rateLimit,
      limitHit: status === 429,
    });
  }
  return rateLimit;
}

/** Attaches the observed rate-limit snapshot to a failed attempt's diagnostic, unchanged in every other field. */
function withRateLimitDiagnostic(
  error: OriginProviderError,
  rateLimit: OriginRateLimitSnapshot | undefined,
): OriginProviderError {
  if (!rateLimit) return error;
  return new OriginProviderError(error.code, error.message, error.status, error.retryable, error.retryAfterSeconds, {
    ...error.diagnostic,
    rateLimit,
  });
}

function inferenceFailure(status: number, body: OvhcloudChatCompletionEnvelope | null, retryAfterSeconds?: number): OriginProviderError {
  const errorText = `${String(body?.error?.code ?? "")} ${String(body?.error?.message ?? "")}`.toLowerCase();
  // Keep the provider's raw error code (never the message text) so a classified
  // failure stays identifiable in diagnostics.
  const upstreamErrorCode = safeOriginUpstreamErrorCode(body?.error?.code) ?? safeOriginUpstreamErrorCode(body?.error?.type);
  const diagnostic = { upstreamStatus: status, ...(upstreamErrorCode ? { upstreamErrorCode } : {}) };
  if (status === 429 || /rate.?limit|too many requests|requests per/.test(errorText)) {
    return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, retryAfterSeconds, diagnostic);
  }
  if (status === 401 || status === 403) {
    // The anonymous tier needs no credential, so an auth refusal means the
    // tier's terms changed underneath the catalog evidence: the route is
    // not configured the way its evidence describes (fail closed).
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

function extractUsage(body: OvhcloudChatCompletionEnvelope): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const usage = body.usage;
  const promptTokens = Number.isSafeInteger(usage?.prompt_tokens) && Number(usage?.prompt_tokens) >= 0 ? Number(usage?.prompt_tokens) : 0;
  const completionTokens = Number.isSafeInteger(usage?.completion_tokens) && Number(usage?.completion_tokens) >= 0 ? Number(usage?.completion_tokens) : 0;
  const totalTokens = Number.isSafeInteger(usage?.total_tokens) && Number(usage?.total_tokens) >= 0 ? Number(usage?.total_tokens) : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * The reasoning-token count the provider broke out of the completion
 * total, when it reported one (gpt-oss generations spend on reasoning
 * before any answer text exists).
 */
function extractReasoningTokens(usage: { completion_tokens_details?: { reasoning_tokens?: unknown } } | undefined): number | undefined {
  const value = usage?.completion_tokens_details?.reasoning_tokens;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

/**
 * The usage fields a failed attempt records on its error diagnostic,
 * mirroring the other routes: counts only, never payload content.
 */
function usageDiagnosticFields(
  usage: { promptTokens: number; completionTokens: number },
  reasoningTokens: number | undefined,
): Partial<OriginProviderDiagnostic> {
  return {
    usagePromptTokens: usage.promptTokens,
    usageCompletionTokens: usage.completionTokens,
    ...(reasoningTokens !== undefined ? { usageReasoningTokens: reasoningTokens } : {}),
  };
}

export interface OriginOvhcloudExecutionOptions {
  catalog?: readonly OriginOvhcloudFreeModelEvidence[];
  nowMs?: number;
}

function withTransportCount(error: unknown, transport: { count: number }): unknown {
  if (error instanceof OriginOvhcloudPreflightError) return error;
  if (error instanceof OriginProviderError) {
    return new OriginProviderError(error.code, error.message, error.status, error.retryable, error.retryAfterSeconds, {
      ...error.diagnostic,
      transportRequestCount: transport.count,
    });
  }
  return error;
}

/**
 * The fourth route's single send. Every route invariant is enforced
 * before and after it: the kill switch, plan/policy validation, current
 * catalog evidence matching the plan's own evidence, served-model
 * identity, and the shared $0 result assertion. Exactly one request is
 * ever sent — no retry and no rotation, by design (see the module
 * header). The payload is the standard instruction and history,
 * sanitized exactly like the other routes send them; no route-specific
 * substitute exists for this tier.
 */
export async function executeOriginOvhcloudProvider(
  providerRequest: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
  options: OriginOvhcloudExecutionOptions = {},
): Promise<OriginProviderExecutionResult> {
  if (!isOriginOvhcloudFailoverEnabled(env)) throw new OriginOvhcloudPreflightError("not-enabled");
  const plan = providerRequest.plan;
  validateOvhcloudPlan(plan);
  if (providerRequest.requiredTool) {
    // Required-tool contracts stay on the primary route: the strict
    // single-call tool contract has not been verified against this
    // route's model (and the failover entries never route them here).
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "必須ツール付きリクエストはフェイルオーバー対象外です。", 400, false);
  }
  const modelId = plan.modelId as OriginOvhcloudFreeModelId;
  const nowMs = options.nowMs ?? Date.now();
  const selection = selectCurrentOriginOvhcloudFreeModelById(options.catalog, modelId, nowMs);
  if (selection.ok === false) {
    throw new OriginOvhcloudPreflightError(selection.code === "FREE_MODEL_CATALOG_INVALID" ? "catalog-invalid" : "evidence-stale");
  }
  if (!planEvidenceIsCurrent(plan, selection.model, nowMs)) {
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "実行計画の無料証拠がカタログと一致しません。", 400, false);
  }

  const messages = [
    { role: "system", content: sanitizePreEgress(providerRequest.systemInstruction) },
    ...providerRequest.messages.map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      content: sanitizePreEgress(message.content),
    })),
  ];
  const completionBudget = originCompletionTokenBudget(plan.taskType);
  const timeoutMs = Math.min(ORIGIN_OVHCLOUD_MAX_REQUEST_TIMEOUT_MS, Math.max(5_000, Number(plan.timeoutMs) || ORIGIN_OVHCLOUD_MAX_REQUEST_TIMEOUT_MS));

  const transport = { count: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    transport.count += 1;
    response = await fetchImpl(`${OVHCLOUD_API_BASE}/chat/completions`, {
      method: "POST",
      // Anonymous tier: no Authorization header is sent, by design. There
      // is no credential to leak, and adding one would leave the tier the
      // evidence describes.
      headers: { "Content-Type": "application/json" },
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
      throw withTransportCount(new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, { transportFailure: "timeout" }), transport);
    }
    throw withTransportCount(new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportFailure: "network" }), transport);
  } finally {
    clearTimeout(timer);
  }

  const rateLimit = recordOvhcloudRateLimitObservation(modelId, response.headers, response.status);
  const body = await response.json().catch(() => null) as OvhcloudChatCompletionEnvelope | null;
  if (!response.ok || !body) {
    throw withTransportCount(withRateLimitDiagnostic(inferenceFailure(response.status, body, retryAfterSecondsFromHeader(response.headers.get("Retry-After"))), rateLimit), transport);
  }
  // Served-model identity: the response must name the exact model this
  // attempt requested — the same standard every other route is held to.
  if (body.model !== modelId) {
    throw withTransportCount(withRateLimitDiagnostic(new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "許可された無料Provider/Modelの証跡を確認できません。", 502, false, undefined, { upstreamStatus: response.status }), rateLimit), transport);
  }
  const usage = extractUsage(body);
  const content = body.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) {
    const finishReason = safeOriginFinishReason(body.choices?.[0]?.finish_reason);
    throw withTransportCount(withRateLimitDiagnostic(new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true, undefined, {
      ...(finishReason ? { finishReason } : {}),
      ...usageDiagnosticFields(usage, extractReasoningTokens(body.usage)),
    }), rateLimit), transport);
  }
  const result: OriginProviderExecutionResult = {
    text,
    transportRequestCount: transport.count,
    actualCostUsd: 0,
    providerDataPolicy: plan.providerDataPolicy,
    routingEvidence: {
      requestedModel: modelId,
      servedModel: modelId,
      strategy: "verified-free-failover",
      provider: "OVHcloud",
      attempt: 4,
      fallbackUsed: true,
    },
    usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, costUsd: 0 },
    ...(rateLimit ? { rateLimit } : {}),
  };
  assertOriginOvhcloudExecutionResult(result, modelId);
  return result;
}
