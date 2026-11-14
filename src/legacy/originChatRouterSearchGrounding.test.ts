import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { OriginSearchUsageCounter } from "../search/originSearchProviderCatalog";
import { OriginSearchTtlCache } from "../search/originSearchCache";
import { ORIGIN_GROUNDING_UNAVAILABLE_MESSAGE_JA } from "../search/originSearchGrounding";
import type { OriginSearchFetch } from "../search/originSearchProviders";
import { createOriginChatRouter, type OriginChatExecutor } from "./originChatRouter";

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
const SEARCH_NOW = Date.parse("2026-11-07T12:00:00.000Z");

const defaultExecutionResult = {
  text: "安全な確認結果です。",
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

interface RecordedCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
}

function routedFetch(routes: Array<{ match: string; respond: (call: RecordedCall) => unknown }>) {
  const calls: RecordedCall[] = [];
  const fetchImpl: OriginSearchFetch = async (url, init) => {
    const call: RecordedCall = { url, init };
    calls.push(call);
    for (const route of routes) {
      if (url.includes(route.match)) return jsonResponse(route.respond(call));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  return { fetchImpl, calls };
}

const OPEN_METEO_ROUTES = [
  {
    match: "geocoding-api.open-meteo.com",
    respond: () => ({ results: [{ name: "東京", admin1: "東京都", country: "日本", latitude: 35.6895, longitude: 139.6917 }] }),
  },
  {
    match: "api.open-meteo.com/v1/forecast",
    respond: () => ({
      current: { time: "2026-11-07T12:00", temperature_2m: 18.5, relative_humidity_2m: 55, apparent_temperature: 18.1, weather_code: 1 },
      daily: {
        time: ["2026-11-07", "2026-11-08"],
        weather_code: [1, 61],
        temperature_2m_max: [21.2, 17.4],
        temperature_2m_min: [12.3, 10.1],
        precipitation_probability_max: [20, 80],
      },
    }),
  },
];

function createSearchApp(options: {
  execute: OriginChatExecutor;
  fetchImpl: OriginSearchFetch;
  searchEnv?: NodeJS.ProcessEnv;
  researchSynthesis?: OriginChatExecutor | null;
}) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: options.execute,
    researchSynthesis: options.researchSynthesis ?? null,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-test-trace",
    searchGrounding: {
      env: options.searchEnv ?? { TAVILY_API_KEY: "tvly-test-key" },
      fetchImpl: options.fetchImpl,
      now: () => SEARCH_NOW,
      counter: new OriginSearchUsageCounter(),
      cache: new OriginSearchTtlCache(),
    },
  }));
  return app;
}

