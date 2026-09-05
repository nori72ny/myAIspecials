import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor } from "./originChatRouter";

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;

const executionResult = {
  text: "AIOはAI検索最適化を指す言葉として使われます。",
  actualCostUsd: 0,
  providerDataPolicy: {
    allowProviderFallbacks: false as const,
    dataCollection: "deny" as const,
    requireZeroDataRetention: false as const,
  },
  routingEvidence: {
    requestedModel: "google/gemma-4-31b-it:free",
    servedModel: "google/gemma-4-31b-it:free",
    strategy: "adaptive-primary" as const,
    provider: "OpenRouter",
    region: "iad",
    attempt: 1,
    fallbackUsed: false,
  },
  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0 },
};

function createApp(execute: OriginChatExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute,
    catalogNow,
    createRequestId: () => "origin-acronym-test",
  }));
  return app;
}

describe("stable acronym definition intent", () => {
  it("routes AIOとは? to normal answer generation instead of the current-information gate", async () => {
    const executeMock = vi.fn().mockResolvedValue(executionResult) as OriginChatExecutor;

    const response = await request(createApp(executeMock)).post("/api/chat").send({
      messages: [{ role: "user", content: "AIOとは？" }],
    });

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(response.body.content).toBe(executionResult.text);
    expect(response.body.answer.verification.status).toBe("not-required");
  });

  it("still distinguishes an explicit current-information request", async () => {
    const executeMock = vi.fn().mockResolvedValue(executionResult) as OriginChatExecutor;

    const response = await request(createApp(executeMock)).post("/api/chat").send({
      messages: [{ role: "user", content: "AIOの最新情報は？" }],
    });

    expect(response.status).toBe(200);
    expect(executeMock).not.toHaveBeenCalled();
    expect(response.body.content).toContain("検索機能");
  });
});
