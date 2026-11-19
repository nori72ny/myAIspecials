import { describe, expect, it } from "vitest";
import { ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS } from "./originSearchClassifier";
import {
  evaluateOriginSourceFreshness,
  executeOriginSearchGrounding,
  type OriginSearchGroundingDeps,
  type OriginSearchGroundingOutcome,
} from "./originSearchGrounding";
import { OriginSearchUsageCounter } from "./originSearchProviderCatalog";
import { OriginSearchTtlCache } from "./originSearchCache";
import {
  MAX_OFFICIAL_SOURCE_QUERIES,
  planOriginOfficialSourceQueries,
  resolveOriginOfficialSourceRoutingEnabled,
} from "./originOfficialSourceRouting";
import {
  searchTavilySources,
  type OriginSearchFetch,
  type OriginSearchSource,
} from "./originSearchProviders";

const NOW = Date.parse("2026-11-19T03:00:00.000Z");
const LONG_EXCERPT = "これは十分な長さの抜粋テキストです。完全失業率について説明します。".repeat(30);

/* ------------------------------------------------------------------ */
/* Switch                                                              */
/* ------------------------------------------------------------------ */

describe("resolveOriginOfficialSourceRoutingEnabled", () => {
  it("is off unless the value is exactly \"true\" (fail closed)", () => {
    expect(resolveOriginOfficialSourceRoutingEnabled(undefined)).toBe(false);
    expect(resolveOriginOfficialSourceRoutingEnabled({})).toBe(false);
    expect(resolveOriginOfficialSourceRoutingEnabled({ ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" })).toBe(true);
    expect(resolveOriginOfficialSourceRoutingEnabled({ ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "shadow" })).toBe(false);
    expect(resolveOriginOfficialSourceRoutingEnabled({ ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "enforce" })).toBe(false);
    expect(resolveOriginOfficialSourceRoutingEnabled({ ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "1" })).toBe(false);
    expect(resolveOriginOfficialSourceRoutingEnabled({ ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "TRUE" })).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Plan (measure B): the round-6 F questions as fixtures               */
/* ------------------------------------------------------------------ */

describe("planOriginOfficialSourceQueries", () => {
  // The exact question texts of the round-6 fixed set (F group +
  // E-15), so the plan is pinned against the measured failures, not
  // paraphrases of them.
  const cases: Array<{ question: string; topic: string; domains: string[] }> = [
    { question: "日本銀行の金融政策で操作の対象にしている金利は何ですか？", topic: "monetary-policy", domains: ["boj.or.jp"] },
    { question: "現在の日本の内閣総理大臣は誰ですか？", topic: "cabinet", domains: ["kantei.go.jp"] },
    { question: "日銀の政策金利は今いくつですか？いつ決まったものですか？", topic: "monetary-policy", domains: ["boj.or.jp"] },
    { question: "レギュラーガソリンの全国平均価格は今いくらくらいですか？", topic: "fuel-prices", domains: ["enecho.meti.go.jp"] },
    { question: "最新の有効求人倍率を教えてください。いつの分ですか？", topic: "employment-and-pension", domains: ["mhlw.go.jp"] },
    { question: "最新の完全失業率を教えてください。いつの分ですか？", topic: "labour-force-statistics", domains: ["stat.go.jp", "e-stat.go.jp"] },
    { question: "日本の総人口の最新の推計値と、その基準日を教えてください。", topic: "population-statistics", domains: ["stat.go.jp", "e-stat.go.jp"] },
    { question: "今年度の国民年金保険料は月額いくらですか？", topic: "employment-and-pension", domains: ["mhlw.go.jp"] },
    { question: "直近の国政選挙（衆院選・参院選いずれか近い方）はいつ行われ、結果はどうでしたか？", topic: "elections", domains: ["soumu.go.jp"] },
    { question: "直近に公表された日本の実質GDP成長率（四半期）を教えてください。", topic: "gdp-and-economy", domains: ["esri.cao.go.jp", "cao.go.jp"] },
  ];
  for (const { question, topic, domains } of cases) {
    it(`plans ${topic} for: ${question}`, () => {
      const plan = planOriginOfficialSourceQueries(question);
      expect(plan).not.toBeNull();
      expect(plan?.queries).toHaveLength(1);
      expect(plan?.queries[0]?.topic).toBe(topic);
      expect(plan?.queries[0]?.domains).toEqual(domains);
    });
  }

  it("plans nothing for F questions with no curated official topic", () => {
    // F-02 (都知事), F-09/F-10 (sports winners), F-11/F-13 (product
    // versions), F-12 (product price): value questions, but no topic
    // in the map — the ordinary routes already reach their official
    // vendor domains, and inventing a map entry is out of bounds.
    for (const question of [
      "現在の東京都知事は誰ですか？",
      "プロ野球の日本シリーズで優勝した直近のチームはどこですか？",
      "箱根駅伝の直近の優勝校はどこですか？",
      "Nintendo Switchの後継機の、現在の正式名称と発売状況を教えてください。",
      "GoogleのPixelの最新モデルの日本の価格を教えてください。",
      "Windowsの現在の最新バージョンを教えてください。",
    ]) {
      expect(planOriginOfficialSourceQueries(question)).toBeNull();
    }
  });

  it("plans nothing for non-value question types", () => {
    for (const question of [
      "国民幸福手当という制度はありますか？申請方法も教えてください。",
      "失業保険の受給手続きの手順を教えてください。",
      "100円の切手を3枚買うといくらかかりますか？計算してください。",
      "日本の首都はどこですか？",
    ]) {
      expect(planOriginOfficialSourceQueries(question)).toBeNull();
    }
  });

  it("caps additional queries at MAX_OFFICIAL_SOURCE_QUERIES, in topic priority order", () => {
    const plan = planOriginOfficialSourceQueries(
      "日銀の政策金利と完全失業率と実質GDP成長率を教えてください。",
    );
    expect(plan?.queries).toHaveLength(MAX_OFFICIAL_SOURCE_QUERIES);
    expect(plan?.queries.map((query) => query.topic)).toEqual([
      "monetary-policy",
      "labour-force-statistics",
    ]);
  });

  it("does not spend a second query when two topics share one domain set", () => {
    const plan = planOriginOfficialSourceQueries(
      "完全失業率と日本の総人口を教えてください。",
    );
    expect(plan?.queries).toHaveLength(1);
    expect(plan?.queries[0]?.domains).toEqual(["stat.go.jp", "e-stat.go.jp"]);
  });
});

/* ------------------------------------------------------------------ */
/* Freshness gate (measure C)                                          */
/* ------------------------------------------------------------------ */

function makeSource(partial: Partial<OriginSearchSource>): OriginSearchSource {
  return {
    title: "出典",
    url: "https://example.com/x",
    excerpt: "抜粋",
    providerId: "tavily",
    domain: "example.com",
    authorityTier: "general",
    evidenceLevel: "snippet",
    ...partial,
  };
}

const UNDATED_OFFICIAL = makeSource({
  title: "労働力調査 総務省統計局",
  url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
  domain: "stat.go.jp",
  authorityTier: "official",
});
const UNDATED_GENERAL = makeSource({
  title: "完全失業率の解説ブログ",
  url: "https://blog.example.com/unemployment",
  domain: "blog.example.com",
  authorityTier: "general",
});

describe("evaluateOriginSourceFreshness — official undated exemption (measure C)", () => {
  const newsRequirement = ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS.news;

  it("without the option, an undated official source is dropped for strict types (old behaviour)", () => {
    const { kept, stats } = evaluateOriginSourceFreshness([UNDATED_OFFICIAL], newsRequirement, "news", NOW);
    expect(kept).toHaveLength(0);
    expect(stats.droppedUndatedCount).toBe(1);
  });

  it("with the option, an undated official source survives a strict gate — as undated, never verified-fresh", () => {
    const { kept, stats } = evaluateOriginSourceFreshness(
      [UNDATED_OFFICIAL], newsRequirement, "news", NOW, { officialUndatedExempt: true },
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.dateVerified).toBe(false);
    expect(stats.droppedUndatedCount).toBe(0);
    expect(stats.unknownDateCount).toBe(1);
    expect(stats.verifiedFreshCount).toBe(0);
  });

  it("with the option, an undated UNOFFICIAL source is still dropped for strict types", () => {
    const { kept, stats } = evaluateOriginSourceFreshness(
      [UNDATED_GENERAL], newsRequirement, "news", NOW, { officialUndatedExempt: true },
    );
    expect(kept).toHaveLength(0);
    expect(stats.droppedUndatedCount).toBe(1);
  });

  it("with the option, a dated but stale official source is still dropped (exemption is undated-only)", () => {
    const staleOfficial = makeSource({
      ...UNDATED_OFFICIAL,
      publishedAt: "2026-10-01T00:00:00.000Z",
    });
    const { kept, stats } = evaluateOriginSourceFreshness(
      [staleOfficial], newsRequirement, "news", NOW, { officialUndatedExempt: true },
    );
    expect(kept).toHaveLength(0);
    expect(stats.droppedStaleCount).toBe(1);
  });

  it("fresh_general: undated official alone is wiped without the option, kept with it", () => {
    const requirement = ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS.fresh_general;
    const without = evaluateOriginSourceFreshness([UNDATED_OFFICIAL], requirement, "fresh_general", NOW);
    expect(without.kept).toHaveLength(0);
    const withOption = evaluateOriginSourceFreshness(
      [UNDATED_OFFICIAL], requirement, "fresh_general", NOW, { officialUndatedExempt: true },
    );
    expect(withOption.kept).toHaveLength(1);
    expect(withOption.kept[0]?.domain).toBe("stat.go.jp");
  });

  it("fresh_general: with the option, an undated unofficial source still cannot carry the pool alone", () => {
    const requirement = ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS.fresh_general;
    const { kept, stats } = evaluateOriginSourceFreshness(
      [UNDATED_GENERAL], requirement, "fresh_general", NOW, { officialUndatedExempt: true },
    );
    expect(kept).toHaveLength(0);
    expect(stats.droppedUndatedCount).toBe(1);
    expect(stats.unknownDateCount).toBe(0);
  });

  it("fresh_general: with the option, a mixed undated pool keeps only the official source", () => {
    const requirement = ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS.fresh_general;
    const { kept, stats } = evaluateOriginSourceFreshness(
      [UNDATED_GENERAL, UNDATED_OFFICIAL], requirement, "fresh_general", NOW, { officialUndatedExempt: true },
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.domain).toBe("stat.go.jp");
    expect(stats.droppedUndatedCount).toBe(1);
    expect(stats.unknownDateCount).toBe(1);
  });

  it("fresh_general: a dated fresh source keeps the whole pool, exemption or not", () => {
    const requirement = ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS.fresh_general;
    const datedFresh = makeSource({
      title: "完全失業率の速報記事",
      url: "https://news.example.com/u",
      domain: "news.example.com",
      publishedAt: "2026-11-18T00:00:00.000Z",
    });
    const { kept, stats } = evaluateOriginSourceFreshness(
      [datedFresh, UNDATED_OFFICIAL], requirement, "fresh_general", NOW, { officialUndatedExempt: true },
    );
    expect(kept).toHaveLength(2);
    expect(stats.verifiedFreshCount).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Tavily include_domains                                              */
/* ------------------------------------------------------------------ */

describe("searchTavilySources include_domains", () => {
  function capturingFetch() {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl: OriginSearchFetch = async (_url, init) => {
      bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ results: [] }),
      };
    };
    return { fetchImpl, bodies };
  }

  it("sends include_domains only when domains are given", async () => {
    const { fetchImpl, bodies } = capturingFetch();
    await searchTavilySources("完全失業率", {
      fetchImpl, apiKey: "tvly-test", topic: "general", timeRange: "year",
      includeDomains: ["stat.go.jp", "e-stat.go.jp"],
    });
    await searchTavilySources("完全失業率", {
      fetchImpl, apiKey: "tvly-test", topic: "general", timeRange: "year",
    });
    expect(bodies[0]?.include_domains).toEqual(["stat.go.jp", "e-stat.go.jp"]);
    expect(bodies[1]).not.toHaveProperty("include_domains");
  });
});

/* ------------------------------------------------------------------ */
/* End-to-end: grounding with the switch on/off (measures B + C)       */
/* ------------------------------------------------------------------ */

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

const STAT_RESULT = {
  title: "労働力調査（基本集計）完全失業率 総務省統計局",
  url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
  content: LONG_EXCERPT,
  score: 0.9,
  // No published_date: the official statistics page states no date
  // in the extracted text — the round-6 failure shape.
};
const BLOG_RESULT = {
  title: "完全失業率とは？日本の完全失業率を分かりやすく解説",
  url: "https://blog.example.com/unemployment-rate",
  content: LONG_EXCERPT,
  score: 0.8,
};

function officialAwareFetch() {
  const calls: RecordedCall[] = [];
  const fetchImpl: OriginSearchFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("api.tavily.com/search")) {
      const body = JSON.parse(init?.body ?? "{}") as { include_domains?: string[] };
      if (body.include_domains?.includes("stat.go.jp")) return jsonResponse({ results: [STAT_RESULT] });
      return jsonResponse({ results: [BLOG_RESULT] });
    }
    if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
    if (url.includes("wikipedia.org")) return jsonResponse({ pages: [] });
    throw new Error(`unexpected URL: ${url}`);
  };
  return { fetchImpl, calls };
}

function makeDeps(overrides: Partial<OriginSearchGroundingDeps> = {}): OriginSearchGroundingDeps {
  return {
    env: { TAVILY_API_KEY: "tvly-test-key" },
    now: () => NOW,
    counter: new OriginSearchUsageCounter(),
    cache: new OriginSearchTtlCache(),
    ...overrides,
  };
}

function groundedOf(outcome: OriginSearchGroundingOutcome) {
  if (outcome.kind !== "grounded") throw new Error(`expected grounded, got ${outcome.kind}`);
  return outcome;
}

const F06_QUESTION = "最新の完全失業率を教えてください。いつの分ですか？";

describe("executeOriginSearchGrounding — official-source routing (B + C)", () => {
  it("switch ON: issues one additional stat.go.jp-restricted search and grounds on the official source", async () => {
    const { fetchImpl, calls } = officialAwareFetch();
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(F06_QUESTION, deps));
    const searchCalls = calls.filter((call) => call.url.includes("api.tavily.com/search"));
    expect(searchCalls).toHaveLength(2);
    const restricted = searchCalls
      .map((call) => JSON.parse(call.init?.body ?? "{}") as { include_domains?: string[] })
      .find((body) => body.include_domains);
    expect(restricted?.include_domains).toEqual(["stat.go.jp", "e-stat.go.jp"]);
    // The official source reached the adopted pool with its tier intact.
    const official = outcome.sources.find((source) => source.domain === "stat.go.jp");
    expect(official).toBeDefined();
    expect(official?.authorityTier).toBe("official");
    expect(outcome.providersUsed).toEqual(["tavily"]);
    // Two basic searches = two credits, honestly recorded.
    expect(deps.counter?.usage("tavily", NOW)).toBe(2);
  });

  it("switch OFF (default): no additional search, and the official source never enters the pool", async () => {
    const { fetchImpl, calls } = officialAwareFetch();
    const deps = makeDeps({ fetchImpl });
    const outcome = await executeOriginSearchGrounding(F06_QUESTION, deps);
    const searchCalls = calls.filter((call) => call.url.includes("api.tavily.com/search"));
    expect(searchCalls).toHaveLength(1);
    expect(JSON.parse(searchCalls[0]?.init?.body ?? "{}")).not.toHaveProperty("include_domains");
    if (outcome.kind === "grounded") {
      expect(outcome.sources.some((source) => source.domain === "stat.go.jp")).toBe(false);
    }
    expect(deps.counter?.usage("tavily", NOW)).toBe(1);
  });

  it("switch ON but no topic match (F-12 shape): no additional search is spent", async () => {
    const { fetchImpl, calls } = officialAwareFetch();
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    await executeOriginSearchGrounding("GoogleのPixelの最新モデルの日本の価格を教えてください。", deps);
    const searchCalls = calls.filter((call) => call.url.includes("api.tavily.com/search"));
    expect(searchCalls).toHaveLength(1);
  });
});
