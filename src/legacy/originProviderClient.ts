import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
  type OriginProviderDataPolicy,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import { sanitizePreEgress, sanitizePreEgressPayload } from "../services/securitySanitizer.js";
import { ORIGIN_ZERO_COST_OPENROUTER_POLICY_STAGES } from "./zeroCostRoutingPolicy.js";

export interface OriginChatMessage { role: "user" | "ai" | "assistant" | "model"; content: string; }
export interface OriginProviderRequiredTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface OriginProviderExecutionRequest {
  plan: OriginExecutionPlan;
  messages: OriginChatMessage[];
  systemInstruction: string;
  /**
   * Optional route-3-only substitute system instruction. The Groq executor sends this
   * instead of `systemInstruction` so its payload can pass the free plan's
   * tokens/minute gate (the assembled standard instruction estimates to nearly the
   * whole 8,000-token ceiling by itself). Routes 1 and 2 never read this field and
   * always receive `systemInstruction` unchanged, and callers that do not set it —
   * for example the grounded-research synthesis — keep the previous route-3 behavior
   * exactly.
   */
  groqSystemInstruction?: string;
  /**
   * Optional text-release policy for the upstream streaming executor; every other
   * executor ignores this field. "hold-until-verified" (also the behavior when the
   * field is absent) releases the answer text only after the stream has terminated
   * and every billing/routing check has passed — the original behavior. "incremental"
   * forwards each chunk's text as it arrives, but only after that chunk itself has
   * passed the served-model identity and billing-metadata checks; the terminal
   * checks (final usage cost, stream completion, finish reason) still run before
   * the result is returned, so downstream admission — the client's verified-stream
   * completion contract — is unchanged, and a terminal failure still discards the
   * provisionally displayed text. The streaming chat router sets "incremental" only
   * for requests whose review decision does not require verification; every other
   * caller keeps the hold behavior.
   */
  streamRelease?: "hold-until-verified" | "incremental";
  /** Optional single required function contract. The provider must return exactly one matching tool call. */
  requiredTool?: OriginProviderRequiredTool;
}
export interface OriginProviderRoutingEvidence { requestedModel: string; servedModel: string; strategy: string; provider: string; region?: string; attempt: number; fallbackUsed: boolean; neurons?: number; }
/**
 * One executed route attempt inside a failover composite result. Results only ever carry
 * attempts that were actually executed; routes that were skipped before execution (for
 * example a missing token or stale evidence) are recorded on the error diagnostic instead.
 */
export interface OriginProviderAttemptEvidence { providerId: string; modelId: string; outcome: "succeeded" | "availability-error" | "failed" | "skipped"; errorCode?: OriginProviderErrorCode; skipReason?: string; upstreamStatus?: number; upstreamErrorType?: string; upstreamErrorCode?: string; transportRequestCount?: number; }
export interface OriginProviderExecutionResult { text: string; transportRequestCount?: number; actualCostUsd: 0; providerDataPolicy: OriginProviderDataPolicy; routingEvidence: OriginProviderRoutingEvidence; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd: 0; }; attempts?: readonly OriginProviderAttemptEvidence[]; }
export type OriginProviderErrorCode = "PROVIDER_NOT_CONFIGURED" | "PROVIDER_POLICY_VIOLATION" | "PROVIDER_COST_UNVERIFIED" | "PROVIDER_ROUTING_UNVERIFIED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "PROVIDER_INVALID_RESPONSE" | "PROVIDER_REQUIRED_TOOL_MISSING" | "PROVIDER_REQUIRED_TOOL_AMBIGUOUS" | "PROVIDER_REQUIRED_TOOL_INVALID" | "PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID" | "PROVIDER_REQUIRED_TOOL_TRUNCATED" | "PROVIDER_TRANSPORT_UNVERIFIED" | "PROVIDER_INTERNAL_ERROR";
export interface OriginProviderDiagnostic { upstreamStatus?: number; upstreamErrorType?: string; upstreamErrorCode?: string; transportFailure?: "timeout" | "network"; transportRequestCount?: number; failoverAttempts?: readonly OriginProviderAttemptEvidence[]; }

