import {
  ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL,
  ORIGIN_GROQ_FREE_MODEL,
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginExecutionPlan,
  type OriginProviderDataPolicy,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import { sanitizePreEgress, sanitizePreEgressPayload } from "../services/securitySanitizer.js";

export interface OriginChatMessage { role: "user" | "ai" | "assistant" | "model"; content: string; }
export interface OriginProviderExecutionRequest { plan: OriginExecutionPlan; messages: OriginChatMessage[]; systemInstruction: string; }
export interface OriginProviderRoutingEvidence {
  requestedModel: string; servedModel: string; strategy: string; provider: string; region?: string;
  attempt: 1; fallbackUsed: boolean;
}
export interface OriginProviderExecutionResult {
  text: string; actualCostUsd: 0; providerDataPolicy: OriginProviderDataPolicy;
  routingEvidence: OriginProviderRoutingEvidence;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd: 0 };
}

export type OriginProviderErrorCode =
  | "PROVIDER_NOT_CONFIGURED" | "PROVIDER_POLICY_VIOLATION" | "PROVIDER_COST_UNVERIFIED"
  | "PROVIDER_ROUTING_UNVERIFIED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT" | "PROVIDER_INVALID_RESPONSE" | "PROVIDER_INTERNAL_ERROR";
export interface OriginProviderDiagnostic { upstreamStatus?: number; upstreamErrorType?: string; transportFailure?: "timeout" | "network"; }
export class OriginProviderError extends Error {
  constructor(
    public readonly code: OriginProviderErrorCode, message: string, public readonly status: number,
    public readonly retryable: boolean, public readonly retryAfterSeconds?: number,
    public readonly diagnostic?: OriginProviderDiagnostic,
  ) { super(message); this.name = "OriginProviderError"; }
}
export type OriginFetch = typeof fetch;
const MAX_COMPLETION_SEGMENTS = 3;
const SILENT_RETRY_DELAYS_MS = [200, 500, 1000] as const;
const PROVIDER_ATTEMPT_TIMEOUT_MS = 6000;

