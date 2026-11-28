import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import { requiresOriginGroundedResearch } from "./originChatResponsePolicy";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

/**
 * Q9-01 router wiring (full audit round 3, 2026-11-28): a
 * deterministic calculation question is answered by the
 * deterministic calculation branch — no research, no model —
 * while its factual near-misses keep their existing routes. The
 * parser/builder set itself is pinned by
 * src/search/originDeterministicCalculationAnswer.test.ts.
 */
const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
const NOW = Date.parse("2026-11-28T03:00:00.000Z");

const executeMock = vi.fn().mockResolvedValue({
  text: "モデル側の回答です。",
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
});
const researchMock = vi.fn().mockResolvedValue({ ok: false, sources: [] });

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: executeMock as unknown as OriginChatExecutor,
    research: researchMock as unknown as OriginResearchExecutor,
    researchSynthesis: null,
    now: () => NOW,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-q901-test",
  }));
  return app;
}

async function ask(content: string) {
  return request(createApp())
    .post("/api/chat")
    .send({ messages: [{ role: "user", content }] });
}

describe("deterministic calculation branch — the Q9-01 defect", () => {
  it("answers 200万円の消費税10%込みの金額は？ deterministically: no research, no model", async () => {
    executeMock.mockClear();
    researchMock.mockClear();
    const response = await ask("200万円の消費税10%込みの金額は？");
    expect(response.status).toBe(200);
    expect(response.body.content).toBe("200万円の消費税10%込みの金額は、2,200,000円（220万円）です。");
    expect(response.body.routing.answerMode).toBe("deterministic-calculation");
    expect(executeMock).not.toHaveBeenCalled();
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("answers the same calculation at the round-2 amount (150万円)", async () => {
    const response = await ask("150万円の消費税10%込みの金額は？");
    expect(response.status).toBe(200);
    expect(response.body.content).toBe("150万円の消費税10%込みの金額は、1,650,000円（165万円）です。");
    expect(response.body.routing.answerMode).toBe("deterministic-calculation");
  });

  it("answers percent-of and unit conversion through the same branch", async () => {
    const percent = await ask("40人の75%は何人ですか");
    expect(percent.body.content).toBe("40人の75%は、30人です。");
    expect(percent.body.routing.answerMode).toBe("deterministic-calculation");
    const conversion = await ask("100cmは何mですか");
    expect(conversion.body.content).toBe("100cmは、1mです。");
    expect(conversion.body.routing.answerMode).toBe("deterministic-calculation");
  });
});

describe("deterministic calculation branch — near-misses keep their routes", () => {
  it("a current-rate question still grounds (research runs)", async () => {
    researchMock.mockClear();
    const response = await ask("最新の税率は何%ですか？");
    expect(response.status).toBe(200);
    expect(response.body.routing.answerMode).not.toBe("deterministic-calculation");
    expect(researchMock).toHaveBeenCalled();
  });

  it("a tax-inclusive question WITHOUT the rate still grounds (the rate is external)", async () => {
    researchMock.mockClear();
    const response = await ask("200万円の消費税込みの金額は？");
    expect(response.status).toBe(200);
    expect(response.body.routing.answerMode).not.toBe("deterministic-calculation");
    expect(researchMock).toHaveBeenCalled();
  });

  it("an explicit research request over a calculation still grounds", async () => {
    researchMock.mockClear();
    const response = await ask("200万円の消費税10%込みの金額を調べてください");
    expect(response.status).toBe(200);
    expect(response.body.routing.answerMode).not.toBe("deterministic-calculation");
    expect(researchMock).toHaveBeenCalled();
  });

  it("a tax history question is not swallowed by the branch", async () => {
    const response = await ask("消費税率の歴史は？");
    expect(response.status).toBe(200);
    expect(response.body.routing.answerMode).not.toBe("deterministic-calculation");
  });
});

describe("routing determination pins (the bisection, fixed)", () => {
  it("the Q9-01 question no longer requires grounded research", () => {
    expect(requiresOriginGroundedResearch("200万円の消費税10%込みの金額は？")).toBe(false);
    expect(requiresOriginGroundedResearch("150万円の消費税10%込みの金額は？")).toBe(false);
    expect(requiresOriginGroundedResearch("40人の75%は何人ですか")).toBe(false);
    expect(requiresOriginGroundedResearch("100cmは何mですか")).toBe(false);
  });

  it("factual tax questions still require grounded research where they did before", () => {
    expect(requiresOriginGroundedResearch("最新の税率は何%ですか？")).toBe(true);
    expect(requiresOriginGroundedResearch("200万円の消費税込みの金額は？")).toBe(true);
  });
});

describe("streaming router delegation", () => {
  it("delegates a deterministic calculation question to the non-streaming router", async () => {
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta("回答");
      return {
        text: "回答",
        actualCostUsd: 0 as const,
        providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
        routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0 as const },
      };
    }) as unknown as OriginProviderStreamExecutor;
    const app = express();
    app.use(express.json());
    app.use(createOriginStreamingChatRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      streamExecute,
      catalogNow: () => verifiedCatalogTime,
      createRequestId: () => "origin-q901-stream-test",
    }));
    app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "200万円の消費税10%込みの金額は？" }] });
    expect(response.status).toBe(418);
    expect(response.body).toEqual({ delegated: true });
    expect(streamExecute).not.toHaveBeenCalled();
  });
});
