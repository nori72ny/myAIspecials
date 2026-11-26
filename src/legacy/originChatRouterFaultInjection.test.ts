import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { buildGroundedResearchAbstainAnswer } from "../research/groundedResearchOutcome";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import { OriginProviderError, type OriginProviderErrorCode } from "./originProviderClient";
import type { GroundedResearchSynthesisProviderRetryExecutor } from "./originRecordsRetryRoute";
import type { OriginResearchResult, OriginResearchSource } from "./originResearchSource";
import { createOriginResearchRouter, type OriginResearchSynthesisExecutor } from "./originResearchRouter";

// Fault injection for the answer-quality floor (CONSULT_ADOPTION_DESIGN
// 2026-11-17 §6.2, N-6): the fallback tiers (extractive / source-list /
// grounded hold) are only reached when the synthesis stage fails, so
// ordinary tests never exercise them. Here the synthesis executor and the
// research executor are forced into the failure shapes the 2026-11-17
// re-measurement actually produced — provider rate limited (16 cases,
// T-1), synthesis empty (the F-12 compound case, T-8), grounding
// unavailable (F-13) — and the landing is pinned: a non-empty, honest
// answer body every time, never an empty 200.
//
// Assertions deliberately stick to invariants that survive the R-1
// extractive-fallback change (the fallback lead, the source list, and the
// routing status/code), so this suite does not need rewriting when the
// fallback body gains verbatim excerpts.

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

const faultSources: OriginResearchSource[] = [
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
];

const researchOk = vi.fn().mockResolvedValue({
  ok: true,
  searchProvider: "Tavily",
  sources: faultSources,
}) as unknown as OriginResearchExecutor;

function createChatApp(research: OriginResearchExecutor, researchSynthesis: OriginChatExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor,
    research,
    researchSynthesis,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-fault-injection",
  }));
  return app;
}

const FALLBACK_LEAD = "要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします";

function expectSourceListFallback(body: { content: string; routing: Record<string, unknown> }) {
  expect(body.content.length).toBeGreaterThan(0);
  expect(body.content).toContain(FALLBACK_LEAD);
  expect(body.content).toContain("## 確認できた範囲");
  // Sources-display redesign (2026-11-20): the sources ride as cards
  // (heading + linked title) instead of a separate 出典 list.
  expect(body.content).toContain("### S1 ·");
  expect(body.content).not.toContain("## 出典");
  for (const source of faultSources) expect(body.content).toContain(source.url);
  expect(body.routing.freeOnly).toBe(true);
  expect(body.routing.cost).toBe(0);
  // Ladder landing (N-1): the extractive fallback is tier T3 with the
  // three-valued outcome PARTIAL, never an abstain.
  expect(body.routing.researchTier).toBe("T3");
  expect(body.routing.researchOutcome).toBe("PARTIAL");
  expect(body.routing.researchAbstainReason).toBeUndefined();
}

describe("fault injection: synthesis provider unavailable (chat router)", () => {
  it.each([
    ["PROVIDER_RATE_LIMITED", 429],
    ["PROVIDER_TIMEOUT", 504],
    ["PROVIDER_INVALID_RESPONSE", 502],
  ] as Array<[OriginProviderErrorCode, number]>)(
    "lands on the source-list fallback, never an empty answer, when synthesis throws %s",
    async (code, status) => {
      const synthesis = vi.fn().mockRejectedValue(
        new OriginProviderError(code, "internal", status, true),
      ) as unknown as OriginChatExecutor;
      const response = await request(createChatApp(researchOk, synthesis))
        .post("/api/chat")
        .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
      expect(response.status).toBe(200);
      expectSourceListFallback(response.body);
      expect(response.body.routing.synthesisStatus).toBe("provider-failed");
      expect(response.body.routing.synthesisFailureCode).toBe(code);
      // A provider failure is not retried inside the synthesis stage; the
      // fallback is the landing, exactly once.
      expect(synthesis).toHaveBeenCalledTimes(1);
    },
  );

  it("maps a non-provider error to PROVIDER_INTERNAL_ERROR and still lands on the fallback", async () => {
    const synthesis = vi.fn().mockRejectedValue(new Error("unexpected boom")) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(researchOk, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expectSourceListFallback(response.body);
    expect(response.body.routing.synthesisStatus).toBe("provider-failed");
    expect(response.body.routing.synthesisFailureCode).toBe("PROVIDER_INTERNAL_ERROR");
  });
});

describe("fault injection: synthesis returns an empty answer (chat router)", () => {
  it("discards the empty synthesis (EMPTY_SYNTHESIS) and lands on the fallback instead of an empty 200", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: "" }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(researchOk, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expectSourceListFallback(response.body);
    expect(response.body.routing.synthesisStatus).toBe("citation-validation-failed");
    expect(response.body.routing.synthesisFailureCode).toBe("EMPTY_SYNTHESIS");
  });
});

