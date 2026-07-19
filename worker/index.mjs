const DISABLED_AI_RESPONSE = {
  error: "ORIGIN_LEGACY_PROVIDER_PATH_DISABLED",
  message: "This legacy provider endpoint is disabled until it is migrated to the ORIGIN safety and free-only execution policy.",
  retryable: false,
};

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
          providerExecutionEnabled: false,
        },
        200,
        headers,
      );
    }

    if (url.pathname === "/api/v1/ai/free-chat") {
      if (request.method !== "POST") {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405, headers);
      }

      return json(DISABLED_AI_RESPONSE, 503, headers);
    }

    return json({ error: "NOT_FOUND" }, 404, headers);
  },
};
