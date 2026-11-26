import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import type { OriginCodeEquivalenceVerificationResult } from "./originCodeEquivalenceVerification";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import type { OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Wiring tests for code equivalence verification B-1 (streaming
// router, shadow; CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27 sections
// 4.3/6): the check runs after the delivered stream has settled, so
// the delta events are exactly what mode off would have sent; only
// the completion event waits for the check and carries the
// recorded metadata. Mode off adds nothing to the stream.

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;

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

function groqResult(text: string): OriginProviderExecutionResult {
  return {
    text,
    transportRequestCount: 2,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: {
      requestedModel: "openai/gpt-oss-120b",
      servedModel: "openai/gpt-oss-120b",
      strategy: "verified-free-failover",
      provider: "Groq",
      attempt: 3,
      fallbackUsed: true,
    },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
  } as unknown as OriginProviderExecutionResult;
}

function completedEquivalence(): OriginCodeEquivalenceVerificationResult {
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
  };
}

type VerifyStub = (input: unknown, options: unknown) => Promise<OriginCodeEquivalenceVerificationResult>;

function appWith(options: {
  streamExecute: OriginProviderStreamExecutor;
  env?: NodeJS.ProcessEnv;
  verify?: VerifyStub;
}) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env: options.env ?? { OPENROUTER_API_KEY: "synthetic-key" },
    streamExecute: options.streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-code-equivalence-test",
    ...(options.verify
      ? { codeEquivalenceVerification: { verify: options.verify as never } }
      : {}),
  }));
  return app;
}

function streamExecutorWith(text: string): OriginProviderStreamExecutor {
  return vi.fn(async (_providerRequest, handlers) => {
    handlers.onDelta(text);
    return groqResult(text);
  }) as unknown as OriginProviderStreamExecutor;
}

function parseEvents(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

const SHADOW_ENV = {
  OPENROUTER_API_KEY: "synthetic-key",
  ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "shadow",
  ORIGIN_CODE_TASK_ROUTING_MODE: "enforce",
};

describe("code equivalence verification shadow wiring — streaming path (B-1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shadow: the delivered deltas are unchanged and the completion event carries the recorded verdict", async () => {
    const verify = vi.fn(async () => completedEquivalence());
    const response = await request(appWith({
      streamExecute: streamExecutorWith(CODE_ANSWER),
      env: SHADOW_ENV,
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: CODE_QUESTION }] });
    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
    const events = parseEvents(response.text);
    const delivered = events
      .filter((event) => event.type === "delta")
      .map((event) => String(event.text))
      .join("");
    expect(delivered).toBe(CODE_ANSWER);
    const complete = events.find((event) => event.type === "complete");
    expect(complete).toBeDefined();
    expect(complete?.codeEquivalenceVerification).toMatchObject({
      verificationMode: "shadow",
      verificationStatus: "completed",
      verdict: "non-equivalent",
      mainBlockIndex: 1,
      differingCaseCount: 1,
      sameResultClaimed: true,
      appliedAction: "none",
    });
    // Kinds and counts only: the completion event never carries the case text.
    expect(JSON.stringify(complete)).not.toContain("明細行のない注文");
  });

  it("mode off (default): no verification call and no metadata on the completion event", async () => {
    const verify = vi.fn(async () => completedEquivalence());
    const response = await request(appWith({
      streamExecute: streamExecutorWith(CODE_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-key", ORIGIN_CODE_TASK_ROUTING_MODE: "enforce" },
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: CODE_QUESTION }] });
    expect(response.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    const events = parseEvents(response.text);
    const complete = events.find((event) => event.type === "complete");
    expect(complete).toBeDefined();
    expect(complete?.codeEquivalenceVerification).toBeUndefined();
  });

  it("shadow: a non-target question is never verified", async () => {
    const verify = vi.fn(async () => completedEquivalence());
    const response = await request(appWith({
      streamExecute: streamExecutorWith("富士山の標高は3,776メートルです。"),
      env: SHADOW_ENV,
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "富士山の高さはどれくらいですか。" }] });
    expect(response.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    const events = parseEvents(response.text);
    const complete = events.find((event) => event.type === "complete");
    expect(complete?.codeEquivalenceVerification).toBeUndefined();
  });
});