export const ALLOWED_ZERO_COST_PROVIDERS = ["openrouter", "groq", "google-gemini"] as const;
export type AllowedZeroCostProvider = typeof ALLOWED_ZERO_COST_PROVIDERS[number];
export const ALLOWED_ZERO_COST_MODELS = {
  openrouter: [ORIGIN_OPENROUTER_FREE_MODEL] as const,
  groq: [ORIGIN_GROQ_FREE_MODEL] as const,
  "google-gemini": [ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL] as const,
} as const;
const PROVIDER_ID_BY_LABEL: Record<string, AllowedZeroCostProvider> = {
  OpenRouter: "openrouter", Groq: "groq", "Google AI Studio": "google-gemini",
};
function rejectZeroCost(message: string, code: OriginProviderErrorCode = "PROVIDER_POLICY_VIOLATION"): never { throw new OriginProviderError(code, message, 502, false); }
function assertFiniteZeroCost(value: unknown, field: string): asserts value is 0 {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Math.abs(value) > Number.EPSILON) rejectZeroCost(`${field} が厳格な$0ポリシーを満たさないため、回答を破棄しました。`);
}
function resolveAllowedProvider(provider: unknown): AllowedZeroCostProvider | null {
  if (typeof provider !== "string") return null;
  return PROVIDER_ID_BY_LABEL[provider] ?? (ALLOWED_ZERO_COST_PROVIDERS.includes(provider as AllowedZeroCostProvider) ? provider as AllowedZeroCostProvider : null);
}
function isAllowedModel(provider: AllowedZeroCostProvider, model: unknown): model is string {
  if (typeof model !== "string") return false;
  if (provider === "openrouter" && !model.endsWith(":free")) return false;
  return (ALLOWED_ZERO_COST_MODELS[provider] as readonly string[]).includes(model);
}
export function assertOriginZeroCostExecutionResult(result: OriginProviderExecutionResult, expectedModel: string = ORIGIN_OPENROUTER_FREE_MODEL): void {
  if (!result || typeof result !== "object") rejectZeroCost("無料AIの実行結果を検証できないため、回答を返しません。", "PROVIDER_COST_UNVERIFIED");
  const actualCost = (result as { actualCostUsd?: unknown }).actualCostUsd;
  const usageCost = (result as { usage?: { costUsd?: unknown } }).usage?.costUsd;
  assertFiniteZeroCost(actualCost, "actualCostUsd"); assertFiniteZeroCost(usageCost, "usage.costUsd");
  const e = (result as { routingEvidence?: OriginProviderRoutingEvidence }).routingEvidence;
  if (!e || typeof e !== "object") rejectZeroCost("プロバイダーの実行証跡が存在しないため、回答を返しません。", "PROVIDER_ROUTING_UNVERIFIED");
  const provider = resolveAllowedProvider(e.provider);
  if (!provider) rejectZeroCost("許可されていないAIプロバイダーの実行証跡を検出したため、回答を返しません。", "PROVIDER_ROUTING_UNVERIFIED");
  if (typeof e.requestedModel !== "string" || typeof e.servedModel !== "string") rejectZeroCost("要求モデルまたは提供モデルを確認できないため、回答を返しません。", "PROVIDER_ROUTING_UNVERIFIED");
  if (!isAllowedModel(provider, e.servedModel)) rejectZeroCost("許可されていない無料モデル、または無料モデルとして確認できないモデルを検出したため、回答を返しません。", "PROVIDER_ROUTING_UNVERIFIED");
  if (expectedModel !== ORIGIN_OPENROUTER_FREE_MODEL || !isAllowedModel("openrouter", expectedModel)) rejectZeroCost("要求モデルがORIGINの許可済み無料モデルではないため、回答を返しません。", "PROVIDER_ROUTING_UNVERIFIED");
  if (e.requestedModel !== expectedModel) {
    if (!(e.fallbackUsed === true && e.strategy === "zero-cost-failover")) rejectZeroCost("要求モデルの実行証跡がORIGINの固定無料モデルと一致しないため、回答を返しません。", "PROVIDER_ROUTING_UNVERIFIED");
  }
  if (e.attempt !== 1) rejectZeroCost("未許可の実行試行番号を検出したため、回答を返しません。", "PROVIDER_ROUTING_UNVERIFIED");
  if (e.fallbackUsed === true) {
    if (e.strategy !== "zero-cost-failover") rejectZeroCost("フォールバック実行の戦略を確認できないため、回答を返しません。", "PROVIDER_ROUTING_UNVERIFIED");
    return;
  }
  if (e.fallbackUsed !== false || e.strategy !== "fixed-free-model" || provider !== "openrouter" || e.servedModel !== expectedModel) rejectZeroCost("固定無料モデルの応答証跡を確認できないため、回答を返しません。", "PROVIDER_ROUTING_UNVERIFIED");
}
export function originCompletionTokenBudget(taskType: OriginExecutionPlan["taskType"]): number {
  switch (taskType) { case "implementation": case "documentation": return 2400; case "research": case "review": case "architecture": case "security": case "current-information": return 1800; default: return 1200; }
}
function normalizeMessages(messages: OriginChatMessage[], systemInstruction: string) {
  return [
    { role: "system", content: sanitizePreEgress(systemInstruction) },
    ...messages.map((m) => ({
      role: m.role === "ai" || m.role === "assistant" || m.role === "model" ? "assistant" : "user",
      content: sanitizePreEgress(m.content),
    })),
  ];
}
function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim(); if (!Array.isArray(content)) return "";
  return content.filter((p): p is { type?: string; text?: string } => typeof p === "object" && p !== null).filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text!.trim()).filter(Boolean).join("\n\n").trim();
}
function mergeContinuation(previous: string, continuation: string): string {
  const left = previous.trimEnd(); const right = continuation.trimStart();
  for (let n = Math.min(left.length, right.length, 500); n >= 20; n -= 1) if (left.slice(-n) === right.slice(0, n)) return `${left}${right.slice(n)}`.trim();
  const a = left.split("\n"); const b = right.split("\n"); while (b[0]?.trim() === "") b.shift();
  if (b[0] && /^#{1,6}\s+/.test(b[0]) && a.some((x) => x.replace(/^(?:#{1,6}\s+|[-*+]\s+)/, "").toLocaleLowerCase() === b[0].replace(/^#{1,6}\s+/, "").replace(/[（(]\s*(?:続き|continued)\s*[）)]/i, "").toLocaleLowerCase())) b.shift();
  for (let n = Math.min(a.length, b.length, 20); n >= 1; n -= 1) { const aa = a.slice(-n).map((x) => x.trim().toLocaleLowerCase()); const bb = b.slice(0, n).map((x) => x.trim().toLocaleLowerCase()); if (aa.every(Boolean) && aa.every((x, i) => x === bb[i])) return [...a, ...b.slice(n)].join("\n").trim(); }
  return `${left}\n\n${right}`.trim();
}
function parseRetryAfterSeconds(v: string | null): number | undefined { if (!v) return undefined; const n = Number(v); if (Number.isFinite(n) && n > 0) return Math.ceil(n); const t = Date.parse(v); return Number.isFinite(t) ? Math.max(1, Math.ceil((t - Date.now()) / 1000)) : undefined; }
function mapHttpFailure(status: number, retryAfterSeconds?: number): OriginProviderError {
  const d = { upstreamStatus: status };
  if (status === 401) return new OriginProviderError("PROVIDER_NOT_CONFIGURED", "無料AIの認証情報を確認できませんでした。", 401, false, undefined, d);
  if (status === 402) return new OriginProviderError("PROVIDER_POLICY_VIOLATION", "無料モデルの利用に支払いが必要と判定されたため、実行を停止しました。", 502, false, undefined, d);
  if (status === 403) return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, false, undefined, d);
  if (status === 404) return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, d);
  if (status === 429) return new OriginProviderError("PROVIDER_RATE_LIMITED", retryAfterSeconds ? `無料AIの利用上限に達しました。約${retryAfterSeconds}秒後に再試行できます。` : "無料AIの利用上限に達しました。時間をおいて再試行してください。", 429, true, retryAfterSeconds, d);
  if (status === 408 || status === 504) return new OriginProviderError("PROVIDER_TIMEOUT", "無料AIの応答が時間内に完了しませんでした。", 504, true, undefined, d);
  if (status === 502 || status === 503) return new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, d);
  return new OriginProviderError("PROVIDER_INTERNAL_ERROR", "無料AIの処理に失敗しました。", status >= 400 && status < 600 ? status : 500, status >= 500, undefined, d);
}
function validatePlan(plan: OriginExecutionPlan): void {
  if (!plan.freeOnly || plan.estimatedCostUsd !== 0 || plan.providerDataPolicy.allowProviderFallbacks !== true || plan.providerDataPolicy.dataCollection !== "deny" || plan.providerDataPolicy.requireZeroDataRetention !== false) throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "0ドル固定ポリシーに適合しない実行計画は使用できません。", 400, false);
  if (!["openrouter-free", "google-ai-studio-free", "groq-free"].includes(plan.providerId)) throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "許可されていないプロバイダーです。", 400, false);
}
function freeUsage(cost: unknown): 0 { if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || Math.abs(cost) > Number.EPSILON) throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "無料実行で0ドル以外、または検証不能な利用額が報告されたため、回答を破棄しました。", 502, false); return 0; }
async function readJson(response: Response): Promise<Record<string, any>> { try { return await response.json() as Record<string, any>; } catch { throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を受け取れませんでした。", 502, true); } }

function isRetryableHttpStatus(status: number): boolean { return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504; }
async function fetchWithSilentRetry(fetchImpl: OriginFetch, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SILENT_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, SILENT_RETRY_DELAYS_MS[attempt - 1]));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      if (!isRetryableHttpStatus(response.status) || attempt === SILENT_RETRY_DELAYS_MS.length) return response;
      lastError = mapHttpFailure(response.status, parseRetryAfterSeconds(response.headers.get("Retry-After")));
    } catch (error) {
      lastError = error;
      if (attempt === SILENT_RETRY_DELAYS_MS.length) break;
    } finally { clearTimeout(timeout); }
  }
  if (lastError instanceof OriginProviderError) throw lastError;
  if (lastError instanceof Error && lastError.name === "AbortError") throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIの応答が時間内に完了しませんでした。", 504, true, undefined, { transportFailure: "timeout" });
  throw new OriginProviderError("PROVIDER_INTERNAL_ERROR", "無料AIとの通信に失敗しました。", 500, true, undefined, { transportFailure: "network" });
}

