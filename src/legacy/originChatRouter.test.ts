import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OriginContextPolicy } from "../lib/orchestration/OriginContextPolicy";
import { createOriginChatRouter, type OriginChatExecutor } from "./originChatRouter";

const verifiedCatalogTime = Date.parse("2026-07-19T12:00:00.000Z");

function createApp(
  execute: OriginChatExecutor,
  env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: "synthetic-test-key" },
  catalogNow: () => number = () => verifiedCatalogTime,
  contextPolicy?: OriginContextPolicy,
) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env,
    execute,
    now: (() => {
      let current = 1_000;
      return () => {
        current += 25;
        return current;
      };
    })(),
    catalogNow,
    contextPolicy,
    createRequestId: () => "origin-test-trace",
  }));
  return app;
}

describe("createOriginChatRouter", () => {
  let execute: OriginChatExecutor;
  let executeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executeMock = vi.fn().mockResolvedValue({
      text: "安全な確認結果です。",
      actualCostUsd: 0,
      providerDataPolicy: {
        allowProviderFallbacks: false,
        dataCollection: "deny",
        requireZeroDataRetention: true,
      },
      routingEvidence: {
        requestedModel: "moonshotai/kimi-k2.6:free",
        servedModel: "moonshotai/kimi-k2.6:free",
        strategy: "free",
        provider: "Synthetic ZDR Provider",
        region: "iad",
        attempt: 1,
        fallbackUsed: false,
      },
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        costUsd: 0,
      },
    });
    execute = executeMock as OriginChatExecutor;
  });

  it("rejects invalid messages before planning or provider execution", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_CHAT_MESSAGES");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("blocks synthetic secret-bearing input before provider execution", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [{
        role: "user",
        content: "Authorization: Bearer synthetic_token_value_123456 を確認してください",
      }],
    });

    expect(response.status).toBe(422);
    expect(response.body).toEqual(expect.objectContaining({
      code: "SENSITIVE_INPUT_BLOCKED",
      retryable: false,
      requestId: "origin-test-trace",
      sensitiveKinds: expect.arrayContaining(["authorization-header"]),
    }));
    expect(JSON.stringify(response.body)).not.toContain("synthetic_token_value_123456");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("does not block ordinary credential-safety advice in prior assistant history", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [
        { role: "ai", content: "APIキーは共有せず、安全な保管方法を確認してください。" },
        { role: "user", content: "では一般的な確認手順をまとめてください" },
      ],
    });

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("still blocks structured secret patterns before minimization when found in old assistant history", async () => {
    const response = await request(createApp(
      execute,
      undefined,
      undefined,
      { version: 1, maxMessages: 1, maxCharacters: 12_000 },
    )).post("/api/chat").send({
      messages: [
        { role: "assistant", content: "Authorization: Bearer synthetic_assistant_secret_123456" },
        { role: "user", content: "続けてください" },
      ],
    });

    expect(response.status).toBe(422);
    expect(response.body.sensitiveKinds).toContain("authorization-header");
    expect(JSON.stringify(response.body)).not.toContain("synthetic_assistant_secret_123456");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("blocks a structured provider key split across chat messages", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [
        { role: "user", content: "確認対象の接頭辞は sk-" },
        { role: "assistant", content: "続きの値を入力してください" },
        { role: "user", content: "abcdefghijklmnopqrstuv" },
      ],
    });

    expect(response.status).toBe(422);
    expect(response.body.sensitiveKinds).toContain("provider-key");
    expect(JSON.stringify(response.body)).not.toContain("abcdefghijklmnopqrstuv");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns the current free plan plus actual provider routing and data-policy evidence", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [{ role: "user", content: "認証処理をレビューしてください" }],
    });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe("安全な確認結果です。");
    expect(response.body.answer).toEqual({
      schemaVersion: "origin.answer.v1",
      language: "ja",
      conclusion: "安全な確認結果です。",
      answer: "安全な確認結果です。",
      evidence: [],
      verification: {
        status: "not-run",
        independentReviewPerformed: false,
        summary: "Phase 1では独立検証と統合をまだ実行していません。",
      },
      limitations: [],
      nextActions: [],
      richOutputs: [],
    });
    expect(response.body.routing).toEqual(expect.objectContaining({
      model: "ORIGIN 無料AI",
      providerId: "openrouter-free",
      modelId: "moonshotai/kimi-k2.6:free",
      taskType: "security",
      cost: 0,
      actualCostUsd: 0,
      estimatedCostUsd: 0,
      freeOnly: true,
      traceId: "origin-test-trace",
      verificationStatus: "not-run",
      modelEvidence: expect.objectContaining({
        verifiedAt: "2026-07-19T00:00:00.000Z",
        reviewAfter: "2026-08-18T23:59:59.999Z",
        sourceUrl: expect.stringContaining("openrouter.ai"),
      }),
      providerDataPolicy: {
        allowProviderFallbacks: false,
        dataCollection: "deny",
        requireZeroDataRetention: true,
      },
      providerRouting: {
        requestedModel: "moonshotai/kimi-k2.6:free",
        servedModel: "moonshotai/kimi-k2.6:free",
        strategy: "free",
        provider: "Synthetic ZDR Provider",
        region: "iad",
        attempt: 1,
        fallbackUsed: false,
      },
      context: {
        policyVersion: 1,
        includedMessageCount: 1,
        includedCharacterCount: "認証処理をレビューしてください".length,
        omittedMessageCount: 0,
        omittedCharacterCount: 0,
      },
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        costUsd: 0,
      },
    }));
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        providerId: "openrouter-free",
        modelId: "moonshotai/kimi-k2.6:free",
        freeOnly: true,
        providerDataPolicy: {
          allowProviderFallbacks: false,
          dataCollection: "deny",
          requireZeroDataRetention: true,
        },
      }),
      messages: [{ role: "user", content: "認証処理をレビューしてください" }],
      systemInstruction: expect.stringContaining("Never request, reproduce, or expose credentials"),
    }));
  });

  it("sends only the latest coherent context window to the provider", async () => {
    const response = await request(createApp(
      execute,
      undefined,
      undefined,
      { version: 1, maxMessages: 3, maxCharacters: 12_000 },
    )).post("/api/chat").send({
      messages: [
        { role: "ai", content: "初期案内" },
        { role: "user", content: "古い依頼" },
        { role: "ai", content: "古い回答" },
        { role: "user", content: "直近の依頼" },
        { role: "ai", content: "直近の回答" },
        { role: "user", content: "最新の依頼" },
      ],
    });

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: "user", content: "直近の依頼" },
        { role: "ai", content: "直近の回答" },
        { role: "user", content: "最新の依頼" },
      ],
    }));
    expect(response.body.routing.context).toEqual({
      policyVersion: 1,
      includedMessageCount: 3,
      includedCharacterCount: "直近の依頼直近の回答最新の依頼".length,
      omittedMessageCount: 3,
      omittedCharacterCount: "初期案内古い依頼古い回答".length,
    });
  });

  it("rejects an oversized latest request rather than truncating it", async () => {
    const response = await request(createApp(
      execute,
      undefined,
      undefined,
      { version: 1, maxMessages: 12, maxCharacters: 1_000 },
    )).post("/api/chat").send({
      messages: [{ role: "user", content: "x".repeat(1_001) }],
    });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe("LATEST_MESSAGE_TOO_LARGE");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("fails closed when no explicitly free provider is configured", async () => {
    const response = await request(createApp(execute, {
      GEMINI_API_KEY: "synthetic-gemini-key",
    })).post("/api/chat").send({
      messages: [{ role: "user", content: "文章を確認してください" }],
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("FREE_PROVIDER_NOT_CONFIGURED");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("fails closed when the free-model evidence is stale", async () => {
    const response = await request(createApp(
      execute,
      { OPENROUTER_API_KEY: "synthetic-test-key" },
      () => Date.parse("2026-08-19T00:00:00.000Z"),
    )).post("/api/chat").send({
      messages: [{ role: "user", content: "文章を確認してください" }],
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("FREE_MODEL_EVIDENCE_STALE");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("handles weather location clarification without calling a provider", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [{ role: "user", content: "今日の天気は？" }],
    });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe("どの地域の天気をお調べしますか？");
    expect(response.body.answer).toEqual(expect.objectContaining({
      schemaVersion: "origin.answer.v1",
      language: "ja",
      conclusion: "どの地域の天気をお調べしますか？",
      answer: "どの地域の天気をお調べしますか？",
      verification: expect.objectContaining({
        status: "not-required",
        independentReviewPerformed: false,
      }),
    }));
    expect(response.body.routing).toEqual(expect.objectContaining({
      model: "ORIGIN アプリ内処理",
      cost: 0,
      verificationStatus: "not-required",
    }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("rejects invalid client policy values without provider execution", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [{ role: "user", content: "文章を確認してください" }],
      executionPolicy: { timeoutMs: 0 },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_EXECUTION_POLICY");
    expect(executeMock).not.toHaveBeenCalled();
  });
});
