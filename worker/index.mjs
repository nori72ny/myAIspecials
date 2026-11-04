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

function previewExecutionEnabled(env) {
  return env.FREE_ONLY === "true"
    && env.CF_WORKERS_AI_PREVIEW_ENABLED === "true"
    && env.CF_WORKERS_AI_FREE_PLAN_CONFIRMED === "true"
    && Boolean(env.ORIGIN_PREVIEW_TOKEN)
    && Boolean(env.AI && typeof env.AI.run === "function");
}

function validPreviewToken(request, env) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization === `Bearer ${env.ORIGIN_PREVIEW_TOKEN}`;
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
  if (!previewExecutionEnabled(env)) {
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
        previewExecutionEnabled: previewExecutionEnabled(env),
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
