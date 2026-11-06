import {
  ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL,
  ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  selectCurrentOriginCloudflareFreeModel,
  type OriginCloudflareFreeModelEvidence,
} from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import { sanitizePreEgress } from "../services/securitySanitizer.js";
import {
  originCompletionTokenBudget,
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient.js";

/**
 * Cloudflare Workers AI route (free-provider failover Phase 1, second route).
 *
 * This executor is only reachable through originProviderFailover when the owner enables
 * ORIGIN_CF_FAILOVER_ENABLED. It never runs on its own from a router, and it never relaxes
 * the zero-cost contract: before every inference it mechanically proves that the account is
 * on the Workers Free plan (no paid Workers subscription, exact $0 prices on any Workers
 * row, live model schema) using the read-only proof token. Any unverifiable condition
 * blocks the route before inference is sent (fail closed), mirroring the plan-proof logic
 * first built for PR #1092 and tightened by PR #1094. Cloudflare documents zero data
 * retention and no training on Customer Content for Workers AI, which is why this route can
 * carry the same data policy class as the OpenRouter primary route.
 */

export const ORIGIN_CF_FAILOVER_ENABLED_ENV = "ORIGIN_CF_FAILOVER_ENABLED" as const;
export const ORIGIN_CF_ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID" as const;
export const ORIGIN_CF_PROOF_TOKEN_ENV = "ORIGIN_CF_PROOF_TOKEN" as const;
export const ORIGIN_CF_AI_TOKEN_ENV = "ORIGIN_CF_AI_TOKEN" as const;

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_CF_REQUEST_TIMEOUT_MS = 52_000;
const PROOF_REQUEST_TIMEOUT_MS = 10_000;
// Published Workers AI rates for @cf/google/gemma-4-26b-a4b-it (Neurons per 1M tokens),
// rechecked 2026-11-06 against the official pricing page. Used only to record an estimated
// free-allocation consumption figure in routing evidence; never a charge.
const NEURONS_PER_MILLION_INPUT_TOKENS = 9_091;
const NEURONS_PER_MILLION_OUTPUT_TOKENS = 27_273;

export type OriginCloudflarePreflightReason =
  | "not-enabled"
  | "not-configured"
  | "catalog-invalid"
  | "evidence-stale"
  | "plan-proof-failed";

/**
 * The route was skipped before any inference was sent. This is deliberately not an
 * OriginProviderError: the dispatcher records the skip and surfaces the primary route's
 * error instead, so a misconfigured secondary route can never mask the real failure.
 */
export class OriginCloudflarePreflightError extends Error {
  constructor(
    public readonly reason: OriginCloudflarePreflightReason,
    public readonly proofReason?: string,
  ) {
    super(`Cloudflare failover route skipped before execution: ${reason}`);
    this.name = "OriginCloudflarePreflightError";
  }
}

export interface OriginCloudflareCredentials { accountId: string; proofToken: string; aiToken: string; }

export function isOriginCloudflareFailoverEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_CF_FAILOVER_ENABLED_ENV] === "true";
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 20 && value.trim().length <= 4096;
}

export function resolveOriginCloudflareCredentials(env: NodeJS.ProcessEnv): OriginCloudflareCredentials | null {
  const accountId = typeof env[ORIGIN_CF_ACCOUNT_ID_ENV] === "string" ? env[ORIGIN_CF_ACCOUNT_ID_ENV].trim() : "";
  const proofToken = env[ORIGIN_CF_PROOF_TOKEN_ENV];
  const aiToken = env[ORIGIN_CF_AI_TOKEN_ENV];
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !validToken(proofToken) || !validToken(aiToken)) return null;
  return { accountId, proofToken: (proofToken as string).trim(), aiToken: (aiToken as string).trim() };
}

interface CloudflareEnvelope {
  success?: unknown;
  result?: unknown;
  result_info?: { count?: unknown; total_count?: unknown; next_page?: unknown };
  errors?: Array<{ code?: unknown; message?: unknown }>;
  usage?: unknown;
}

