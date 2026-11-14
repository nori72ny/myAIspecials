import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

// Feedback retry, router level (SYNTHESIS_RETRY_DESIGN_2026-11-14 §2):
// both routers route a rejected synthesis through the SAME shared helper
// (executeGroundedResearchSynthesisWithRetry in the V12 module) for at
// most one corrective retry before falling back. These tests pin the
// rescue, the still-failing fallback, the kill switch, and the
// salvage-first ordering on the chat router, plus the rescue on the
// research router.

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

const retrySources: OriginResearchSource[] = [
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

// Four uncited units: the salvage aborts (max 3 removals), so only the
// feedback retry can rescue this shape.
const FAILING_TEXT = [
  "内閣総理大臣は高市早苗氏です [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
  "補足文その1です",
  "記者会見も行われました [S2](https://www.nhk.or.jp/politics/articles/1.html)",
  "補足文その2です",
  "補足文その3です",
  "補足文その4です",
].join("\n");

const VALID_TEXT = [
  "首相官邸のページでは高市早苗が内閣総理大臣として示されています [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
  "記者会見も行われました [S2](https://www.nhk.or.jp/politics/articles/1.html)",
].join("\n");

function createChatApp(researchSynthesis: OriginChatExecutor, env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: "synthetic-test-key" }) {
  const research = vi.fn().mockResolvedValue({
    ok: true,
    searchProvider: "Tavily",
    sources: retrySources,
  }) as unknown as OriginResearchExecutor;
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env,
    execute: vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor,
    research,
    researchSynthesis,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-retry-trace",
  }));
  return app;
}

describe("chat router synthesis feedback retry", () => {
  it("rescues a synthesis the salvage could not save, and records the retry in routing", async () => {
    const synthesis = vi.fn()
      .mockResolvedValueOnce({ ...executionResult, text: FAILING_TEXT })
      .mockResolvedValueOnce({ ...executionResult, text: VALID_TEXT }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(VALID_TEXT);
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.synthesisRetried).toBe(true);
    expect(response.body.routing.synthesisSalvaged).toBeUndefined();
    // Exactly one initial call + exactly one retry.
    expect(synthesis).toHaveBeenCalledTimes(2);
    // The retry reuses the initial plan and the identical system
    // instruction; only the user message gains the feedback section.
    const calls = (synthesis as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]?.[0].plan).toBe(calls[0]?.[0].plan);
    expect(calls[1]?.[0].systemInstruction).toBe(calls[0]?.[0].systemInstruction);
    expect(calls[1]?.[0].messages[0].content).toContain("前回の回答と検証結果");
    expect(calls[1]?.[0].messages[0].content).toContain("補足文その4です");
    expect(calls[0]?.[0].messages[0].content).not.toContain("前回の回答と検証結果");
  });

  it("falls back to the partial answer with the first failure code when the retry also fails", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: FAILING_TEXT }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.routing.synthesisStatus).toBe("citation-validation-failed");
    expect(response.body.routing.synthesisFailureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(response.body.content).toBe(buildGroundedResearchPartialAnswer(retrySources, "ja"));
    expect(response.body.content).not.toContain("補足文");
    // The retry fired exactly once before the fallback.
    expect(synthesis).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the kill switch ORIGIN_SYNTHESIS_RETRY_ENABLED is off", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: FAILING_TEXT }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(synthesis, {
      OPENROUTER_API_KEY: "synthetic-test-key",
      ORIGIN_SYNTHESIS_RETRY_ENABLED: "false",
    }))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.routing.synthesisStatus).toBe("citation-validation-failed");
    expect(response.body.content).toBe(buildGroundedResearchPartialAnswer(retrySources, "ja"));
    expect(synthesis).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the salvage already adopted the synthesis", async () => {
    const salvageableText = [
      "現在の内閣総理大臣は高市早苗です。",
      ...VALID_TEXT.split("\n"),
    ].join("\n");
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: salvageableText }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(VALID_TEXT);
    expect(response.body.routing.synthesisSalvaged).toBe(true);
    expect(response.body.routing.synthesisRetried).toBeUndefined();
    expect(synthesis).toHaveBeenCalledTimes(1);
  });
});