function safeProviderMessage(code: OriginProviderErrorCode): string {
  switch (code) {
    case "PROVIDER_NOT_CONFIGURED": return "利用可能な無料AIが設定されていません。";
    case "PROVIDER_RATE_LIMITED": return "無料AIの利用上限に達しました。";
    case "PROVIDER_TIMEOUT": return "無料AIがタイムアウトしました。";
    case "PROVIDER_UNAVAILABLE": return "無料AIを現在利用できません。";
    case "PROVIDER_INVALID_RESPONSE": return "無料AIから有効な応答を取得できません。";
    case "PROVIDER_REQUIRED_TOOL_MISSING": return "無料AIの必須ツール呼び出しを確認できません。";
    case "PROVIDER_REQUIRED_TOOL_AMBIGUOUS": return "無料AIの必須ツール呼び出しを一意に確認できません。";
    case "PROVIDER_REQUIRED_TOOL_INVALID": return "無料AIの必須ツール呼び出しが契約に適合しません。";
    case "PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID": return "無料AIの必須ツール引数を確認できません。";
    case "PROVIDER_REQUIRED_TOOL_TRUNCATED": return "無料AIの必須ツール出力が完了しませんでした。";
    case "PROVIDER_COST_UNVERIFIED": return "無料実行の費用を確認できません。";
    case "PROVIDER_ROUTING_UNVERIFIED": return "許可された無料Provider/Modelの証跡を確認できません。";
    case "PROVIDER_TRANSPORT_UNVERIFIED": return "実際のProvider HTTP送信回数を確認できません。";
    case "PROVIDER_POLICY_VIOLATION": return "0ドル固定ポリシーに適合しない実行計画です。";
    case "PROVIDER_INTERNAL_ERROR": return "無料AIとの通信に失敗しました。";
    default: return "無料AIを現在利用できません。";
  }
}

export class OriginProviderError extends Error {
  constructor(public readonly code: OriginProviderErrorCode, _message: string, public readonly status: number, public readonly retryable: boolean, public readonly retryAfterSeconds?: number, public readonly diagnostic?: OriginProviderDiagnostic) {
    super(safeProviderMessage(code));
    this.name = "OriginProviderError";
  }
}

/**
 * Failure diagnostics that are safe to surface: the chat failure response body and
 * the server log line both carry exactly this shape. The internal
 * OriginProviderDiagnostic is metadata-only by convention, but its string fields
 * are populated from upstream payloads and multiple construction sites, so
 * anything client- or log-visible is rebuilt here from a whitelist — numbers,
 * this module's own error-code enum, route identifiers in their known shapes,
 * skip reasons in their known shapes, and upstream error codes/types reduced to
 * the providers' public vocabularies. Free-form upstream text (messages, bodies)
 * and anything shaped like a credential can never pass; the tests pin that down
 * with deliberately poisoned diagnostic values.
 */
export interface OriginProviderAttemptDiagnostic {
  providerId: string;
  modelId: string;
  outcome: OriginProviderAttemptEvidence["outcome"];
  errorCode?: OriginProviderErrorCode;
  skipReason?: string;
  upstreamStatus?: number;
  upstreamErrorType?: string;
  upstreamErrorCode?: string;
  transportRequestCount?: number;
}

export interface OriginProviderFailureDiagnostic {
  upstreamStatus?: number;
  upstreamErrorType?: string;
  upstreamErrorCode?: string;
  transportFailure?: "timeout" | "network";
  transportRequestCount?: number;
  failoverAttempts: OriginProviderAttemptDiagnostic[];
}

