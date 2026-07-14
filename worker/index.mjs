const DEFAULT_FREE_MODEL = "google/gemini-2.5-flash:free";
const MAX_PROMPT_LENGTH = 4000;
const OPENROUTER_TIMEOUT_MS = 8000;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function isExplicitlyFreeModel(model) {
  const normalized = String(model || "").toLowerCase();
  return normalized.includes(":free") || normalized.includes("-free") || normalized.endsWith("/free");
}

async function callOpenRouter(request, env) {
  if (env.FREE_ONLY !== "true") {
    return json({ error: "FREE_ONLY_REQUIRED" }, 503, corsHeaders(request));
  }

  if (!env.OPENROUTER_API_KEY) {
    return json({ error: "OPENROUTER_NOT_CONFIGURED" }, 503, corsHeaders(request));
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400, corsHeaders(request));
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    return json({ error: "INVALID_PROMPT", maxLength: MAX_PROMPT_LENGTH }, 400, corsHeaders(request));
  }

  const model = env.OPENROUTER_FREE_MODEL || DEFAULT_FREE_MODEL;
  if (!isExplicitlyFreeModel(model)) {
    return json({ error: "FREE_MODEL_REQUIRED" }, 503, corsHeaders(request));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": env.APP_URL || "https://acos-staging.pages.dev",
        "x-title": "ACOS 2.0 Staging",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 700,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return json(
        { error: "FREE_MODEL_UNAVAILABLE", upstreamStatus: response.status },
        response.status === 429 ? 429 : 503,
        corsHeaders(request),
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return json({ error: "EMPTY_MODEL_RESPONSE" }, 503, corsHeaders(request));
    }

    return json({ content, model, freeOnly: true }, 200, corsHeaders(request));
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return json({ error: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_FAILURE" }, 503, corsHeaders(request));
  } finally {
    clearTimeout(timeoutId);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "acos-worker", freeOnly: env.FREE_ONLY === "true" }, 200, headers);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/status") {
      return json(
        {
          status: "ready",
          runtime: "cloudflare-worker",
          freeOnly: env.FREE_ONLY === "true",
          aiConfigured: Boolean(env.OPENROUTER_API_KEY),
        },
        200,
        headers,
      );
    }

    if (request.method === "POST" && url.pathname === "/api/v1/ai/free-chat") {
      return callOpenRouter(request, env);
    }

    return json({ error: "NOT_FOUND" }, 404, headers);
  },
};
