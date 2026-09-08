import assert from "node:assert/strict";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SAFE_FAILURE_CODE = /^[A-Z0-9_:-]{1,80}$/;
const EXPECTED_FREE_MODEL = "inclusionai/ling-3.0-flash-sante:free";
const CONTEXT_TOKEN = "ORIGIN-CONTEXT-42";
const STREAM_MARKER = "STREAM-CHECK";

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function normalizedBaseUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", "Production smoke tests require HTTPS.");
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function fetchWithTimeout(url, timeoutMs, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      accept: "application/json, text/html;q=0.9, text/event-stream;q=0.9",
      "cache-control": "no-cache",
      "user-agent": "origin-production-smoke/1.6",
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function safeFailureCode(body, contentType) {
  if (!/application\/json/i.test(contentType) || !body.trim()) return "UNKNOWN";
  try {
    const parsed = JSON.parse(body);
    const code = typeof parsed?.code === "string" ? parsed.code.trim() : "";
    return SAFE_FAILURE_CODE.test(code) ? code : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export async function verifyLiveChat(baseUrl, requestTimeoutMs) {
  const response = await fetchWithTimeout(`${baseUrl}/api/chat`, requestTimeoutMs, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      origin: baseUrl,
    },
    body: JSON.stringify({
      messages: [
        { role: "user", content: `この会話だけで使う検証用合言葉は ${CONTEXT_TOKEN} です。記憶してください。` },
        { role: "assistant", content: "記憶しました。" },
        { role: "user", content: `前のユーザーメッセージで指定された検証用合言葉を1行目にそのまま書き、続けて2行目から25行目まで各行に ${STREAM_MARKER} と書いてください。説明は不要です。` },
      ],
      executionPolicy: { maxEstimatedCostUsd: 0 },
    }),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const vercelId = response.headers.get("x-vercel-id") ?? "";
  let body = "";
  let streamChunkCount = 0;
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) streamChunkCount += 1;
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } else {
    body = await response.text();
  }

  const failureCode = response.status === 200 ? "NONE" : safeFailureCode(body, contentType);
  assert.equal(response.status, 200, `Production /api/chat must return HTTP 200; received ${response.status}; code=${failureCode}; x-vercel-id=${vercelId || "missing"}; body=[response body withheld]`);
  assert.match(contentType, /text\/plain/i, `Production /api/chat returned an unexpected real-stream content type: ${contentType || "missing"}; x-vercel-id=${vercelId || "missing"}; body=[response body withheld]`);
  assert.equal(response.headers.get("x-origin-stream-source"), "upstream", "Production /api/chat must identify the stream source as upstream provider deltas.");
  assert.equal(response.headers.get("x-origin-stream-protocol"), "origin-text-delta-v1", "Production /api/chat must use the verified upstream delta protocol.");
  assert.equal(response.headers.get("x-origin-free-only"), "true", "Production /api/chat must remain free-only.");
  assert.equal(response.headers.get("x-origin-cost-usd"), "0", "Production /api/chat must report zero cost.");
  assert.equal(response.headers.get("x-origin-billing-tier"), "free", "Production /api/chat must report the free billing tier.");
  assert.equal(response.headers.get("x-origin-model-id"), EXPECTED_FREE_MODEL, "Production /api/chat must use the reviewed fixed free model.");
  assert.ok(body.trim().length > 0, "Production /api/chat must return a non-empty response.");
  assert.ok(body.includes(CONTEXT_TOKEN), "Production /api/chat must recover the synthetic token from earlier multi-turn context.");
  assert.ok((body.match(new RegExp(STREAM_MARKER, "g")) ?? []).length >= 8, "Production /api/chat must return enough requested marker text to exercise progressive delivery.");
  assert.ok(streamChunkCount >= 2, `Production /api/chat must deliver more than one network chunk from the upstream stream; observed ${streamChunkCount}.`);

  return {
    status: response.status,
    contentType,
    bytes: Buffer.byteLength(body),
    streamChunkCount,
    streamSource: "upstream",
    contextVerified: true,
    modelId: EXPECTED_FREE_MODEL,
    vercelId,
  };
}

export async function verifyProductionDeployment(env = process.env) {
  const baseUrl = normalizedBaseUrl(env.ORIGIN_PRODUCTION_URL ?? "https://origin-personal.vercel.app");
  const expectedSha = env.ORIGIN_EXPECTED_SHA?.toLowerCase();
  assert.match(expectedSha ?? "", FULL_GIT_SHA, "ORIGIN_EXPECTED_SHA must be the exact 40-character main commit SHA.");

  const timeoutMs = positiveInteger(env.ORIGIN_DEPLOY_TIMEOUT_MS, 600_000, "ORIGIN_DEPLOY_TIMEOUT_MS");
  const pollIntervalMs = positiveInteger(env.ORIGIN_DEPLOY_POLL_INTERVAL_MS, 10_000, "ORIGIN_DEPLOY_POLL_INTERVAL_MS");
  const requestTimeoutMs = positiveInteger(env.ORIGIN_REQUEST_TIMEOUT_MS, 25_000, "ORIGIN_REQUEST_TIMEOUT_MS");

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let chatAttempted = false;
  let lastObservation = "No response received.";

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/health?expected=${expectedSha}&attempt=${attempt}`, requestTimeoutMs);
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !/application\/json/i.test(contentType)) {
        lastObservation = `health returned HTTP ${response.status} (${contentType || "unknown content type"})`;
      } else {
        const health = await response.json();
        lastObservation = `releaseSha=${String(health.releaseSha ?? "missing")}`;
        if (health.status === "ok" && health.service === "acos-2" && String(health.releaseSha).toLowerCase() === expectedSha) {
          const pageResponse = await fetchWithTimeout(`${baseUrl}/?release=${expectedSha}`, requestTimeoutMs);
          assert.equal(pageResponse.status, 200, "Production page must return HTTP 200.");
          assert.match(pageResponse.headers.get("content-type") ?? "", /text\/html/i, "Production page must return HTML.");
          assert.match(await pageResponse.text(), /<title>ORIGIN Personal<\/title>/i, "Production page must identify ORIGIN Personal.");
          chatAttempted = true;
          const chat = await verifyLiveChat(baseUrl, requestTimeoutMs);
          return { baseUrl, expectedSha, observedSha: String(health.releaseSha).toLowerCase(), attempts: attempt, chat };
        }
      }
    } catch (error) {
      if (chatAttempted) throw error;
      lastObservation = error instanceof Error ? error.message : String(error);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
  }

  throw new Error(`Production did not expose expected main SHA ${expectedSha} within ${timeoutMs}ms. Last observation: ${lastObservation}`);
}

if (process.argv[1]?.endsWith("verify-production-deployment.mjs")) {
  try {
    const result = await verifyProductionDeployment();
    console.log(JSON.stringify({ status: "passed", check: "origin-production-deployment-live-upstream-stream-and-multiturn", ...result }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
