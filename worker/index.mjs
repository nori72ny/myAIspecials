const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROMPT_CHARS = 12_000;
const MAX_OUTPUT_TOKENS = 1_024;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function allowedOrigins(env) {
  return new Set(
    [env.APP_URL, env.LOCAL_DEV_ORIGIN]
      .filter((value) => typeof value === "string" && value.length > 0),
  );
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigins(env);
  const headers = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };

  if (origin && allowed.has(origin)) {
    headers["access-control-allow-origin"] = origin;
  }

  return headers;
}

function previewControlsConfigured(env) {
  return env.FREE_ONLY === "true"
    && env.CF_WORKERS_AI_PREVIEW_ENABLED === "true"
    && env.CF_WORKERS_AI_FREE_PLAN_CONFIRMED === "true"
    && typeof env.ORIGIN_PREVIEW_TOKEN === "string"
    && env.ORIGIN_PREVIEW_TOKEN.length >= 32
    && Boolean(env.AI && typeof env.AI.run === "function")
    && validCloudflareCredentials(env);
}

function validCloudflareCredentials(env) {
  const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === "string" ? env.CLOUDFLARE_ACCOUNT_ID.trim() : "";
  const apiToken = typeof env.CLOUDFLARE_API_TOKEN === "string" ? env.CLOUDFLARE_API_TOKEN.trim() : "";
  return /^[a-f0-9]{32}$/i.test(accountId) && apiToken.length >= 20 && apiToken.length <= 4096;
}

function cloudflareCredentials(env) {
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID.trim(),
    apiToken: env.CLOUDFLARE_API_TOKEN.trim(),
  };
}

