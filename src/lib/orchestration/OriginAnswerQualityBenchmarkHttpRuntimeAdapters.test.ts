import { describe, expect, it, vi } from "vitest";

import type { OriginAnswerQualityBenchmarkEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof";
import { createOriginAnswerQualityBenchmarkEphemeralEvidenceVault } from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault";
import {
  createOriginAnswerQualityBenchmarkArtifactHttpAdapter,
  createOriginAnswerQualityBenchmarkChatHttpAdapter,
  createOriginAnswerQualityBenchmarkResearchHttpAdapter,
} from "./OriginAnswerQualityBenchmarkHttpRuntimeAdapters";

const EXPECTED_PROVIDER = "openrouter-free";
const EXPECTED_MODEL = "inclusionai/ling-3.0-flash-sante:free";

function providerRouting(
  verificationStatus: string,
  providerAttempts = 1,
  servedModel = EXPECTED_MODEL,
) {
  return {
    freeOnly: true,
    actualCostUsd: 0,
    providerId: EXPECTED_PROVIDER,
    modelId: EXPECTED_MODEL,
    providerAttempts,
    verificationStatus,
    providerDataPolicy: {
      allowProviderFallbacks: false,
      dataCollection: "deny",
      requireZeroDataRetention: true,
    },
    providerRouting: {
      requestedModel: EXPECTED_MODEL,
      servedModel,
      fallbackUsed: false,
    },
    usage: { costUsd: 0 },
  };
}

const proof: OriginAnswerQualityBenchmarkEnvironmentProof = {
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

const item = (category: "current-factual" | "professional-advice" | "artifact-generation") => ({
  caseId: `case-${category}`,
  category,
  prompt: "テスト用の依頼",
  caseDigest: `sha256:${"a".repeat(64)}`,
});

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("OriginAnswerQualityBenchmarkHttpRuntimeAdapters", () => {
  it("measures the real Research API contract without provider inference", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({
      ok: true,
      report: "# report",
      sources: [{ id: "S1", url: "https://example.com/a" }],
      conflicts: [],
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    }));
    let now = 100;
    const evidenceVault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    const adapter = createOriginAnswerQualityBenchmarkResearchHttpAdapter({
      environmentProof: proof,
      expectedProviderId: EXPECTED_PROVIDER,
      expectedModelId: EXPECTED_MODEL,
      fetchImpl: fetchImpl as typeof fetch,
      nowMs: () => (now += 10),
      evidenceVault,
    });

    const researchItem = item("current-factual");
    const result = await adapter(researchItem);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://candidate.example/api/research/v1.1/query");
    expect(result.verifierResult).toBe("PASS");
    expect(result.providerRequests).toBe(0);
    expect(result.toolCalls).toBe(1);
    expect(result.costUsd).toBe(0);
    expect(result.finalAnswerRef).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.evidenceLedgerRef).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(evidenceVault.consume(
      researchItem.caseId,
      result.finalAnswerRef!,
      result.evidenceLedgerRef!,
    )).toMatchObject({
      caseId: researchItem.caseId,
      answerText: "# report",
      evidenceJson: {
        sources: [{ id: "S1", url: "https://example.com/a" }],
        conflicts: [],
      },
    });
  });

  it("fails closed when Research reports any non-zero or non-free route", async () => {
    const adapter = createOriginAnswerQualityBenchmarkResearchHttpAdapter({
      environmentProof: proof,
      expectedProviderId: EXPECTED_PROVIDER,
      expectedModelId: EXPECTED_MODEL,
      fetchImpl: vi.fn(async () => json({
        ok: true,
        report: "# report",
        sources: [],
        freeOnly: true,
        costUsd: 0.01,
        paidFallbackUsed: false,
      })) as typeof fetch,
    });

    await expect(adapter(item("current-factual")))
      .rejects.toThrow("AQ_BENCHMARK_RESEARCH_ZERO_COST_INVALID");
  });

  it("uses Chat's measured providerAttempts and verification state", async () => {
    const fetchImpl = vi.fn(async () => json({
      content: "回答です",
      answer: {
        answer: "回答です",
        evidence: [{ label: "source" }],
        verification: { status: "passed" },
      },
      routing: providerRouting("passed", 2),
    }));
    const evidenceVault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    const adapter = createOriginAnswerQualityBenchmarkChatHttpAdapter({
      environmentProof: proof,
      expectedProviderId: EXPECTED_PROVIDER,
      expectedModelId: EXPECTED_MODEL,
      fetchImpl: fetchImpl as typeof fetch,
      evidenceVault,
    });

    const chatItem = item("professional-advice");
    const result = await adapter(chatItem);
    expect(result.verifierResult).toBe("PASS");
    expect(result.providerRequests).toBe(2);
    expect(result.costUsd).toBe(0);
    expect(result.finalAnswerRef).toMatch(/^sha256:/);
    expect(evidenceVault.consume(
      chatItem.caseId,
      result.finalAnswerRef!,
      result.evidenceLedgerRef!,
    )).toMatchObject({
      answerText: "回答です",
      evidenceJson: [{ label: "source" }],
    });
  });

  it("rejects a served model that differs from the comparison identity", async () => {
    const adapter = createOriginAnswerQualityBenchmarkChatHttpAdapter({
      environmentProof: proof,
      expectedProviderId: EXPECTED_PROVIDER,
      expectedModelId: EXPECTED_MODEL,
      fetchImpl: vi.fn(async () => json({
        content: "回答です",
        answer: {
          answer: "回答です",
          evidence: [],
          verification: { status: "passed" },
        },
        routing: providerRouting("passed", 1, "other/model:free"),
      })) as typeof fetch,
    });

    await expect(adapter(item("professional-advice")))
      .rejects.toThrow("AQ_BENCHMARK_CHAT_PROVIDER_IDENTITY_INVALID");
  });

  it("does not retry a failed Chat request and reports it as blocked", async () => {
    const fetchImpl = vi.fn(async () => json({
      code: "PROVIDER_UNAVAILABLE",
    }, 503));
    const evidenceVault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    const adapter = createOriginAnswerQualityBenchmarkChatHttpAdapter({
      environmentProof: proof,
      expectedProviderId: EXPECTED_PROVIDER,
      expectedModelId: EXPECTED_MODEL,
      fetchImpl: fetchImpl as typeof fetch,
      evidenceVault,
    });

    const result = await adapter(item("professional-advice"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.verifierResult).toBe("BLOCKED_UNVERIFIED");
    expect(result.failureCode).toBe("PROVIDER_UNAVAILABLE");
    expect(result.costUsd).toBe(0);
    expect(evidenceVault.size()).toBe(0);
  });

  it("creates artifacts only after real Chat content and verifies artifact headers", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/chat") {
        return json({
          content: "提案書本文",
          answer: {
            answer: "提案書本文",
            evidence: [],
            verification: { status: "not-required" },
          },
          routing: providerRouting("not-required"),
        });
      }
      if (path === "/api/artifacts/v1.2/generate") {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "X-Origin-Artifact-Sha256": "b".repeat(64),
            "X-Origin-Artifact-Verified": "true",
            "X-Origin-Free-Only": "true",
            "X-Origin-Cost-Usd": "0",
          },
        });
      }
      return json({}, 404);
    });
    const evidenceVault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    const adapter = createOriginAnswerQualityBenchmarkArtifactHttpAdapter({
      environmentProof: proof,
      expectedProviderId: EXPECTED_PROVIDER,
      expectedModelId: EXPECTED_MODEL,
      fetchImpl: fetchImpl as typeof fetch,
      evidenceVault,
    });

    const artifactItem = {
      ...item("artifact-generation"),
      prompt: "提案書をdocxで作成してください",
    };
    const result = await adapter(artifactItem);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.verifierResult).toBe("PASS");
    expect(result.providerRequests).toBe(1);
    expect(result.toolCalls).toBe(2);
    expect(result.finalAnswerRef).toBe(`sha256:${"b".repeat(64)}`);
    expect(result.costUsd).toBe(0);
    expect(evidenceVault.consume(
      artifactItem.caseId,
      result.finalAnswerRef!,
      result.evidenceLedgerRef!,
    )).toMatchObject({
      answerText: "提案書本文",
      evidenceJson: {
        artifactSha256: "b".repeat(64),
        verified: true,
      },
    });
  });

  it("rejects artifact success without verified zero-cost headers", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/chat") {
        return json({
          content: "content",
          answer: { answer: "content", evidence: [], verification: { status: "not-required" } },
          routing: providerRouting("not-required"),
        });
      }
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          "X-Origin-Artifact-Sha256": "c".repeat(64),
          "X-Origin-Artifact-Verified": "true",
          "X-Origin-Free-Only": "true",
          "X-Origin-Cost-Usd": "1",
        },
      });
    });
    const adapter = createOriginAnswerQualityBenchmarkArtifactHttpAdapter({
      environmentProof: proof,
      expectedProviderId: EXPECTED_PROVIDER,
      expectedModelId: EXPECTED_MODEL,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(adapter(item("artifact-generation")))
      .rejects.toThrow("AQ_BENCHMARK_ARTIFACT_VERIFICATION_INVALID");
  });
});
