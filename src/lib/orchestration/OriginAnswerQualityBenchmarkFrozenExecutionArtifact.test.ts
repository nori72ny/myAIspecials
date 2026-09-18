import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityFrozenCorpus } from "./OriginAnswerQualityBenchmarkCorpus";
import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof";
import {
  createOriginAnswerQualityBenchmarkFrozenExecutionArtifact,
  parseOriginAnswerQualityBenchmarkFrozenExecutionArtifact,
  restoreOriginAnswerQualityBenchmarkFrozenExecutionArtifact,
} from "./OriginAnswerQualityBenchmarkFrozenExecutionArtifact";
import { createOriginAnswerQualityBenchmarkRuntimeAdapter } from "./OriginAnswerQualityBenchmarkRuntimeAdapter";
import type { OriginAnswerQualityBenchmarkCaseExecutor } from "./OriginAnswerQualityBenchmarkRunner";
import {
  runOriginAnswerQualityBenchmarkExecutionSession,
} from "./OriginAnswerQualityBenchmarkTwoPhaseSession";

const sha = (char: string) => `sha256:${char.repeat(64)}`;

const environmentProof: OriginAnswerQualityBenchmarkEnvironmentProof = {
  schemaVersion: "origin.aq-benchmark-environment-proof.v1",
  baseUrl: "https://candidate.example/",
  expectedGitSha: "a".repeat(40),
  observedReleaseSha: "a".repeat(40),
  freeOnly: true,
  costUsd: 0,
  paidFallbackEnabled: false,
  runtimeIds: {
    research: "grounded-research-v1.1",
    coding: "coding-v1.4",
    artifact: "artifact-v1.2",
  },
  codingReady: true,
};

async function frozenSession() {
  const executor: OriginAnswerQualityBenchmarkCaseExecutor = async (item) => ({
    caseId: item.caseId,
    finalAnswerRef: sha("1"),
    evidenceLedgerRef: sha("2"),
    verifierResult: "PASS",
    providerRequests: 1,
    toolCalls: 1,
    latencyMs: 25,
    costUsd: 0,
    failureCode: null,
  });

  const adapters = {
    research: createOriginAnswerQualityBenchmarkRuntimeAdapter(
      "research",
      "grounded-research-v1.1",
      executor,
    ),
    chat: createOriginAnswerQualityBenchmarkRuntimeAdapter(
      "chat",
      "origin-chat",
      executor,
    ),
    coding: createOriginAnswerQualityBenchmarkRuntimeAdapter(
      "coding",
      "coding-v1.4",
      executor,
    ),
    artifact: createOriginAnswerQualityBenchmarkRuntimeAdapter(
      "artifact",
      "artifact-v1.2",
      executor,
    ),
  };

  let now = 1_789_761_600_000;
  const result = await runOriginAnswerQualityBenchmarkExecutionSession({
    runId: "aq-artifact-1",
    gitSha: "a".repeat(40),
    providerId: "openrouter-free",
    modelId: "example/free-model:free",
    environmentProof,
    executors: adapters,
    corpus: createOriginAnswerQualityFrozenCorpus(),
    nowMs: () => {
      const value = now;
      now += 1000;
      return value;
    },
  });

  if (!result.ok) throw new Error("frozen session fixture failed");
  return result.value;
}