describe("research router synthesis feedback retry", () => {
  const iphoneSources = [
    { title: "iPhone 18 Pro 発表 - Apple Newsroom", url: "https://www.apple.com/jp/newsroom/iphone18", excerpt: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。", domain: "apple.com", rank: 1, sourceType: "web-search" as const, evidenceLevel: "page-verified" as const, retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "recent" as const, revisionTimestamp: "2026-09-10T00:00:00.000Z" },
    { title: "iPhone価格まとめ", url: "https://example.jp/iphone", excerpt: "iPhone 18 Proの価格は219,800円と報じられています。", domain: "example.jp", rank: 2, sourceType: "web-search" as const, evidenceLevel: "snippet" as const, retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "unknown" as const },
  ];
  const iphoneQuery = "iPhone の最新モデルの、日本での価格と発売日を教えてください";

  it("rescues a synthesis rejected for an unsupported number, through the same helper", async () => {
    researchMock.mockReset();
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    const failingText = [
      "iPhone 18 Proは99,800円です。[S1](https://www.apple.com/jp/newsroom/iphone18)",
      "発売日は2026年9月18日です。[S1](https://www.apple.com/jp/newsroom/iphone18) [S2](https://example.jp/iphone)",
    ].join("\n");
    const validText = [
      "価格は219,800円です。[S1](https://www.apple.com/jp/newsroom/iphone18)",
      "発売日は2026年9月18日です。[S1](https://www.apple.com/jp/newsroom/iphone18) [S2](https://example.jp/iphone)",
    ].join("\n");
    const synthesis = vi.fn()
      .mockResolvedValueOnce({ ...executionResult, text: failingText })
      .mockResolvedValueOnce({ ...executionResult, text: validText });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      researchSynthesis: synthesis as unknown as OriginResearchSynthesisExecutor,
      catalogNow: () => verifiedCatalogTime,
    }));
    const response = await request(app).post("/api/chat")
      .send({ messages: [{ role: "user", content: iphoneQuery }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(validText);
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.synthesisRetried).toBe(true);
    expect(response.body.research.synthesis).toEqual({ status: "citation-validated", sourceCount: 2, retried: true });
    expect(synthesis).toHaveBeenCalledTimes(2);
    // The feedback names the unsupported price token from the first text.
    const retryContent = synthesis.mock.calls[1]?.[0].messages[0].content as string;
    expect(retryContent).toContain("前回の回答と検証結果");
    expect(retryContent).toContain("99,800円");
  });

  it("degrades to the extractive report when the retry also fails", async () => {
    researchMock.mockReset();
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    const failingText = "iPhone 18 Proは99,800円です。[S9](https://fake.example/x)";
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: failingText });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      researchSynthesis: synthesis as unknown as OriginResearchSynthesisExecutor,
      catalogNow: () => verifiedCatalogTime,
    }));
    const response = await request(app).post("/api/chat")
      .send({ messages: [{ role: "user", content: iphoneQuery }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toContain("出典付き調査レポート（抽出方式）");
    expect(response.body.content).not.toContain("99,800円です");
    expect(response.body.research.synthesis).toEqual({ status: "citation-validation-failed", failureCode: "UNKNOWN_CITATION" });
    expect(synthesis).toHaveBeenCalledTimes(2);
  });
});

describe("shared helper wiring", () => {
  it("both routers import the same retry helper from the V12 module", () => {
    const chatRouter = readFileSync(resolve(process.cwd(), "src/legacy/originChatRouter.ts"), "utf8");
    const researchRouter = readFileSync(resolve(process.cwd(), "src/legacy/originResearchRouter.ts"), "utf8");
    for (const routerSource of [chatRouter, researchRouter]) {
      expect(routerSource).toContain("executeGroundedResearchSynthesisWithRetry");
      expect(routerSource).toContain("../research/groundedResearchSynthesisV12.js");
    }
  });
});
