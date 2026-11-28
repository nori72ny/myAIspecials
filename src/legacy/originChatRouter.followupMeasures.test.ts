import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

/**
 * Wiring tests for the follow-up measures of
 * ANSWER_FOLLOWUP_DIAGNOSIS_2026-11-26:
 *  - measure 1: the deterministic date branch answers a
 *    clock-function question from the server clock — no research,
 *    no model, no freshness gate — under the official-routing
 *    switch, and stays silent with the switch off;
 *  - measure 4: the grounding observation (issued queries,
 *    freshness decisions, the official retry, per-source date
 *    presence) reaches the response routing AND the phased
 *    stream's outcome event, so a streamed answer is as
 *    attributable as a logged one.
 */
const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
// Thursday 2026-11-26, midday JST.
const NOW = Date.parse("2026-11-26T03:00:00.000Z");

const defaultExecutionResult = {
  text: "モデル側の回答です。",
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

function createApp(options: {
  env: Record<string, string>;
  execute: OriginChatExecutor;
  research: OriginResearchExecutor;
}) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: options.env,
    execute: options.execute,
    research: options.research,
    researchSynthesis: null,
    now: () => NOW,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-followup-test",
  }));
  return app;
}

describe("measure 1 — deterministic date branch", () => {
  it("answers 今日は何曜日ですか？ from the clock: no research, no model", async () => {
    const executeMock = vi.fn().mockResolvedValue(defaultExecutionResult);
    const researchMock = vi.fn().mockResolvedValue({ ok: false, sources: [] });
    const app = createApp({
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
      execute: executeMock as unknown as OriginChatExecutor,
      research: researchMock as unknown as OriginResearchExecutor,
    });
    const response = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日は何曜日ですか？" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe("今日は2026年11月26日（木曜日）です。");
    expect(response.body.routing.answerMode).toBe("deterministic-date");
    expect(executeMock).not.toHaveBeenCalled();
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("answers an absolute-date weekday question the same way", async () => {
    const executeMock = vi.fn().mockResolvedValue(defaultExecutionResult);
    const researchMock = vi.fn().mockResolvedValue({ ok: false, sources: [] });
    const app = createApp({
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
      execute: executeMock as unknown as OriginChatExecutor,
      research: researchMock as unknown as OriginResearchExecutor,
    });
    const response = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "2026年12月25日は何曜日ですか？" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe("2026年12月25日は金曜日です。");
    expect(executeMock).not.toHaveBeenCalled();
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("answers deterministically even with the official-routing switch off (Q7-04: a clock question is not gated)", async () => {
    const executeMock = vi.fn().mockResolvedValue(defaultExecutionResult);
    const researchMock = vi.fn().mockResolvedValue({ ok: false, sources: [] });
    const app = createApp({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      execute: executeMock as unknown as OriginChatExecutor,
      research: researchMock as unknown as OriginResearchExecutor,
    });
    const response = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日は何曜日ですか？" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe("今日は2026年11月26日（木曜日）です。");
    expect(response.body.routing.answerMode).toBe("deterministic-date");
    expect(executeMock).not.toHaveBeenCalled();
    expect(researchMock).not.toHaveBeenCalled();
  });
});

const researchWithGrounding = {
  ok: true,
  searchProvider: "Tavily",
  sources: [
    {
      title: "一般職業紹介状況（令和8年9月分）を公表しました",
      url: "https://www.mhlw.go.jp/stf/newdata/20261030.html",
      excerpt: "全国の有効求人倍率は1.19倍でした。",
      revisionTimestamp: "2026-10-30",
      sourceType: "web-search",
      domain: "mhlw.go.jp",
      rank: 1,
      evidenceLevel: "page-verified",
      retrievedAt: "2026-11-26T03:00:00.000Z",
      freshness: "recent",
    },
    {
      title: "日付のない解説ページ",
      url: "https://blog.example.com/job-offers",
      excerpt: "有効求人倍率について解説します。",
      sourceType: "web-search",
      domain: "blog.example.com",
      rank: 2,
      evidenceLevel: "snippet",
      retrievedAt: "2026-11-26T03:00:00.000Z",
      freshness: "unknown",
    },
  ],
  grounding: {
    questionType: "fresh_general",
    providersUsed: ["tavily"],
    freshnessVerified: true,
    verifiedFreshSourceCount: 1,
    unknownDateSourceCount: 1,
    droppedStaleSourceCount: 0,
    droppedUndatedSourceCount: 0,
    queriesIssued: [
      { provider: "tavily", kind: "ordinary", query: "有効求人倍率" },
      {
        provider: "tavily",
        kind: "official",
        query: "有効求人倍率 一般職業紹介状況 令和8年9月分 2026年9月分",
        includeDomains: ["mhlw.go.jp"],
      },
      {
        provider: "tavily",
        kind: "official-retry",
        query: "一般職業紹介状況 令和8年9月分 2026年9月分",
        includeDomains: ["mhlw.go.jp"],
      },
    ],
    candidateStats: {
      totalCount: 2,
      domainCounts: { "mhlw.go.jp": 1, "blog.example.com": 1 },
      tierCounts: { official: 1, general: 1 },
      droppedByScreenCount: 0,
      droppedByFreshnessCount: 0,
      freshnessDecisions: [
        { domain: "mhlw.go.jp", tier: "official", outcome: "kept-verified", basis: "text-date", basisDate: "2026-10-30" },
        { domain: "blog.example.com", tier: "general", outcome: "kept-undated", basis: "none", basisDate: null },
      ],
      officialRetry: { reason: "stale-edition", fired: true, candidateCount: 1, keptCount: 1, adoptedCount: 1 },
    },
  },
} as unknown as Awaited<ReturnType<OriginResearchExecutor>>;

const EXPECTED_OBSERVATION = {
  queriesIssued: [
    { provider: "tavily", kind: "ordinary", query: "有効求人倍率" },
    {
      provider: "tavily",
      kind: "official",
      query: "有効求人倍率 一般職業紹介状況 令和8年9月分 2026年9月分",
      includeDomains: ["mhlw.go.jp"],
    },
    {
      provider: "tavily",
      kind: "official-retry",
      query: "一般職業紹介状況 令和8年9月分 2026年9月分",
      includeDomains: ["mhlw.go.jp"],
    },
  ],
  freshness: { verifiedFreshCount: 1, unknownDateCount: 1, droppedStaleCount: 0, droppedUndatedCount: 0 },
  freshnessDecisions: [
    { domain: "mhlw.go.jp", tier: "official", outcome: "kept-verified", basis: "text-date", basisDate: "2026-10-30" },
    { domain: "blog.example.com", tier: "general", outcome: "kept-undated", basis: "none", basisDate: null },
  ],
  officialRetry: { reason: "stale-edition", fired: true, candidateCount: 1, keptCount: 1, adoptedCount: 1 },
  adoptedSources: [
    { domain: "mhlw.go.jp", hasPublishedAt: true },
    { domain: "blog.example.com", hasPublishedAt: false },
  ],
};

describe("measure 4 — grounding observation reaches the response", () => {
  it("the JSON routing carries the observation", async () => {
    const executeMock = vi.fn().mockResolvedValue(defaultExecutionResult);
    const researchMock = vi.fn().mockResolvedValue(researchWithGrounding);
    const app = createApp({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      execute: executeMock as unknown as OriginChatExecutor,
      research: researchMock as unknown as OriginResearchExecutor,
    });
    const response = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "候補を比較調査してください" }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.answerMode).toBe("research");
    expect(response.body.routing.groundingObservation).toEqual(EXPECTED_OBSERVATION);
  });

  it("the phased stream's outcome event carries the same observation", async () => {
    const executeMock = vi.fn().mockResolvedValue(defaultExecutionResult);
    const researchMock = vi.fn().mockResolvedValue(researchWithGrounding);
    const app = createApp({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      execute: executeMock as unknown as OriginChatExecutor,
      research: researchMock as unknown as OriginResearchExecutor,
    });
    const streamed = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "候補を比較調査してください" }] });
    expect(streamed.status).toBe(200);
    const events = streamed.text
      .split("\n\n")
      .map((block) => block.trim())
      .filter((line) => line.startsWith("data:") && !line.includes("[DONE]"))
      .map((line) => JSON.parse(line.slice("data:".length).trim()) as Record<string, unknown>);
    const outcome = events.find((event) => event.type === "outcome");
    expect(outcome).toBeDefined();
    expect(outcome?.grounding).toEqual(EXPECTED_OBSERVATION);
  });
});
