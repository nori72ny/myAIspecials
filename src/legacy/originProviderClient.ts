import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
  type OriginProviderDataPolicy,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import { sanitizePreEgress, sanitizePreEgressPayload } from "../services/securitySanitizer.js";
import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY } from "./zeroCostRoutingPolicy.js";

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
  /** Optional single required function contract. The provider must return exactly one matching tool call. */
  requiredTool?: OriginProviderRequiredTool;
}
export interface OriginProviderRoutingEvidence { requestedModel: string; servedModel: string; strategy: string; provider: string; region?: string; attempt: 1; fallbackUsed: boolean; }
export interface OriginProviderExecutionResult { text: string; actualCostUsd: 0; providerDataPolicy: OriginProviderDataPolicy; routingEvidence: OriginProviderRoutingEvidence; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd: 0; }; }
export type OriginProviderErrorCode = "PROVIDER_NOT_CONFIGURED" | "PROVIDER_POLICY_VIOLATION" | "PROVIDER_COST_UNVERIFIED" | "PROVIDER_ROUTING_UNVERIFIED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "PROVIDER_INVALID_RESPONSE" | "PROVIDER_REQUIRED_TOOL_MISSING" | "PROVIDER_REQUIRED_TOOL_AMBIGUOUS" | "PROVIDER_REQUIRED_TOOL_INVALID" | "PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID" | "PROVIDER_REQUIRED_TOOL_TRUNCATED" | "PROVIDER_INTERNAL_ERROR";
export interface OriginProviderDiagnostic { upstreamStatus?: number; upstreamErrorType?: string; transportFailure?: "timeout" | "network"; }

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

