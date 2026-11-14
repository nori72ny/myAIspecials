import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { buildGroundedResearchPartialAnswer } from "../research/groundedResearchV11";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import { createOriginResearchRouter, type OriginResearchSynthesisExecutor } from "./originResearchRouter";
import type { OriginResearchSource } from "./originResearchSource";

// Synthesis salvage, router level (SYNTHESIS_SALVAGE_DESIGN_2026-11-14
// §6 S14/S15): S14 — a salvageable synthesis is adopted through the same
// envelope as a first-pass adoption, with the salvage counts recorded in
// routing; S15 — an aborted salvage returns exactly the synthesis-hygiene
// partial answer, with the FIRST validation code preserved.

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;

const executionResult = {
  text: "安全な確認結果です。",
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

const salvageSources: OriginResearchSource[] = [
  {
    title: "内閣総理大臣 高市 早苗 - 首相官邸ホームページ",
    url: "https://www.kantei.go.jp/jp/104/actions/index.html",
    excerpt: "抜粋マーカー1 ナビゲーション ホーム 政策 広告バナー",
    sourceType: "web-search",
    domain: "kantei.go.jp",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
  {
    title: "高市総理大臣 記者会見の概要",
    url: "https://www.nhk.or.jp/politics/articles/1.html",
    excerpt: "抜粋マーカー2 サイドバー おすすめ記事 フッター案内",
    sourceType: "web-search",
    domain: "nhk.or.jp",
    rank: 2,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
  {
    title: "内閣総理大臣の一覧",
    url: "https://ja.wikipedia.org/wiki/pm-list",
    excerpt: "抜粋マーカー3 目次 編集リンク",
    sourceType: "encyclopedia",
    domain: "ja.wikipedia.org",
    rank: 3,
    evidenceLevel: "snippet",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
  {
    title: "首相動静",
    url: "https://www.jiji.com/jc/article?k=1",
    excerpt: "抜粋マーカー4 会員登録のご案内",
    sourceType: "web-search",
    domain: "jiji.com",
    rank: 4,
    evidenceLevel: "snippet",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
];

function createChatApp(researchSynthesis: OriginChatExecutor) {
  const research = vi.fn().mockResolvedValue({
    ok: true,
    searchProvider: "Tavily",
    sources: salvageSources,
  }) as unknown as OriginResearchExecutor;
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor,
    research,
    researchSynthesis,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-salvage-trace",
  }));
  return app;
}

function synthesisReturning(text: string): OriginChatExecutor {
  return vi.fn().mockResolvedValue({ ...executionResult, text }) as unknown as OriginChatExecutor;
}

describe("chat router synthesis salvage", () => {
  it("S14: adopts a salvaged synthesis through the normal envelope and records the salvage in routing", async () => {
    const salvagedText = [
      "首相官邸のページでは高市早苗が内閣総理大臣として示されています [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
      "記者会見も行われました [S2](https://www.nhk.or.jp/politics/articles/1.html)",
    ].join("\n");
    const response = await request(createChatApp(synthesisReturning(
      ["現在の内閣総理大臣は高市早苗です。", salvagedText].join("\n"),
    ))).post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    // The delivered body is exactly the salvaged text (uncited lead removed).
    expect(response.body.content).toBe(salvagedText);
    expect(response.body.content).not.toContain("現在の内閣総理大臣は高市早苗です。");
    // Same adoption envelope shape as a first-pass adoption.
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.synthesisSourceCount).toBe(2);
    expect(response.body.routing.synthesisSalvaged).toBe(true);
    expect(response.body.routing.synthesisSalvageRemovedUnits).toBe(1);
    expect(response.body.supervisor.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "synthesis", status: "completed", citationValidated: true }),
    ]));
    expect(response.body.answer.answer).toBe(salvagedText);
  });

  it("S15: an aborted salvage returns the hygienic partial answer with the first failure code", async () => {
    // Four uncited units: the salvage removes up to MAX_REMOVE (3) and
    // then aborts, so the response must be the partial-answer fallback,
    // byte-identical to the non-salvage discard shape.
    const response = await request(createChatApp(synthesisReturning([
      "内閣総理大臣は高市早苗氏です [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
      "補足文その1です",
      "記者会見も行われました [S2](https://www.nhk.or.jp/politics/articles/1.html)",
      "補足文その2です",
      "補足文その3です",
      "補足文その4です",
    ].join("\n")))).post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.routing.synthesisStatus).toBe("citation-validation-failed");
    expect(response.body.routing.synthesisFailureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(response.body.routing.synthesisSalvaged).toBeUndefined();
    expect(response.body.content).toBe(buildGroundedResearchPartialAnswer(salvageSources, "ja"));
    expect(response.body.content).not.toContain("補足文");
    expect(response.body.content).not.toContain("照合メモ");
  });
});

describe("research router synthesis salvage", () => {
  it("adopts a salvaged synthesis and records the salvage in routing and research.synthesis", async () => {
    const iphoneSources = [
      { title: "iPhone 18 Pro 発表 - Apple Newsroom", url: "https://www.apple.com/jp/newsroom/iphone18", excerpt: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。", domain: "apple.com", rank: 1, sourceType: "web-search" as const, evidenceLevel: "page-verified" as const, retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "recent" as const, revisionTimestamp: "2026-09-10T00:00:00.000Z" },
      { title: "iPhone価格まとめ", url: "https://example.jp/iphone", excerpt: "iPhone 18 Proの価格は219,800円と報じられています。", domain: "example.jp", rank: 2, sourceType: "web-search" as const, evidenceLevel: "snippet" as const, retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "unknown" as const },
    ];
    researchMock.mockReset();
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    const salvagedText = [
      "価格は219,800円です。[S1](https://www.apple.com/jp/newsroom/iphone18)",
      "発売日は2026年9月18日です。[S1](https://www.apple.com/jp/newsroom/iphone18) [S2](https://example.jp/iphone)",
    ].join("\n");
    const synthesis = vi.fn().mockResolvedValue({
      ...executionResult,
      text: ["iPhone 18 Proの価格が発表されました。", salvagedText].join("\n"),
    });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      researchSynthesis: synthesis as unknown as OriginResearchSynthesisExecutor,
      catalogNow: () => verifiedCatalogTime,
    }));
    const response = await request(app).post("/api/chat")
      .send({ messages: [{ role: "user", content: "iPhone の最新モデルの、日本での価格と発売日を教えてください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(salvagedText);
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.synthesisSalvaged).toBe(true);
    expect(response.body.routing.synthesisSalvageRemovedUnits).toBe(1);
    expect(response.body.research.synthesis).toEqual({
      status: "citation-validated",
      sourceCount: 2,
      salvaged: true,
      salvageRemovedUnits: 1,
    });
  });
});