async function readCloudflareJson(url, apiToken, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiToken}`,
        accept: "application/json",
      },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  } catch {
    return { response: null, body: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isActiveSubscription(value) {
  return ["Trial", "Provisioned", "Paid", "AwaitingPayment"].includes(String(value?.state ?? ""));
}

function subscriptionPlanText(value) {
  const plan = value?.rate_plan && typeof value.rate_plan === "object" && !Array.isArray(value.rate_plan)
    ? value.rate_plan
    : {};
  return [plan.id, plan.public_name, plan.name, plan.scope, ...(Array.isArray(plan.sets) ? plan.sets : [])]
    .filter(item => typeof item === "string")
    .join(" ")
    .toLowerCase();
}

async function verifyWorkersFreePlan(env) {
  const { accountId, apiToken } = cloudflareCredentials(env);
  const accountBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;

  const settings = await readCloudflareJson(
    `${accountBase}/workers/account-settings`,
    apiToken,
  );
  if (!settings.response?.ok || settings.body?.success !== true) {
    return { ok: false, reason: "CLOUDFLARE_WORKERS_PLAN_UNVERIFIED" };
  }

  const settingsResult = settings.body.result && typeof settings.body.result === "object" && !Array.isArray(settings.body.result)
    ? settings.body.result
    : {};
  const usageModel = typeof settingsResult.default_usage_model === "string"
    ? settingsResult.default_usage_model.toLowerCase()
    : "";
  if (usageModel === "standard" || usageModel === "unbound") {
    return { ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" };
  }
  if (usageModel !== "bundled") {
    return { ok: false, reason: "CLOUDFLARE_WORKERS_PLAN_UNVERIFIED" };
  }

  const subscriptions = await readCloudflareJson(
    `${accountBase}/subscriptions`,
    apiToken,
  );
  const subscriptionInfo = subscriptions.body?.result_info;
  const subscriptionRows = subscriptions.body?.result;
  if (!subscriptions.response?.ok || subscriptions.body?.success !== true) {
    return { ok: false, reason: "CLOUDFLARE_BILLING_READ_REQUIRED" };
  }
  if (
    !Array.isArray(subscriptionRows)
    || !subscriptionInfo
    || !Number.isSafeInteger(subscriptionInfo.count)
    || !Number.isSafeInteger(subscriptionInfo.total_count)
    || subscriptionInfo.count !== subscriptionRows.length
    || subscriptionInfo.total_count !== subscriptionRows.length
  ) {
    // The endpoint is paginated. Never infer a Free account from an incomplete first page.
    return { ok: false, reason: "CLOUDFLARE_BILLING_READ_INCOMPLETE" };
  }

  for (const row of subscriptionRows) {
    if (!row || typeof row !== "object" || !isActiveSubscription(row)) continue;
    const planText = subscriptionPlanText(row);
    if (!planText.includes("worker")) continue;
    const numericPrice = typeof row.price === "number" && Number.isFinite(row.price) ? row.price : null;
    if ((numericPrice !== null && numericPrice > 0) || planText.includes("paid") || !planText.includes("free")) {
      return { ok: false, reason: "CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED" };
    }
  }

  const schema = await readCloudflareJson(
    `${accountBase}/ai/models/schema?model=${encodeURIComponent(MODEL_ID)}`,
    apiToken,
  );
  if (!schema.response?.ok || schema.body?.success !== true) {
    const errors = Array.isArray(schema.body?.errors) ? schema.body.errors : [];
    const paidOnly = errors.some(error => Number(error?.code) === 5035);
    if (paidOnly) return { ok: false, reason: "CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN" };
    if ([401, 403].includes(schema.response?.status ?? 0)) {
      return { ok: false, reason: "CLOUDFLARE_WORKERS_AI_PERMISSION_REQUIRED" };
    }
    return { ok: false, reason: "CLOUDFLARE_WORKERS_AI_MODEL_UNVERIFIED" };
  }

  const schemaResult = schema.body.result && typeof schema.body.result === "object" && !Array.isArray(schema.body.result)
    ? schema.body.result
    : {};
  if (!schemaResult.input || !schemaResult.output) {
    return { ok: false, reason: "CLOUDFLARE_WORKERS_AI_MODEL_UNVERIFIED" };
  }

  return { ok: true, reason: null };
}

function validPreviewToken(request, env) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;

  const expected = new TextEncoder().encode(env.ORIGIN_PREVIEW_TOKEN);
  const provided = new TextEncoder().encode(authorization.slice(7));
  if (provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected[index] ^ provided[index];
  }
  return mismatch === 0;
}

function safeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function readBodyWithinLimit(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("REQUEST_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function handlePreviewChat(request, env, headers) {
  if (!previewControlsConfigured(env)) {
    return json({
      error: "ORIGIN_CF_AI_PREVIEW_NOT_ENABLED",
      message: "Cloudflare Workers AI preview is disabled until the Free plan and preview controls are confirmed.",
      retryable: false,
    }, 503, headers);
  }

  if (!validPreviewToken(request, env)) {
    return json({ error: "UNAUTHORIZED", retryable: false }, 401, headers);
  }

  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(env).has(origin)) {
    return json({ error: "ORIGIN_NOT_ALLOWED", retryable: false }, 403, headers);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: "REQUEST_BODY_TOO_LARGE", retryable: false }, 413, headers);
  }

  let rawBody;
  try {
    rawBody = await readBodyWithinLimit(request);
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE") {
      return json({ error: "REQUEST_BODY_TOO_LARGE", retryable: false }, 413, headers);
    }
    return json({ error: "INVALID_REQUEST_BODY", retryable: false }, 400, headers);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "INVALID_JSON_BODY", retryable: false }, 400, headers);
  }

  const prompt = body && typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: "INVALID_PROMPT", retryable: false }, 400, headers);
  }

  const freePlanProof = await verifyWorkersFreePlan(env);
  if (!freePlanProof.ok) {
    return json({
      error: freePlanProof.reason,
      message: "The Cloudflare Workers Free plan, billing state, and exact model eligibility could not all be verified. Inference was not sent.",
      retryable: false,
    }, 503, headers);
  }

  let result;
  try {
    // One fixed Cloudflare-hosted ZDR model. No retry, provider fallback, or model fallback.
    result = await env.AI.run(MODEL_ID, {
      messages: [
        {
          role: "system",
          content: "You are ORIGIN Personal. Respond in the user's language. Distinguish verified facts from uncertainty. Do not invent sources, actions, or capabilities.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
    }, { rejectIfBusy: true });
  } catch {
    return json({
      error: "ORIGIN_CF_AI_PROVIDER_UNAVAILABLE",
      message: "The preview inference request failed. No retry or provider fallback was attempted.",
      retryable: false,
    }, 503, headers);
  }

  const responseText = result && typeof result.response === "string"
    ? result.response
    : "";

  if (!responseText.trim()) {
    return json({
      error: "ORIGIN_CF_AI_EMPTY_RESPONSE",
      message: "The preview provider returned no usable response.",
      retryable: false,
    }, 502, headers);
  }

  const usage = result && typeof result.usage === "object" && result.usage !== null
    ? result.usage
    : {};

  return json({
    response: responseText,
    provider: "cloudflare-workers-ai",
    model: MODEL_ID,
    usage: {
      promptTokens: safeTokenCount(usage.prompt_tokens),
      completionTokens: safeTokenCount(usage.completion_tokens),
    },
    freeAllocationEligible: true,
    planEvidenceStatus: "VERIFIED_WORKERS_FREE",
    actualCostUsd: null,
    costEvidenceStatus: "NOT_MEASURED",
    retryable: false,
  }, 200, headers);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        status: "ok",
        service: "acos-worker",
        freeOnly: env.FREE_ONLY === "true",
      }, 200, headers);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/status") {
      return json({
        status: "ready",
        runtime: "cloudflare-worker",
        freeOnly: env.FREE_ONLY === "true",
        aiBindingConfigured: Boolean(env.AI && typeof env.AI.run === "function"),
        previewControlsConfigured: previewControlsConfigured(env),
        freePlanProofRequired: true,
        model: MODEL_ID,
      }, 200, headers);
    }

    if (url.pathname === "/api/v1/ai/free-chat") {
      if (request.method !== "POST") {
        return json({ error: "METHOD_NOT_ALLOWED", retryable: false }, 405, headers);
      }
      return handlePreviewChat(request, env, headers);
    }

    return json({ error: "NOT_FOUND" }, 404, headers);
  },
};
