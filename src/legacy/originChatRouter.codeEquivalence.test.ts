import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import type { OriginCodeEquivalenceVerificationResult } from "./originCodeEquivalenceVerification";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

// Wiring tests for code equivalence verification B-1 (blocking
// router, shadow; CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27 sections
// 4.3/6): mode off reproduces the pre-feature response exactly;
// shadow verifies targeted review/rewrite answers through the
// injected seam, records the verdict on the routing metadata, and
// never changes the delivered content byte-for-byte; non-targets
// and a broken seam leave the answer exactly as before.

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;

const CODE_QUESTION = [
  "次のSQLコードをレビューして、問題があれば修正してください。",
  "",
  "```sql",
  "SELECT o.id, COALESCE(SUM(i.price * i.qty), 0) AS total",
  "FROM orders o",
  "LEFT JOIN items i ON i.order_id = o.id",
  "GROUP BY o.id",
  "```",
].join("\n");

const CODE_ANSWER = [
  "主コードはこちらです。",
  "",
  "```sql",
  "SELECT o.id, SUM(i.price * i.qty) AS total",
  "FROM orders o",
  "JOIN items i ON i.order_id = o.id",
  "GROUP BY o.id",
  "```",
  "",
  "結果は同じです。",
].join("\n");

const PLAIN_QUESTION = "富士山の高さはどれくらいですか。";
const PLAIN_ANSWER = "富士山の標高は3,776メートルです。";

type VerifyStub = (input: unknown, options: unknown) => Promise<OriginCodeEquivalenceVerificationResult>;

function completedEquivalence(
  overrides: Partial<Extract<OriginCodeEquivalenceVerificationResult, { status: "completed" }>> = {},
): OriginCodeEquivalenceVerificationResult {
  return {
    status: "completed",
    servedRoute: "groq",
    verifierRoute: "cloudflare",
    servedModel: "openai/gpt-oss-120b",
    verifierModel: "@cf/google/gemma-4-26b-a4b-it",
    verdict: "non-equivalent",
    mainBlockIndex: 1,
    differingCases: ["明細行のない注文が結果から落ち、合計が返らない"],
    sameResultClaimed: true,
    originalTruncated: false,
    blocksTruncated: false,
    answerBlockCount: 1,
    includedBlockCount: 1,
    durationMs: 120,
    transportRequestCount: 2,
    neurons: 42,
    ...overrides,
  };
}

function groqServedExecutorWith(text: string): OriginChatExecutor {
  return vi.fn(async () => ({
    text,
    transportRequestCount: 2,
    actualCostUsd: 0 as const,
    providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
    routingEvidence: { requestedModel: "openai/gpt-oss-120b", servedModel: "openai/gpt-oss-120b", strategy: "verified-free-failover" as const, provider: "Groq", attempt: 3 as const, fallbackUsed: true as const },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
    attempts: [
      { providerId: "openrouter-free", modelId: verifiedEvidence.modelId, outcome: "skipped" as const, skipReason: "route-stopped", transportRequestCount: 0 },
      { providerId: "cloudflare-workers-ai-free", modelId: "@cf/google/gemma-4-26b-a4b-it", outcome: "availability-error" as const, errorCode: "PROVIDER_RATE_LIMITED" as const, transportRequestCount: 1 },
      { providerId: "groq-free", modelId: "openai/gpt-oss-120b", outcome: "succeeded" as const, transportRequestCount: 1 },
    ],
  })) as unknown as OriginChatExecutor;
}

function createApp(options: {
  execute: OriginChatExecutor;
  env?: NodeJS.ProcessEnv;
  verify?: VerifyStub;
}) {
  const app = express();
  app.use(express.json());
  const research: OriginResearchExecutor = async () => ({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } });
  app.use(createOriginChatRouter({
    env: options.env ?? { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: options.execute,
    research,
    researchSynthesis: null,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-code-equivalence-test",
    ...(options.verify
      ? { codeEquivalenceVerification: { verify: options.verify as never } }
      : {}),
  }));
  return app;
}

