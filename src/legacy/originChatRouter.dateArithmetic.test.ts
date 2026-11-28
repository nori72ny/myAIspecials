import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import {
  createOriginChatRouter,
  type OriginChatExecutor,
  type OriginResearchExecutor,
} from "./originChatRouter";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Route-level pins for the deterministic date-arithmetic branch.
// Diagnosis (2026-11-28): date arithmetic had no deterministic owner.
// The relative-base shapes ("今日から45日後…") were promoted to the
// grounded path by the freshness determination and refused with the
// T4 abstain when retrieval failed (reproduced on the pristine tree:
// researchTier T4 / researchOutcome ABSTAIN / provider-error), and
// the absolute-date shapes fell to the model. The successor's
// production probe hit exactly this class ("2026年11月28日の45日後
// は何日ですか？" refused). These tests drive the real routers with
// a failing research executor: every parsed shape must now be
// answered by the calendar, with no research and no model call.
const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
// 2026-11-28 (Sat) JST.
const FIXED_NOW = Date.parse("2026-11-28T03:00:00.000Z");

function createExecutors() {
  const execute = vi.fn(async () => ({
    text: "モデルが生成した回答です。",
    transportRequestCount: 1,
    actualCostUsd: 0 as const,
    providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
    routingEvidence: { requestedModel: verifiedEvidence.modelId, servedModel: verifiedEvidence.modelId, strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
  })) as unknown as OriginChatExecutor & ReturnType<typeof vi.fn>;
  const research = vi.fn().mockResolvedValue({
    ok: false,
    sources: [],
    failure: { stage: "web-search", code: "NETWORK_FAILURE" },
  }) as unknown as OriginResearchExecutor & ReturnType<typeof vi.fn>;
  return { execute, research };
}

function createChatApp(executors: ReturnType<typeof createExecutors>) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: executors.execute,
    research: executors.research,
    researchSynthesis: vi.fn() as unknown as OriginChatExecutor,
    now: () => FIXED_NOW,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-date-arithmetic-test",
  }));
  return app;
}

describe("deterministic date arithmetic through the chat route", () => {
  it("answers the production-observed question deterministically, with no research or model call", async () => {
    const executors = createExecutors();
    const response = await request(createChatApp(executors))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "2026年11月28日の45日後は何日ですか？" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe("2026年11月28日の45日後は2027年1月12日（火曜日）です。");
    expect(response.body.routing?.answerMode).toBe("deterministic-date-arithmetic");
    expect(executors.research).not.toHaveBeenCalled();
    expect(executors.execute).not.toHaveBeenCalled();
  });

  it("answers the relative-base shape that previously landed on the T4 abstain", async () => {
    const executors = createExecutors();
    const response = await request(createChatApp(executors))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日から45日後は何日ですか？" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe("今日から45日後は2027年1月12日（火曜日）です。");
    expect(response.body.routing?.answerMode).toBe("deterministic-date-arithmetic");
    expect(response.body.routing?.researchOutcome).toBeUndefined();
    expect(executors.research).not.toHaveBeenCalled();
    expect(executors.execute).not.toHaveBeenCalled();
  });

  it("answers remaining-days questions deterministically", async () => {
    const executors = createExecutors();
    const response = await request(createChatApp(executors))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "2026年12月25日まであと何日ですか？" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe("今日から2026年12月25日まではあと27日です。");
    expect(response.body.routing?.answerMode).toBe("deterministic-date-arithmetic");
    expect(executors.research).not.toHaveBeenCalled();
  });

  it("serves the deterministic answer on the SSE surface via delegation", async () => {
    const executors = createExecutors();
    const streamExecute = vi.fn() as unknown as OriginProviderStreamExecutor & ReturnType<typeof vi.fn>;
    const app = express();
    app.use(express.json());
    app.use(createOriginStreamingChatRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      streamExecute,
      catalogNow: () => verifiedCatalogTime,
      createRequestId: () => "origin-date-arithmetic-stream-test",
    }));
    app.use(createChatApp(executors));

    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "45日後は何日ですか？" }] });

    expect(response.status).toBe(200);
    expect(response.text).toContain("今日から45日後は2027年1月12日（火曜日）です。");
    expect(streamExecute).not.toHaveBeenCalled();
    expect(executors.research).not.toHaveBeenCalled();
    expect(executors.execute).not.toHaveBeenCalled();
  });

  it("does not capture date fact questions: they keep their previous route", async () => {
    const executors = createExecutors();
    const response = await request(createChatApp(executors))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "2026年11月28日は何の日ですか？" }] });

    expect(response.status).toBe(200);
    expect(response.body.routing?.answerMode).not.toBe("deterministic-date-arithmetic");
  });
});
