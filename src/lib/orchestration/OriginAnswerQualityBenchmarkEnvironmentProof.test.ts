import { describe, expect, it, vi } from "vitest";

import { probeOriginAnswerQualityBenchmarkEnvironment } from "./OriginAnswerQualityBenchmarkEnvironmentProof";

const sha = "a".repeat(40);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchFor(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/health") return response({
      status: "ok",
      service: "acos-2",
      releaseSha: overrides.releaseSha ?? sha,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
    });
    if (path === "/api/research/v1.1/status") return response({
      ok: true,
      version: "1.1",
      capability: "grounded-research",
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      ...((overrides.research as object | undefined) ?? {}),
    });
    if (path === "/api/artifacts/v1.2/status") return response({
      ok: true,
      ready: true,
      version: "1.2",
      capability: "real-artifact-generation",
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      ...((overrides.artifact as object | undefined) ?? {}),
    });
    if (path === "/api/coding/v1.4/status") return response({
      ok: true,
      ready: true,
      version: "1.4",
      capability: "durable-agentic-coding-jobs",
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      ...((overrides.coding as object | undefined) ?? {}),
    });
    return response({}, 404);
  });
}

describe("OriginAnswerQualityBenchmarkEnvironmentProof", () => {
  it("proves exact release SHA and zero-cost runtime readiness", async () => {
    const result = await probeOriginAnswerQualityBenchmarkEnvironment(
      "https://candidate.example/",
      sha,
      fetchFor() as typeof fetch,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.baseUrl).toBe("https://candidate.example/");
    expect(result.value.observedReleaseSha).toBe(sha);
    expect(result.value.codingReady).toBe(true);
    expect(result.value.runtimeIds).toEqual({
      research: "grounded-research-v1.1",
      coding: "coding-v1.4",
      artifact: "artifact-v1.2",
    });
  });

  it("rejects a deployment whose release SHA differs from the measured git SHA", async () => {
    const result = await probeOriginAnswerQualityBenchmarkEnvironment(
      "https://candidate.example/",
      sha,
      fetchFor({ releaseSha: "b".repeat(40) }) as typeof fetch,
    );
    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_ENV_SHA_MISMATCH" });
  });

  it("rejects coding when the durable runtime is not actually ready", async () => {
    const result = await probeOriginAnswerQualityBenchmarkEnvironment(
      "https://candidate.example/",
      sha,
      fetchFor({ coding: { ready: false } }) as typeof fetch,
    );
    expect(result).toEqual({ ok: false, code: "AQ_BENCHMARK_ENV_CODING_NOT_READY" });
  });

  it("rejects non-HTTPS remote targets and embedded credentials", async () => {
    expect(await probeOriginAnswerQualityBenchmarkEnvironment(
      "http://example.com/",
      sha,
      fetchFor() as typeof fetch,
    )).toEqual({ ok: false, code: "AQ_BENCHMARK_ENV_INVALID_BASE_URL" });

    expect(await probeOriginAnswerQualityBenchmarkEnvironment(
      "https://user:pass@example.com/",
      sha,
      fetchFor() as typeof fetch,
    )).toEqual({ ok: false, code: "AQ_BENCHMARK_ENV_INVALID_BASE_URL" });
  });
});