async function readCloudflareJson(
  fetchImpl: OriginFetch,
  url: string,
  token: string,
  transport: { count: number },
  timeoutMs: number = PROOF_REQUEST_TIMEOUT_MS,
): Promise<{ response: Response | null; body: CloudflareEnvelope | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    transport.count += 1;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as CloudflareEnvelope | null;
    return { response, body };
  } catch {
    return { response: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

function subscriptionState(value: { state?: unknown }): "active" | "inactive" | "unknown" {
  const state = String(value?.state ?? "");
  if (["Trial", "Provisioned", "Paid", "AwaitingPayment"].includes(state)) return "active";
  if (["Cancelled", "Expired", "Failed"].includes(state)) return "inactive";
  return "unknown";
}

function subscriptionPlanText(value: { rate_plan?: unknown }): string {
  const plan = value?.rate_plan && typeof value.rate_plan === "object" && !Array.isArray(value.rate_plan)
    ? value.rate_plan as Record<string, unknown>
    : {};
  return [plan.id, plan.public_name, plan.name, plan.scope, ...(Array.isArray(plan.sets) ? plan.sets : [])]
    .filter((item) => typeof item === "string")
    .join(" ")
    .toLowerCase();
}

export type OriginCloudflarePlanProofResult = { ok: true } | { ok: false; reason: string };

/**
 * Mechanical $0.00 proof for the Cloudflare route, ported from the PR #1092 preview worker
 * with the PR #1094 fail-closed tightening, and revised (v2, 2026-11-07) against the real
 * API responses measured on a dashboard-confirmed Workers Free account ($0, no payment
 * method registered):
 * - `workers/account-settings` is not offered on that account at all (HTTP 401, error
 *   10023, for account and user tokens alike), so the settings read is advisory only:
 *   it can veto the route (paid usage model, unknown non-empty value) but a failed
 *   read never blocks by itself.
 * - `subscriptions` omits the `count`/`total_count` pagination fields; a read in that
 *   shape is complete only when the API explicitly states `next_page === false`.
 * - The subscriptions result is empty even though the account is genuinely on Workers
 *   Free (the dashboard billing rows are not exposed through this API), so the positive
 *   proof is: a complete read whose rows all pass the strict free checks below, with
 *   either at least one proven free Workers row or zero rows at all.
 * Every row that is present must still pass the strict checks; anything paid, ambiguous,
 * externally managed, or contracted blocks the route.
 */
export async function verifyOriginCloudflareWorkersFreePlan(
  fetchImpl: OriginFetch,
  credentials: OriginCloudflareCredentials,
  transport: { count: number },
): Promise<OriginCloudflarePlanProofResult> {
  const accountBase = `${CLOUDFLARE_API_BASE}/accounts/${credentials.accountId}`;

  // Settings leg (v2): advisory, negative-only. Strictness is carried by the
  // subscriptions and schema legs below, which each require their own successful
  // read — a revoked or under-privileged proof token fails the subscriptions
  // read, so demoting this leg cannot open the route on a broken token.
  const settings = await readCloudflareJson(fetchImpl, `${accountBase}/workers/account-settings`, credentials.proofToken, transport);
  if (settings.response?.ok && settings.body?.success === true) {
    const settingsResult = settings.body.result && typeof settings.body.result === "object" && !Array.isArray(settings.body.result)
      ? settings.body.result as Record<string, unknown>
      : {};
    const usageModel = typeof settingsResult.default_usage_model === "string"
      ? settingsResult.default_usage_model.toLowerCase()
      : "";
    if (usageModel === "standard" || usageModel === "unbound") {
      return { ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" };
    }
    // A missing/empty default_usage_model is neutral (the field is optional and
    // Cloudflare omits it on some free accounts). A non-empty unknown value is
    // still unverifiable and blocks the route here.
    if (usageModel !== "" && usageModel !== "bundled") {
      return { ok: false, reason: "CLOUDFLARE_WORKERS_PLAN_UNVERIFIED" };
    }
  }

  const subscriptions = await readCloudflareJson(fetchImpl, `${accountBase}/subscriptions`, credentials.proofToken, transport);
  const subscriptionInfo = subscriptions.body?.result_info;
  const subscriptionRows = subscriptions.body?.result;
  if (!subscriptions.response?.ok || subscriptions.body?.success !== true) {
    return { ok: false, reason: "CLOUDFLARE_BILLING_READ_REQUIRED" };
  }
  // Completeness of the paginated read. When both count fields are present they
  // must be safe integers matching the row count exactly. When both are absent
  // (the shape Cloudflare's current billing API returns), the read is complete
  // only on an explicit `next_page === false`. Anything else — exactly one count
  // field, a mismatch, `next_page` true or missing — is an incomplete read:
  // never infer a Free account from a partial page.
  const rowCount = Array.isArray(subscriptionRows) ? subscriptionRows.length : -1;
  const hasCount = subscriptionInfo?.count !== undefined;
  const hasTotalCount = subscriptionInfo?.total_count !== undefined;
  const countsComplete = hasCount && hasTotalCount
    && Number.isSafeInteger(subscriptionInfo?.count)
    && Number.isSafeInteger(subscriptionInfo?.total_count)
    && subscriptionInfo?.count === rowCount
    && subscriptionInfo?.total_count === rowCount;
  const nextPageComplete = !hasCount && !hasTotalCount && subscriptionInfo?.next_page === false;
  if (!Array.isArray(subscriptionRows) || !subscriptionInfo || (!countsComplete && !nextPageComplete)) {
    return { ok: false, reason: "CLOUDFLARE_BILLING_READ_INCOMPLETE" };
  }

  let provenFreeWorkersSubscription = false;
  for (const row of subscriptionRows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, reason: "CLOUDFLARE_BILLING_SUBSCRIPTION_UNVERIFIED" };
    }
    const record = row as { state?: unknown; price?: unknown; rate_plan?: unknown };
    const state = subscriptionState(record);
    if (state === "inactive") continue;
    if (state === "unknown") {
      // An unrecognized state must not be silently treated as an inactive subscription.
      return { ok: false, reason: "CLOUDFLARE_BILLING_SUBSCRIPTION_UNVERIFIED" };
    }
    if (record.state === "Paid" || record.state === "AwaitingPayment") {
      // A paid or payment-pending subscription is never accepted as Free,
      // even if an inconsistent rate_plan object claims a zero-priced Free tier.
      return { ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" };
    }

    const ratePlan = record.rate_plan && typeof record.rate_plan === "object" && !Array.isArray(record.rate_plan)
      ? record.rate_plan as Record<string, unknown>
      : {};
    const planText = subscriptionPlanText(record);
    if (!planText) {
      return { ok: false, reason: "CLOUDFLARE_BILLING_SUBSCRIPTION_UNVERIFIED" };
    }

    if (!planText.includes("worker")) {
      // Non-Workers products may be ignored only when their product identity is explicit.
      const productMarkers = [ratePlan.scope, ...(Array.isArray(ratePlan.sets) ? ratePlan.sets : [])]
        .filter((item) => typeof item === "string" && item.trim().length > 0);
      if (productMarkers.length === 0) {
        return { ok: false, reason: "CLOUDFLARE_BILLING_SUBSCRIPTION_UNVERIFIED" };
      }
      continue;
    }

    const ratePlanId = typeof ratePlan.id === "string" ? ratePlan.id.toLowerCase() : "";
    const hasExplicitFreePlanId = ratePlanId === "free" || ratePlanId === "partners_free";
    const hasExactZeroPrice = typeof record.price === "number" && Number.isFinite(record.price) && record.price === 0;
    const explicitlyNotExternallyManaged = ratePlan.externally_managed === false;
    const explicitlyNotContracted = ratePlan.is_contract === false;

    // Every optional billing field must positively prove the free Workers entitlement.
    if (
      !hasExplicitFreePlanId
      || !hasExactZeroPrice
      || !explicitlyNotExternallyManaged
      || !explicitlyNotContracted
      || planText.includes("paid")
    ) {
      return { ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" };
    }
    provenFreeWorkersSubscription = true;
  }

  // Positive proof (v2): the subscriptions leg carries the proof on its own.
  // The read above succeeded under a Billing Read token and is complete, and
  // every row passed the strict checks (any paid, unknown-state, or unverifiable
  // row already returned). What remains is one of two positive shapes: at least
  // one proven free Workers row, or zero rows at all. An empty result is
  // positive evidence, not missing evidence: a complete Billing Read that
  // returns no subscriptions shows there is no billing contract, and the
  // Workers Free plan has no overage-billing mechanism that could start
  // charging. A non-empty read with no proven free Workers row stays unverified.
  if (subscriptionRows.length > 0 && !provenFreeWorkersSubscription) {
    return { ok: false, reason: "CLOUDFLARE_WORKERS_PLAN_UNVERIFIED" };
  }

  const schema = await readCloudflareJson(
    fetchImpl,
    `${accountBase}/ai/models/schema?model=${encodeURIComponent(ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL)}`,
    credentials.proofToken,
    transport,
  );
  if (!schema.response?.ok || schema.body?.success !== true) {
    const errors = Array.isArray(schema.body?.errors) ? schema.body.errors : [];
    const paidOnly = errors.some((error) => Number(error?.code) === 5035);
    if (paidOnly) return { ok: false, reason: "CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN" };
    if ([401, 403].includes(schema.response?.status ?? 0)) {
      return { ok: false, reason: "CLOUDFLARE_WORKERS_AI_PERMISSION_REQUIRED" };
    }
    return { ok: false, reason: "CLOUDFLARE_WORKERS_AI_MODEL_UNVERIFIED" };
  }
  const schemaResult = schema.body.result && typeof schema.body.result === "object" && !Array.isArray(schema.body.result)
    ? schema.body.result as Record<string, unknown>
    : {};
  if (!schemaResult.input || !schemaResult.output) {
    return { ok: false, reason: "CLOUDFLARE_WORKERS_AI_MODEL_UNVERIFIED" };
  }

  return { ok: true };
}

function validateCloudflarePlan(plan: OriginExecutionPlan): void {
  if (!plan.freeOnly
    || plan.estimatedCostUsd !== 0
    || plan.providerId !== ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID
    || plan.modelId !== ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL
    || plan.providerDataPolicy.allowProviderFallbacks !== false
    || plan.providerDataPolicy.dataCollection !== "deny"
    || plan.providerDataPolicy.requireZeroDataRetention !== true) {
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "0ドル・ZDR固定ポリシーに適合しない実行計画です。", 400, false);
  }
}

function planEvidenceIsCurrent(plan: OriginExecutionPlan, selected: OriginCloudflareFreeModelEvidence, nowMs: number): boolean {
  const planVerifiedAt = Date.parse(plan.modelEvidence?.verifiedAt ?? "");
  const planReviewAfter = Date.parse(plan.modelEvidence?.reviewAfter ?? "");
  return plan.modelEvidence?.providerId === ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_PROVIDER_ID
    && plan.modelEvidence?.sourceUrl === selected.sourceUrl
    && Number.isFinite(planVerifiedAt)
    && Number.isFinite(planReviewAfter)
    && planVerifiedAt === Date.parse(selected.verifiedAt)
    && planReviewAfter === Date.parse(selected.reviewAfter)
    && nowMs >= planVerifiedAt
    && nowMs <= planReviewAfter;
}

export function assertOriginCloudflareExecutionResult(result: OriginProviderExecutionResult): void {
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
    || evidence.provider !== "Cloudflare"
    || evidence.requestedModel !== ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL
    || evidence.servedModel !== ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL
    || evidence.strategy !== "verified-free-failover"
    || evidence.fallbackUsed !== true
    || evidence.attempt !== 2) {
    fail("PROVIDER_ROUTING_UNVERIFIED", "許可された無料Provider/Modelの証跡を確認できません。");
  }
  if (result.providerDataPolicy.allowProviderFallbacks !== false
    || result.providerDataPolicy.dataCollection !== "deny"
    || result.providerDataPolicy.requireZeroDataRetention !== true) {
    fail("PROVIDER_POLICY_VIOLATION", "0ドル・ZDR固定ポリシーに適合しない実行結果です。");
  }
}

function inferenceFailure(status: number, body: CloudflareEnvelope | null): OriginProviderError {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const errorText = errors.map((error) => `${String(error?.code ?? "")} ${String(error?.message ?? "")}`).join(" ").toLowerCase();
  const diagnostic = { upstreamStatus: status };
  if (status === 429 || /neuron|rate.?limit|quota|too many requests/.test(errorText)) {
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

function extractInferenceText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const record = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  if (typeof record.response === "string") return record.response.trim();
  const content = record.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

function extractUsage(body: CloudflareEnvelope): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const result = body.result && typeof body.result === "object" ? body.result as { usage?: unknown } : {};
  const usage = (result.usage ?? body.usage) as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } | undefined;
  const promptTokens = Number.isSafeInteger(usage?.prompt_tokens) && Number(usage?.prompt_tokens) >= 0 ? Number(usage?.prompt_tokens) : 0;
  const completionTokens = Number.isSafeInteger(usage?.completion_tokens) && Number(usage?.completion_tokens) >= 0 ? Number(usage?.completion_tokens) : 0;
  const totalTokens = Number.isSafeInteger(usage?.total_tokens) && Number(usage?.total_tokens) >= 0 ? Number(usage?.total_tokens) : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

export interface OriginCloudflareExecutionOptions {
  catalog?: readonly OriginCloudflareFreeModelEvidence[];
  nowMs?: number;
}

export async function executeOriginCloudflareProvider(
  providerRequest: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: OriginFetch = fetch,
  options: OriginCloudflareExecutionOptions = {},
): Promise<OriginProviderExecutionResult> {
  if (!isOriginCloudflareFailoverEnabled(env)) throw new OriginCloudflarePreflightError("not-enabled");
  const credentials = resolveOriginCloudflareCredentials(env);
  if (!credentials) throw new OriginCloudflarePreflightError("not-configured");

  const transport = { count: 0 };
  try {
    validateCloudflarePlan(providerRequest.plan);
    if (providerRequest.requiredTool) {
      // Required-tool contracts stay on the primary route in Phase 1: the strict single-call
      // tool contract has not been verified against this route's model.
      throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "必須ツール付きリクエストはフェイルオーバー対象外です。", 400, false);
    }
    const nowMs = options.nowMs ?? Date.now();
    const selection = selectCurrentOriginCloudflareFreeModel(options.catalog, nowMs);
    if (selection.ok === false) {
      throw new OriginCloudflarePreflightError(selection.code === "FREE_MODEL_CATALOG_INVALID" ? "catalog-invalid" : "evidence-stale");
    }
    if (!planEvidenceIsCurrent(providerRequest.plan, selection.model, nowMs)) {
      throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "実行計画の無料証拠がカタログと一致しません。", 400, false);
    }

    const proof = await verifyOriginCloudflareWorkersFreePlan(fetchImpl, credentials, transport);
    if (proof.ok === false) throw new OriginCloudflarePreflightError("plan-proof-failed", proof.reason);

    const messages = [
      { role: "system", content: sanitizePreEgress(providerRequest.systemInstruction) },
      ...providerRequest.messages.map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        content: sanitizePreEgress(message.content),
      })),
    ];
    const timeoutMs = Math.min(MAX_CF_REQUEST_TIMEOUT_MS, Math.max(5_000, Number(providerRequest.plan.timeoutMs) || MAX_CF_REQUEST_TIMEOUT_MS));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      transport.count += 1;
      response = await fetchImpl(
        `${CLOUDFLARE_API_BASE}/accounts/${credentials.accountId}/ai/run/${ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.aiToken}` },
          body: JSON.stringify({
            messages,
            max_tokens: originCompletionTokenBudget(providerRequest.plan.taskType),
            temperature: 0.2,
          }),
          signal: controller.signal,
        },
      );
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new OriginProviderError("PROVIDER_TIMEOUT", "無料AIがタイムアウトしました。", 504, true, undefined, { transportFailure: "timeout" });
      }
      throw new OriginProviderError("PROVIDER_UNAVAILABLE", "無料AIを現在利用できません。", 503, true, undefined, { transportFailure: "network" });
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => null) as CloudflareEnvelope | null;
    if (!response.ok || !body || body.success !== true) throw inferenceFailure(response.status, body);
    const text = extractInferenceText(body.result);
    if (!text) throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true);
    const usage = extractUsage(body);
    const neurons = Math.round(
      (usage.promptTokens / 1_000_000) * NEURONS_PER_MILLION_INPUT_TOKENS
      + (usage.completionTokens / 1_000_000) * NEURONS_PER_MILLION_OUTPUT_TOKENS,
    );
    const result: OriginProviderExecutionResult = {
      text,
      transportRequestCount: transport.count,
      actualCostUsd: 0,
      providerDataPolicy: providerRequest.plan.providerDataPolicy,
      routingEvidence: {
        requestedModel: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL,
        servedModel: ORIGIN_CLOUDFLARE_WORKERS_AI_FREE_MODEL,
        strategy: "verified-free-failover",
        provider: "Cloudflare",
        attempt: 2,
        fallbackUsed: true,
        neurons,
      },
      usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, costUsd: 0 },
    };
    assertOriginCloudflareExecutionResult(result);
    return result;
  } catch (error) {
    if (error instanceof OriginCloudflarePreflightError) throw error;
    if (error instanceof OriginProviderError) {
      throw new OriginProviderError(error.code, error.message, error.status, error.retryable, error.retryAfterSeconds, {
        ...error.diagnostic,
        transportRequestCount: transport.count,
      });
    }
    throw error;
  }
}