describe("OriginAnswerQualityBenchmarkFrozenExecutionArtifact", () => {
  it("serializes only content-free execution references and restores the exact frozen session", async () => {
    const frozen = await frozenSession();
    const artifact = createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(frozen);

    expect(artifact.ok).toBe(true);
    if (!artifact.ok) return;
    expect(artifact.value.cases).toHaveLength(40);
    expect(artifact.value.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const serialized = JSON.stringify(artifact.value);
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("answer text");
    expect(serialized).not.toContain("messages");
    expect(serialized).not.toContain("chain-of-thought");
    expect(artifact.value.cases.every((item) =>
      item.finalAnswerRef === null || /^sha256:[a-f0-9]{64}$/.test(item.finalAnswerRef)
    )).toBe(true);

    const restored = restoreOriginAnswerQualityBenchmarkFrozenExecutionArtifact(
      artifact.value,
      frozen.corpus,
      frozen.environmentProof,
    );

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.executionSessionDigest).toBe(frozen.executionSessionDigest);
    expect(restored.value.execution.executionOnlyDigest).toBe(frozen.execution.executionOnlyDigest);
  });

  it("rejects non-digest answer references so raw answer text cannot enter the artifact", async () => {
    const frozen = await frozenSession();
    const contaminated = {
      ...frozen,
      execution: {
        ...frozen.execution,
        executedCases: frozen.execution.executedCases.map((item, index) =>
          index === 0
            ? {
                ...item,
                execution: {
                  ...item.execution,
                  finalAnswerRef: "This is raw answer text and must never be persisted.",
                },
              }
            : item
        ),
      },
    };

    expect(createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(contaminated)).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_FROZEN_ARTIFACT_INVALID_REFERENCE",
    });
  });

  it("rejects artifact field tampering before restoration", async () => {
    const frozen = await frozenSession();
    const artifact = createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(frozen);
    if (!artifact.ok) throw new Error("artifact fixture failed");

    const tampered = {
      ...artifact.value,
      totalLatencyMs: artifact.value.totalLatencyMs + 1,
    };

    expect(restoreOriginAnswerQualityBenchmarkFrozenExecutionArtifact(
      tampered,
      frozen.corpus,
      frozen.environmentProof,
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_FROZEN_ARTIFACT_DIGEST_MISMATCH",
    });
  });

  it("rejects restoration against another environment SHA", async () => {
    const frozen = await frozenSession();
    const artifact = createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(frozen);
    if (!artifact.ok) throw new Error("artifact fixture failed");

    const otherEnvironment = {
      ...frozen.environmentProof,
      expectedGitSha: "b".repeat(40),
      observedReleaseSha: "b".repeat(40),
    };

    expect(restoreOriginAnswerQualityBenchmarkFrozenExecutionArtifact(
      artifact.value,
      frozen.corpus,
      otherEnvironment,
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_FROZEN_ARTIFACT_ENVIRONMENT_MISMATCH",
    });
  });

  it("rejects restoration against another frozen corpus manifest", async () => {
    const frozen = await frozenSession();
    const artifact = createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(frozen);
    if (!artifact.ok) throw new Error("artifact fixture failed");

    const otherCorpus = {
      ...frozen.corpus,
      manifest: {
        ...frozen.corpus.manifest,
        manifestDigest: sha("f"),
      },
    };

    expect(restoreOriginAnswerQualityBenchmarkFrozenExecutionArtifact(
      artifact.value,
      otherCorpus,
      frozen.environmentProof,
    )).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_FROZEN_ARTIFACT_CORPUS_MISMATCH",
    });
  });

  it("parses a serialized artifact from unknown JSON and preserves the exact digest", async () => {
    const frozen = await frozenSession();
    const artifact = createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(frozen);
    if (!artifact.ok) throw new Error("artifact fixture failed");

    const parsed = parseOriginAnswerQualityBenchmarkFrozenExecutionArtifact(
      JSON.parse(JSON.stringify(artifact.value)),
    );

    expect(parsed).toEqual(artifact);
  });

  it("rejects unknown top-level fields so raw content cannot be smuggled beside digests", async () => {
    const frozen = await frozenSession();
    const artifact = createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(frozen);
    if (!artifact.ok) throw new Error("artifact fixture failed");

    const contaminated = {
      ...artifact.value,
      rawAnswer: "secret or answer text",
    };

    expect(parseOriginAnswerQualityBenchmarkFrozenExecutionArtifact(contaminated)).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH",
    });
  });

  it("rejects unknown per-case fields so prompts or messages cannot be embedded", async () => {
    const frozen = await frozenSession();
    const artifact = createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(frozen);
    if (!artifact.ok) throw new Error("artifact fixture failed");

    const contaminated = {
      ...artifact.value,
      cases: artifact.value.cases.map((item, index) =>
        index === 0 ? { ...item, prompt: "must not persist" } : item
      ),
    };

    expect(parseOriginAnswerQualityBenchmarkFrozenExecutionArtifact(contaminated)).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH",
    });
  });

  it("rejects duplicate case IDs from external JSON", async () => {
    const frozen = await frozenSession();
    const artifact = createOriginAnswerQualityBenchmarkFrozenExecutionArtifact(frozen);
    if (!artifact.ok) throw new Error("artifact fixture failed");

    const duplicate = JSON.parse(JSON.stringify(artifact.value)) as {
      cases: Array<{ caseId: string }>;
    } & Record<string, unknown>;
    duplicate.cases[1].caseId = duplicate.cases[0].caseId;

    expect(parseOriginAnswerQualityBenchmarkFrozenExecutionArtifact(duplicate)).toEqual({
      ok: false,
      code: "AQ_BENCHMARK_FROZEN_ARTIFACT_EXECUTION_MISMATCH",
    });
  });
});