describe("createOriginChatRouter with search grounding (default research composition)", () => {
  let executeMock: ReturnType<typeof vi.fn>;
  let execute: OriginChatExecutor;
  beforeEach(() => {
    executeMock = vi.fn().mockResolvedValue(defaultExecutionResult);
    execute = executeMock as OriginChatExecutor;
  });

  it("answers a weather question with live Open-Meteo data instead of the not-connected message", async () => {
    const { fetchImpl } = routedFetch(OPEN_METEO_ROUTES);
    const response = await request(createSearchApp({ execute, fetchImpl }))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の東京の天気は？" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain("東京");
    expect(response.body.content).toContain("18.5");
    expect(response.body.content).toContain("Open-Meteo");
    expect(response.body.content).not.toContain("接続されていません");
    expect(response.body.routing.answerMode).toBe("weather");
    expect(response.body.routing.weatherProvider).toBe("Open-Meteo");
    expect(response.body.answer.evidence).toHaveLength(1);
    expect(response.body.answer.evidence[0].sourceUrl).toBe("https://open-meteo.com/");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("answers honestly when the weather provider cannot be reached", async () => {
    const failingFetch: OriginSearchFetch = async () => {
      throw new Error("network down");
    };
    const response = await request(createSearchApp({ execute, fetchImpl: failingFetch }))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の東京の天気は？" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe("最新の天気情報を取得しようとしましたが、取得できませんでした。");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns the §2.5 honest failure when news sources are all stale", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "api.gdeltproject.org",
        respond: () => ({
          articles: [
            { url: "https://www3.nhk.or.jp/news/html/old.html", title: "古いニュース", domain: "nhk.or.jp", seendate: "20261001T000000Z" },
          ],
        }),
      },
    ]);
    const response = await request(createSearchApp({ execute, fetchImpl, searchEnv: {} }))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "昨日から今日にかけて、日本に関する主要なニュースを3つ教えてください" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(ORIGIN_GROUNDING_UNAVAILABLE_MESSAGE_JA);
    expect(response.body.answer.limitations.join("")).toContain("鮮度条件");
    expect(response.body.answer.evidence).toEqual([]);
    expect(response.body.routing.answerMode).toBe("research");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("grounds a fresh_general answer through Tavily into the synthesis path with grounding metadata", async () => {
    const longExcerpt = (core: string) => `${core}${" 補足の説明テキスト。".repeat(30)}`;
    const { fetchImpl } = routedFetch([
      {
        match: "api.tavily.com/search",
        respond: () => ({
          results: [
            {
              title: "ChatGPT 最新モデル GPT-5.1 - OpenAI",
              url: "https://openai.com/news/gpt-51",
              content: longExcerpt("GPT-5.1が公開された。"),
              score: 0.9,
              published_date: "2026-11-05T00:00:00.000Z",
            },
            {
              title: "ChatGPT 最新モデル GPT-5.1 解説 - ITmedia",
              url: "https://www.itmedia.co.jp/news/gpt51",
              content: longExcerpt("2026年10月に公開されたGPT-5.1の解説記事。"),
              score: 0.8,
              published_date: "2026-11-01T00:00:00.000Z",
            },
          ],
        }),
      },
      { match: "api.tavily.com/extract", respond: () => ({ results: [], failed_results: [] }) },
      { match: "wikipedia.org", respond: () => ({ pages: [] }) },
    ]);
    const synthesis = vi.fn().mockResolvedValue({
      ...defaultExecutionResult,
      text: "現在の最新モデルはGPT-5.1です。[S1](https://openai.com/news/gpt-51)\n2026年10月に公開されました。[S2](https://www.itmedia.co.jp/news/gpt51)",
    });
    const response = await request(createSearchApp({
      execute,
      fetchImpl,
      researchSynthesis: synthesis as unknown as OriginChatExecutor,
    }))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "ChatGPT の最新モデルの名前と主な特徴を教えてください" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain("GPT-5.1");
    expect(response.body.routing.answerMode).toBe("research");
    expect(response.body.routing.researchProvider).toBe("Tavily");
    expect(response.body.routing.searchGrounding).toEqual(expect.objectContaining({
      questionType: "fresh_general",
      freshnessVerified: true,
      verifiedFreshSourceCount: 2,
    }));
    expect(response.body.answer.evidence).toHaveLength(2);
    expect(synthesis).toHaveBeenCalledTimes(1);
  });

  // Regression (2026-11-07 production benchmark Q8): the minimum-wage
  // question previously bypassed grounded research entirely — the chat
  // gate required a 最新/今日/現在 prefix plus a listed target noun, and
  // 最低賃金 matched neither — so the model asserted the 2024 values with
  // no sources. It must now take the research path via the classifier.
  // Presentation note (PKG-9 search-dump fix): this app disables the
  // synthesis stage, so the response is the fallback. The fallback cites
  // the retrieved official source without reproducing its text — grounded
  // values reach the answer body only through a citation-validated
  // synthesis (see the GPT-5.1 case above). What this regression pins is
  // the routing: research path, official evidence, no model execution.
  it("grounds the minimum-wage policy question instead of answering from memory", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "api.tavily.com/search",
        respond: () => ({
          results: [
            {
              title: "地域別最低賃金の改定について - 厚生労働省",
              url: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/minimumichiran/",
              content: "令和8年度の地域別最低賃金は、全国加重平均1,177円、東京都は1,280円となり、2026年10月1日から発効しました。",
              score: 0.95,
              published_date: "2026-10-01T00:00:00.000Z",
            },
          ],
        }),
      },
      { match: "api.tavily.com/extract", respond: () => ({ results: [], failed_results: [] }) },
    ]);
    const response = await request(createSearchApp({ execute, fetchImpl }))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "現在の最低賃金（全国平均と東京都）と、いつの改定のものか教えてください" }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.answerMode).toBe("research");
    expect(response.body.routing.searchGrounding).toEqual(expect.objectContaining({
      questionType: "policy",
    }));
    expect(response.body.content).toContain("確認できた範囲と出典の一覧をお伝えします");
    expect(response.body.content).toContain("mhlw.go.jp");
    expect(response.body.content).not.toContain("1,177円");
    expect(response.body.content).not.toContain("全国加重平均");
    expect(response.body.answer.evidence).toHaveLength(1);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