const SHADOW_ENV = {
  OPENROUTER_API_KEY: "synthetic-test-key",
  ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "shadow",
  // The CB-1 exemption in enforce keeps the self-contained code
  // task on the direct path this wiring covers.
  ORIGIN_CODE_TASK_ROUTING_MODE: "enforce",
};

function equivalenceLogFields(infoSpy: ReturnType<typeof vi.spyOn>): Record<string, unknown> | undefined {
  const call = infoSpy.mock.calls.find(([message]) => String(message).includes("code equivalence verification"));
  return call?.[1] as Record<string, unknown> | undefined;
}

describe("code equivalence verification shadow wiring — direct path (B-1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mode off (default): no verification call and no routing block", async () => {
    const verify = vi.fn(async () => completedEquivalence());
    const response = await request(createApp({
      execute: groqServedExecutorWith(CODE_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: CODE_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(CODE_ANSWER);
    expect(response.body.routing.codeEquivalenceVerification).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });

  it("shadow: a targeted review/rewrite answer is verified once, recorded, and delivered byte-identical to mode off", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const verify = vi.fn(async () => completedEquivalence());
    const shadowResponse = await request(createApp({
      execute: groqServedExecutorWith(CODE_ANSWER),
      env: SHADOW_ENV,
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: CODE_QUESTION }] });
    expect(shadowResponse.status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(shadowResponse.body.routing.codeEquivalenceVerification).toMatchObject({
      verificationMode: "shadow",
      verificationConfiguredMode: "shadow",
      verificationStatus: "completed",
      servedRoute: "groq",
      verifierRoute: "cloudflare",
      verdict: "non-equivalent",
      mainBlockIndex: 1,
      differingCaseCount: 1,
      sameResultClaimed: true,
      answerBlockCount: 1,
      appliedAction: "none",
      verifierNeurons: 42,
    });
    const fields = equivalenceLogFields(infoSpy);
    expect(fields).toBeDefined();
    expect(fields?.requestId).toBe("origin-code-equivalence-test");
    expect(fields?.verdict).toBe("non-equivalent");
    // Kinds and counts only: the log never carries the code or the case text.
    expect(JSON.stringify(fields)).not.toContain("LEFT JOIN");
    expect(JSON.stringify(fields)).not.toContain("明細行のない注文");

    const offResponse = await request(createApp({
      execute: groqServedExecutorWith(CODE_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: CODE_QUESTION }] });
    expect(offResponse.status).toBe(200);
    expect(shadowResponse.body.content).toBe(CODE_ANSWER);
    expect(shadowResponse.body.content).toBe(offResponse.body.content);
  });

  it("shadow: a non-target question is never verified", async () => {
    const verify = vi.fn(async () => completedEquivalence());
    const response = await request(createApp({
      execute: groqServedExecutorWith(PLAIN_ANSWER),
      env: SHADOW_ENV,
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(PLAIN_ANSWER);
    expect(verify).not.toHaveBeenCalled();
    expect(response.body.routing.codeEquivalenceVerification).toBeUndefined();
  });

  it("enforce value behaves as shadow in stage 1 (configured mode recorded, nothing applied)", async () => {
    const verify = vi.fn(async () => completedEquivalence());
    const response = await request(createApp({
      execute: groqServedExecutorWith(CODE_ANSWER),
      env: { ...SHADOW_ENV, ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "enforce" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: CODE_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(CODE_ANSWER);
    expect(response.body.routing.codeEquivalenceVerification).toMatchObject({
      verificationMode: "shadow",
      verificationConfiguredMode: "enforce",
      appliedAction: "none",
    });
  });

  it("fails open when the verification seam throws: the answer is delivered and the failure is recorded", async () => {
    const verify = vi.fn(async () => { throw new Error("seam failure"); });
    const response = await request(createApp({
      execute: groqServedExecutorWith(CODE_ANSWER),
      env: SHADOW_ENV,
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: CODE_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(CODE_ANSWER);
    expect(response.body.routing.codeEquivalenceVerification).toMatchObject({
      verificationStatus: "not-run",
      verificationFailureKind: "provider-error",
      appliedAction: "none",
    });
  });
});
