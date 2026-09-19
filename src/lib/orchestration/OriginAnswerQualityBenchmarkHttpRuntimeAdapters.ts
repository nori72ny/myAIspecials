import { createHash } from "node:crypto";

import type { OriginAnswerQualityBenchmarkAnyEnvironmentProof } from "./OriginAnswerQualityBenchmarkEnvironmentProof.js";
import type {
  OriginAnswerQualityBenchmarkEphemeralEvidenceVault,
} from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault.js";
import {
  createOriginAnswerQualityBenchmarkRuntimeAdapter,
  type OriginAnswerQualityBenchmarkRuntimeAdapter,
} from "./OriginAnswerQualityBenchmarkRuntimeAdapter.js";
import type {
  OriginAnswerQualityBenchmarkExecutableCase,
  OriginAnswerQualityBenchmarkExecutionEvidence,
} from "./OriginAnswerQualityBenchmarkRunner.js";

type JsonRecord = Record<string, unknown>;

export interface OriginAnswerQualityBenchmarkHttpAdapterOptions {
  readonly environmentProof: OriginAnswerQualityBenchmarkAnyEnvironmentProof;
  readonly fetchImpl?: typeof fetch;
  readonly nowMs?: () => number;
  readonly evidenceVault?: OriginAnswerQualityBenchmarkEphemeralEvidenceVault;
  readonly expectedProviderId: string;
  readonly expectedModelId: string;
}

interface ChatExecution {
  readonly ok: boolean;
  readonly content: string;
  readonly answerRef: string | null;
  readonly evidenceRef: string | null;
  readonly verification: "PASS" | "REPAIR_REQUIRED" | "BLOCKED_UNVERIFIED";
  readonly providerRequests: number;
  readonly failureCode: string | null;
  readonly evidenceJson: unknown;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as JsonRecord).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_:.-]{0,160}$/.test(value)
    ? value
    : fallback;
}

function canonicalBase(proof: OriginAnswerQualityBenchmarkEnvironmentProof): URL {
  const base = new URL(proof.baseUrl);
  if (base.href !== proof.baseUrl) throw new Error("AQ_BENCHMARK_HTTP_BASE_URL_MISMATCH");
  if (base.username || base.password || base.search || base.hash) {
    throw new Error("AQ_BENCHMARK_HTTP_BASE_URL_INVALID");
  }
  return base;
}

async function jsonOrNull(response: Response): Promise<JsonRecord | null> {
  try {
    return record(await response.json());
  } catch {
    return null;
  }
}

async function postJson(
  fetchImpl: typeof fetch,
  base: URL,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetchImpl(new URL(path, base), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    cache: "no-store",
  });
}

function chatVerification(value: unknown): ChatExecution["verification"] {
  if (value === "passed" || value === "not-required") return "PASS";
  if (value === "not-run") return "REPAIR_REQUIRED";
  return "BLOCKED_UNVERIFIED";
}

async function executeChat(
  item: OriginAnswerQualityBenchmarkExecutableCase,
  base: URL,
  fetchImpl: typeof fetch,
  expectedProviderId: string,
  expectedModelId: string,
): Promise<ChatExecution> {
  let response: Response;
  try {
    response = await postJson(fetchImpl, base, "/api/chat", {
      messages: [{ role: "user", content: item.prompt }],
    });
  } catch {
    return {
      ok: false,
      content: "",
      answerRef: null,
      evidenceRef: null,
      verification: "BLOCKED_UNVERIFIED",
      providerRequests: 0,
      evidenceJson: null,
      failureCode: "AQ_BENCHMARK_CHAT_FETCH_FAILED",
    };
  }

  const body = await jsonOrNull(response);
  if (!response.ok || !body) {
    return {
      ok: false,
      content: "",
      answerRef: null,
      evidenceRef: null,
      verification: "BLOCKED_UNVERIFIED",
      providerRequests: 0,
      evidenceJson: null,
      failureCode: safeCode(body?.code, `AQ_BENCHMARK_CHAT_HTTP_${response.status}`),
    };
  }

  const routing = record(body.routing);
  const answer = record(body.answer);
  const content = typeof body.content === "string"
    ? body.content
    : typeof answer?.answer === "string"
      ? answer.answer
      : "";
  if (!content || !routing || routing.freeOnly !== true || routing.actualCostUsd !== 0) {
    throw new Error("AQ_BENCHMARK_CHAT_ZERO_COST_OR_RESPONSE_INVALID");
  }

  const providerUsed = routing.providerId !== undefined || routing.modelId !== undefined;
  if (providerUsed) {
    const providerRouting = record(routing.providerRouting);
    const usage = record(routing.usage);
    const policy = record(routing.providerDataPolicy);
    if (
      routing.providerId !== expectedProviderId
      || routing.modelId !== expectedModelId
      || !providerRouting
      || providerRouting.requestedModel !== expectedModelId
      || providerRouting.servedModel !== expectedModelId
      || providerRouting.fallbackUsed !== false
      || !usage
      || usage.costUsd !== 0
      || !policy
      || policy.allowProviderFallbacks !== false
      || policy.dataCollection !== "deny"
      || policy.requireZeroDataRetention !== true
    ) {
      throw new Error("AQ_BENCHMARK_CHAT_PROVIDER_IDENTITY_INVALID");
    }
  }

  const attempts = routing.providerAttempts;
  const providerRequests = Number.isInteger(attempts) && Number(attempts) >= 0
    ? Number(attempts)
    : routing.providerId === undefined
      ? 0
      : 1;
  const verificationStatus = answer && record(answer.verification)
    ? record(answer.verification)?.status
    : routing.verificationStatus;
  const evidence = answer?.evidence ?? body.evidence ?? [];

  return {
    ok: true,
    content,
    answerRef: sha256(content),
    evidenceRef: sha256(stableJson(evidence)),
    verification: chatVerification(verificationStatus),
    providerRequests,
    failureCode: null,
    evidenceJson: evidence,
  };
}

