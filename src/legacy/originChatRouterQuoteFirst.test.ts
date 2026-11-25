import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import type { OriginResearchSource } from "./originResearchSource";

// Quote-first generation contract, router level: the production chat
// path must (a) add the quote registry + contract to the synthesis
// request only when ORIGIN_QUOTE_FIRST_MODE is shadow/enforce, (b)
// never deliver the scaffold section, and (c) in enforce, deliver the
// answer without the unit that rests on an unquoted stale sentence.
// The fake synthesis executor behaves like a compliant model: it
// echoes registry lines from the request it actually received, so a
// missing registry makes the test fail rather than silently pass.

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

const quoteSources: OriginResearchSource[] = [
  {
    title: "金融政策決定会合の結果について",
    url: "https://www.boj.or.jp/mopo/result.htm",
    excerpt: "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定し、公開情報として公表しました。2026年6月時点では、無担保コール翌日物は1.0%程度でした。",
    sourceType: "web-search",
    domain: "boj.or.jp",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-19T00:00:00.000Z",
    freshness: "recent",
  },
  {
    title: "日銀の金融政策に市場の注目",
    url: "https://news.example.jp/boj",
    excerpt: "公開情報によると、政策金利の動向に市場の注目が集まっています。",
    sourceType: "web-search",
    domain: "news.example.jp",
    rank: 2,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-19T00:00:00.000Z",
    freshness: "recent",
  },
];

interface CapturedRequest {
  content: string;
  systemInstruction: string;
}

/** Echo the registry lines for the given fragments, exactly as printed in the request. */
function registryLines(content: string, fragments: string[]): string[] {
  const lines = content.split("\n").filter((line) => /^Q\d+ \[S\d+\]\(https:\/\/[^)]+\): 「.*」$/.test(line));
  return fragments.map((fragment) => {
    const line = lines.find((candidate) => candidate.includes(fragment));
    if (!line) throw new Error(`registry line not found in request: ${fragment}`);
    return line;
  });
}

function compliantSynthesis(captured: CapturedRequest[], extraStaleUnit: boolean): OriginChatExecutor {
  return vi.fn().mockImplementation(async (req: { messages: Array<{ content: string }>; systemInstruction: string }) => {
    const content = req.messages[req.messages.length - 1]?.content ?? "";
    captured.push({ content, systemInstruction: req.systemInstruction });
    const scaffold = registryLines(content, ["1.25%程度に引き上げる", "市場の注目が集まっています"]);
    const text = [
      "## 根拠引用",
      ...scaffold,
      "## 結論",
      "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定し、公開情報として公表しました。[S1](https://www.boj.or.jp/mopo/result.htm)",
      "## 根拠",
      ...(extraStaleUnit
        ? ["現在の政策金利は1.0%程度です。[S1](https://www.boj.or.jp/mopo/result.htm)"]
        : []),
      "公開情報によると、政策金利の動向に市場の注目が集まっています。[S2](https://news.example.jp/boj)",
      "## 出典",
      "boj.or.jp・公開日不明 [S1](https://www.boj.or.jp/mopo/result.htm)",
      "news.example.jp・公開日不明 [S2](https://news.example.jp/boj)",
    ].join("\n");
    return { ...executionResult, text };
  }) as unknown as OriginChatExecutor;
}

function plainSynthesis(captured: CapturedRequest[]): OriginChatExecutor {
  return vi.fn().mockImplementation(async (req: { messages: Array<{ content: string }>; systemInstruction: string }) => {
    const content = req.messages[req.messages.length - 1]?.content ?? "";
    captured.push({ content, systemInstruction: req.systemInstruction });
    const text = [
      "## 結論",
      "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定し、公開情報として公表しました。[S1](https://www.boj.or.jp/mopo/result.htm)",
      "## 根拠",
      "公開情報によると、政策金利の動向に市場の注目が集まっています。[S2](https://news.example.jp/boj)",
      "## 出典",
      "boj.or.jp・公開日不明 [S1](https://www.boj.or.jp/mopo/result.htm)",
      "news.example.jp・公開日不明 [S2](https://news.example.jp/boj)",
    ].join("\n");
    return { ...executionResult, text };
  }) as unknown as OriginChatExecutor;
}

/** A source pool whose packet holds no answer-bearing sentence: the registry stays empty. */
const aboutSources: OriginResearchSource[] = [
  {
    title: "会社概要",
    url: "https://example.jp/about",
    excerpt: "ホーム 会社概要 アクセス 採用情報",
    sourceType: "web-search",
    domain: "example.jp",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-19T00:00:00.000Z",
    freshness: "recent",
  },
];

function aboutSynthesis(captured: CapturedRequest[]): OriginChatExecutor {
  return vi.fn().mockImplementation(async (req: { messages: Array<{ content: string }>; systemInstruction: string }) => {
    const content = req.messages[req.messages.length - 1]?.content ?? "";
    captured.push({ content, systemInstruction: req.systemInstruction });
    const text = [
      "## 結論",
      "会社概要のページが取得できました。[S1](https://example.jp/about)",
      "## 根拠",
      "会社概要のページです。[S1](https://example.jp/about)",
      "## 出典",
      "example.jp・公開日不明 [S1](https://example.jp/about)",
    ].join("\n");
    return { ...executionResult, text };
  }) as unknown as OriginChatExecutor;
}

