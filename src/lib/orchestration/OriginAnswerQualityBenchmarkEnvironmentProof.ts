import {
  type OriginAnswerQualityBenchmarkExecutionLane,
} from "./OriginAnswerQualityBenchmarkExecutionRouter.js";
import {
  type OriginAnswerQualityBenchmarkRuntimeId,
} from "./OriginAnswerQualityBenchmarkRuntimeAdapter.js";

export interface OriginAnswerQualityBenchmarkEnvironmentProof {
  readonly schemaVersion: "origin.aq-benchmark-environment-proof.v1";
  readonly baseUrl: string;
  readonly expectedGitSha: string;
  readonly observedReleaseSha: string;
  readonly freeOnly: true;
  readonly costUsd: 0;
  readonly paidFallbackEnabled: false;
  readonly runtimeIds: Readonly<Record<
    Exclude<OriginAnswerQualityBenchmarkExecutionLane, "chat">,
    OriginAnswerQualityBenchmarkRuntimeId
  >>;
  readonly codingReady: true;
}

export type OriginAnswerQualityBenchmarkEnvironmentProofResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkEnvironmentProof }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_ENV_INVALID_BASE_URL"
        | "AQ_BENCHMARK_ENV_FETCH_FAILED"
        | "AQ_BENCHMARK_ENV_HEALTH_INVALID"
        | "AQ_BENCHMARK_ENV_SHA_MISMATCH"
        | "AQ_BENCHMARK_ENV_RESEARCH_INVALID"
        | "AQ_BENCHMARK_ENV_ARTIFACT_INVALID"
        | "AQ_BENCHMARK_ENV_CODING_NOT_READY";
    };

type JsonRecord = Record<string, unknown>;

const SHA40 = /^[a-f0-9]{40}$/;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function validBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const local = url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (url.protocol !== "https:" && !local) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

async function getJson(fetchImpl: typeof fetch, base: URL, path: string): Promise<JsonRecord | null> {
  try {
    const response = await fetchImpl(new URL(path, base), {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return record(await response.json());
  } catch {
    return null;
  }
}

function zeroCost(value: JsonRecord): boolean {
  return value.freeOnly === true
    && value.costUsd === 0
    && value.paidFallbackEnabled === false;
}

export async function probeOriginAnswerQualityBenchmarkEnvironment(
  baseUrl: string,
  expectedGitSha: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OriginAnswerQualityBenchmarkEnvironmentProofResult> {
  const base = validBaseUrl(baseUrl);
  if (!base) return { ok: false, code: "AQ_BENCHMARK_ENV_INVALID_BASE_URL" };
  if (!SHA40.test(expectedGitSha)) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_SHA_MISMATCH" };
  }

  const [health, research, artifact, coding] = await Promise.all([
    getJson(fetchImpl, base, "/api/health"),
    getJson(fetchImpl, base, "/api/research/v1.1/status"),
    getJson(fetchImpl, base, "/api/artifacts/v1.2/status"),
    getJson(fetchImpl, base, "/api/coding/v1.4/status"),
  ]);
  if (!health || !research || !artifact || !coding) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_FETCH_FAILED" };
  }

  if (
    health.status !== "ok"
    || health.service !== "acos-2"
    || !zeroCost(health)
    || typeof health.releaseSha !== "string"
    || !SHA40.test(health.releaseSha)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_HEALTH_INVALID" };
  }
  if (health.releaseSha !== expectedGitSha) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_SHA_MISMATCH" };
  }

  if (
    research.ok !== true
    || research.version !== "1.1"
    || research.capability !== "grounded-research"
    || !zeroCost(research)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_RESEARCH_INVALID" };
  }

  if (
    artifact.ok !== true
    || artifact.version !== "1.2"
    || artifact.capability !== "real-artifact-generation"
    || artifact.ready !== true
    || !zeroCost(artifact)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_ARTIFACT_INVALID" };
  }

  if (
    coding.ok !== true
    || coding.version !== "1.4"
    || coding.capability !== "durable-agentic-coding-jobs"
    || coding.ready !== true
    || coding.freeOnly !== true
    || coding.costUsd !== 0
    || coding.paidFallbackEnabled !== false
  ) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_CODING_NOT_READY" };
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-environment-proof.v1",
      baseUrl: base.href,
      expectedGitSha,
      observedReleaseSha: health.releaseSha,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      runtimeIds: Object.freeze({
        research: "grounded-research-v1.1",
        coding: "coding-v1.4",
        artifact: "artifact-v1.2",
      }),
      codingReady: true,
    }),
  };
}


export interface OriginAnswerQualityBenchmarkScopedEnvironmentProof {
  readonly schemaVersion: "origin.aq-benchmark-scoped-environment-proof.v1";
  readonly baseUrl: string;
  readonly expectedGitSha: string;
  readonly observedReleaseSha: string;
  readonly freeOnly: true;
  readonly costUsd: 0;
  readonly paidFallbackEnabled: false;
  readonly requiredLanes: readonly OriginAnswerQualityBenchmarkExecutionLane[];
  readonly runtimeIds: Readonly<Partial<Record<
    OriginAnswerQualityBenchmarkExecutionLane,
    OriginAnswerQualityBenchmarkRuntimeId
  >>>;
}

export type OriginAnswerQualityBenchmarkAnyEnvironmentProof =
  | OriginAnswerQualityBenchmarkEnvironmentProof
  | OriginAnswerQualityBenchmarkScopedEnvironmentProof;