export function createOriginAnswerQualityBenchmarkResearchHttpAdapter(
  options: OriginAnswerQualityBenchmarkHttpAdapterOptions,
): OriginAnswerQualityBenchmarkRuntimeAdapter {
  const base = canonicalBase(options.environmentProof);
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? Date.now;

  return createOriginAnswerQualityBenchmarkRuntimeAdapter(
    "research",
    "grounded-research-v1.1",
    async (item): Promise<OriginAnswerQualityBenchmarkExecutionEvidence> => {
      const startedAt = nowMs();
      let response: Response;
      try {
        response = await postJson(fetchImpl, base, "/api/research/v1.1/query", { query: item.prompt });
      } catch {
        return {
          caseId: item.caseId,
          finalAnswerRef: null,
          evidenceLedgerRef: null,
          verifierResult: "BLOCKED_UNVERIFIED",
          providerRequests: 0,
          toolCalls: 1,
          latencyMs: Math.max(0, nowMs() - startedAt),
          costUsd: 0,
          failureCode: "AQ_BENCHMARK_RESEARCH_FETCH_FAILED",
        };
      }

      const body = await jsonOrNull(response);
      if (!response.ok || !body || body.ok !== true) {
        return {
          caseId: item.caseId,
          finalAnswerRef: null,
          evidenceLedgerRef: null,
          verifierResult: "BLOCKED_UNVERIFIED",
          providerRequests: 0,
          toolCalls: 1,
          latencyMs: Math.max(0, nowMs() - startedAt),
          costUsd: 0,
          failureCode: safeCode(body?.code, `AQ_BENCHMARK_RESEARCH_HTTP_${response.status}`),
        };
      }
      if (body.freeOnly !== true || body.costUsd !== 0 || body.paidFallbackUsed !== false) {
        throw new Error("AQ_BENCHMARK_RESEARCH_ZERO_COST_INVALID");
      }
      if (typeof body.report !== "string" || !body.report.trim() || !Array.isArray(body.sources)) {
        throw new Error("AQ_BENCHMARK_RESEARCH_RESPONSE_INVALID");
      }

      const finalAnswerRef = sha256(body.report);
      const evidencePayload = { sources: body.sources, conflicts: body.conflicts ?? [] };
      const evidenceLedgerRef = sha256(stableJson(evidencePayload));
      options.evidenceVault?.put({
        caseId: item.caseId,
        finalAnswerRef,
        evidenceLedgerRef,
        answerText: body.report,
        evidenceJson: evidencePayload,
      });

      return {
        caseId: item.caseId,
        finalAnswerRef,
        evidenceLedgerRef,
        verifierResult: "PASS",
        providerRequests: 0,
        toolCalls: 1,
        latencyMs: Math.max(0, nowMs() - startedAt),
        costUsd: 0,
        failureCode: null,
      };
    },
  );
}

export function createOriginAnswerQualityBenchmarkChatHttpAdapter(
  options: OriginAnswerQualityBenchmarkHttpAdapterOptions,
): OriginAnswerQualityBenchmarkRuntimeAdapter {
  const base = canonicalBase(options.environmentProof);
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? Date.now;

  return createOriginAnswerQualityBenchmarkRuntimeAdapter(
    "chat",
    "origin-chat",
    async (item): Promise<OriginAnswerQualityBenchmarkExecutionEvidence> => {
      const startedAt = nowMs();
      const result = await executeChat(
        item,
        base,
        fetchImpl,
        options.expectedProviderId,
        options.expectedModelId,
      );
      if (result.ok && result.answerRef && result.evidenceRef) {
        options.evidenceVault?.put({
          caseId: item.caseId,
          finalAnswerRef: result.answerRef,
          evidenceLedgerRef: result.evidenceRef,
          answerText: result.content,
          evidenceJson: result.evidenceJson,
        });
      }
      return {
        caseId: item.caseId,
        finalAnswerRef: result.answerRef,
        evidenceLedgerRef: result.evidenceRef,
        verifierResult: result.verification,
        providerRequests: result.providerRequests,
        toolCalls: 1,
        latencyMs: Math.max(0, nowMs() - startedAt),
        costUsd: 0,
        failureCode: result.failureCode,
      };
    },
  );
}