function createChatApp(
  env: Record<string, string>,
  researchSynthesis: OriginChatExecutor,
  sources: OriginResearchSource[] = quoteSources,
) {
  const research = vi.fn().mockResolvedValue({
    ok: true,
    searchProvider: "Tavily",
    sources,
  }) as unknown as OriginResearchExecutor;
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key", ...env },
    execute: vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor,
    research,
    researchSynthesis,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-quote-first-trace",
  }));
  return app;
}

const QUESTION = { messages: [{ role: "user", content: "今日の公開情報を調査してください" }] };

const ENGAGEMENT_LOG_MESSAGE = "[origin-chat] research synthesis quote-first engagement";

function engagementPayloads(infoSpy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return infoSpy.mock.calls
    .filter((call) => call[0] === ENGAGEMENT_LOG_MESSAGE)
    .map((call) => call[1] as Record<string, unknown>);
}

describe("chat router quote-first wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("off (switch unset): the request carries no registry or contract and the answer is unchanged", async () => {
    const captured: CapturedRequest[] = [];
    const response = await request(createChatApp({}, plainSynthesis(captured)))
      .post("/api/chat")
      .send(QUESTION);
    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0].content).not.toContain("引用レジストリ");
    expect(captured[0].systemInstruction).not.toContain("quote-first");
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.content).toContain("1.25%程度に引き上げる");
  });

  it("shadow: registry + contract reach the model, the scaffold is never delivered, the answer is adopted as-is", async () => {
    const captured: CapturedRequest[] = [];
    const response = await request(createChatApp(
      { ORIGIN_QUOTE_FIRST_MODE: "shadow" },
      compliantSynthesis(captured, false),
    )).post("/api/chat").send(QUESTION);
    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0].content).toContain("引用レジストリ（quote-first）");
    expect(captured[0].content).toContain("Q1 [S1](https://www.boj.or.jp/mopo/result.htm)");
    expect(captured[0].systemInstruction).toContain("追加の契約（quote-first生成）");
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.content).not.toContain("根拠引用");
    expect(response.body.content).toContain("1.25%程度に引き上げる");
    expect(response.body.routing.synthesisSalvaged).toBeUndefined();
  });

  it("enforce: the unit resting on the unquoted stale sentence is removed before delivery", async () => {
    const captured: CapturedRequest[] = [];
    const response = await request(createChatApp(
      { ORIGIN_QUOTE_FIRST_MODE: "enforce" },
      compliantSynthesis(captured, true),
    )).post("/api/chat").send(QUESTION);
    expect(response.status).toBe(200);
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.content).not.toContain("現在の政策金利は1.0%程度です");
    expect(response.body.content).not.toContain("根拠引用");
    expect(response.body.content).toContain("1.25%程度に引き上げる");
    // Delivered removals surface through the existing salvage fields,
    // including the partial-answer disclosure.
    expect(response.body.routing.synthesisSalvaged).toBe(true);
    expect(response.body.routing.synthesisSalvageRemovedUnits).toBe(1);
    expect(response.body.answer.limitations).toContain("この回答は確認できた範囲のみを示しており、確認できなかった部分は含めていません。");
  });

  it("off: no engagement record is emitted (the observation stays out of off requests entirely)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const captured: CapturedRequest[] = [];
    const response = await request(createChatApp({}, plainSynthesis(captured)))
      .post("/api/chat")
      .send(QUESTION);
    expect(response.status).toBe(200);
    expect(engagementPayloads(infoSpy)).toEqual([]);
  });

  it("shadow: the engagement record names the mode and the registry the model was given", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const captured: CapturedRequest[] = [];
    const response = await request(createChatApp(
      { ORIGIN_QUOTE_FIRST_MODE: "shadow" },
      compliantSynthesis(captured, false),
    )).post("/api/chat").send(QUESTION);
    expect(response.status).toBe(200);
    const engagements = engagementPayloads(infoSpy);
    expect(engagements).toHaveLength(1);
    expect(engagements[0]).toMatchObject({
      requestId: "origin-quote-first-trace",
      quoteFirstMode: "shadow",
      quoteFirstEngaged: true,
      quoteFirstRegistrySources: 2,
    });
    expect(engagements[0].quoteFirstRegistryQuotes).toBeGreaterThanOrEqual(2);
    // The record is counts and codes only: no quote text rides it.
    expect(JSON.stringify(engagements[0])).not.toContain("1.25%");
  });

  it("shadow with an empty registry: recorded as not engaged, and the request stays exactly as off", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const captured: CapturedRequest[] = [];
    const response = await request(createChatApp(
      { ORIGIN_QUOTE_FIRST_MODE: "shadow" },
      aboutSynthesis(captured),
      aboutSources,
    )).post("/api/chat").send(QUESTION);
    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0].content).not.toContain("引用レジストリ");
    expect(captured[0].systemInstruction).not.toContain("quote-first");
    const engagements = engagementPayloads(infoSpy);
    expect(engagements).toHaveLength(1);
    expect(engagements[0]).toMatchObject({
      quoteFirstMode: "shadow",
      quoteFirstEngaged: false,
      quoteFirstRegistryQuotes: 0,
      quoteFirstRegistrySources: 0,
    });
  });
});
