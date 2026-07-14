const DEFAULT_FREE_MODEL = "google/gemini-2.5-flash:free";
const MAX_PROMPT_LENGTH = 4000;
const OPENROUTER_TIMEOUT_MS = 8000;
const BUSY_MESSAGE = "Currently free AI models are busy. Please wait a moment and try again.";

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
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };

  if (origin && allowed.has(origin)) {
    headers["access-control-allow-origin"] = origin;
  }

  return headers;
}

function isExplicitlyFreeModel(model) {
  const normalized = String(model || "").trim().toLowerCase();
  return normalized.length > 0 && normalized !== "openrouter/auto" && normalized.endsWith(":free");
}

async function callOpenRouter(request, env) {
  const headers = corsHeaders(request, env);

  if (env.FREE_ONLY !== "true") {
    return json(
      { error: "FREE_ONLY_REQUIRED", message: "Only free models are permitted on this endpoint." },
      503,
      headers,
    );
  }

  if (!env.OPENROUTER_API_KEY) {
    return json(
      { error: "OPENROUTER_NOT_CONFIGURED", message: "OpenRouter API key is missing." },
      503,
      headers,
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON", message: "Invalid JSON format." }, 400, headers);
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return json({ error: "INVALID_PROMPT", message: "Prompt cannot be empty." }, 400, headers);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return json(
      { error: "INVALID_PROMPT", message: "Prompt is too long.", maxLength: MAX_PROMPT_LENGTH },
      400,
      headers,
    );
  }

  const model = env.OPENROUTER_FREE_MODEL || DEFAULT_FREE_MODEL;
  if (!isExplicitlyFreeModel(model)) {
    return json(
      { error: "FREE_MODEL_REQUIRED", message: "Configured model is not an explicitly free OpenRouter model." },
      503,
      headers,
    );
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
        { error: "FREE_MODEL_UNAVAILABLE", message: BUSY_MESSAGE },
        response.status === 429 ? 429 : 503,
        headers,
      );
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return json({ error: "INVALID_UPSTREAM_RESPONSE", message: BUSY_MESSAGE }, 503, headers);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return json({ error: "EMPTY_MODEL_RESPONSE", message: BUSY_MESSAGE }, 503, headers);
    }

    return json({ content: content.trim(), model, freeOnly: true }, 200, headers);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return json(
      { error: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_FAILURE", message: BUSY_MESSAGE },
      503,
      headers,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);

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

    if (url.pathname === "/api/v1/ai/free-chat") {
      if (request.method !== "POST") {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405, headers);
      }
      return callOpenRouter(request, env);
    }

    return json({ error: "NOT_FOUND" }, 404, headers);
  },
};