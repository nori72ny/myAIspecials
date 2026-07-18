import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOriginChatRouter, type OriginChatExecutor } from "./originChatRouter";

function createApp(execute: OriginChatExecutor, env: NodeJS.ProcessEnv = {
  OPENROUTER_API_KEY: "synthetic-test-key",
}) {
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
    createRequestId: () => "origin-test-trace",
  }));
  return app;
}

describe("createOriginChatRouter", () => {
  let execute: ReturnType<typeof vi.fn<OriginChatExecutor>>;

  beforeEach(() => {
    execute = vi.fn<OriginChatExecutor>().mockResolvedValue({
      text: "安全な確認結果です。",
      actualCostUsd: 0,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it("rejects invalid messages before planning or provider execution", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_CHAT_MESSAGES");
    expect(execute).not.toHaveBeenCalled();
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
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes only the selected explicit free plan and returns matching metadata", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [{ role: "user", content: "認証処理をレビューしてください" }],
    });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe("安全な確認結果です。");
    expect(response.body.routing).toEqual(expect.objectContaining({
      model: "ORIGIN 無料AI",
      providerId: "openrouter-free",
      modelId: "google/gemini-2.5-flash:free",
      taskType: "security",
      cost: 0,
      actualCostUsd: 0,
      estimatedCostUsd: 0,
      freeOnly: true,
      traceId: "origin-test-trace",
      verificationStatus: "not-run",
    }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({
        providerId: "openrouter-free",
        modelId: "google/gemini-2.5-flash:free",
        freeOnly: true,
      }),
      messages: [{ role: "user", content: "認証処理をレビューしてください" }],
      systemInstruction: expect.stringContaining("Never request, reproduce, or expose credentials"),
    }));
  });

  it("fails closed when no explicitly free provider is configured", async () => {
    const response = await request(createApp(execute, {
      GEMINI_API_KEY: "synthetic-gemini-key",
    })).post("/api/chat").send({
      messages: [{ role: "user", content: "文章を確認してください" }],
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("FREE_PROVIDER_NOT_CONFIGURED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("handles weather location clarification without calling a provider", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [{ role: "user", content: "今日の天気は？" }],
    });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe("どの地域の天気をお調べしますか？");
    expect(response.body.routing).toEqual(expect.objectContaining({
      model: "ORIGIN アプリ内処理",
      cost: 0,
      verificationStatus: "not-required",
    }));
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects invalid client policy values without provider execution", async () => {
    const response = await request(createApp(execute)).post("/api/chat").send({
      messages: [{ role: "user", content: "文章を確認してください" }],
      executionPolicy: { timeoutMs: 0 },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_EXECUTION_POLICY");
    expect(execute).not.toHaveBeenCalled();
  });
});