describe("fault injection: grounding unavailable (chat router)", () => {
  it("answers with the could-not-confirm hold, not a guess and not an empty body, when research fails", async () => {
    const research = vi.fn().mockResolvedValue({
      ok: false,
      sources: [],
      failure: { stage: "web-search", code: "NETWORK_FAILURE" },
    }) as unknown as OriginResearchExecutor;
    const synthesis = vi.fn() as unknown as OriginChatExecutor;
    const response = await request(createChatApp(research, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    // Tier-T4 hold text (N-1): names what was searched and the concrete
    // reason (the retrieval itself failed), instead of a fixed template.
    expect(response.body.content).toBe(buildGroundedResearchAbstainAnswer({
      query: "今日の公開情報を調査してください",
      language: "ja",
      reason: "provider-error",
    }));
    expect(response.body.content).toContain("出典を確認できませんでした");
    expect(response.body.routing.sourceCount).toBe(0);
    expect(response.body.routing.synthesisStatus).toBe("not-run");
    expect(response.body.routing.researchTier).toBe("T4");
    expect(response.body.routing.researchOutcome).toBe("ABSTAIN");
    expect(response.body.routing.researchAbstainReason).toBe("provider-error");
    expect(synthesis).not.toHaveBeenCalled();
  });

  it("answers with the grounding-unavailable hold when the search ran but produced no usable sources", async () => {
    const research = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "Tavily",
      sources: [],
      groundingFailure: "no-fresh-sources",
    }) as unknown as OriginResearchExecutor;
    const synthesis = vi.fn() as unknown as OriginChatExecutor;
    const response = await request(createChatApp(research, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    // Tier-T4 hold text (N-1): the reason is concrete — sources existed
    // but none was fresh enough — not the former fixed template.
    expect(response.body.content).toBe(buildGroundedResearchAbstainAnswer({
      query: "今日の公開情報を調査してください",
      language: "ja",
      reason: "no-fresh-sources",
    }));
    expect(response.body.content).toContain("古い情報を現在の情報として示すことはしませんでした");
    expect(response.body.content.length).toBeGreaterThan(0);
    expect(response.body.routing.sourceCount).toBe(0);
    expect(response.body.routing.researchTier).toBe("T4");
    expect(response.body.routing.researchOutcome).toBe("ABSTAIN");
    expect(response.body.routing.researchAbstainReason).toBe("no-fresh-sources");
    expect(synthesis).not.toHaveBeenCalled();
  });
});

type PhasedEvent =
  | { type: "phase"; phase: string }
  | { type: "sources"; sources: Array<{ title: string; domain: string }> }
  | { type: "delta"; text: string }
  | { type: "complete" }
  | { type: "error"; code?: string };

function parsePhasedStream(text: string): { events: PhasedEvent[]; doneSeen: boolean } {
  const events: PhasedEvent[] = [];
  let doneSeen = false;
  for (const block of text.split("\n\n")) {
    const line = block.trim();
    if (!line) continue;
    expect(line.startsWith("data:")).toBe(true);
    const raw = line.slice("data:".length).trim();
    if (raw === "[DONE]") { doneSeen = true; continue; }
    events.push(JSON.parse(raw) as PhasedEvent);
  }
  return { events, doneSeen };
}

function deltaText(events: PhasedEvent[]): string {
  return events.filter((event) => event.type === "delta").map((event) => (event as { text: string }).text).join("");
}

describe("fault injection: phased streaming app path (chat router)", () => {
  it("streams the fallback as deltas and completes when synthesis is rate limited (F-12 empty-stream guard)", async () => {
    const synthesis = vi.fn().mockRejectedValue(
      new OriginProviderError("PROVIDER_RATE_LIMITED", "internal", 429, true),
    ) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(researchOk, synthesis))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    const { events, doneSeen } = parsePhasedStream(response.text);
    expect(doneSeen).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.filter((event) => event.type === "phase").map((event) => (event as { phase: string }).phase))
      .toEqual(expect.arrayContaining(["searching", "composing"]));
    const text = deltaText(events);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain(FALLBACK_LEAD);
    expect(text).toContain("### S1 ·");
    expect(events.some((event) => event.type === "complete")).toBe(true);
  });

  it("streams the hold message and completes when grounding finds no usable sources", async () => {
    const research = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "Tavily",
      sources: [],
      groundingFailure: "no-sources",
    }) as unknown as OriginResearchExecutor;
    const synthesis = vi.fn() as unknown as OriginChatExecutor;
    const response = await request(createChatApp(research, synthesis))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    const { events, doneSeen } = parsePhasedStream(response.text);
    expect(doneSeen).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(deltaText(events)).toBe(buildGroundedResearchAbstainAnswer({
      query: "今日の公開情報を調査してください",
      language: "ja",
      reason: "no-sources",
    }));
    expect(events.some((event) => event.type === "complete")).toBe(true);
  });
});

