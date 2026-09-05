import {
  ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL,
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
  type OriginProviderDataPolicy,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import { sanitizePreEgress, sanitizePreEgressPayload } from "../services/securitySanitizer.js";
import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY } from "./zeroCostRoutingPolicy.js";

export interface OriginChatMessage { role: "user" | "ai" | "assistant" | "model"; content: string; }
export interface OriginProviderExecutionRequest { plan: OriginExecutionPlan; messages: OriginChatMessage[]; systemInstruction: string; }
export interface OriginProviderRoutingEvidence { requestedModel: string; servedModel: string; strategy: string; provider: string; region?: string; attempt: 1; fallbackUsed: boolean; }
export interface OriginProviderExecutionResult { text: string; actualCostUsd: 0; providerDataPolicy: OriginProviderDataPolicy; routingEvidence: OriginProviderRoutingEvidence; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd: 0; }; }
export type OriginProviderErrorCode = "PROVIDER_NOT_CONFIGURED" | "PROVIDER_POLICY_VIOLATION" | "PROVIDER_COST_UNVERIFIED" | "PROVIDER_ROUTING_UNVERIFIED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "PROVIDER_INVALID_RESPONSE" | "PROVIDER_INTERNAL_ERROR";
export interface OriginProviderDiagnostic { upstreamStatus?: number; upstreamErrorType?: string; transportFailure?: "timeout" | "network"; }

function safeProviderMessage(code: OriginProviderErrorCode): string {
  switch (code) {
    case "PROVIDER_NOT_CONFIGURED": return "利用可能な無料AIが設定されていません。";
    case "PROVIDER_RATE_LIMITED": return "無料AIの利用上限に達しました。";
    case "PROVIDER_TIMEOUT": return "無料AIがタイムアウトしました。";
    case "PROVIDER_UNAVAILABLE": return "無料AIを現在利用できません。";
    case "PROVIDER_INVALID_RESPONSE": return "無料AIから有効な応答を取得できません。";
    case "PROVIDER_COST_UNVERIFIED": return "無料実行の費用を確認できません。";
    case "PROVIDER_ROUTING_UNVERIFIED": return "許可された無料Provider/Modelの証跡を確認できません。";
    case "PROVIDER_POLICY_VIOLATION": return "0ドル固定ポリシーに適合しない実行計画です。";
    case "PROVIDER_INTERNAL_ERROR": return "無料AIとの通信に失敗しました。";
    default: return "無料AIを現在利用できません。";
  }
}

export class OriginProviderError extends Error {
  constructor(public readonly code: OriginProviderErrorCode, _message: string, public readonly status: number, public readonly retryable: boolean, public readonly retryAfterSeconds?: number, public readonly diagnostic?: OriginProviderDiagnostic) { super(safeProviderMessage(code)); this.name = "OriginProviderError"; }
}