export type OriginFetch = typeof fetch;
const RETRY: readonly number[] = [];
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
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${field} を検証できません。`, "PROVIDER_COST_UNVERIFIED");
  if (Math.abs(value) > Number.EPSILON) fail(`${field} が$0ポリシーを満たしません。`, "PROVIDER_POLICY_VIOLATION");
}
function nonzeroIfPresent(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) fail(`${field} を検証できません。`, "PROVIDER_COST_UNVERIFIED");
  if (numeric > Number.EPSILON) fail(`${field} が$0ポリシーを満たしません。`, "PROVIDER_POLICY_VIOLATION");
}
function assertBillingMetadata(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const data = payload as { billing_tier?: unknown; is_free?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; usage?: { cost_details?: { upstream_inference_cost?: unknown }; is_byok?: unknown } };
  if (data.billing_tier !== undefined && String(data.billing_tier).toLowerCase() !== "free") fail("有料の課金ティアが検出されました。", "PROVIDER_POLICY_VIOLATION");
  if (data.is_free === false) fail("無料モデルではない証跡が検出されました。", "PROVIDER_POLICY_VIOLATION");
  nonzeroIfPresent(data.pricing?.prompt, "pricing.prompt");
  nonzeroIfPresent(data.pricing?.completion, "pricing.completion");
  nonzeroIfPresent(data.usage?.cost_details?.upstream_inference_cost, "usage.cost_details.upstream_inference_cost");
  if (data.usage?.is_byok === true) fail("BYOK課金経路は$0境界で許可されません。", "PROVIDER_POLICY_VIOLATION");
}
export function assertOriginZeroCostExecutionResult(result: OriginProviderExecutionResult, expectedModel?: string, expectedProvider?: string): void {
  if (!result || typeof result !== "object") fail("実行結果を検証できません。", "PROVIDER_COST_UNVERIFIED");
  zero(result.actualCostUsd, "actualCostUsd");
  zero(result.usage?.costUsd, "usage.costUsd");
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
function http(status: number, retryAfterSeconds?: number): OriginProviderError {
  const diagnostic = { upstreamStatus: status };
  if (status === 401) return new OriginProviderError("PROVIDER_NOT_CONFIGURED", "Provider認証情報を確認できません。", 401, false, undefined, diagnostic);
  if (status === 402) return new OriginProviderError("PROVIDER_POLICY_VIOLATION", "無料実行として確認できない課金状態です。", 502, false, undefined, diagnostic);
  if (status === 429) return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, true, retryAfterSeconds, diagnostic);
  if (status === 400 || status === 404 || status === 422) return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, false, undefined, diagnostic);
  if (status === 408 || status === 504) return new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, diagnostic);
  return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, diagnostic);
}
async function json(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true); }
}
async function request(fetchImpl: OriginFetch, input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  let last: unknown;
  for (let index = 0; index <= RETRY.length; index += 1) {
    if (index) await new Promise((resolve) => setTimeout(resolve, RETRY[index - 1]));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      if ([401, 402, 429].includes(response.status)) throw http(response.status, retryAfter(response.headers.get("Retry-After")));
      if (![408, 500, 502, 503, 504].includes(response.status)) return response;
      last = http(response.status, retryAfter(response.headers.get("Retry-After")));
    } catch (error) {
      if (error instanceof OriginProviderError) throw error;
      last = error;
      if (index === RETRY.length) break;
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
async function openrouter(requestData: OriginProviderExecutionRequest, key: string, fetchImpl: OriginFetch, provider: AllowedZeroCostProvider): Promise<OriginProviderExecutionResult> {
  let messages = msgs(requestData.messages, requestData.systemInstruction);
  let output = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (let index = 0; index < MAX_SEGMENTS; index += 1) {
    const response = await requestFetch(fetchImpl, requestData, key, messages);
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
    if (errorType === "rate_limit_exceeded") throw http(429);
    if (errorType === "timeout") throw http(504);
    if (errorType === "provider_overloaded" || errorType === "provider_unavailable") throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { upstreamErrorType: String(errorType) });
    const servedModel = typeof data.model === "string" && data.model.trim() ? data.model.trim() : requestData.plan.modelId;
    if (!allowed(provider, servedModel)) throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "OpenRouter無料モデルを確認できません。", 502, false, undefined, { upstreamErrorType: `served-model:${servedModel}` });
    assertBillingMetadata(data);
    promptTokens += data.usage?.prompt_tokens ?? 0;
    completionTokens += data.usage?.completion_tokens ?? 0;
    totalTokens += data.usage?.total_tokens ?? 0;
    zero(data.usage?.cost, "usage.cost");

    if (requestData.requiredTool) {
      if (choice?.finish_reason === "length") throw new OriginProviderError("PROVIDER_REQUIRED_TOOL_TRUNCATED", "必須ツール出力が完了しませんでした。", 502, true);
      output = requiredToolArguments(choice?.message, requestData.requiredTool);
    } else {
      const part = text(choice?.message?.content);
      if (!part) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "OpenRouterから回答を取得できません。", 502, true);
      output = output ? mergeContinuation(output, part) : part;
    }

    if (choice?.finish_reason !== "length") {
      const result: OriginProviderExecutionResult = { text: output, actualCostUsd: 0, providerDataPolicy: requestData.plan.providerDataPolicy, routingEvidence: evidence(requestData, String(servedModel)), usage: { promptTokens, completionTokens, totalTokens, costUsd: 0 } };
      assertOriginZeroCostExecutionResult(result, requestData.plan.modelId, requestData.plan.providerId);
      return result;
    }
    if (index === MAX_SEGMENTS - 1) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "回答を完了できませんでした。", 502, true);
    messages = [...msgs(requestData.messages, requestData.systemInstruction), { role: "assistant", content: output }, { role: "user", content: "直前の回答が出力上限で途切れました。途切れた箇所から最後まで不足部分だけを続けてください。" }];
  }
  throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "回答を完了できませんでした。", 502, true);
}
async function requestFetch(fetchImpl: OriginFetch, requestData: OriginProviderExecutionRequest, key: string, messages: ReturnType<typeof msgs>): Promise<Response> {
  validateRequiredTool(requestData.requiredTool);
  const structured = requestData.requiredTool ? {
    tools: [{ type: "function", function: { name: requestData.requiredTool.name, description: requestData.requiredTool.description, parameters: requestData.requiredTool.parameters } }],
    tool_choice: { type: "function", function: { name: requestData.requiredTool.name } },
  } : {};
  const body = {
    model: requestData.plan.modelId,
    messages,
    max_tokens: originCompletionTokenBudget(requestData.plan.taskType, Boolean(requestData.requiredTool)),
    temperature: 0.2,
    top_p: 0.9,
    usage: { include: true },
    provider: ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY,
    ...(requestData.requiredTool ? { reasoning: REQUIRED_TOOL_REASONING } : {}),
    ...structured,
  };
  const timeoutMs = Math.min(
    MAX_PROVIDER_REQUEST_TIMEOUT_MS,
    Math.max(5_000, Number(requestData.plan.timeoutMs) || MAX_PROVIDER_REQUEST_TIMEOUT_MS),
  );
  return request(fetchImpl, "https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": "https://myaispecials.ai.studio/", "X-OpenRouter-Title": "ORIGIN Personal" },
    body: JSON.stringify(sanitizePreEgressPayload(body)),
  }, timeoutMs);
}
export async function executeOriginProvider(providerRequest: OriginProviderExecutionRequest, env: NodeJS.ProcessEnv = process.env, fetchImpl: OriginFetch = fetch): Promise<OriginProviderExecutionResult> {
  validate(providerRequest.plan);
  validateRequiredTool(providerRequest.requiredTool);
  const primary = pid(providerRequest.plan.providerId);
  if (primary !== "openrouter") throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "許可されていないProviderです。", 400, false);
  const openRouterKey = env.OPENROUTER_API_KEY;
  if (!openRouterKey) throw new OriginProviderError("PROVIDER_NOT_CONFIGURED", "利用可能な無料AIが設定されていません。", 503, false);
  return openrouter(providerRequest, openRouterKey, fetchImpl, primary);
}