const researchRouterSources: OriginResearchSource[] = [
  {
    title: "iPhone 18 Pro 発表 - Apple Newsroom",
    url: "https://www.apple.com/jp/newsroom/iphone18",
    excerpt: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。",
    sourceType: "web-search",
    domain: "apple.com",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-07T00:00:00.000Z",
    freshness: "recent",
  },
  {
    title: "iPhone価格まとめ",
    url: "https://example.jp/iphone",
    excerpt: "iPhone 18 Proの価格は219,800円と報じられています。",
    sourceType: "web-search",
    domain: "example.jp",
    rank: 2,
    evidenceLevel: "snippet",
    retrievedAt: "2026-11-07T00:00:00.000Z",
    freshness: "unknown",
  },
];

function createResearchApp(research: (query: string) => Promise<OriginResearchResult>, researchSynthesis: OriginResearchSynthesisExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginResearchRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    research,
    researchSynthesis,
    catalogNow: () => verifiedCatalogTime,
  }));
  return app;
}

describe("fault injection: research router (extractive tier)", () => {
  it("retains the deterministic extractive report when synthesis is rate limited", async () => {
    const research = vi.fn().mockResolvedValue({ ok: true, searchProvider: "DuckDuckGo", sources: researchRouterSources });
    const synthesis = vi.fn().mockRejectedValue(
      new OriginProviderError("PROVIDER_RATE_LIMITED", "internal", 429, true),
    ) as unknown as OriginResearchSynthesisExecutor;
    const response = await request(createResearchApp(research, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "iPhone の最新モデルの、日本での価格と発売日を教えてください" }] });
    expect(response.status).toBe(200);
    expect(response.body.content.length).toBeGreaterThan(0);
    expect(response.body.content).toContain("出典付き調査レポート（抽出方式）");
    // The extractive tier is the deterministic report: retrieved excerpts
    // are shown verbatim with their sources, never invented text.
    expect(response.body.content).toContain("219,800円");
    expect(response.body.routing.synthesisStatus).toBe("provider-failed");
    expect(response.body.research.synthesis).toEqual({
      status: "provider-failed",
      failureCode: "PROVIDER_RATE_LIMITED",
      // Round-5 measure 5-2b: this router now runs the provider
      // retry layer too; with no free route configured in this
      // env it skips at the last stage, and the skip is recorded.
      providerRetrySkipDetail: "groq-not-configured",
    });
  });

  it("fails explicitly with 503 RESEARCH_SOURCE_UNAVAILABLE (never an empty 200) when research itself is unavailable", async () => {
    const research = vi.fn().mockResolvedValue({
      ok: false,
      sources: [],
      failure: { stage: "web-search", code: "NETWORK_FAILURE" },
      fallback: "none",
    });
    const synthesis = vi.fn() as unknown as OriginResearchSynthesisExecutor;
    const response = await request(createResearchApp(research, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "iPhone の最新モデルの、日本での価格と発売日を教えてください" }] });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("RESEARCH_SOURCE_UNAVAILABLE");
    expect(typeof response.body.message).toBe("string");
    expect(response.body.message.length).toBeGreaterThan(0);
    expect(response.body.research.status).toBe("unavailable");
    expect(synthesis).not.toHaveBeenCalled();
  });
});