export type OriginFetch = typeof fetch;
const RETRY: readonly number[] = [];
const TIMEOUT = 6000;
const MAX_SEGMENTS = 3;
export const ALLOWED_ZERO_COST_PROVIDERS = ["openrouter", "gemini"] as const;
export type AllowedZeroCostProvider = (typeof ALLOWED_ZERO_COST_PROVIDERS)[number];
export const ALLOWED_ZERO_COST_MODELS = { openrouter: [ORIGIN_OPENROUTER_FREE_MODEL], gemini: [ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL] } as const;
const IDS: Record<string, AllowedZeroCostProvider> = { OpenRouter: "openrouter", "openrouter-free": "openrouter", Gemini: "gemini", "google-ai-studio-free": "gemini" };
export function resetOriginProviderCooldownForTests(): void { /* retained for test compatibility; cooldown circuit was removed */ }
const pid = (value: unknown): AllowedZeroCostProvider | null => { if (typeof value !== "string") return null; return IDS[value] ?? (ALLOWED_ZERO_COST_PROVIDERS.includes(value as AllowedZeroCostProvider) ? value as AllowedZeroCostProvider : null); };
const allowed = (provider: AllowedZeroCostProvider, model: unknown): model is string => typeof model === "string" && (ALLOWED_ZERO_COST_MODELS[provider] as readonly string[]).includes(model);
function fail(message: string, code: OriginProviderErrorCode = "PROVIDER_POLICY_VIOLATION"): never { throw new OriginProviderError(code, message, 502, false); }
function zero(value: unknown, field: string): asserts value is 0 { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${field} を検証できません。`, "PROVIDER_COST_UNVERIFIED"); if (Math.abs(value) > Number.EPSILON) fail(`${field} が$0ポリシーを満たしません。`, "PROVIDER_POLICY_VIOLATION"); }
function nonzeroIfPresent(value: unknown, field: string): void { if (value === undefined || value === null) return; const numeric = typeof value === "number" ? value : Number(value); if (!Number.isFinite(numeric) || numeric < 0) fail(`${field} を検証できません。`, "PROVIDER_COST_UNVERIFIED"); if (numeric > Number.EPSILON) fail(`${field} が$0ポリシーを満たしません。`, "PROVIDER_POLICY_VIOLATION"); }
function assertBillingMetadata(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const data = payload as { billing_tier?: unknown; is_free?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; usage?: { cost_details?: { upstream_inference_cost?: unknown }; is_byok?: unknown } };
  if (data.billing_tier !== undefined && String(data.billing_tier).toLowerCase() !== "free") fail("有料の課金ティアが検出されました。", "PROVIDER_POLICY_VIOLATION");
  if (data.is_free === false) fail("無料モデルではない証跡が検出されました。", "PROVIDER_POLICY_VIOLATION");
  nonzeroIfPresent(data.pricing?.prompt, "pricing.prompt"); nonzeroIfPresent(data.pricing?.completion, "pricing.completion"); nonzeroIfPresent(data.usage?.cost_details?.upstream_inference_cost, "usage.cost_details.upstream_inference_cost");
  if (data.usage?.is_byok === true) fail("BYOK課金経路は$0境界で許可されません。", "PROVIDER_POLICY_VIOLATION");
}
export function assertOriginZeroCostExecutionResult(result: OriginProviderExecutionResult, expectedModel?: string, expectedProvider?: string): void {
  if (!result || typeof result !== "object") fail("実行結果を検証できません。", "PROVIDER_COST_UNVERIFIED");
  zero(result.actualCostUsd, "actualCostUsd"); zero(result.usage?.costUsd, "usage.costUsd");
  const evidence = result.routingEvidence; const provider = pid(evidence?.provider);
  if (!evidence || !provider || !allowed(provider, evidence.servedModel)) fail("許可された無料Provider/Modelの証跡を確認できません。", "PROVIDER_ROUTING_UNVERIFIED");
  if (expectedModel && evidence.requestedModel !== expectedModel) fail("要求モデルが一致しません。", "PROVIDER_ROUTING_UNVERIFIED");
  if (evidence.attempt !== 1) fail("不正な試行番号です。", "PROVIDER_ROUTING_UNVERIFIED");
  const validStrategy = evidence.strategy === "adaptive-primary" || (provider === "gemini" && evidence.strategy === "bounded-secondary");
  const validFallback = !evidence.fallbackUsed || (provider === "gemini" && evidence.fallbackUsed && evidence.strategy === "bounded-secondary");
  if (!validStrategy || !validFallback || (provider === "openrouter" && evidence.requestedModel !== evidence.servedModel)) fail("Provider fallback またはPrimary証跡が不正です。", "PROVIDER_ROUTING_UNVERIFIED");
  if (expectedProvider && pid(expectedProvider) !== provider) fail("Providerが一致しません。", "PROVIDER_ROUTING_UNVERIFIED");
}
export function originCompletionTokenBudget(taskType: OriginExecutionPlan["taskType"]): number { switch (taskType) { case "implementation": case "documentation": return 2400; case "research": case "review": case "architecture": case "security": case "current-information": return 1800; default: return 1200; } }
const msgs = (messages: OriginChatMessage[], systemInstruction: string) => [{ role: "system", content: sanitizePreEgress(systemInstruction) }, ...messages.map((message) => ({ role: message.role === "user" ? "user" : "assistant", content: sanitizePreEgress(message.content) }))];
const text = (content: unknown): string => { if (typeof content === "string") return content.trim(); if (!Array.isArray(content)) return ""; return content.filter((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string").map((part) => String((part as { text: string }).text).trim()).filter(Boolean).join("\n\n").trim(); };
function mergeContinuation(previous: string, continuation: string): string { const left = previous.trimEnd(); const right = continuation.trimStart(); for (let length = Math.min(left.length, right.length, 500); length >= 20; length -= 1) if (left.slice(-length) === right.slice(0, length)) return `${left}${right.slice(length)}`.trim(); return `${left}\n\n${right}`.trim(); }
const retryAfter = (value: string | null): number | undefined => { if (!value) return undefined; const numeric = Number(value); if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric); const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? Math.max(1, Math.ceil((timestamp - Date.now()) / 1000)) : undefined; };
function http(status: number, retryAfterSeconds?: number): OriginProviderError { const diagnostic = { upstreamStatus: status }; if (status === 401) return new OriginProviderError("PROVIDER_NOT_CONFIGURED", "Provider認証情報を確認できません。", 401, false, undefined, diagnostic); if (status === 402) return new OriginProviderError("PROVIDER_POLICY_VIOLATION", "無料実行として確認できない課金状態です。", 502, false, undefined, diagnostic); if (status === 429) return new OriginProviderError("PROVIDER_RATE_LIMITED", "無料AIの利用上限に達しました。", 429, true, retryAfterSeconds, diagnostic); if (status === 408 || status === 504) return new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, diagnostic); return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, diagnostic); }
async function json(response: Response): Promise<unknown> { try { return await response.json(); } catch { throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true); } }
async function request(fetchImpl: OriginFetch, input: RequestInfo | URL, init: RequestInit): Promise<Response> { let last: unknown; for (let index = 0; index <= RETRY.length; index += 1) { if (index) await new Promise((resolve) => setTimeout(resolve, RETRY[index - 1])); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT); try { const response = await fetchImpl(input, { ...init, signal: controller.signal }); if ([401, 402, 429].includes(response.status)) throw http(response.status, retryAfter(response.headers.get("Retry-After"))); if (![408, 500, 502, 503, 504].includes(response.status) || index === RETRY.length) return response; last = http(response.status, retryAfter(response.headers.get("Retry-After"))); } catch (error) { if (error instanceof OriginProviderError) throw error; last = error; if (index === RETRY.length) break; } finally { clearTimeout(timer); } } if (last instanceof OriginProviderError) throw last; throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIとの通信に失敗しました。", 504, true); }
function validate(plan: OriginExecutionPlan): void { const provider = pid(plan.providerId); if (!plan.freeOnly || plan.estimatedCostUsd !== 0 || plan.providerDataPolicy.allowProviderFallbacks !== false || !provider || !allowed(provider, plan.modelId)) throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "0ドル固定ポリシーに適合しない実行計画です。", 400, false); }
function evidence(request: OriginProviderExecutionRequest, provider: AllowedZeroCostProvider, servedModel: string, fallbackUsed = false): OriginProviderRoutingEvidence { return { requestedModel: provider === "gemini" ? ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL : request.plan.modelId, servedModel, strategy: fallbackUsed ? "bounded-secondary" : "adaptive-primary", provider: provider === "gemini" ? "Gemini" : "OpenRouter", attempt: 1, fallbackUsed }; }
async function openrouter(request: OriginProviderExecutionRequest, key: string, fetchImpl: OriginFetch, provider: AllowedZeroCostProvider): Promise<OriginProviderExecutionResult> {
  let messages = msgs(request.messages, request.systemInstruction); let output = ""; let promptTokens = 0; let completionTokens = 0; let totalTokens = 0;
  for (let index = 0; index < MAX_SEGMENTS; index += 1) {
    const response = await requestFetch(fetchImpl, request, key, messages); const data = await json(response) as { model?: unknown; choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown; error?: { metadata?: { error_type?: unknown } } }>; error?: { metadata?: { error_type?: unknown } }; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number; cost_details?: { upstream_inference_cost?: unknown }; is_byok?: unknown }; billing_tier?: unknown; is_free?: unknown; pricing?: { prompt?: unknown; completion?: unknown } };
    const errorType = data.choices?.[0]?.error?.metadata?.error_type ?? data.error?.metadata?.error_type;
    if (errorType === "rate_limit_exceeded") throw http(429); if (errorType === "timeout") throw http(504); if (errorType === "provider_overloaded" || errorType === "provider_unavailable") throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { upstreamErrorType: String(errorType) });
    const servedModel = data.model; if (!allowed(provider, servedModel)) throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "OpenRouter無料モデルを確認できません。", 502, false); assertBillingMetadata(data);
    const part = text(data.choices?.[0]?.message?.content); if (!part) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "OpenRouterから回答を取得できません。", 502, true);
    output = output ? mergeContinuation(output, part) : part; promptTokens += data.usage?.prompt_tokens ?? 0; completionTokens += data.usage?.completion_tokens ?? 0; totalTokens += data.usage?.total_tokens ?? 0; zero(data.usage?.cost, "usage.cost");
    if (data.choices?.[0]?.finish_reason !== "length") { const result: OriginProviderExecutionResult = { text: output, actualCostUsd: 0, providerDataPolicy: request.plan.providerDataPolicy, routingEvidence: evidence(request, provider, String(servedModel)), usage: { promptTokens, completionTokens, totalTokens, costUsd: 0 } }; assertOriginZeroCostExecutionResult(result, request.plan.modelId, request.plan.providerId); return result; }
    if (index === MAX_SEGMENTS - 1) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "回答を完了できませんでした。", 502, true);
    messages = [...msgs(request.messages, request.systemInstruction), { role: "assistant", content: output }, { role: "user", content: "直前の回答が出力上限で途切れました。途切れた箇所から最後まで不足部分だけを続けてください。" }];
  }
  throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "回答を完了できませんでした。", 502, true);
}
async function requestFetch(fetchImpl: OriginFetch, requestData: OriginProviderExecutionRequest, key: string, messages: ReturnType<typeof msgs>): Promise<Response> { const body = { model: requestData.plan.modelId, messages, max_tokens: originCompletionTokenBudget(requestData.plan.taskType), temperature: 0.2, top_p: 0.9, usage: { include: true }, provider: ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY }; return request(fetchImpl, "https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": "https://myaispecials.ai.studio/", "X-OpenRouter-Title": "ORIGIN Personal" }, body: JSON.stringify(sanitizePreEgressPayload(body)) }); }
function geminiEligible(env: NodeJS.ProcessEnv, messages: OriginChatMessage[]): boolean { if (env.ORIGIN_GEMINI_FREE_ONLY !== "true" || !env.GEMINI_API_KEY) return false; const combined = messages.map((message) => message.content).join("\n"); return !/(password|passcode|secret|api[ -]?key|private[ -]?key|credit[ -]?card|confidential|パスワード|暗証番号|秘密鍵|APIキー|クレジットカード|機密|個人情報|マイナンバー|口座|病歴|診断)/i.test(combined); }
async function gemini(requestData: OriginProviderExecutionRequest, key: string, fetchImpl: OriginFetch): Promise<OriginProviderExecutionResult> { const contents = requestData.messages.map((message) => ({ role: message.role === "user" ? "user" : "model", parts: [{ text: sanitizePreEgress(message.content) }] })); const body = { systemInstruction: { parts: [{ text: sanitizePreEgress(requestData.systemInstruction) }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: originCompletionTokenBudget(requestData.plan.taskType) } }; const response = await request(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/models/${ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sanitizePreEgressPayload(body)) }); if (!response.ok) throw http(response.status, retryAfter(response.headers.get("Retry-After"))); const data = await json(response) as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }; modelVersion?: unknown }; const servedModel = String(data.modelVersion ?? ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL).trim(); if (!allowed("gemini", servedModel) && servedModel !== ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL) throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "Gemini無料モデルを確認できません。", 502, false); const answer = text(data.candidates?.[0]?.content?.parts); if (!answer) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "Geminiから回答を取得できません。", 502, true); const result: OriginProviderExecutionResult = { text: answer, actualCostUsd: 0, providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "provider-free-tier", requireZeroDataRetention: false }, routingEvidence: evidence(requestData, "gemini", ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL, true), usage: { promptTokens: data.usageMetadata?.promptTokenCount, completionTokens: data.usageMetadata?.candidatesTokenCount, totalTokens: data.usageMetadata?.totalTokenCount, costUsd: 0 } }; assertOriginZeroCostExecutionResult(result, ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL, "google-ai-studio-free"); return result; }

export async function executeOriginProvider(providerRequest: OriginProviderExecutionRequest, env: NodeJS.ProcessEnv = process.env, fetchImpl: OriginFetch = fetch): Promise<OriginProviderExecutionResult> { validate(providerRequest.plan); const primary = pid(providerRequest.plan.providerId); if (!primary) throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "許可されていないProviderです。", 400, false); const openRouterKey = env.OPENROUTER_API_KEY; if (!openRouterKey) throw new OriginProviderError("PROVIDER_NOT_CONFIGURED", "利用可能な無料AIが設定されていません。", 503, false); try { return await openrouter(providerRequest, openRouterKey, fetchImpl, "openrouter"); } catch (error) { if (!(error instanceof OriginProviderError)) error = new OriginProviderError("PROVIDER_INTERNAL_ERROR", "無料AIとの通信に失敗しました。", 503, true); if (!geminiEligible(env, providerRequest.messages) || !(error as OriginProviderError).retryable) throw error; const geminiKey = env.GEMINI_API_KEY; if (!geminiKey) throw error; try { return await gemini(providerRequest, geminiKey, fetchImpl); } catch { throw error; } } }
