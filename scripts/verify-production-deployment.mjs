import assert from "node:assert/strict";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
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

async function fetchWithTimeout(url, timeoutMs) {
  return fetch(url, {
    headers: {
      accept: "application/json, text/html;q=0.9",
      "cache-control": "no-cache",
      "user-agent": "origin-production-smoke/1.0",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function verifyProductionDeployment(env = process.env) {
  const baseUrl = normalizedBaseUrl(
    env.ORIGIN_PRODUCTION_URL ?? "https://origin-personal.vercel.app",
  );
  const expectedSha = env.ORIGIN_EXPECTED_SHA?.toLowerCase();
  assert.match(
    expectedSha ?? "",
    FULL_GIT_SHA,
    "ORIGIN_EXPECTED_SHA must be the exact 40-character main commit SHA.",
  );

  const timeoutMs = positiveInteger(
    env.ORIGIN_DEPLOY_TIMEOUT_MS,
    600_000,
    "ORIGIN_DEPLOY_TIMEOUT_MS",
  );
  const pollIntervalMs = positiveInteger(
    env.ORIGIN_DEPLOY_POLL_INTERVAL_MS,
    10_000,
    "ORIGIN_DEPLOY_POLL_INTERVAL_MS",
  );
  const requestTimeoutMs = positiveInteger(
    env.ORIGIN_REQUEST_TIMEOUT_MS,
    15_000,
    "ORIGIN_REQUEST_TIMEOUT_MS",
  );

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastObservation = "No response received.";

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/health?expected=${expectedSha}&attempt=${attempt}`,
        requestTimeoutMs,
      );
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !/application\/json/i.test(contentType)) {
        lastObservation = `health returned HTTP ${response.status} (${contentType || "unknown content type"})`;
      } else {
        const health = await response.json();
        lastObservation = `releaseSha=${String(health.releaseSha ?? "missing")}`;
        if (
          health.status === "ok"
          && health.service === "acos-2"
          && String(health.releaseSha).toLowerCase() === expectedSha
        ) {
          const pageResponse = await fetchWithTimeout(
            `${baseUrl}/?release=${expectedSha}`,
            requestTimeoutMs,
          );
          assert.equal(pageResponse.status, 200, "Production page must return HTTP 200.");
          assert.match(
            pageResponse.headers.get("content-type") ?? "",
            /text\/html/i,
            "Production page must return HTML.",
          );
          assert.match(
            await pageResponse.text(),
            /<title>ORIGIN Personal<\/title>/i,
            "Production page must identify ORIGIN Personal.",
          );

          return {
            baseUrl,
            expectedSha,
            observedSha: String(health.releaseSha).toLowerCase(),
            attempts: attempt,
          };
        }
      }
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => {
      setTimeout(resolve, Math.min(pollIntervalMs, remainingMs));
    });
  }

  throw new Error(
    `Production did not expose expected main SHA ${expectedSha} within ${timeoutMs}ms. Last observation: ${lastObservation}`,
  );
}

if (process.argv[1]?.endsWith("verify-production-deployment.mjs")) {
  try {
    const result = await verifyProductionDeployment();
    console.log(JSON.stringify({
      status: "passed",
      check: "origin-production-deployment",
      ...result,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