describe("fault injection: K-06 plan A (provider retry + deterministic reconstruction)", () => {
  const RETRY_VALID_TEXT = [
    "首相官邸のページでは高市早苗が内閣総理大臣として示されています [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
    "記者会見も行われました [S2](https://www.nhk.or.jp/politics/articles/1.html)",
  ].join("\n");

  function createPlanAChatApp(
    research: OriginResearchExecutor,
    researchSynthesis: OriginChatExecutor,
    researchSynthesisProviderRetry?: GroundedResearchSynthesisProviderRetryExecutor,
  ) {
    const app = express();
    app.use(express.json());
    app.use(createOriginChatRouter({
      env: { OPENROUTER_API_KEY: "synthetic-test-key" },
      execute: vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor,
      research,
      researchSynthesis,
      researchSynthesisProviderRetry,
      now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
      catalogNow: () => verifiedCatalogTime,
      createRequestId: () => "origin-fault-injection-plan-a",
    }));
    return app;
  }

  it("adopts the synthesis when the provider-failure retry succeeds on another route (429 → retry → adopted)", async () => {
    const synthesis = vi.fn().mockRejectedValue(
      new OriginProviderError("PROVIDER_RATE_LIMITED", "internal", 429, true),
    ) as unknown as OriginChatExecutor;
    const providerRetry = vi.fn().mockResolvedValue({
      kind: "executed",
      route: 3,
      result: { ...executionResult, text: RETRY_VALID_TEXT },
    }) as unknown as GroundedResearchSynthesisProviderRetryExecutor;
    const response = await request(createPlanAChatApp(researchOk, synthesis, providerRetry))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    // The retried execution's text goes through the unchanged
    // adoption gate and is delivered as the tier-T0 answer.
    expect(response.body.content).toBe(RETRY_VALID_TEXT);
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.researchTier).toBe("T0");
    expect(response.body.routing.synthesisProviderRetried).toBe(true);
    expect(response.body.routing.synthesisProviderRetryRoute).toBe(3);
    // Exactly one initial execution and one retry execution.
    expect(synthesis).toHaveBeenCalledTimes(1);
    expect(providerRetry).toHaveBeenCalledTimes(1);
    const retryError = (providerRetry as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as OriginProviderError;
    expect(retryError).toBeInstanceOf(OriginProviderError);
    expect(retryError.code).toBe("PROVIDER_RATE_LIMITED");
  });

  it("records every tried route in the routing when the provider retry also fails (round-5 measure 5-2a)", async () => {
    // The round-5 measurement shape: the initial dispatch failed on
    // route 2, the different-route retry executed on route 3 and
    // failed there too. Before measure 5-2a the landing carried
    // providerRouting null and NO attempt record — the failure
    // could not be attributed to a route or a model from the
    // response at all.
    const initialError = new OriginProviderError("PROVIDER_RATE_LIMITED", "internal", 429, true, undefined, {
      failoverAttempts: [{
        providerId: "cloudflare-workers-ai-free",
        modelId: "@cf/google/gemma-4-26b-a4b-it",
        outcome: "availability-error",
        errorCode: "PROVIDER_RATE_LIMITED",
        transportRequestCount: 1,
      }],
    });
    const synthesis = vi.fn().mockRejectedValue(initialError) as unknown as OriginChatExecutor;
    const providerRetry = vi.fn().mockResolvedValue({
      kind: "failed",
      route: 3,
      errorCode: "PROVIDER_RATE_LIMITED",
    }) as unknown as GroundedResearchSynthesisProviderRetryExecutor;
    const response = await request(createPlanAChatApp(researchOk, synthesis, providerRetry))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    // The landing is unchanged: the standing fallback, provider-failed.
    expectSourceListFallback(response.body);
    expect(response.body.routing.synthesisStatus).toBe("provider-failed");
    expect(response.body.routing.synthesisProviderRetryFailed).toBe(true);
    // …but the attempts are now in the response: the initial
    // dispatch's route-2 attempt, then the retry's route-3 attempt.
    expect(response.body.routing.synthesisProviderAttempts).toEqual([
      {
        providerId: "cloudflare-workers-ai-free",
        modelId: "@cf/google/gemma-4-26b-a4b-it",
        outcome: "availability-error",
        errorCode: "PROVIDER_RATE_LIMITED",
        transportRequestCount: 1,
      },
      {
        providerId: "groq-free",
        modelId: "openai/gpt-oss-120b",
        outcome: "failed",
        errorCode: "PROVIDER_RATE_LIMITED",
      },
    ]);
  });

  it("answers with verbatim source sentences only when synthesis is rejected and the reconstruction establishes", async () => {
    const vegaSources: OriginResearchSource[] = [
      {
        title: "新型スマートフォン Vega X1 発表",
        url: "https://example.com/vega-x1",
        excerpt: "Vega X1は2026年12月4日に発売されます。価格は税込89,800円です。",
        sourceType: "web-search",
        domain: "example.com",
        rank: 1,
        evidenceLevel: "page-verified",
        retrievedAt: "2026-11-14T03:00:00.000Z",
        freshness: "recent",
      },
      {
        title: "Vega X1 価格まとめ",
        url: "https://example.net/vega",
        excerpt: "Vega X1の価格は89,800円と発表されています。",
        sourceType: "web-search",
        domain: "example.net",
        rank: 2,
        evidenceLevel: "page-verified",
        retrievedAt: "2026-11-14T03:00:00.000Z",
        freshness: "recent",
      },
    ];
    const research = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "Tavily",
      sources: vegaSources,
    }) as unknown as OriginResearchExecutor;
    // An empty synthesis is a citation-validation rejection
    // (EMPTY_SYNTHESIS), never a provider failure: the provider
    // retry layer must not fire, and the feedback retry excludes it.
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: "" }) as unknown as OriginChatExecutor;
    const providerRetry = vi.fn() as unknown as GroundedResearchSynthesisProviderRetryExecutor;
    const response = await request(createPlanAChatApp(research, synthesis, providerRetry))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "Vega X1の価格と発売日を調査してください" }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.synthesisStatus).toBe("citation-validation-failed");
    expect(providerRetry).not.toHaveBeenCalled();
    // The reconstruction replaces the sources-only template: the
    // sources' own sentences, verbatim, each cited to its source —
    // and no failure lead.
    expect(response.body.routing.researchReconstruction).toBe("packet-sentences");
    expect(response.body.content).toContain("「価格は税込89,800円です。」 [S1](https://example.com/vega-x1)");
    expect(response.body.content).toContain("「Vega X1の価格は89,800円と発表されています。」 [S2](https://example.net/vega)");
    expect(response.body.content).not.toContain(FALLBACK_LEAD);
    // The landing stays the honest tier-T3 / PARTIAL.
    expect(response.body.routing.researchTier).toBe("T3");
    expect(response.body.routing.researchOutcome).toBe("PARTIAL");
  });

  it("keeps the standing sources-only template when the reconstruction does not establish", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: "" }) as unknown as OriginChatExecutor;
    const response = await request(createPlanAChatApp(researchOk, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.synthesisStatus).toBe("citation-validation-failed");
    expect(response.body.routing.researchReconstruction).toBeUndefined();
    expectSourceListFallback(response.body);
  });
});
