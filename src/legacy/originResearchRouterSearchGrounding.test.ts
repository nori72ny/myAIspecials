import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { OriginSearchUsageCounter } from "../search/originSearchProviderCatalog";
import { OriginSearchTtlCache } from "../search/originSearchCache";
import type { OriginSearchFetch } from "../search/originSearchProviders";
import { createOriginResearchRouter } from "./originResearchRouter.js";

const SEARCH_NOW = Date.parse("2026-11-07T12:00:00.000Z");

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function gdeltFetch(seendate: string | undefined) {
  const fetchImpl: OriginSearchFetch = async (url) => {
    if (url.includes("api.gdeltproject.org")) {
      return jsonResponse({
        articles: [
          { url: "https://www3.nhk.or.jp/news/html/1.html", title: "本日の主要ニュース", domain: "nhk.or.jp", ...(seendate ? { seendate } : {}) },
        ],
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  return fetchImpl;
}

function createApp(fetchImpl: OriginSearchFetch) {
  const app = express();
  app.use(express.json());
  app.use(createOriginResearchRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    searchGrounding: {
      env: {},
      fetchImpl,
      now: () => SEARCH_NOW,
      counter: new OriginSearchUsageCounter(),
      cache: new OriginSearchTtlCache(),
    },
  }));
  return app;
}

describe("originResearchRouter with search grounding composition", () => {
  beforeEach(() => {
    researchMock.mockReset();
  });

  it("serves today's news from GDELT instead of failing closed on the legacy scrapers (production repro)", async () => {
    const response = await request(createApp(gdeltFetch("20261107T103000Z")))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日のニュースを要約して" }] });
    expect(response.status).toBe(200);
    expect(response.body.research.source).toBe("GDELT");
    expect(response.body.research.sources).toHaveLength(1);
    expect(response.body.content).toContain("本日の主要ニュース");
    expect(response.body.research.grounding).toEqual(expect.objectContaining({
      questionType: "news",
      freshnessVerified: true,
    }));
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("keeps the fail-closed contract: stale-only news still returns 503 RESEARCH_SOURCE_UNAVAILABLE", async () => {
    const response = await request(createApp(gdeltFetch("20261001T000000Z")))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日のニュースを要約して" }] });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("RESEARCH_SOURCE_UNAVAILABLE");
    expect(response.body.research.groundingFailure).toBe("no-fresh-sources");
    expect(response.body.research.sources).toEqual([]);
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("delegates non-grounding research requests to the legacy research function", async () => {
    researchMock.mockResolvedValue({
      ok: true,
      sources: [{ title: "Evidence", url: "https://en.wikipedia.org/wiki/AI", excerpt: "Retrieved evidence.", evidenceLevel: "page-verified", freshness: "unknown", retrievedAt: "2026-09-10T00:00:00Z" }],
    });
    const response = await request(createApp(gdeltFetch("20261107T103000Z")))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "AIの調査レポートを出典付きで作成して" }] });
    expect(response.status).toBe(200);
    expect(researchMock).toHaveBeenCalledTimes(1);
  });

  it("defers weather requests to the chat router's Open-Meteo branch (no duplicate weather route)", async () => {
    const response = await request(createApp(gdeltFetch("20261107T103000Z")))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の東京の天気は？" }] });
    // Nothing else is mounted in this app, so a deferred request falls through.
    expect(response.status).toBe(404);
    expect(researchMock).not.toHaveBeenCalled();
  });
});
