import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor } from "./originChatRouter";

// Wiring test for the numeric audit gate's enforcement mode on the
// non-streaming (JSON) path: with ORIGIN_BUSINESS_PLANNING_AUDIT_MODE
// set to enforce, the delivered content carries the deterministic
// formula correction and its disclosure; without the switch the
// content is the model's text unchanged (stage-1 shadow behaviour).

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
const defaultExecutionResult = {
  text: "安全な確認結果です。",
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

const PLANNING_PROMPT = "新製品ローンチのマーケティング仕様書を作って。目的、ターゲット、ファネル、KPI、計測方法まで含めてください。";
const ANSWER_WITH_FORMULA_SLIP = "必要な商談数：60件（120件 ÷ 20%）";

function createApp(execute: OriginChatExecutor, env: NodeJS.ProcessEnv) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env,
    execute,
    research: async () => ({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } }),
    researchSynthesis: null,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-test-trace",
  }));
  return app;
}

describe("numeric audit gate enforcement mode (JSON router)", () => {
  let executeMock: ReturnType<typeof vi.fn>;
  let execute: OriginChatExecutor;
  beforeEach(() => {
    executeMock = vi.fn().mockResolvedValue({ ...defaultExecutionResult, text: ANSWER_WITH_FORMULA_SLIP });
    execute = executeMock as OriginChatExecutor;
  });

  it("delivers the corrected figure with the fix disclosure when enforce is set", async () => {
    const response = await request(createApp(execute, {
      OPENROUTER_API_KEY: "synthetic-test-key",
      ORIGIN_BUSINESS_PLANNING_AUDIT_MODE: "enforce",
    })).post("/api/chat").send({ messages: [{ role: "user", content: PLANNING_PROMPT }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain("必要な商談数：600件（120件 ÷ 20%）");
    expect(response.body.content).toContain("数値の一部を、回答に記載された計算式に合わせて修正しました。");
  });

  it("delivers the model's text unchanged without the switch (shadow default)", async () => {
    const response = await request(createApp(execute, { OPENROUTER_API_KEY: "synthetic-test-key" }))
      .post("/api/chat").send({ messages: [{ role: "user", content: PLANNING_PROMPT }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(ANSWER_WITH_FORMULA_SLIP);
  });
});