const ORIGIN_PROVIDER_ERROR_CODE_SET: ReadonlySet<string> = new Set([
  "PROVIDER_NOT_CONFIGURED", "PROVIDER_POLICY_VIOLATION", "PROVIDER_COST_UNVERIFIED",
  "PROVIDER_ROUTING_UNVERIFIED", "PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT", "PROVIDER_INVALID_RESPONSE", "PROVIDER_REQUIRED_TOOL_MISSING",
  "PROVIDER_REQUIRED_TOOL_AMBIGUOUS", "PROVIDER_REQUIRED_TOOL_INVALID",
  "PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID", "PROVIDER_REQUIRED_TOOL_TRUNCATED",
  "PROVIDER_TRANSPORT_UNVERIFIED", "PROVIDER_INTERNAL_ERROR",
]);

function safeUpstreamStatusValue(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : undefined;
}

/**
 * The upstream error types that may be surfaced verbatim. Mirrors the allowlist
 * the trusted-answer proxy applies to the same field: OpenRouter's embedded
 * error vocabulary is small and public, everything else stays internal.
 */
export function safeOriginUpstreamErrorType(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:rate_limit_exceeded|timeout|provider_overloaded|provider_unavailable)$/.test(value)
    ? value
    : undefined;
}

/**
 * A raw provider-issued error code that may be kept in diagnostics: Workers AI
 * numeric codes and OpenAI-style snake_case code tokens (Groq). Anything with
 * spaces, punctuation beyond "_", or free-form length is rejected, so an
 * upstream message sentence or an injected secret can never ride this field.
 * Used both when clients capture a code from an upstream payload and when the
 * failure summary below re-validates what it surfaces.
 */
export function safeOriginUpstreamErrorCode(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 && value <= 9_999_999_999 ? String(value) : undefined;
  }
  if (typeof value !== "string") return undefined;
  if (/^\d{1,10}$/.test(value)) return value;
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

function safeRouteIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9@][A-Za-z0-9@/_:.+-]{0,127}$/.test(value) ? value : undefined;
}

function safeSkipReason(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 128 && /^[a-z][a-z0-9-]*(?::[A-Za-z0-9_]+)?$/.test(value) ? value : undefined;
}

function safeTransportRequestCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000 ? Number(value) : undefined;
}

function summarizeOriginProviderAttempt(attempt: OriginProviderAttemptEvidence): OriginProviderAttemptDiagnostic | null {
  if (!attempt || typeof attempt !== "object") return null;
  const providerId = safeRouteIdentifier(attempt.providerId);
  const modelId = safeRouteIdentifier(attempt.modelId);
  if (!providerId || !modelId) return null;
  if (!["succeeded", "availability-error", "failed", "skipped"].includes(attempt.outcome)) return null;
  const summary: OriginProviderAttemptDiagnostic = { providerId, modelId, outcome: attempt.outcome };
  if (attempt.errorCode && ORIGIN_PROVIDER_ERROR_CODE_SET.has(attempt.errorCode)) summary.errorCode = attempt.errorCode;
  const skipReason = safeSkipReason(attempt.skipReason);
  if (skipReason) summary.skipReason = skipReason;
  const upstreamStatus = safeUpstreamStatusValue(attempt.upstreamStatus);
  if (upstreamStatus !== undefined) summary.upstreamStatus = upstreamStatus;
  const upstreamErrorType = safeOriginUpstreamErrorType(attempt.upstreamErrorType);
  if (upstreamErrorType) summary.upstreamErrorType = upstreamErrorType;
  const upstreamErrorCode = safeOriginUpstreamErrorCode(attempt.upstreamErrorCode);
  if (upstreamErrorCode) summary.upstreamErrorCode = upstreamErrorCode;
  const transportRequestCount = safeTransportRequestCount(attempt.transportRequestCount);
  if (transportRequestCount !== undefined) summary.transportRequestCount = transportRequestCount;
  return summary;
}

/**
 * Builds the surfaced failure diagnostic for one provider error: the surfaced
 * error's own upstream metadata plus every recorded failover attempt, each
 * reduced to the whitelist above. The result is plain JSON-safe data, so the
 * chat routers can embed it in the failure response and serialize it into the
 * log line (where nested objects previously collapsed to "[Object]").
 */