export type OriginAnswerQualityBenchmarkScopedEnvironmentProofResult =
  | { ok: true; value: OriginAnswerQualityBenchmarkScopedEnvironmentProof }
  | {
      ok: false;
      code:
        | "AQ_BENCHMARK_ENV_INVALID_BASE_URL"
        | "AQ_BENCHMARK_ENV_FETCH_FAILED"
        | "AQ_BENCHMARK_ENV_HEALTH_INVALID"
        | "AQ_BENCHMARK_ENV_SHA_MISMATCH"
        | "AQ_BENCHMARK_ENV_RESEARCH_INVALID"
        | "AQ_BENCHMARK_ENV_ARTIFACT_INVALID"
        | "AQ_BENCHMARK_ENV_CODING_NOT_READY"
        | "AQ_BENCHMARK_ENV_REQUIRED_LANES_INVALID";
    };

function normalizedRequiredLanes(
  lanes: readonly OriginAnswerQualityBenchmarkExecutionLane[],
): readonly OriginAnswerQualityBenchmarkExecutionLane[] | null {
  const allowed: readonly OriginAnswerQualityBenchmarkExecutionLane[] = [
    "research",
    "chat",
    "coding",
    "artifact",
  ];
  const seen = new Set<OriginAnswerQualityBenchmarkExecutionLane>();
  for (const lane of lanes) {
    if (!allowed.includes(lane) || seen.has(lane)) return null;
    seen.add(lane);
  }
  return Object.freeze(allowed.filter((lane) => seen.has(lane)));
}

export interface OriginAnswerQualityBenchmarkScopedProbeOptions {
  readonly codingReadiness?: "durable-http" | "checkout";
  readonly codingCheckoutReady?: boolean;
}

export async function probeOriginAnswerQualityBenchmarkEnvironmentForLanes(
  baseUrl: string,
  expectedGitSha: string,
  requiredLanes: readonly OriginAnswerQualityBenchmarkExecutionLane[],
  fetchImpl: typeof fetch = fetch,
  options: OriginAnswerQualityBenchmarkScopedProbeOptions = {},
): Promise<OriginAnswerQualityBenchmarkScopedEnvironmentProofResult> {
  const base = validBaseUrl(baseUrl);
  if (!base) return { ok: false, code: "AQ_BENCHMARK_ENV_INVALID_BASE_URL" };
  if (!SHA40.test(expectedGitSha)) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_SHA_MISMATCH" };
  }

  const normalized = normalizedRequiredLanes(requiredLanes);
  if (!normalized || normalized.length === 0) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_REQUIRED_LANES_INVALID" };
  }

  const health = await getJson(fetchImpl, base, "/api/health");
  if (!health) return { ok: false, code: "AQ_BENCHMARK_ENV_FETCH_FAILED" };

  if (
    health.status !== "ok"
    || health.service !== "acos-2"
    || !zeroCost(health)
    || typeof health.releaseSha !== "string"
    || !SHA40.test(health.releaseSha)
  ) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_HEALTH_INVALID" };
  }
  if (health.releaseSha !== expectedGitSha) {
    return { ok: false, code: "AQ_BENCHMARK_ENV_SHA_MISMATCH" };
  }

  const runtimeIds: Partial<Record<
    OriginAnswerQualityBenchmarkExecutionLane,
    OriginAnswerQualityBenchmarkRuntimeId
  >> = {};

  if (normalized.includes("research")) {
    const research = await getJson(fetchImpl, base, "/api/research/v1.1/status");
    if (!research) return { ok: false, code: "AQ_BENCHMARK_ENV_FETCH_FAILED" };
    if (
      research.ok !== true
      || research.version !== "1.1"
      || research.capability !== "grounded-research"
      || !zeroCost(research)
    ) {
      return { ok: false, code: "AQ_BENCHMARK_ENV_RESEARCH_INVALID" };
    }
    runtimeIds.research = "grounded-research-v1.1";
  }

  if (normalized.includes("artifact")) {
    const artifact = await getJson(fetchImpl, base, "/api/artifacts/v1.2/status");
    if (!artifact) return { ok: false, code: "AQ_BENCHMARK_ENV_FETCH_FAILED" };
    if (
      artifact.ok !== true
      || artifact.version !== "1.2"
      || artifact.capability !== "real-artifact-generation"
      || artifact.ready !== true
      || !zeroCost(artifact)
    ) {
      return { ok: false, code: "AQ_BENCHMARK_ENV_ARTIFACT_INVALID" };
    }
    runtimeIds.artifact = "artifact-v1.2";
  }

  if (normalized.includes("coding")) {
    if (options.codingReadiness === "checkout") {
      if (options.codingCheckoutReady !== true) {
        return { ok: false, code: "AQ_BENCHMARK_ENV_CODING_NOT_READY" };
      }
      runtimeIds.coding = "coding-v1.4";
    } else {
      const coding = await getJson(fetchImpl, base, "/api/coding/v1.4/status");
      if (!coding) return { ok: false, code: "AQ_BENCHMARK_ENV_FETCH_FAILED" };
      if (
        coding.ok !== true
        || coding.version !== "1.4"
        || coding.capability !== "durable-agentic-coding-jobs"
        || coding.ready !== true
        || coding.freeOnly !== true
        || coding.costUsd !== 0
        || coding.paidFallbackEnabled !== false
      ) {
        return { ok: false, code: "AQ_BENCHMARK_ENV_CODING_NOT_READY" };
      }
      runtimeIds.coding = "coding-v1.4";
    }
  }

  if (normalized.includes("chat")) {
    runtimeIds.chat = "origin-chat";
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-benchmark-scoped-environment-proof.v1",
      baseUrl: base.href,
      expectedGitSha,
      observedReleaseSha: health.releaseSha,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      requiredLanes: normalized,
      runtimeIds: Object.freeze(runtimeIds),
    }),
  };
}