type ArtifactType = "markdown" | "pdf" | "docx" | "xlsx" | "pptx";

function artifactType(prompt: string): ArtifactType {
  if (/(?:xlsx|excel|spreadsheet|表計算)/i.test(prompt)) return "xlsx";
  if (/(?:pptx|presentation|slides?|プレゼン|スライド)/i.test(prompt)) return "pptx";
  if (/(?:pdf)/i.test(prompt)) return "pdf";
  if (/(?:docx|word|document|report|proposal|文書|報告書|提案書)/i.test(prompt)) return "docx";
  return "markdown";
}

function artifactRequest(type: ArtifactType, content: string): JsonRecord {
  const title = "ORIGIN Benchmark Artifact";
  if (type === "xlsx") {
    return {
      type,
      title,
      rows: content.split(/\r?\n/).filter(Boolean).slice(0, 200).map((line) => [line]),
    };
  }
  if (type === "pptx") {
    return {
      type,
      title,
      slides: [{ title, content: content.slice(0, 10_000) }],
    };
  }
  return { type, title, content };
}

export function createOriginAnswerQualityBenchmarkArtifactHttpAdapter(
  options: OriginAnswerQualityBenchmarkHttpAdapterOptions,
): OriginAnswerQualityBenchmarkRuntimeAdapter {
  const base = canonicalBase(options.environmentProof);
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? Date.now;

  return createOriginAnswerQualityBenchmarkRuntimeAdapter(
    "artifact",
    "artifact-v1.2",
    async (item): Promise<OriginAnswerQualityBenchmarkExecutionEvidence> => {
      const startedAt = nowMs();
      const chat = await executeChat(
        item,
        base,
        fetchImpl,
        options.expectedProviderId,
        options.expectedModelId,
      );
      if (!chat.ok) {
        return {
          caseId: item.caseId,
          finalAnswerRef: null,
          evidenceLedgerRef: chat.evidenceRef,
          verifierResult: "BLOCKED_UNVERIFIED",
          providerRequests: chat.providerRequests,
          toolCalls: 1,
          latencyMs: Math.max(0, nowMs() - startedAt),
          costUsd: 0,
          failureCode: chat.failureCode ?? "AQ_BENCHMARK_ARTIFACT_CONTENT_UNAVAILABLE",
        };
      }

      let response: Response;
      try {
        response = await postJson(
          fetchImpl,
          base,
          "/api/artifacts/v1.2/generate",
          artifactRequest(artifactType(item.prompt), chat.content),
        );
      } catch {
        return {
          caseId: item.caseId,
          finalAnswerRef: null,
          evidenceLedgerRef: chat.evidenceRef,
          verifierResult: "BLOCKED_UNVERIFIED",
          providerRequests: chat.providerRequests,
          toolCalls: 2,
          latencyMs: Math.max(0, nowMs() - startedAt),
          costUsd: 0,
          failureCode: "AQ_BENCHMARK_ARTIFACT_FETCH_FAILED",
        };
      }

      if (!response.ok) {
        const body = await jsonOrNull(response);
        return {
          caseId: item.caseId,
          finalAnswerRef: null,
          evidenceLedgerRef: chat.evidenceRef,
          verifierResult: "BLOCKED_UNVERIFIED",
          providerRequests: chat.providerRequests,
          toolCalls: 2,
          latencyMs: Math.max(0, nowMs() - startedAt),
          costUsd: 0,
          failureCode: safeCode(body?.code, `AQ_BENCHMARK_ARTIFACT_HTTP_${response.status}`),
        };
      }

      const artifactSha = response.headers.get("x-origin-artifact-sha256");
      if (
        response.headers.get("x-origin-artifact-verified") !== "true"
        || response.headers.get("x-origin-free-only") !== "true"
        || response.headers.get("x-origin-cost-usd") !== "0"
        || !artifactSha
        || !/^[a-f0-9]{64}$/.test(artifactSha)
      ) {
        throw new Error("AQ_BENCHMARK_ARTIFACT_VERIFICATION_INVALID");
      }

      await response.arrayBuffer();
      const finalAnswerRef = `sha256:${artifactSha}`;
      if (chat.evidenceRef) {
        options.evidenceVault?.put({
          caseId: item.caseId,
          finalAnswerRef,
          evidenceLedgerRef: chat.evidenceRef,
          answerText: chat.content,
          evidenceJson: {
            chatEvidence: chat.evidenceJson,
            artifactSha256: artifactSha,
            verified: true,
          },
        });
      }
      return {
        caseId: item.caseId,
        finalAnswerRef,
        evidenceLedgerRef: chat.evidenceRef,
        verifierResult: "PASS",
        providerRequests: chat.providerRequests,
        toolCalls: 2,
        latencyMs: Math.max(0, nowMs() - startedAt),
        costUsd: 0,
        failureCode: null,
      };
    },
  );
}