export function buildOriginProviderFailureDiagnostic(error: OriginProviderError): OriginProviderFailureDiagnostic {
  const diagnostic = error.diagnostic;
  const summary: OriginProviderFailureDiagnostic = { failoverAttempts: [] };
  const upstreamStatus = safeUpstreamStatusValue(diagnostic?.upstreamStatus);
  if (upstreamStatus !== undefined) summary.upstreamStatus = upstreamStatus;
  const upstreamErrorType = safeOriginUpstreamErrorType(diagnostic?.upstreamErrorType);
  if (upstreamErrorType) summary.upstreamErrorType = upstreamErrorType;
  const upstreamErrorCode = safeOriginUpstreamErrorCode(diagnostic?.upstreamErrorCode);
  if (upstreamErrorCode) summary.upstreamErrorCode = upstreamErrorCode;
  if (diagnostic?.transportFailure === "timeout" || diagnostic?.transportFailure === "network") {
    summary.transportFailure = diagnostic.transportFailure;
  }
  const transportRequestCount = safeTransportRequestCount(diagnostic?.transportRequestCount);
  if (transportRequestCount !== undefined) summary.transportRequestCount = transportRequestCount;
  if (Array.isArray(diagnostic?.failoverAttempts)) {
    for (const attempt of diagnostic.failoverAttempts) {
      const summarized = summarizeOriginProviderAttempt(attempt);
      if (summarized) summary.failoverAttempts.push(summarized);
    }
  }
  return summary;
}