async function executeOpenRouter(request: OriginProviderExecutionRequest, apiKey: string, fetchImpl: OriginFetch): Promise<OriginProviderExecutionResult> {
  let messages = normalizeMessages(request.messages, request.systemInstruction); let text = ""; let pt = 0; let ct = 0; let tt = 0;
  for (let segment = 0; segment < MAX_COMPLETION_SEGMENTS; segment += 1) {
    try {
      const response = await fetchWithSilentRetry(fetchImpl, "https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://myaispecials.ai.studio/", "X-OpenRouter-Title": "ORIGIN Personal" }, body: JSON.stringify(sanitizePreEgressPayload({ model: ORIGIN_OPENROUTER_FREE_MODEL, messages, max_tokens: originCompletionTokenBudget(request.plan.taskType), reasoning: { effort: "medium", exclude: true }, temperature: 0.2, top_p: 0.9, provider: { sort: "throughput", allow_fallbacks: true, data_collection: "deny" } })) });
      const data = await readJson(response); const errType = data.choices?.[0]?.error?.metadata?.error_type ?? data.error?.metadata?.error_type;
      if (errType === "rate_limit_exceeded") throw mapHttpFailure(429); if (errType === "timeout") throw mapHttpFailure(504); if (errType === "provider_overloaded" || errType === "provider_unavailable") throw mapHttpFailure(503);
      const model = data.model; if (!isAllowedModel("openrouter", model)) throw new OriginProviderError("PROVIDER_ROUTING_UNVERIFIED", "OpenRouterの許可済み無料モデル利用を確認できませんでした。", 502, false);
      const choice = data.choices?.[0]; const part = extractText(choice?.message?.content); if (!part) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な回答を受け取れませんでした。", 502, true);
      text = text ? mergeContinuation(text, part) : part; pt += data.usage?.prompt_tokens ?? 0; ct += data.usage?.completion_tokens ?? 0; tt += data.usage?.total_tokens ?? 0;
      const cost = freeUsage(data.usage?.cost);
      if (choice?.finish_reason !== "length") {
        const result: OriginProviderExecutionResult = { text, actualCostUsd: cost, providerDataPolicy: request.plan.providerDataPolicy, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: model, strategy: "fixed-free-model", provider: "OpenRouter", attempt: 1, fallbackUsed: false }, usage: { promptTokens: pt, completionTokens: ct, totalTokens: tt, costUsd: cost } }; assertOriginZeroCostExecutionResult(result); return result;
      }
      if (segment === MAX_COMPLETION_SEGMENTS - 1) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "回答が長く、完了を確認できませんでした。依頼を分けて再実行してください。", 502, true);
      messages = [...normalizeMessages(request.messages, request.systemInstruction), { role: "assistant", content: sanitizePreEgress(text) }, { role: "user", content: sanitizePreEgress("直前の回答が出力上限で途切れました。途切れた箇所から最後まで不足部分だけを続けてください。") }];
    } catch (e) {
      if (e instanceof OriginProviderError) throw e;
      if (e instanceof Error && e.name === "AbortError") throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIの応答が時間内に完了しませんでした。", 504, true, undefined, { transportFailure: "timeout" });
      throw new OriginProviderError("PROVIDER_INTERNAL_ERROR", "無料AIとの通信に失敗しました。", 500, true, undefined, { transportFailure: "network" });
    }
  }
  throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "回答の完了を確認できませんでした。", 502, true);
}
async function executeGemini(request: OriginProviderExecutionRequest, apiKey: string, fetchImpl: OriginFetch): Promise<OriginProviderExecutionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = request.messages.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: sanitizePreEgress(m.content) }] }));
  const payload = sanitizePreEgressPayload({ systemInstruction: { parts: [{ text: request.systemInstruction }] }, contents, generationConfig: { maxOutputTokens: originCompletionTokenBudget(request.plan.taskType), temperature: 0.2, topP: 0.9 } });
  const response = await fetchWithSilentRetry(fetchImpl, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await readJson(response); const text = extractText(data.candidates?.[0]?.content?.parts?.map((p: any) => ({ type: "text", text: p.text })));
  if (!text) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "Geminiから有効な応答を受け取れませんでした。", 502, true);
  const result: OriginProviderExecutionResult = { text, actualCostUsd: 0, providerDataPolicy: request.plan.providerDataPolicy, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL, strategy: "zero-cost-failover", provider: "Google AI Studio", attempt: 1, fallbackUsed: true }, usage: { costUsd: 0 } }; assertOriginZeroCostExecutionResult(result); return result;
}
async function executeGroq(request: OriginProviderExecutionRequest, apiKey: string, fetchImpl: OriginFetch): Promise<OriginProviderExecutionResult> {
  const payload = sanitizePreEgressPayload({ model: ORIGIN_GROQ_FREE_MODEL, messages: normalizeMessages(request.messages, request.systemInstruction).filter((m) => m.role !== "system"), max_tokens: originCompletionTokenBudget(request.plan.taskType), temperature: 0.2, top_p: 0.9 });
  const response = await fetchWithSilentRetry(fetchImpl, "https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) });
  const data = await readJson(response); const text = extractText(data.choices?.[0]?.message?.content); if (!text) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "Groqから有効な応答を受け取れませんでした。", 502, true);
  const result: OriginProviderExecutionResult = { text, actualCostUsd: 0, providerDataPolicy: request.plan.providerDataPolicy, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_GROQ_FREE_MODEL, strategy: "zero-cost-failover", provider: "Groq", attempt: 1, fallbackUsed: true }, usage: { promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens, totalTokens: data.usage?.total_tokens, costUsd: 0 } }; assertOriginZeroCostExecutionResult(result); return result;
}
function shouldFailover(error: unknown): boolean { return error instanceof OriginProviderError && error.retryable && (error.code === "PROVIDER_RATE_LIMITED" || error.code === "PROVIDER_UNAVAILABLE" || error.code === "PROVIDER_TIMEOUT" || error.code === "PROVIDER_INTERNAL_ERROR"); }
export async function executeOriginProvider(request: OriginProviderExecutionRequest, env: NodeJS.ProcessEnv = process.env, fetchImpl: OriginFetch = fetch): Promise<OriginProviderExecutionResult> {
  validatePlan(request.plan); const failures: OriginProviderError[] = []; const openRouterKey = env.OPENROUTER_API_KEY; const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_AI_STUDIO_API_KEY; const groqKey = env.GROQ_API_KEY;
  if (!openRouterKey && !geminiKey && !groqKey) throw new OriginProviderError("PROVIDER_NOT_CONFIGURED", "無料AIプロバイダーが設定されていません。", 503, false);
  if (openRouterKey) { try { return await executeOpenRouter(request, openRouterKey, fetchImpl); } catch (e) { if (!shouldFailover(e)) throw e; failures.push(e as OriginProviderError); } }
  if (geminiKey) { try { return await executeGemini(request, geminiKey, fetchImpl); } catch (e) { if (!shouldFailover(e)) throw e; failures.push(e as OriginProviderError); } }
  if (groqKey) { try { return await executeGroq(request, groqKey, fetchImpl); } catch (e) { if (!shouldFailover(e)) throw e; failures.push(e as OriginProviderError); } }
  const last = failures.at(-1); throw last ?? new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true);
}
