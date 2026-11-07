import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("../legacy/originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { OriginSearchUsageCounter } from "../search/originSearchProviderCatalog";
import { OriginSearchTtlCache } from "../search/originSearchCache";
import type { OriginSearchFetch } from "../search/originSearchProviders";
import { createGroundedResearchV11Router } from "./groundedResearchV11Router.js";

const SEARCH_NOW = Date.parse("2026-11-07T12:00:00.000Z");

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function isGdeltApiUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "api.gdeltproject.org";
  } catch {
    return false;
  }
}

function gdeltFetch(seendate: string | undefined) {
  const fetchImpl: OriginSearchFetch = async (url) => {
    if (isGdeltApiUrl(url)) {
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

function createGroundedApp(fetchImpl: OriginSearchFetch) {
  const app = express();
  app.use(express.json());
  app.use(createGroundedResearchV11Router({
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

function createDefaultApp() {
  const app = express();
  app.use(express.json());
  app.use(createGroundedResearchV11Router());
  return app;
}

describe("groundedResearchV11Router with search grounding composition", () => {
  beforeEach(() => {
    researchMock.mockReset();
  });

  it("serves today's news from GDELT instead of failing closed on the legacy sources (production repro)", async () => {
    const response = await request(createGroundedApp(gdeltFetch("20261107T103000Z")))
      .post("/api/research/v1.1/query")
      .send({ query: "今日のニュースを要約して" });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.provider).toBe("GDELT");
    expect(response.body.sourceCount).toBe(1);
    expect(response.body.report).toContain("本日の主要ニュース");
    expect(response.body.grounding).toEqual(expect.objectContaining({
      questionType: "news",
      freshnessVerified: true,
    }));
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("keeps the fail-closed contract: stale-only news still returns 503 RESEARCH_SOURCE_UNAVAILABLE", async () => {
    const response = await request(createGroundedApp(gdeltFetch("20261001T000000Z")))
      .post("/api/research/v1.1/query")
      .send({ query: "今日のニュースを要約して" });
    expect(response.status).toBe(503);
    expect(response.body.ok).toBe(false);
    expect(response.body.code).toBe("RESEARCH_SOURCE_UNAVAILABLE");
    expect(response.body.groundingFailure).toBe("no-fresh-sources");
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("delegates queries with no enabled grounding route to the legacy research function", async () => {
    researchMock.mockResolvedValue({
      ok: true,
      searchProvider: "Wikipedia",
      sources: [{ title: "Evidence", url: "https://en.wikipedia.org/wiki/AI", excerpt: "Retrieved evidence.", sourceType: "encyclopedia", evidenceLevel: "page-verified", freshness: "unknown", retrievedAt: "2026-09-10T00:00:00Z" }],
    });
    const response = await request(createGroundedApp(gdeltFetch("20261107T103000Z")))
      .post("/api/research/v1.1/query")
      .send({ query: "AIの調査レポートを出典付きで作成して" });
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe("Wikipedia");
    expect(response.body.grounding).toBeUndefined();
    expect(researchMock).toHaveBeenCalledTimes(1);
  });
});

describe("groundedResearchV11Router with no options (legacy behavior preserved)", () => {
  beforeEach(() => {
    researchMock.mockReset();
  });

  it("answers directly from the legacy research function", async () => {
    researchMock.mockResolvedValue({
      ok: true,
      searchProvider: "Wikipedia",
      sources: [{ title: "Evidence", url: "https://en.wikipedia.org/wiki/AI", excerpt: "Retrieved evidence.", sourceType: "encyclopedia", evidenceLevel: "page-verified", freshness: "unknown", retrievedAt: "2026-09-10T00:00:00Z" }],
    });
    const response = await request(createDefaultApp())
      .post("/api/research/v1.1/query")
      .send({ query: "人工知能の歴史について調べて" });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.provider).toBe("Wikipedia");
    expect(response.body.grounding).toBeUndefined();
    expect(researchMock).toHaveBeenCalledTimes(1);
    expect(researchMock).toHaveBeenCalledWith("人工知能の歴史について調べて");
  });

  it("fails closed with 503 RESEARCH_SOURCE_UNAVAILABLE and no grounding fields", async () => {
    researchMock.mockResolvedValue({
      ok: false,
      sources: [],
      failure: { stage: "encyclopedia-search", code: "NO_RESULTS" },
    });
    const response = await request(createDefaultApp())
      .post("/api/research/v1.1/query")
      .send({ query: "今日のニュースを要約して" });
    expect(response.status).toBe(503);
    expect(response.body.ok).toBe(false);
    expect(response.body.code).toBe("RESEARCH_SOURCE_UNAVAILABLE");
    expect(response.body.groundingFailure).toBeUndefined();
    expect(researchMock).toHaveBeenCalledTimes(1);
  });
});