export type OriginFetch = typeof fetch;
const RETRY: readonly number[] = [700, 1_800];
const MAX_PROVIDER_TOTAL_BUDGET_MS = 60_000;
const MAX_PROVIDER_REQUEST_TIMEOUT_MS = 52_000;
const MAX_SEGMENTS = 1;
const MAX_TOOL_SCHEMA_BYTES = 32 * 1024;
const MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;
const REQUIRED_TOOL_REASONING = { effort: "minimal", exclude: true } as const;
export const ALLOWED_ZERO_COST_PROVIDERS = ["openrouter"] as const;
export type AllowedZeroCostProvider = (typeof ALLOWED_ZERO_COST_PROVIDERS)[number];
export const ALLOWED_ZERO_COST_MODELS = { openrouter: [ORIGIN_OPENROUTER_FREE_MODEL] } as const;
const OPENROUTER_CANONICAL_SERVED_MODEL = ORIGIN_OPENROUTER_FREE_MODEL.replace(/:free$/, "");
const IDS: Record<string, AllowedZeroCostProvider> = { OpenRouter: "openrouter", "openrouter-free": "openrouter" };
export function resetOriginProviderCooldownForTests(): void { /* retained for test compatibility; cooldown circuit was removed */ }
const pid = (value: unknown): AllowedZeroCostProvider | null => {
  if (typeof value !== "string") return null;
  return IDS[value] ?? (ALLOWED_ZERO_COST_PROVIDERS.includes(value as AllowedZeroCostProvider) ? value as AllowedZeroCostProvider : null);
};
const allowed = (provider: AllowedZeroCostProvider, model: unknown): model is string => typeof model === "string" && ((ALLOWED_ZERO_COST_MODELS[provider] as readonly string[]).includes(model) || (provider === "openrouter" && model === OPENROUTER_CANONICAL_SERVED_MODEL));
function fail(message: string, code: OriginProviderErrorCode = "PROVIDER_POLICY_VIOLATION"): never { throw new OriginProviderError(code, message, 502, false); }
function zero(value: unknown, field: string): asserts value is 0 {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} を検証できません。`, "PROVIDER_COST_UNVERIFIED");
  if (value !== 0 || !Object.is(value, 0)) fail(`${field} が厳密な$0ポリシーを満たしません。`, "PROVIDER_POLICY_VIOLATION");
}
function nonzeroIfPresent(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) fail(`${field} を検証できません。`, "PROVIDER_COST_UNVERIFIED");
  if (numeric !== 0 || !Object.is(numeric, 0)) fail(`${field} が厳密な$0ポリシーを満たしません。`, "PROVIDER_POLICY_VIOLATION");
}
function assertBillingMetadata(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const data = payload as { billing_tier?: unknown; is_free?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; usage?: { cost_details?: { upstream_inference_cost?: unknown }; is_byok?: unknown } };
  if (data.billing_tier !== undefined && String(data.billing_tier).toLowerCase() !== "free") fail("有料の課金ティアが検出されました。", "PROVIDER_POLICY_VIOLATION");
  if (data.is_free === false) fail("無料モデルではない証跡が検出されました。", "PROVIDER_POLICY_VIOLATION");
  nonzeroIfPresent(data.pricing?.prompt, "pricing.prompt");
  nonzeroIfPresent(data.pricing?.completion, "pricing.completion");
  nonzeroIfPresent(data.usage?.cost_details?.upstream_inference_cost, "usage.cost_details.upstream_inference_cost");
  if (data.usage?.is_byok !== false) fail("is_byok=false の明示的な証跡がないため遮断しました。", "PROVIDER_POLICY_VIOLATION");
}
export function assertOriginZeroCostExecutionResult(result: OriginProviderExecutionResult, expectedModel?: string, expectedProvider?: string): void {
  if (!result || typeof result !== "object") fail("実行結果を検証できません。", "PROVIDER_COST_UNVERIFIED");
  zero(result.actualCostUsd, "actualCostUsd");
  zero(result.usage?.costUsd, "usage.costUsd");
  if (!Number.isSafeInteger(result.transportRequestCount) || Number(result.transportRequestCount) < 1) {
    fail("実際のProvider HTTP送信回数を確認できません。", "PROVIDER_TRANSPORT_UNVERIFIED");
  }
  const evidence = result.routingEvidence;
  const provider = pid(evidence?.provider);
  if (!evidence || !provider || !allowed(provider, evidence.servedModel)) fail("許可された無料Provider/Modelの証跡を確認できません。", "PROVIDER_ROUTING_UNVERIFIED");
  if (expectedModel && evidence.requestedModel !== expectedModel) fail("要求モデルが一致しません。", "PROVIDER_ROUTING_UNVERIFIED");
  if (evidence.attempt !== 1) fail("不正な試行番号です。", "PROVIDER_ROUTING_UNVERIFIED");
  const validStrategy = evidence.strategy === "adaptive-primary";
  const validFallback = evidence.fallbackUsed === false;
  const validServedModel = evidence.requestedModel === evidence.servedModel || evidence.servedModel === OPENROUTER_CANONICAL_SERVED_MODEL;
  if (!validStrategy || !validFallback || !validServedModel) fail("Provider fallback またはPrimary証跡が不正です。", "PROVIDER_ROUTING_UNVERIFIED");
  if (expectedProvider && pid(expectedProvider) !== provider) fail("Providerが一致しません。", "PROVIDER_ROUTING_UNVERIFIED");
}
export function originCompletionTokenBudget(taskType: OriginExecutionPlan["taskType"], requiredTool = false): number {
  if (requiredTool) return 8192;
  switch (taskType) {
    case "implementation": case "documentation": return 6144;
    case "research": case "review": case "architecture": case "security": case "current-information": case "operations": case "ux": return 4096;
    default: return 2400;
  }
}
const msgs = (messages: OriginChatMessage[], systemInstruction: string) => [
  { role: "system", content: sanitizePreEgress(systemInstruction) },
  ...messages.map((message) => ({ role: message.role === "user" ? "user" : "assistant", content: sanitizePreEgress(message.content) })),
];
const text = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string").map((part) => String((part as { text: string }).text).trim()).filter(Boolean).join("\n\n").trim();
};
function mergeContinuation(previous: string, continuation: string): string {
  const left = previous.trimEnd();
  const right = continuation.trimStart();
  for (let length = Math.min(left.length, right.length, 500); length >= 20; length -= 1) if (left.slice(-length) === right.slice(0, length)) return `${left}${right.slice(length)}`.trim();
  return `${left}\n\n${right}`.trim();
}
const retryAfter = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(1, Math.ceil((timestamp - Date.now()) / 1000)) : undefined;
};
/**
 * Rebuilds an http()-classified error keeping its status/transport diagnostic
 * while also recording the upstream's embedded error type, so a 429 caused by
 * rate_limit_exceeded stays distinguishable in failure diagnostics from a bare
 * HTTP 429.
 */
function withUpstreamErrorType(error: OriginProviderError, errorType: unknown): OriginProviderError {
  if (typeof errorType !== "string" || errorType.length === 0) return error;
  return new OriginProviderError(error.code, error.message, error.status, error.retryable, error.retryAfterSeconds, { ...error.diagnostic, upstreamErrorType: errorType });
}

function http(status: number, retryAfterSeconds?: number): OriginProviderError {
  const diagnostic = { upstreamStatus: status };
  if (status === 401) return new OriginProviderError("PROVIDER_NOT_CONFIGURED", "Provider認証情報を確認できません。", 401, false, undefined, diagnostic);
  if (status === 402) return new OriginProviderError("PROVIDER_POLICY_VIOLATION", "無料実行として確認できない課金状態です。", 502, false, undefined, diagnostic);
  if (status === 429) return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, false, retryAfterSeconds, diagnostic);
  if (status === 400 || status === 404 || status === 422) return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, false, undefined, diagnostic);
  if (status === 408 || status === 504) return new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, diagnostic);
  return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, diagnostic);
}
async function json(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true); }
}
async function request(fetchImpl: OriginFetch, input: RequestInfo | URL, init: RequestInit, timeoutMs: number, transport: { count: number }): Promise<Response> {
  const deadline = Date.now() + MAX_PROVIDER_TOTAL_BUDGET_MS;
  let last: unknown;
  for (let index = 0; index < 3; index += 1) {
    if (index) {
      const delay = RETRY[index - 1];
      if (Date.now() + delay >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const attemptTimeout = Math.max(1, Math.min(timeoutMs, remaining, 18_000));
    const timer = setTimeout(() => controller.abort(), attemptTimeout);
    try {
      transport.count += 1;
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      if ([401, 402, 403, 429].includes(response.status)) {
        if (response.status === 403) return response;
        throw http(response.status, retryAfter(response.headers.get("Retry-After")));
      }
      if (response.status === 404) return response;
      if (![408, 500, 502, 503, 504].includes(response.status)) return response;
      last = http(response.status, retryAfter(response.headers.get("Retry-After")));
    } catch (error) {
      if (error instanceof OriginProviderError) {
        if (!error.retryable || index === 2 || Date.now() >= deadline) throw error;
        last = error;
      } else {
        last = error;
      }
      if (index === 2 || Date.now() >= deadline) break;
    } finally { clearTimeout(timer); }
  }
  if (last instanceof OriginProviderError) throw last;
  throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIとの通信に失敗しました。", 504, true);
}
function validate(plan: OriginExecutionPlan): void {
  const provider = pid(plan.providerId);
  if (!plan.freeOnly || plan.estimatedCostUsd !== 0 || plan.providerDataPolicy.allowProviderFallbacks !== false || plan.providerDataPolicy.dataCollection !== "deny" || plan.providerDataPolicy.requireZeroDataRetention !== true || !provider || !allowed(provider, plan.modelId)) throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "0ドル・ZDR固定ポリシーに適合しない実行計画です。", 400, false);
}
function validateRequiredTool(tool: OriginProviderRequiredTool | undefined): void {
  if (!tool) return;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) || typeof tool.description !== "string" || !tool.description || tool.description.length > 1000 || !tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) fail("必須ツール契約が不正です。", "PROVIDER_POLICY_VIOLATION");
  const serialized = JSON.stringify(tool.parameters);
  if (Buffer.byteLength(serialized, "utf8") > MAX_TOOL_SCHEMA_BYTES) fail("必須ツール契約が大きすぎます。", "PROVIDER_POLICY_VIOLATION");
}
function evidence(requestData: OriginProviderExecutionRequest, servedModel: string): OriginProviderRoutingEvidence {
  return { requestedModel: requestData.plan.modelId, servedModel, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false };
}
type OpenRouterMessage = {
  content?: unknown;
  tool_calls?: Array<{ type?: unknown; function?: { name?: unknown; arguments?: unknown } }>;
};
function requiredToolArguments(message: OpenRouterMessage | undefined, requiredTool: OriginProviderRequiredTool): string {
  const calls = message?.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) throw new OriginProviderError("PROVIDER_REQUIRED_TOOL_MISSING", "必須ツール呼び出しを確認できません。", 502, true);
  if (calls.length !== 1) throw new OriginProviderError("PROVIDER_REQUIRED_TOOL_AMBIGUOUS", "必須ツール呼び出しを一意に確認できません。", 502, true);
  const call = calls[0];
  const args = call?.function?.arguments;
  if (call?.type !== "function" || call.function?.name !== requiredTool.name) throw new OriginProviderError("PROVIDER_REQUIRED_TOOL_INVALID", "必須ツール呼び出しが契約に適合しません。", 502, true);
  if (typeof args !== "string" || !args.trim() || Buffer.byteLength(args, "utf8") > MAX_TOOL_ARGUMENT_BYTES) throw new OriginProviderError("PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID", "必須ツール引数を確認できません。", 502, true);
  return args.trim();
}
async function openrouter(requestData: OriginProviderExecutionRequest, key: string, fetchImpl: OriginFetch, provider: AllowedZeroCostProvider, transport: { count: number }): Promise<OriginProviderExecutionResult> {
  let messages = msgs(requestData.messages, requestData.systemInstruction);
  let output = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (let index = 0; index < MAX_SEGMENTS; index += 1) {
    const response = await requestFetch(fetchImpl, requestData, key, messages, transport);
    if (!response.ok) throw http(response.status, retryAfter(response.headers.get("Retry-After")));
    const data = await json(response) as {
      model?: unknown;
      choices?: Array<{ message?: OpenRouterMessage; finish_reason?: unknown; error?: { metadata?: { error_type?: unknown } } }>;
      error?: { metadata?: { error_type?: unknown } };
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number; cost_details?: { upstream_inference_cost?: unknown }; is_byok?: unknown };
      billing_tier?: unknown;
      is_free?: unknown;
      pricing?: { prompt?: unknown; completion?: unknown };
    };
    const choice = data.choices?.[0];
    const errorType = choice?.error?.metadata?.error_type ?? data.error?.metadata?.error_type;
    if (errorType === "rate_limit_exceeded") throw withUpstreamErrorType(http(429), errorType);
    if (errorType === "timeout") throw withUpstreamErrorType(http(504), errorType);
    if (errorType === "provider_overloaded" || errorType === "provider_unavailable") throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { upstreamErrorType: String(errorType) });
    // Never substitute the requested model when the provider omits its served-model identity.
    // Missing identity is unverified routing and must fail closed before any result is returned.
    if (typeof data.model !== "string" || !data.model.trim()) {
      throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "OpenRouterの提供モデルを確認できません。", 502, false);
    }
    const servedModel = data.model.trim();
    if (!allowed(provider, servedModel)) throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "OpenRouter無料モデルを確認できません。", 502, false, undefined, { upstreamErrorType: `served-model:${servedModel}` });
    // Validate required-tool structure before provider billing metadata so malformed tool
    // responses receive their precise contract error. Nothing is returned or emitted until
    // all billing and routing policy checks below have also succeeded.
    let requiredOutput: string | undefined;
    if (requestData.requiredTool) {
      if (choice?.finish_reason === "length") throw new OriginProviderError("PROVIDER_REQUIRED_TOOL_TRUNCATED", "必須ツール出力が完了しませんでした。", 502, true);
      requiredOutput = requiredToolArguments(choice?.message, requestData.requiredTool);
    }

    assertBillingMetadata(data);
    promptTokens += data.usage?.prompt_tokens ?? 0;
    completionTokens += data.usage?.completion_tokens ?? 0;
    totalTokens += data.usage?.total_tokens ?? 0;
    zero(data.usage?.cost, "usage.cost");

    if (requestData.requiredTool) {
      output = requiredOutput as string;
    } else {
      const part = text(choice?.message?.content);
      if (!part) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "OpenRouterから回答を取得できません。", 502, true);
      output = output ? mergeContinuation(output, part) : part;
    }

    if (choice?.finish_reason !== "length") {
      const result: OriginProviderExecutionResult = { text: output, transportRequestCount: transport.count, actualCostUsd: 0, providerDataPolicy: requestData.plan.providerDataPolicy, routingEvidence: evidence(requestData, String(servedModel)), usage: { promptTokens, completionTokens, totalTokens, costUsd: 0 } };
      assertOriginZeroCostExecutionResult(result, requestData.plan.modelId, requestData.plan.providerId);
      return result;
    }
    if (index === MAX_SEGMENTS - 1) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "回答を完了できませんでした。", 502, true);
    messages = [...msgs(requestData.messages, requestData.systemInstruction), { role: "assistant", content: output }, { role: "user", content: "直前の回答が出力上限で途切れました。途切れた箇所から最後まで不足部分だけを続けてください。" }];
  }
  throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "回答を完了できませんでした。", 502, true);
}
async function requestFetch(fetchImpl: OriginFetch, requestData: OriginProviderExecutionRequest, key: string, messages: ReturnType<typeof msgs>, transport: { count: number }): Promise<Response> {
  validateRequiredTool(requestData.requiredTool);
  const structured = requestData.requiredTool ? {
    tools: [{ type: "function", function: { name: requestData.requiredTool.name, description: requestData.requiredTool.description, parameters: requestData.requiredTool.parameters } }],
    tool_choice: { type: "function", function: { name: requestData.requiredTool.name } },
  } : {};
  const timeoutMs = Math.min(
    MAX_PROVIDER_REQUEST_TIMEOUT_MS,
    Math.max(5_000, Number(requestData.plan.timeoutMs) || MAX_PROVIDER_REQUEST_TIMEOUT_MS),
  );
  for (const policy of ORIGIN_ZERO_COST_OPENROUTER_POLICY_STAGES) {
    const body = {
      model: requestData.plan.modelId,
      messages,
      max_tokens: originCompletionTokenBudget(requestData.plan.taskType, Boolean(requestData.requiredTool)),
      temperature: 0.2,
      top_p: 0.9,
      usage: { include: true },
      provider: policy,
      ...(requestData.requiredTool ? { reasoning: REQUIRED_TOOL_REASONING } : {}),
      ...structured,
    };
    const response = await request(fetchImpl, "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": "https://myaispecials.ai.studio/", "X-OpenRouter-Title": "ORIGIN Personal" },
      body: JSON.stringify(sanitizePreEgressPayload(body)),
    }, timeoutMs, transport);
    if (![403, 404].includes(response.status)) return response;
  }
  throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, false, undefined, { upstreamStatus: 404 });
}
export async function executeOriginProvider(providerRequest: OriginProviderExecutionRequest, env: NodeJS.ProcessEnv = process.env, fetchImpl: OriginFetch = fetch): Promise<OriginProviderExecutionResult> {
  const transport = { count: 0 };
  try {
    validate(providerRequest.plan);
    validateRequiredTool(providerRequest.requiredTool);
    const primary = pid(providerRequest.plan.providerId);
    if (primary !== "openrouter") throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "許可されていないProviderです。", 400, false);
    const openRouterKey = env.OPENROUTER_API_KEY;
    if (!openRouterKey) throw new OriginProviderError("PROVIDER_NOT_CONFIGURED", "利用可能な無料AIが設定されていません。", 503, false);
    return await openrouter(providerRequest, openRouterKey, fetchImpl, primary, transport);
  } catch (error) {
    if (error instanceof OriginProviderError) {
      throw new OriginProviderError(error.code, error.message, error.status, error.retryable, error.retryAfterSeconds, {
        ...error.diagnostic,
        transportRequestCount: transport.count,
      });
    }
    throw error;
  }
}
