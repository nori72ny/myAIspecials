import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;

const executionResult = {
  text: "AIOはAI検索最適化を指す言葉として使われます。",
  actualCostUsd: 0,
  providerDataPolicy: {
    allowProviderFallbacks: false as const,
    dataCollection: "deny" as const,
    requireZeroDataRetention: true as const,
  },
  routingEvidence: {
    requestedModel: "inclusionai/ling-3.0-flash-sante:free",
    servedModel: "inclusionai/ling-3.0-flash-sante:free",
    strategy: "adaptive-primary" as const,
    provider: "OpenRouter",
    region: "iad",
    attempt: 1,
    fallbackUsed: false,
  },
  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0 },
};

function createApp(
  execute: OriginChatExecutor,
  research: OriginResearchExecutor = async () => ({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } }),
) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute,
    research,
    researchSynthesis: null,
    catalogNow,
    createRequestId: () => "origin-acronym-test",
  }));
  return app;
}

describe("stable acronym definition intent", () => {
  it("routes AIOとは? to normal answer generation instead of the current-information gate", async () => {
    const executeMock = vi.fn().mockResolvedValue(executionResult) as OriginChatExecutor;
    const researchMock = vi.fn() as unknown as OriginResearchExecutor;

    const response = await request(createApp(executeMock, researchMock)).post("/api/chat").send({
      messages: [{ role: "user", content: "AIOとは？" }],
    });

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(researchMock).not.toHaveBeenCalled();
    expect(response.body.content).toBe(executionResult.text);
    expect(response.body.answer.verification.status).toBe("not-required");
  });

  it("routes an explicit current-information acronym request through Grounded Research", async () => {
    const executeMock = vi.fn().mockResolvedValue(executionResult) as OriginChatExecutor;
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "DuckDuckGo",
      sources: [{
        title: "AIO current source",
        url: "https://example.com/aio-current",
        excerpt: "AIOに関する現在の公開情報です。",
        sourceType: "web-search",
        domain: "example.com",
        rank: 1,
        evidenceLevel: "page-verified",
        retrievedAt: "2026-09-24T08:00:00.000Z",
        freshness: "recent",
      }],
    }) as unknown as OriginResearchExecutor;

    const response = await request(createApp(executeMock, researchMock)).post("/api/chat").send({
      messages: [{ role: "user", content: "AIOの最新情報は？" }],
    });

    expect(response.status).toBe(200);
    expect(executeMock).not.toHaveBeenCalled();
    expect(researchMock).toHaveBeenCalledWith("AIOの最新情報は？");
    expect(response.body.routing).toEqual(expect.objectContaining({
      answerMode: "research",
      verificationLevel: "evidence-required",
      sourceCount: 1,
      researchProvider: "DuckDuckGo",
      freeOnly: true,
      cost: 0,
    }));
    expect(response.body.content).toContain("確認できた公開情報");
    expect(response.body.content).toContain("https://example.com/aio-current");
  });
});
