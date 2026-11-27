import { describe, expect, it } from "vitest";
import { ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS } from "./originSearchClassifier";
import {
  evaluateOriginSourceFreshness,
  executeOriginSearchGrounding,
  extractStatedPublicationMs,
  isDataTablePage,
  originSearchGroundingToResearchResult,
  selectOriginSearchSourcesWithObservation,
  type OriginSearchGroundingDeps,
  type OriginSearchGroundingOutcome,
} from "./originSearchGrounding";
import { OriginSearchUsageCounter } from "./originSearchProviderCatalog";
import { OriginSearchTtlCache } from "./originSearchCache";
import {
  assessOfficialMaterialInsufficiency,
  buildOfficialReleaseQueryText,
  buildOfficialRetryQueryText,
  buildOfficialSourceQueryText,
  excerptHasOfficialValueToken,
  isRegionalOfficialSource,
  isStatisticalCurrentValueRequest,
  MAX_OFFICIAL_SOURCE_QUERIES,
  planOriginOfficialSourceQueries,
  resolveOriginOfficialSourceRoutingEnabled,
} from "./originOfficialSourceRouting";
import type { OriginOfficialEdition } from "./originOfficialEdition";
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

  /* Round-5 measure 5-1: the type gate opens from the topic side.
   * 「実質GDPの最新値」 carries no rate word, so the recovery
   * classifier returns `other` and — before this measure — the plan
   * returned null before the topic table was consulted: no
   * domain-restricted search, no edition key, no insufficiency
   * retry, ever, for the most natural phrasing of the question. */
  it("plans the GDP topic for current-value phrasings the classifier types as other (round-5 measure 5-1)", () => {
    for (const question of [
      "実質GDPの最新値を教えてください",
      "GDPの最新値を教えてください",
      "国内総生産の最新値はいくつですか？",
      "実質GDPの現在の値を教えてください",
    ]) {
      const plan = planOriginOfficialSourceQueries(question, NOW);
      expect(plan, question).not.toBeNull();
      expect(plan?.queries).toHaveLength(1);
      expect(plan?.queries[0]?.topic).toBe("gdp-and-economy");
      expect(plan?.queries[0]?.domains).toEqual(["esri.cao.go.jp", "cao.go.jp"]);
      expect(plan?.queries[0]?.releaseTerms).toBe("四半期別GDP速報");
      // The edition key rides the plan, so the insufficiency retry
      // and the sub-ranking work for this phrasing too. At NOW
      // (2026-11-19) the edition that must exist is 2026年7-9月期.
      expect(plan?.queries[0]?.expectedEdition?.label).toBe("2026年7-9月期");
      expect(plan?.queries[0]?.editionTerms).toEqual(["2026年7-9月期", "令和8年7-9月期"]);
    }
  });

  it("plans nothing for explanation questions about the same topics (round-5 measure 5-1)", () => {
    for (const question of [
      "実質GDPとは何か教えてください",
      "GDPとは何ですか？",
      "実質GDPの最新値とは何ですか",
      "実質GDPの算出方法を教えてください",
      "国内総生産の決め方を教えてください",
    ]) {
      expect(planOriginOfficialSourceQueries(question, NOW), question).toBeNull();
    }
  });

  it("the topic-side gate still requires a curated topic match", () => {
    // A current-value phrasing alone never spends a query: no topic
    // in the map matches these subjects.
    for (const question of [
      "私の体重の最新値を教えてください",
      "この会社の株価の最新値を教えてください",
    ]) {
      expect(planOriginOfficialSourceQueries(question, NOW), question).toBeNull();
    }
  });

  it("isStatisticalCurrentValueRequest separates value requests from explanations", () => {
    expect(isStatisticalCurrentValueRequest("実質GDPの最新値を教えてください")).toBe(true);
    expect(isStatisticalCurrentValueRequest("完全失業率の現在の値は？")).toBe(true);
    expect(isStatisticalCurrentValueRequest("実質GDPとは何か")).toBe(false);
    expect(isStatisticalCurrentValueRequest("実質GDPの最新値とは何ですか")).toBe(false);
    expect(isStatisticalCurrentValueRequest("GDPの仕組みを教えてください")).toBe(false);
    expect(isStatisticalCurrentValueRequest("今日の天気は？")).toBe(false);
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
  title: "労働力調査（基本集計）2026年9月分 完全失業率 総務省統計局",
  url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
  // The value rides the excerpt AND the title states the current
  // edition (2026年9月分 is the edition that must exist at this
  // file's NOW), so the adopted pool is materially sufficient and
  // the retry does not fire. Round-3 measure 3-4: an edition the
  // pool cannot READ is no longer sufficiency — a value whose
  // vintage cannot be shown to be current fires the stale-edition
  // retry (pinned separately below), so this fixture states its
  // edition, as the bureau's release page does.
  content: `${LONG_EXCERPT} 完全失業率は2.4%でした。`,
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
    // Exact-host check only: a substring match would also accept
    // "https://wikipedia.org.evil.example/..." (CodeQL
    // js/incomplete-url-substring-sanitization). Mirrors the
    // production host rule in originSearchProviders.ts.
    const host = new URL(url).hostname;
    if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) {
      return jsonResponse({ pages: [] });
    }
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
/* ------------------------------------------------------------------ */
/* Round-8 measure A: release-name targeting                           */
/* ------------------------------------------------------------------ */

describe("planOriginOfficialSourceQueries — release names (round-8 measure A)", () => {
  const releaseCases: Array<{ question: string; releaseTerms: string }> = [
    { question: "日銀の政策金利は今いくつですか？いつ決まったものですか？", releaseTerms: "金融政策決定会合" },
    { question: "最新の完全失業率を教えてください。いつの分ですか？", releaseTerms: "労働力調査 基本集計" },
    { question: "日本の総人口の最新の推計値と、その基準日を教えてください。", releaseTerms: "人口推計" },
    { question: "最新の有効求人倍率を教えてください。いつの分ですか？", releaseTerms: "一般職業紹介状況" },
    { question: "直近に公表された日本の実質GDP成長率（四半期）を教えてください。", releaseTerms: "四半期別GDP速報" },
    { question: "レギュラーガソリンの全国平均価格は今いくらくらいですか？", releaseTerms: "石油製品価格調査" },
  ];
  for (const { question, releaseTerms } of releaseCases) {
    it(`carries the release name for: ${question}`, () => {
      expect(planOriginOfficialSourceQueries(question)?.queries[0]?.releaseTerms).toBe(releaseTerms);
    });
  }

  it("carries no release name where the publication has no single stable title", () => {
    expect(planOriginOfficialSourceQueries(
      "直近の国政選挙（衆院選・参院選いずれか近い方）はいつ行われ、結果はどうでしたか？",
    )?.queries[0]?.releaseTerms).toBeUndefined();
    expect(planOriginOfficialSourceQueries(
      "現在の日本の内閣総理大臣は誰ですか？",
    )?.queries[0]?.releaseTerms).toBeUndefined();
  });
});

describe("buildOfficialSourceQueryText / buildOfficialRetryQueryText (round-8 measures A/B)", () => {
  it("appends the release name to the minimized query", () => {
    expect(buildOfficialSourceQueryText("最新の完全失業率 いつの分", "労働力調査 基本集計"))
      .toBe("最新の完全失業率 いつの分 労働力調査 基本集計");
  });

  it("does not duplicate the release name when the query already names it", () => {
    expect(buildOfficialSourceQueryText("労働力調査の結果", "労働力調査 基本集計"))
      .toBe("労働力調査の結果");
  });

  it("returns the base query unchanged when the topic has no release name", () => {
    expect(buildOfficialSourceQueryText("直近の国政選挙", undefined)).toBe("直近の国政選挙");
  });

  it("the retry query is the release name alone (a different formulation)", () => {
    expect(buildOfficialRetryQueryText("一般職業紹介状況")).toBe("一般職業紹介状況");
  });

  it("the release query (round-5 measure 5-3a) is the publication name plus the expected edition, in both notations", () => {
    expect(buildOfficialReleaseQueryText("労働力調査 基本集計", ["令和8年9月分", "2026年9月分"]))
      .toBe("労働力調査 基本集計 令和8年9月分 2026年9月分");
    expect(buildOfficialReleaseQueryText("四半期別GDP速報", ["2026年7-9月期", "令和8年7-9月期"]))
      .toBe("四半期別GDP速報 2026年7-9月期 令和8年7-9月期");
    // No edition known: the release name alone.
    expect(buildOfficialReleaseQueryText("労働力調査 基本集計")).toBe("労働力調査 基本集計");
    // An edition term already inside the release name is not duplicated.
    expect(buildOfficialReleaseQueryText("労働力調査 基本集計 令和8年9月分", ["令和8年9月分", "2026年9月分"]))
      .toBe("労働力調査 基本集計 令和8年9月分 2026年9月分");
    // The retry builder is the same form (the two passes share the
    // short query since round 5).
    expect(buildOfficialRetryQueryText("労働力調査 基本集計", ["令和8年9月分", "2026年9月分"]))
      .toBe(buildOfficialReleaseQueryText("労働力調査 基本集計", ["令和8年9月分", "2026年9月分"]));
  });
});

/* ------------------------------------------------------------------ */
/* Round-8 measure B: material insufficiency detection                 */
/* ------------------------------------------------------------------ */

describe("excerptHasOfficialValueToken / isRegionalOfficialSource (round-8 measure B)", () => {
  it("recognizes published-statistic value shapes", () => {
    expect(excerptHasOfficialValueToken("完全失業率は2.4%でした。")).toBe(true);
    expect(excerptHasOfficialValueToken("総人口は1億2,243万人です。")).toBe(true);
    expect(excerptHasOfficialValueToken("有効求人倍率は0.67倍でした。")).toBe(true);
    expect(excerptHasOfficialValueToken("価格は170.0円/Lです。")).toBe(true);
    expect(excerptHasOfficialValueToken("実質GDPは前期比-0.0%でした。")).toBe(true);
  });

  it("does not mistake navigation text, figure numbers or reference periods for values", () => {
    expect(excerptHasOfficialValueToken("印刷用PDF：図 一般職業紹介状況の公表資料一覧ページです。")).toBe(false);
    expect(excerptHasOfficialValueToken("2026年9月分の結果については資料出所の注記をご覧ください。")).toBe(false);
    expect(excerptHasOfficialValueToken("データセットのメタデータページです。")).toBe(false);
    expect(excerptHasOfficialValueToken("")).toBe(false);
  });

  it("recognizes regional publications by host, title and URL", () => {
    expect(isRegionalOfficialSource({
      title: "一般職業紹介状況", url: "https://jsite.mhlw.go.jp/miyagi-roudoukyoku/x.pdf",
      excerpt: "", domain: "jsite.mhlw.go.jp", authorityTier: "official",
    })).toBe(true);
    expect(isRegionalOfficialSource({
      title: "宮城県の有効求人倍率について", url: "https://example.com/a",
      excerpt: "", domain: "example.com", authorityTier: "general",
    })).toBe(true);
    expect(isRegionalOfficialSource({
      title: "労働力調査（基本集計）結果", url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
      excerpt: "", domain: "stat.go.jp", authorityTier: "official",
    })).toBe(false);
  });
});

describe("assessOfficialMaterialInsufficiency (round-8 measure B)", () => {
  const shape = (partial: Partial<OriginSearchSource>): OriginSearchSource => makeSource(partial);

  it("F-06 shape: no value-bearing span at all → no-numeric-span", () => {
    const assessment = assessOfficialMaterialInsufficiency([
      shape({ domain: "jilpt.go.jp", authorityTier: "official", excerpt: "印刷用PDF：図 完全失業率の長期時系列データのページです。" }),
      shape({ domain: "e-stat.go.jp", authorityTier: "official", excerpt: "労働力調査年報データセットのメタデータページです。" }),
    ]);
    expect(assessment.sufficient).toBe(false);
    expect(assessment.reason).toBe("no-numeric-span");
  });

  it("F-05 shape: values only from a regional publication → regional-only", () => {
    const assessment = assessOfficialMaterialInsufficiency([
      shape({
        title: "宮城県の有効求人倍率", domain: "jsite.mhlw.go.jp", authorityTier: "official",
        url: "https://jsite.mhlw.go.jp/miyagi-roudoukyoku/x.pdf",
        excerpt: "宮城県内の有効求人倍率は0.67倍でした。",
      }),
      shape({ domain: "jilpt.go.jp", authorityTier: "official", excerpt: "資料出所の注記のみのページです。" }),
    ]);
    expect(assessment.sufficient).toBe(false);
    expect(assessment.reason).toBe("regional-only");
    expect(assessment.valueBearingCount).toBe(1);
  });

  it("a national official value makes the pool sufficient", () => {
    const assessment = assessOfficialMaterialInsufficiency([
      shape({
        title: "労働力調査（基本集計）", domain: "stat.go.jp", authorityTier: "official",
        url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
        excerpt: "完全失業率は2.4%でした。",
      }),
    ]);
    expect(assessment.sufficient).toBe(true);
    expect(assessment.nationalOfficialValueCount).toBe(1);
  });

  it("F-03 shape: values on unofficial non-regional sources are NOT this measure's trigger", () => {
    const assessment = assessOfficialMaterialInsufficiency([
      shape({ domain: "nomura.co.jp", authorityTier: "general", excerpt: "政策金利は現在1.00%で、将来シナリオでは1.25%です。" }),
    ]);
    expect(assessment.sufficient).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Round-8 measure C: freshness by the stated publication date         */
/* ------------------------------------------------------------------ */

describe("extractStatedPublicationMs (round-8 measure C)", () => {
  it("reads Gregorian, Reiwa and ISO full dates", () => {
    expect(extractStatedPublicationMs("2026年10月30日公表", NOW)).toBe(Date.UTC(2026, 9, 30));
    expect(extractStatedPublicationMs("令和8年11月17日に公表しました", NOW)).toBe(Date.UTC(2026, 10, 17));
    expect(extractStatedPublicationMs("令和元年5月1日", NOW)).toBe(Date.UTC(2019, 4, 1));
    expect(extractStatedPublicationMs("published 2026-10-30", NOW)).toBe(Date.UTC(2026, 9, 30));
  });

  it("ignores reference periods (no day) and future dates, and picks the newest date", () => {
    expect(extractStatedPublicationMs("2026年9月分の結果です", NOW)).toBeNull();
    expect(extractStatedPublicationMs("2027年1月1日に公表予定", NOW)).toBeNull();
    expect(extractStatedPublicationMs("前回は2026年9月30日、今回は2026年10月30日公表", NOW))
      .toBe(Date.UTC(2026, 9, 30));
    expect(extractStatedPublicationMs("日付の無いページ", NOW)).toBeNull();
  });
});

describe("evaluateOriginSourceFreshness — stated publication date (round-8 measure C)", () => {
  const priceRequirement = ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS.price_spec;

  it("F-04 shape: an official survey page with a stale page date is kept on its stated publication date (one week old)", () => {
    const enecho = makeSource({
      title: "石油製品価格調査 結果 資源エネルギー庁",
      url: "https://www.enecho.meti.go.jp/about/pamphlet/statistic/petroleum/",
      domain: "enecho.meti.go.jp",
      authorityTier: "official",
      // The provider reports the page's old first-seen date…
      publishedAt: "2025-06-01T00:00:00.000Z",
      // …while the page itself states the current release's date.
      excerpt: "石油製品価格調査の結果です。レギュラーガソリン全国平均価格は170.0円/Lでした（令和8年11月17日公表分）。",
    });
    const withOption = evaluateOriginSourceFreshness(
      [enecho], priceRequirement, "price_spec", NOW, { officialStatedDate: true },
    );
    expect(withOption.kept).toHaveLength(1);
    expect(withOption.kept[0]?.dateVerified).toBe(true);
    expect(withOption.decisions).toEqual([
      { domain: "enecho.meti.go.jp", tier: "official", outcome: "kept-verified", basis: "text-date", basisDate: "2026-11-17" },
    ]);
    // Without the option the same source falls to the page-age window.
    const without = evaluateOriginSourceFreshness([enecho], priceRequirement, "price_spec", NOW);
    expect(without.kept).toHaveLength(0);
    expect(without.stats.droppedStaleCount).toBe(1);
  });

  it("an UNOFFICIAL source is judged by its provider date exactly as before (not relaxed)", () => {
    const blog = makeSource({
      title: "ガソリン価格の解説ブログ",
      url: "https://blog.example.com/gas",
      domain: "blog.example.com",
      authorityTier: "general",
      publishedAt: "2025-06-01T00:00:00.000Z",
      excerpt: "ガソリン価格は170.0円/Lでした（令和8年11月17日公表分）。",
    });
    const { kept, stats, decisions } = evaluateOriginSourceFreshness(
      [blog], priceRequirement, "price_spec", NOW, { officialStatedDate: true },
    );
    expect(kept).toHaveLength(0);
    expect(stats.droppedStaleCount).toBe(1);
    expect(decisions[0]?.basis).toBe("provider-date");
  });

  it("an official source whose stated date is also outside the window is dropped as stale (basis: text-date)", () => {
    const oldRelease = makeSource({
      title: "石油製品価格調査 結果 資源エネルギー庁",
      url: "https://www.enecho.meti.go.jp/about/pamphlet/statistic/petroleum/",
      domain: "enecho.meti.go.jp",
      authorityTier: "official",
      excerpt: "石油製品価格調査の結果です（令和7年11月17日公表分）。",
    });
    const { kept, decisions } = evaluateOriginSourceFreshness(
      [oldRelease], priceRequirement, "price_spec", NOW, { officialStatedDate: true },
    );
    expect(kept).toHaveLength(0);
    expect(decisions).toEqual([
      { domain: "enecho.meti.go.jp", tier: "official", outcome: "dropped-stale", basis: "text-date", basisDate: "2025-11-17" },
    ]);
  });

  it("F-14 shape: an undated official page is verified on the event date its text states; an undated blog is never upgraded", () => {
    const requirement = ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS.fresh_general;
    const soumu = makeSource({
      title: "衆議院議員総選挙の結果 総務省",
      url: "https://www.soumu.go.jp/senkyo/senkyo_s/data/shugiin51/",
      domain: "soumu.go.jp",
      authorityTier: "official",
      excerpt: "第51回衆議院議員総選挙は2026年2月8日に行われました。結果の詳細を掲載しています。",
    });
    const blog = makeSource({
      title: "選挙結果の感想ブログ",
      url: "https://blog.example.com/election",
      domain: "blog.example.com",
      authorityTier: "general",
      excerpt: "選挙の結果について感想を書きます。",
    });
    const { kept, decisions } = evaluateOriginSourceFreshness(
      [soumu, blog], requirement, "fresh_general", NOW,
      { officialUndatedExempt: true, officialStatedDate: true },
    );
    const soumuKept = kept.find((source) => source.domain === "soumu.go.jp");
    expect(soumuKept?.dateVerified).toBe(true);
    const blogKept = kept.find((source) => source.domain === "blog.example.com");
    expect(blogKept?.dateVerified).toBe(false);
    expect(decisions).toEqual([
      { domain: "soumu.go.jp", tier: "official", outcome: "kept-verified", basis: "text-date", basisDate: "2026-02-08" },
      { domain: "blog.example.com", tier: "general", outcome: "kept-undated", basis: "none", basisDate: null },
    ]);
    // Without the stated-date option the same official page is only
    // ever "official, undated" — the event date in its text is not
    // a basis the old gate could use.
    const without = evaluateOriginSourceFreshness(
      [soumu], requirement, "fresh_general", NOW, { officialUndatedExempt: true },
    );
    expect(without.kept[0]?.dateVerified).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Round-8 measures A+B+D end to end                                   */
/* ------------------------------------------------------------------ */

const JILPT_NAV_RESULT = {
  title: "最新の完全失業率の推移（長期時系列）",
  url: "https://www.jilpt.go.jp/chousa/zenpan/term.html",
  content: "完全失業率の長期時系列データを掲載しています。収録範囲がいつの分からかは資料出所の注記をご覧ください。",
  score: 0.5,
};
const LABOUR_RELEASE_RESULT = {
  title: "労働力調査（基本集計）2026年9月分 結果の概要 総務省統計局",
  url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
  content: "労働力調査（基本集計）2026年9月分の結果です。完全失業率は2.4%でした。2026年10月30日に公表しました。",
  score: 0.95,
};

function labourRetryFetch() {
  const calls: RecordedCall[] = [];
  let statRestrictedCalls = 0;
  const fetchImpl: OriginSearchFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("api.tavily.com/search")) {
      const body = JSON.parse(init?.body ?? "{}") as { query?: string; include_domains?: string[] };
      if (body.include_domains?.includes("stat.go.jp")) {
        // First-pass official search misses; the retry finds the
        // publication page. Since round-5 measure 5-3a the first
        // pass and the retry share the short release-form query
        // text, so the mock distinguishes them by call order.
        statRestrictedCalls += 1;
        return jsonResponse({ results: statRestrictedCalls >= 2 ? [LABOUR_RELEASE_RESULT] : [] });
      }
      return jsonResponse({ results: [JILPT_NAV_RESULT] });
    }
    if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
    const host = new URL(url).hostname;
    if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
    throw new Error(`unexpected URL: ${url}`);
  };
  return { fetchImpl, calls };
}

describe("executeOriginSearchGrounding — round-8 measures A + B + D", () => {
  it("switch ON with a sufficient pool: the official search aims at the release page and no retry fires", async () => {
    const { fetchImpl, calls } = officialAwareFetch();
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(F06_QUESTION, deps));
    const searchCalls = calls.filter((call) => call.url.includes("api.tavily.com/search"));
    expect(searchCalls).toHaveLength(2);
    const restricted = searchCalls
      .map((call) => JSON.parse(call.init?.body ?? "{}") as { query?: string; include_domains?: string[] })
      .find((body) => body.include_domains);
    // Measure A: the restricted query names the publication.
    expect(restricted?.query).toContain("労働力調査 基本集計");
    expect(outcome.candidateStats?.officialRetry).toBeUndefined();
    // Measure 5-3c: the labour topic's two release pages are also
    // fetched directly (the mock's extract returns nothing for
    // them, so they add records but no candidates here).
    expect(outcome.queriesIssued?.map((issued) => issued.kind)).toEqual([
      "ordinary", "ordinary", "official", "official-release-page", "official-release-page",
    ]);
  });

  it("F-06 shape: a value-less pool fires exactly ONE retry (release name + expected edition), which brings the publication page", async () => {
    const { fetchImpl, calls } = labourRetryFetch();
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(F06_QUESTION, deps));
    const searchCalls = calls.filter((call) => call.url.includes("api.tavily.com/search"));
    // ordinary + official + exactly one retry — never two.
    expect(searchCalls).toHaveLength(3);
    const bodies = searchCalls.map((call) => JSON.parse(call.init?.body ?? "{}") as { query?: string; include_domains?: string[] });
    // Round-5 measure 5-3a: the FIRST-pass official query is the
    // short release form (publication name + expected edition),
    // not the minimized-question long form.
    expect(bodies[1]?.query).toBe("労働力調査 基本集計 令和8年9月分 2026年9月分");
    // Round-4 measure 3-5: the reason here is no-numeric-span, yet
    // the retry still names the edition that must exist — the
    // edition terms are no longer a stale-edition-only attachment.
    expect(bodies[2]?.query).toBe("労働力調査 基本集計 令和8年9月分 2026年9月分");
    expect(bodies[2]?.include_domains).toEqual(["stat.go.jp", "e-stat.go.jp"]);
    expect(deps.counter?.usage("tavily", NOW)).toBe(3);
    // The publication page was adopted, judged fresh on its stated date.
    const release = outcome.sources.find((source) => source.domain === "stat.go.jp");
    expect(release).toBeDefined();
    expect(release?.dateVerified).toBe(true);
    // Measure B observation.
    expect(outcome.candidateStats?.officialRetry).toEqual({
      reason: "no-numeric-span", fired: true, candidateCount: 1, keptCount: 1, adoptedCount: 1,
    });
    // Measure D: issued queries and per-candidate decisions are recorded.
    // Measure 5-3c: the release-page fetches sit between the official
    // search and the retry (they start in parallel with the searches).
    expect(outcome.queriesIssued?.map((issued) => issued.kind)).toEqual([
      "ordinary", "ordinary", "official", "official-release-page", "official-release-page", "official-retry",
    ]);
    expect(outcome.queriesIssued?.[3]).toEqual({
      provider: "tavily", kind: "official-release-page",
      query: "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/index.html",
      url: "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/index.html",
    });
    expect(outcome.queriesIssued?.[5]).toEqual({
      provider: "tavily", kind: "official-retry", query: "労働力調査 基本集計 令和8年9月分 2026年9月分",
      includeDomains: ["stat.go.jp", "e-stat.go.jp"],
    });
    const releaseDecision = outcome.candidateStats?.freshnessDecisions
      .find((decision) => decision.domain === "stat.go.jp");
    expect(releaseDecision).toEqual({
      domain: "stat.go.jp", tier: "official", outcome: "kept-verified", basis: "text-date", basisDate: "2026-10-30",
    });
    // …and the same record reaches the research result's metadata.
    const result = originSearchGroundingToResearchResult(outcome);
    expect(result.grounding?.queriesIssued?.map((issued) => issued.kind)).toEqual([
      "ordinary", "ordinary", "official", "official-release-page", "official-release-page", "official-retry",
    ]);
    expect(result.grounding?.queriesIssued?.[4]?.url).toBe(
      "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/pdf/gaiyou.pdf",
    );
    expect(result.grounding?.candidateStats?.officialRetry?.reason).toBe("no-numeric-span");
    expect(result.grounding?.candidateStats?.freshnessDecisions?.length).toBeGreaterThan(0);
  });

  it("F-05 shape: regional-only values fire the retry, and the national release page is adopted", async () => {
    const miyagi = {
      title: "最新の有効求人倍率（宮城県・令和8年6月分）",
      url: "https://jsite.mhlw.go.jp/miyagi-roudoukyoku/roudoukyoku/gyoumu_naiyou_00001.html",
      content: "宮城県内の有効求人倍率は0.67倍でした。いつの分かの詳細は公表資料をご覧ください。",
      score: 0.9,
      published_date: "2026-11-10T00:00:00.000Z",
    };
    const mhlwRelease = {
      title: "一般職業紹介状況（令和8年10月分）を公表しました 厚生労働省",
      url: "https://www.mhlw.go.jp/stf/newdata/20261128.html",
      content: "一般職業紹介状況の結果です。全国の有効求人倍率は1.19倍でした。2026年10月30日に公表しました。",
      score: 0.85,
    };
    const calls: RecordedCall[] = [];
    let mhlwRestrictedCalls = 0;
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { query?: string; include_domains?: string[] };
        if (body.include_domains?.includes("mhlw.go.jp")) {
          // The first-pass official search misses the national
          // release; the retry finds it. Since round-5 measure
          // 5-3a both passes use the same short release-form query
          // text, the mock distinguishes them by call order.
          mhlwRestrictedCalls += 1;
          return jsonResponse({ results: mhlwRestrictedCalls >= 2 ? [mhlwRelease] : [] });
        }
        return jsonResponse({ results: [miyagi] });
      }
      if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(
      "最新の有効求人倍率を教えてください。いつの分ですか？", deps,
    ));
    expect(outcome.candidateStats?.officialRetry).toEqual({
      reason: "regional-only", fired: true, candidateCount: 1, keptCount: 1, adoptedCount: 1,
    });
    const national = outcome.sources.find((source) => source.domain === "mhlw.go.jp");
    expect(national).toBeDefined();
    expect(national?.excerpt).toContain("1.19倍");
    const searchCalls = calls.filter((call) => call.url.includes("api.tavily.com/search"));
    expect(searchCalls).toHaveLength(3);
    // The reason was regional-only, and the retry query still
    // names the expected edition (round-4 measure 3-5).
    const bodies = searchCalls.map(
      (call) => JSON.parse(call.init?.body ?? "{}") as { query?: string },
    );
    expect(bodies[2]?.query).toBe("一般職業紹介状況 令和8年9月分 2026年9月分");
  });
});

/* ------------------------------------------------------------------ */
/* Round-5 measure 5-1 end to end: the GDP current-value phrasing      */
/* reaches the official route (before round 5 the plan was null and   */
/* no official query was ever issued for this question).               */
/* ------------------------------------------------------------------ */

describe("executeOriginSearchGrounding — round-5 measure 5-1 (GDP current value)", () => {
  it("switch ON: 「実質GDPの最新値」 issues the ESRI-restricted official query in the release form and adopts the release", async () => {
    const gdpRelease = {
      title: "四半期別GDP速報（2026年7-9月期・1次速報値）内閣府経済社会総合研究所",
      url: "https://www.esri.cao.go.jp/jp/sna/data/data_list/sokuhou/sokuhou_top.html",
      content: "2026年7-9月期の実質GDP成長率は、前期比-0.0%、年率換算-0.1%となりました。2026年11月16日に公表しました。",
      score: 0.95,
    };
    const blog = {
      title: "GDPとは？分かりやすく解説",
      url: "https://blog.example.com/gdp",
      content: LONG_EXCERPT,
      score: 0.8,
    };
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { query?: string; include_domains?: string[] };
        if (body.include_domains?.includes("esri.cao.go.jp")) {
          return jsonResponse({ results: [gdpRelease] });
        }
        return jsonResponse({ results: [blog] });
      }
      if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(
      "実質GDPの最新値を教えてください", deps,
    ));
    const officialIssued = outcome.queriesIssued?.find((issued) => issued.kind === "official");
    expect(officialIssued).toEqual({
      provider: "tavily",
      kind: "official",
      query: "四半期別GDP速報 2026年7-9月期 令和8年7-9月期",
      includeDomains: ["esri.cao.go.jp", "cao.go.jp"],
    });
    const adopted = outcome.sources.find((source) => source.domain === "esri.cao.go.jp");
    expect(adopted).toBeDefined();
    expect(adopted?.excerpt).toContain("-0.0%");
    // The pool is materially sufficient (current edition, value
    // present), so no insufficiency retry fires.
    expect(outcome.candidateStats?.officialRetry).toBeUndefined();
  });

  it("switch ON: the explanation phrasing 「実質GDPとは何か」 issues no official query", async () => {
    const { fetchImpl, calls } = officialAwareFetch();
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    await executeOriginSearchGrounding("実質GDPとは何か教えてください", deps);
    const bodies = calls
      .filter((call) => call.url.includes("api.tavily.com/search"))
      .map((call) => JSON.parse(call.init?.body ?? "{}") as { include_domains?: string[] });
    expect(bodies.every((body) => !body.include_domains)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Follow-up measures 2a/2b/2c: edition targeting end to end           */
/* (ANSWER_FOLLOWUP_DIAGNOSIS_2026-11-26). NOW is 2026-11-19 JST, so  */
/* the edition that must exist for a monthly statistic is 2026年9月分. */
/* ------------------------------------------------------------------ */

describe("executeOriginSearchGrounding — follow-up measure 2 (editions)", () => {
  it("F-05 follow-up shape: a stale-edition pool fires ONE edition-targeted retry and adopts the current release", async () => {
    const staleRelease = {
      title: "一般職業紹介状況（令和7年12月分）を公表しました 厚生労働省",
      url: "https://www.mhlw.go.jp/stf/newdata/20251226.html",
      content: "一般職業紹介状況の結果です。全国の有効求人倍率は1.18倍でした。2025年12月26日に公表しました。",
      score: 0.85,
    };
    const currentRelease = {
      title: "一般職業紹介状況（令和8年9月分）を公表しました 厚生労働省",
      url: "https://www.mhlw.go.jp/stf/newdata/20261030.html",
      content: "一般職業紹介状況の結果です。全国の有効求人倍率は1.19倍でした。2026年10月30日に公表しました。",
      score: 0.95,
    };
    const blog = {
      title: "有効求人倍率とは？意味を解説",
      url: "https://blog.example.com/job-offers-ratio",
      content: "有効求人倍率について分かりやすく解説します。求職者と求人の関係を示す指標です。",
      score: 0.7,
    };
    const calls: RecordedCall[] = [];
    let mhlwRestrictedCalls = 0;
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { query?: string; include_domains?: string[] };
        if (body.include_domains?.includes("mhlw.go.jp")) {
          // The first pass returns the stale edition; the retry
          // returns the current one. Since round-5 measure 5-3a
          // both passes share the short release-form query text,
          // the mock distinguishes them by call order.
          mhlwRestrictedCalls += 1;
          return jsonResponse({ results: mhlwRestrictedCalls >= 2 ? [currentRelease] : [staleRelease] });
        }
        return jsonResponse({ results: [blog] });
      }
      if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(
      "最新の有効求人倍率を教えてください。いつの分ですか？", deps,
    ));
    // The first-pass official query already aims at the edition
    // that must exist (measure 2a).
    const searchCalls = calls.filter((call) => call.url.includes("api.tavily.com/search"));
    const bodies = searchCalls.map(
      (call) => JSON.parse(call.init?.body ?? "{}") as { query?: string; include_domains?: string[] },
    );
    const firstOfficial = bodies.find((body) => body.include_domains?.includes("mhlw.go.jp"));
    expect(firstOfficial?.query).toContain("一般職業紹介状況");
    expect(firstOfficial?.query).toContain("令和8年9月分");
    // The stale pool fired exactly one retry, edition-targeted
    // (measure 2c), and the current release was adopted.
    expect(outcome.candidateStats?.officialRetry).toEqual({
      reason: "stale-edition", fired: true, candidateCount: 1, keptCount: 1, adoptedCount: 1,
    });
    expect(bodies[bodies.length - 1]?.query).toBe("一般職業紹介状況 令和8年9月分 2026年9月分");
    const adopted = outcome.sources.find((source) => source.domain === "mhlw.go.jp");
    expect(adopted?.title).toContain("令和8年9月分");
    expect(adopted?.excerpt).toContain("1.19倍");
    expect(searchCalls).toHaveLength(3);
    // The same record reaches the research result's metadata.
    const result = originSearchGroundingToResearchResult(outcome);
    expect(result.grounding?.candidateStats?.officialRetry?.reason).toBe("stale-edition");
  });

  it("a current-edition pool fires no retry", async () => {
    const currentRelease = {
      title: "一般職業紹介状況（令和8年9月分）を公表しました 厚生労働省",
      url: "https://www.mhlw.go.jp/stf/newdata/20261030.html",
      content: "一般職業紹介状況の結果です。全国の有効求人倍率は1.19倍でした。2026年10月30日に公表しました。",
      score: 0.95,
    };
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { include_domains?: string[] };
        if (body.include_domains?.includes("mhlw.go.jp")) {
          return jsonResponse({ results: [currentRelease] });
        }
        return jsonResponse({ results: [] });
      }
      if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(
      "最新の有効求人倍率を教えてください。いつの分ですか？", deps,
    ));
    expect(outcome.candidateStats?.officialRetry).toBeUndefined();
    const searchCalls = calls.filter((call) => call.url.includes("api.tavily.com/search"));
    expect(searchCalls).toHaveLength(2);
  });
});

describe("selectOriginSearchSourcesWithObservation — edition recency (measure 2b)", () => {
  const editioned = (title: string, url: string, domain: string): OriginSearchSource => ({
    title,
    url,
    excerpt: "抜粋",
    providerId: "tavily",
    domain,
    authorityTier: "official",
    evidenceLevel: "snippet",
    providerScore: 0.9,
  });

  it("with the fallback on, the newer edition wins the recency key when publishedAt is absent", () => {
    const older = editioned(
      "一般職業紹介状況（令和7年12月分）", "https://www.stat.go.jp/a", "stat.go.jp",
    );
    const newer = editioned(
      "一般職業紹介状況（令和8年9月分）", "https://www.e-stat.go.jp/b", "e-stat.go.jp",
    );
    const { selected } = selectOriginSearchSourcesWithObservation(
      [older, newer], 5, { editionDateFallback: true },
    );
    expect(selected[0]?.title).toContain("令和8年9月分");
  });

  it("with the fallback off, dateless candidates keep their provider order", () => {
    const older = editioned(
      "一般職業紹介状況（令和7年12月分）", "https://www.stat.go.jp/a", "stat.go.jp",
    );
    const newer = editioned(
      "一般職業紹介状況（令和8年9月分）", "https://www.e-stat.go.jp/b", "e-stat.go.jp",
    );
    const { selected } = selectOriginSearchSourcesWithObservation([older, newer], 5);
    expect(selected[0]?.title).toContain("令和7年12月分");
  });

  it("a real publishedAt still outranks the edition fallback", () => {
    const dated = {
      ...editioned("日付のあるページ", "https://www.stat.go.jp/a", "stat.go.jp"),
      publishedAt: "2026-11-01T00:00:00.000Z",
    };
    const editionOnly = editioned(
      "一般職業紹介状況（令和8年9月分）", "https://www.e-stat.go.jp/b", "e-stat.go.jp",
    );
    const { selected } = selectOriginSearchSourcesWithObservation(
      [editionOnly, dated], 5, { editionDateFallback: true },
    );
    expect(selected[0]?.title).toBe("日付のあるページ");
  });
});

/* ------------------------------------------------------------------ */
/* Follow-up measure A: extract fires for statistical + official     */
/* (ANSWER_SOURCES_ONLY_DIAGNOSIS_2026-11-26). The pools below are   */
/* snippet-rich (>= 600 chars) and the questions are fresh_general,  */
/* so neither pre-existing extract condition can fire: any extract   */
/* call observed is the new condition's, and only its.               */
/* ------------------------------------------------------------------ */

describe("executeOriginSearchGrounding — follow-up measure A (statistical + official extract)", () => {
  const EXTRACT_MARKER = "抽出された公表本文です。完全失業率は2.4%でした。";

  function statisticalExtractFetch() {
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { include_domains?: string[] };
        if (body.include_domains?.includes("stat.go.jp")) return jsonResponse({ results: [STAT_RESULT] });
        return jsonResponse({ results: [BLOG_RESULT] });
      }
      if (url.includes("api.tavily.com/extract")) {
        // URL-faithful: a page comes back only when it was actually
        // requested (measure 5-3c's release-page fetch asks for the
        // labour topic's release URLs and gets nothing here).
        const body = JSON.parse(init?.body ?? "{}") as { urls?: string[] };
        return jsonResponse({
          results: (body.urls ?? []).includes(STAT_RESULT.url)
            ? [{ url: STAT_RESULT.url, raw_content: EXTRACT_MARKER }]
            : [],
          failed_results: [],
        });
      }
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    return { fetchImpl, calls };
  }

  it("statistical question with an official source adopted: extract fires and the body replaces the snippet", async () => {
    const { fetchImpl, calls } = statisticalExtractFetch();
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(F06_QUESTION, deps));
    const extractCalls = calls.filter((call) => call.url.includes("api.tavily.com/extract"));
    // Two extract calls in total: measure 5-3c's release-page fetch
    // (asks for the topic's release URLs, gets nothing here) and the
    // extract STAGE's call — the one carrying the adopted pool's
    // URLs — which is this measure's subject and fires exactly once.
    const stageExtractCalls = extractCalls.filter((call) =>
      (JSON.parse(call.init?.body ?? "{}") as { urls?: string[] }).urls?.includes(STAT_RESULT.url));
    expect(stageExtractCalls).toHaveLength(1);
    const official = outcome.sources.find((source) => source.domain === "stat.go.jp");
    expect(official).toBeDefined();
    expect(official?.evidenceLevel).toBe("extracted");
    expect(official?.excerpt).toContain(EXTRACT_MARKER);
    // Two searches + one extract page = three credits, honestly recorded.
    expect(deps.counter?.usage("tavily", NOW)).toBe(3);
    // Round-3 measure D (minimal form): which adopted sources the
    // extract stage actually read rides the research result as
    // domains only, so the next re-measurement can tell "the
    // summary page was adopted" apart from "its body was read".
    const result = originSearchGroundingToResearchResult(outcome);
    expect(result?.grounding?.extractedDomains).toEqual(["stat.go.jp"]);
  });

  it("statistical question but NO official source in the adopted pool: extract does not fire", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { include_domains?: string[] };
        if (body.include_domains) return jsonResponse({ results: [] });
        return jsonResponse({
          results: [{ ...BLOG_RESULT, published_date: "2026-11-18T00:00:00.000Z" }],
        });
      }
      if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(F06_QUESTION, deps));
    expect(outcome.sources.some((source) => source.authorityTier === "official")).toBe(false);
    // The extract STAGE never fires — its condition needs an adopted
    // official source. The single extract call is measure 5-3c's
    // release-page fetch (candidate generation, not the stage),
    // whose mock returns nothing, so the pool stays official-free.
    const extractCalls = calls.filter((call) => call.url.includes("api.tavily.com/extract"));
    expect(extractCalls).toHaveLength(1);
    const releaseFetchBody = JSON.parse(extractCalls[0]?.init?.body ?? "{}") as { urls?: string[] };
    expect(releaseFetchBody.urls).toEqual([
      "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/index.html",
      "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/pdf/gaiyou.pdf",
    ]);
  });

  it("non-statistical question with an official source adopted: extract does not fire", async () => {
    const kanteiResult = {
      title: "首相官邸ホームページ 日本の主要なニュース",
      url: "https://www.kantei.go.jp/jp/104/actions/index.html",
      content: "日本に関する主要なニュースの概要を掲載しています。".repeat(40),
      score: 0.9,
      published_date: "2026-11-18T00:00:00.000Z",
    };
    const newsResult = {
      title: "主要ニュースまとめ",
      url: "https://news.example.com/top",
      content: "日本に関する主要なニュースを3つ紹介します。".repeat(40),
      score: 0.85,
      published_date: "2026-11-18T00:00:00.000Z",
    };
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) return jsonResponse({ results: [kanteiResult, newsResult] });
      if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(
      "昨日から今日にかけて、日本に関する主要なニュースを3つ教えてください", deps,
    ));
    // The official source IS adopted — only the statistical half of
    // the new condition is missing, and that alone keeps extract off.
    expect(outcome.sources.some((source) => source.authorityTier === "official")).toBe(true);
    expect(calls.filter((call) => call.url.includes("api.tavily.com/extract"))).toHaveLength(0);
  });

  it("switch OFF: no plan exists, so an adopted official source alone does not fire extract", async () => {
    const datedStat = { ...STAT_RESULT, published_date: "2026-11-18T00:00:00.000Z" };
    const datedBlog = { ...BLOG_RESULT, published_date: "2026-11-18T00:00:00.000Z" };
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) return jsonResponse({ results: [datedStat, datedBlog] });
      if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({ fetchImpl });
    const outcome = groundedOf(await executeOriginSearchGrounding(F06_QUESTION, deps));
    expect(outcome.sources.some((source) => source.authorityTier === "official")).toBe(true);
    expect(calls.filter((call) => call.url.includes("api.tavily.com/extract"))).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Remeasure measures 2-1 / 3-1 / 3-2                                  */
/* (ANSWER_STATISTICS_REMEASURE_DIAGNOSIS_2026-11-26): the regional   */
/* predicate wired into ranking, data-table pages demoted below the   */
/* release summary, and the retry trigger relaxed to "a regional      */
/* value exists while no national official value does".               */
/* ------------------------------------------------------------------ */

describe("assessOfficialMaterialInsufficiency — relaxed regional trigger (measure 3-2)", () => {
  const shape = (partial: Partial<OriginSearchSource>): OriginSearchSource => makeSource(partial);

  it("a secondary value no longer masks a regional-only official pool", () => {
    // The F-06 re-measurement shape: the national figure existed
    // only in a news headline, the quotable value sentence rode a
    // prefectural bureau's fragment, and the national publication
    // itself carried no value in the pool. The old
    // every-value-is-regional condition never fired.
    const assessment = assessOfficialMaterialInsufficiency([
      shape({
        title: "京都労働局 雇用情勢", domain: "jsite.mhlw.go.jp", authorityTier: "official",
        url: "https://jsite.mhlw.go.jp/kyoto-roudoukyoku/jirei_toukei.html",
        excerpt: "京都府の完全失業率は2.6%でした。",
      }),
      shape({
        title: "完全失業率2.4%に改善と報道", domain: "news.example.com", authorityTier: "major-news",
        url: "https://news.example.com/unemployment",
        excerpt: "完全失業率は2.4%でした。",
      }),
      shape({
        title: "労働力調査（基本集計）", domain: "stat.go.jp", authorityTier: "official",
        url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
        excerpt: "労働力調査の結果公表ページです。",
      }),
    ]);
    expect(assessment.sufficient).toBe(false);
    expect(assessment.reason).toBe("regional-only");
    expect(assessment.nationalOfficialValueCount).toBe(0);
  });
});

describe("selectOriginSearchSourcesWithObservation — official sub-ranking (measures 2-1 / 3-1)", () => {
  const official = (
    title: string, url: string, domain: string, providerScore: number,
  ): OriginSearchSource => ({
    title,
    url,
    excerpt: "抜粋",
    providerId: "tavily",
    domain,
    authorityTier: "official",
    evidenceLevel: "snippet",
    providerScore,
  });

  it("demotes a data-table page below the same release's summary page", () => {
    const table = official(
      "四半期別GDP速報 時系列表", "https://www.esri.cao.go.jp/jp/sna/hyou.html", "esri.cao.go.jp", 0.95,
    );
    const summary = official(
      "四半期別GDP速報（1次速報値）", "https://www.esri.cao.go.jp/jp/sna/gaiyou.html", "esri.cao.go.jp", 0.8,
    );
    const { selected } = selectOriginSearchSourcesWithObservation(
      [table, summary], 5, { officialSubRanking: true },
    );
    // Same domain: only the first in the order survives selection,
    // and it must be the summary page despite the lower score.
    expect(selected).toHaveLength(1);
    expect(selected[0]?.url).toBe(summary.url);
  });

  it("with the sub-ranking off, the table page keeps its provider-score win (old order preserved)", () => {
    const table = official(
      "四半期別GDP速報 時系列表", "https://www.esri.cao.go.jp/jp/sna/hyou.html", "esri.cao.go.jp", 0.95,
    );
    const summary = official(
      "四半期別GDP速報（1次速報値）", "https://www.esri.cao.go.jp/jp/sna/gaiyou.html", "esri.cao.go.jp", 0.8,
    );
    const { selected } = selectOriginSearchSourcesWithObservation([table, summary], 5);
    expect(selected[0]?.url).toBe(table.url);
  });

  it("places a regional official below a national official inside the official tier", () => {
    const regional = official(
      "京都労働局 雇用情勢", "https://jsite.mhlw.go.jp/kyoto-roudoukyoku/x.html", "jsite.mhlw.go.jp", 0.95,
    );
    const national = official(
      "労働力調査（基本集計）", "https://www.stat.go.jp/data/roudou/gaiyou.html", "stat.go.jp", 0.8,
    );
    const { selected } = selectOriginSearchSourcesWithObservation(
      [regional, national], 5, { officialSubRanking: true },
    );
    expect(selected[0]?.domain).toBe("stat.go.jp");
    expect(selected[1]?.domain).toBe("jsite.mhlw.go.jp");
  });

  it("with the sub-ranking off, a regional official keeps its provider-score win (old order preserved)", () => {
    const regional = official(
      "京都労働局 雇用情勢", "https://jsite.mhlw.go.jp/kyoto-roudoukyoku/x.html", "jsite.mhlw.go.jp", 0.95,
    );
    const national = official(
      "労働力調査（基本集計）", "https://www.stat.go.jp/data/roudou/gaiyou.html", "stat.go.jp", 0.8,
    );
    const { selected } = selectOriginSearchSourcesWithObservation([regional, national], 5);
    expect(selected[0]?.domain).toBe("jsite.mhlw.go.jp");
  });

  it("pins the data-table page signals", () => {
    expect(isDataTablePage({ title: "四半期別GDP速報 時系列表", url: "https://example.com/a" })).toBe(true);
    expect(isDataTablePage({ title: "完全失業率の時系列データ", url: "https://example.com/a" })).toBe(true);
    expect(isDataTablePage({ title: "統計データ一覧", url: "https://example.com/a" })).toBe(true);
    expect(isDataTablePage({ title: "四半期別GDP速報（1次速報値）", url: "https://example.com/a" })).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Round-4 measures 3-6 + 4-2 (ANSWER_STATISTICS_ROUND4_DIAGNOSIS_   */
/* 2026-11-27): the selection gains an edition key. A source whose   */
/* stated edition is at/past the expected edition tops the official  */
/* sub-ranking (above providerScore); a readably older edition is    */
/* demoted by the data-table key's weight; an unreadable edition is  */
/* neutral. Without an expected edition the order is unchanged.      */
/* ------------------------------------------------------------------ */

describe("selectOriginSearchSourcesWithObservation — edition key (round-4 measures 3-6 + 4-2)", () => {
  const official = (
    title: string, url: string, domain: string, providerScore: number,
  ): OriginSearchSource => ({
    title,
    url,
    excerpt: "抜粋",
    providerId: "tavily",
    domain,
    authorityTier: "official",
    evidenceLevel: "snippet",
    providerScore,
  });
  const expectedSeptember: OriginOfficialEdition = {
    year: 2026, month: 9, label: "令和8年9月分", sortKey: 202609,
  };
  const expectedQ3: OriginOfficialEdition = {
    year: 2026, month: 9, quarter: 3, label: "2026年7-9月期", sortKey: 202609,
  };

  it("B3 shape: the edition-matching monthly release wins its domain slot over a higher-scored edition-less page", () => {
    const monthly = official(
      "労働力調査（基本集計）2026年（令和8年）9月分結果",
      "https://www.stat.go.jp/data/roudou/sokuhou/tsuki.html", "stat.go.jp", 0.6,
    );
    const editionless = official(
      "労働力調査（基本集計）結果公表ページ",
      "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html", "stat.go.jp", 0.95,
    );
    const { selected } = selectOriginSearchSourcesWithObservation(
      [editionless, monthly], 5,
      { officialSubRanking: true, expectedEdition: expectedSeptember },
    );
    // Same domain: only the first in the order survives, and the
    // edition key — not the provider score — decides it.
    expect(selected).toHaveLength(1);
    expect(selected[0]?.url).toBe(monthly.url);
  });

  it("a newer-than-expected edition also counts as current (the expected edition is a lower bound)", () => {
    const october = official(
      "労働力調査（基本集計）2026年（令和8年）10月分結果",
      "https://www.stat.go.jp/data/roudou/sokuhou/tsuki.html", "stat.go.jp", 0.6,
    );
    const editionless = official(
      "労働力調査（基本集計）結果公表ページ",
      "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html", "stat.go.jp", 0.95,
    );
    const { selected } = selectOriginSearchSourcesWithObservation(
      [editionless, october], 5,
      { officialSubRanking: true, expectedEdition: expectedSeptember },
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.url).toBe(october.url);
  });

  it("B2 shape: the current quarter's summary leads, an edition-less page follows, and the stale quarter is demoted below both", () => {
    const current = official(
      "四半期別GDP速報（2026年7-9月期）1次速報 結果の概要",
      "https://www.esri.cao.go.jp/jp/sna/gaiyou.html", "www.esri.cao.go.jp", 0.6,
    );
    const portal = official(
      "四半期別GDP速報 e-Stat 政府統計の総合窓口",
      "https://www.e-stat.go.jp/stat-search", "www.e-stat.go.jp", 0.9,
    );
    const stale = official(
      "四半期別GDP速報（2025年10-12月期）1次速報 結果の概要",
      "https://www5.cao.go.jp/keizai3/getsurei/gaiyou.html", "www5.cao.go.jp", 0.95,
    );
    const { selected } = selectOriginSearchSourcesWithObservation(
      [stale, portal, current], 5,
      { officialSubRanking: true, expectedEdition: expectedQ3 },
    );
    expect(selected.map((source) => source.url)).toEqual([current.url, portal.url, stale.url]);
  });

  it("without an expected edition, the pre-round-4 order is preserved (provider score decides)", () => {
    const monthly = official(
      "労働力調査（基本集計）2026年（令和8年）9月分結果",
      "https://www.stat.go.jp/data/roudou/sokuhou/tsuki.html", "stat.go.jp", 0.6,
    );
    const editionless = official(
      "労働力調査（基本集計）結果公表ページ",
      "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html", "stat.go.jp", 0.95,
    );
    const { selected } = selectOriginSearchSourcesWithObservation(
      [monthly, editionless], 5, { officialSubRanking: true },
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.url).toBe(editionless.url);
  });

  it("the edition key stays inside the official tier: an unofficial page's title edition changes nothing", () => {
    const news = {
      ...official(
        "完全失業率は2.4%（2026年9月分）",
        "https://www.nikkei.com/article/1", "www.nikkei.com", 0.99,
      ),
      authorityTier: "major-news" as const,
    };
    const monthly = official(
      "労働力調査（基本集計）2026年（令和8年）9月分結果",
      "https://www.stat.go.jp/data/roudou/sokuhou/tsuki.html", "stat.go.jp", 0.6,
    );
    const { selected } = selectOriginSearchSourcesWithObservation(
      [monthly, news], 5,
      { officialSubRanking: true, expectedEdition: expectedSeptember },
    );
    // Tier still dominates: the official release leads, the news
    // page follows on its own tier's order.
    expect(selected.map((source) => source.domain)).toEqual(["stat.go.jp", "www.nikkei.com"]);
  });
});

describe("executeOriginSearchGrounding — summary page wins the extract slot (measure 2-1)", () => {
  const GDP_QUESTION = "直近に公表された日本の実質GDP成長率（四半期）を教えてください。";
  const GDP_TABLE_RESULT = {
    title: "四半期別GDP速報 時系列表",
    url: "https://www.esri.cao.go.jp/jp/sna/data/data_list/sokuhou/hyou/main.html",
    content: `${LONG_EXCERPT} 実質GDPの時系列データを掲載しています。`,
    score: 0.95,
  };
  const GDP_SUMMARY_RESULT = {
    title: "四半期別GDP速報（1次速報値）",
    url: "https://www.esri.cao.go.jp/jp/sna/data/data_list/sokuhou/gaiyou/gaiyou.html",
    content: `${LONG_EXCERPT} 実質GDP成長率は前期比で-0.0%、年率換算で-0.1%でした。`,
    score: 0.8,
  };
  const GDP_NEWS_RESULT = {
    title: "GDP速報を伝える報道",
    url: "https://news.example.com/gdp",
    content: LONG_EXCERPT,
    score: 0.7,
    published_date: "2026-11-16T00:00:00.000Z",
  };
  const SUMMARY_MARKER = "抽出された要約本文です。実質GDP成長率は前期比で-0.0%でした。";
  const TABLE_MARKER = "抽出された時系列表本文です。";

  it("extracts the summary page, not the higher-scored time-series table page", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { include_domains?: string[] };
        if (body.include_domains?.includes("esri.cao.go.jp")) {
          return jsonResponse({ results: [GDP_TABLE_RESULT, GDP_SUMMARY_RESULT] });
        }
        return jsonResponse({ results: [GDP_NEWS_RESULT] });
      }
      if (url.includes("api.tavily.com/extract")) {
        return jsonResponse({
          results: [
            { url: GDP_SUMMARY_RESULT.url, raw_content: SUMMARY_MARKER },
            { url: GDP_TABLE_RESULT.url, raw_content: TABLE_MARKER },
            { url: GDP_NEWS_RESULT.url, raw_content: "抽出された報道本文です。" },
          ],
          failed_results: [],
        });
      }
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(GDP_QUESTION, deps));

    const extractCalls = calls.filter((call) => call.url.includes("api.tavily.com/extract"));
    expect(extractCalls).toHaveLength(1);
    const extractBody = JSON.parse(extractCalls[0]?.init?.body ?? "{}") as { urls?: string[] };
    expect(extractBody.urls).toContain(GDP_SUMMARY_RESULT.url);
    expect(extractBody.urls).not.toContain(GDP_TABLE_RESULT.url);

    const adopted = outcome.sources.find((source) => source.domain === "esri.cao.go.jp");
    expect(adopted?.url).toBe(GDP_SUMMARY_RESULT.url);
    expect(adopted?.evidenceLevel).toBe("extracted");
    expect(adopted?.excerpt).toContain(SUMMARY_MARKER);
  });
});

/* ------------------------------------------------------------------ */
/* Round-3 measures (ANSWER_STATISTICS_ROUND3_DIAGNOSIS_2026-11-26)    */
/* ------------------------------------------------------------------ */

describe("executeOriginSearchGrounding — round-3 measures 3-3 + 3-4 (B3: unreadable edition)", () => {
  // The production B3 pool: a national official page carries A
  // value, but its title states no edition in any form the parser
  // knew, so the 2c stale judgement never stood, the pool read as
  // sufficient and the retry never fired — while the bureau's
  // actual release page carries the dual-calendar composite title
  // the parser also could not read. Both halves are pinned here:
  // the unreadable pool fires the stale-edition retry, and the
  // composite-titled current release is adopted by it.
  const UNREADABLE_STAT_RESULT = {
    title: "労働力調査（基本集計）完全失業率 総務省統計局",
    url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
    content: `${LONG_EXCERPT} 完全失業率は2.6%でした。`,
    score: 0.9,
  };
  const B3_NEWS_RESULT = {
    title: "完全失業率は2.4% 総務省が発表",
    url: "https://www.nikkei.com/article/b3-news",
    content: `${LONG_EXCERPT} 完全失業率は2.4%でした。`,
    score: 0.8,
    published_date: "2026-11-18T00:00:00.000Z",
  };
  const COMPOSITE_RELEASE_RESULT = {
    title: "労働力調査（基本集計）2026年（令和8年）9月分結果",
    url: "https://www.stat.go.jp/data/roudou/sokuhou/tsuki.html",
    content: `${LONG_EXCERPT} 完全失業率は2.4%でした。`,
    score: 0.95,
  };

  it("a national official value with no readable edition fires the stale-edition retry, which adopts the composite-titled current release", async () => {
    const calls: RecordedCall[] = [];
    let statRestrictedCalls = 0;
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { query?: string; include_domains?: string[] };
        if (body.include_domains?.includes("stat.go.jp")) {
          // The first official search returns the unreadable-edition
          // page; the retry returns the composite-titled release.
          // Since round-5 measure 5-3a both passes use the same
          // short release-form query text, the mock distinguishes
          // them by call order.
          statRestrictedCalls += 1;
          return jsonResponse({
            results: [statRestrictedCalls >= 2 ? COMPOSITE_RELEASE_RESULT : UNREADABLE_STAT_RESULT],
          });
        }
        return jsonResponse({ results: [B3_NEWS_RESULT] });
      }
      if (url.includes("api.tavily.com/extract")) return jsonResponse({ results: [], failed_results: [] });
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(F06_QUESTION, deps));
    expect(outcome.candidateStats?.officialRetry).toMatchObject({
      reason: "stale-edition",
      fired: true,
      candidateCount: 1,
      keptCount: 1,
      adoptedCount: 1,
    });
    expect(outcome.queriesIssued.map((query) => query.kind)).toContain("official-retry");
    const adoptedUrls = outcome.sources.map((source) => source.url);
    expect(adoptedUrls).toContain(COMPOSITE_RELEASE_RESULT.url);
  });
});

describe("executeOriginSearchGrounding — round-3 measure 2-3 (B2: the summary's extract slot is guaranteed)", () => {
  const GDP_QUESTION = "直近に公表された日本の実質GDP成長率（四半期）を教えてください。";
  // The round-3 production shape: the release summary IS adopted,
  // but two edition-less national official pages (a schedule page,
  // a portal page) outrank it on provider score, and the release's
  // own data-table page competes in the same pool. The pool's head
  // alone would leave the summary's body unread.
  const CAO_SCHEDULE_RESULT = {
    title: "四半期別GDP速報 公表日程のお知らせ",
    url: "https://www.cao.go.jp/schedule.html",
    content: `${LONG_EXCERPT} 四半期別GDP速報の公表日程を掲載しています。`,
    score: 0.97,
  };
  const ESTAT_PORTAL_RESULT = {
    title: "e-Stat 政府統計の総合窓口 四半期別GDP速報",
    url: "https://www.e-stat.go.jp/stat-search",
    content: `${LONG_EXCERPT} 政府統計のポータルサイトです。`,
    score: 0.9,
  };
  const GDP_TABLE_RESULT = {
    title: "四半期別GDP速報 時系列表",
    url: "https://www.esri.cao.go.jp/jp/sna/data/data_list/sokuhou/hyou/main.html",
    content: `${LONG_EXCERPT} 実質GDPの時系列データを掲載しています。`,
    score: 0.95,
  };
  const GDP_SUMMARY_PDF_RESULT = {
    title: "四半期別GDP速報（2026年7-9月期）1次速報 結果の概要",
    url: "https://www.esri.cao.go.jp/jp/sna/data/data_list/sokuhou/gaiyou/pdf/main_1.pdf",
    content: `${LONG_EXCERPT} 2026年7～9月期の実質ＧＤＰの成長率は、`,
    score: 0.8,
  };
  const SUMMARY_MARKER = "抽出された要約本文です。実質GDP成長率は前期比で-0.0%でした。";

  it("extracts the release summary even when edition-less officials hold both head slots", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { include_domains?: string[] };
        if (body.include_domains?.includes("esri.cao.go.jp")) {
          return jsonResponse({ results: [GDP_TABLE_RESULT, GDP_SUMMARY_PDF_RESULT] });
        }
        return jsonResponse({ results: [CAO_SCHEDULE_RESULT, ESTAT_PORTAL_RESULT, GDP_NEWS_RESULT_FOR_GUARANTEE] });
      }
      if (url.includes("api.tavily.com/extract")) {
        const body = JSON.parse(init?.body ?? "{}") as { urls?: string[] };
        return jsonResponse({
          results: (body.urls ?? []).map((targetUrl) => ({
            url: targetUrl,
            raw_content: targetUrl === GDP_SUMMARY_PDF_RESULT.url ? SUMMARY_MARKER : "抽出された公式本文です。",
          })),
          failed_results: [],
        });
      }
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(GDP_QUESTION, deps));

    const extractCalls = calls.filter((call) => call.url.includes("api.tavily.com/extract"));
    expect(extractCalls).toHaveLength(1);
    const extractBody = JSON.parse(extractCalls[0]?.init?.body ?? "{}") as { urls?: string[] };
    expect(extractBody.urls).toContain(GDP_SUMMARY_PDF_RESULT.url);
    expect(extractBody.urls).not.toContain(ESTAT_PORTAL_RESULT.url);
    expect(extractBody.urls).not.toContain(GDP_TABLE_RESULT.url);

    const summary = outcome.sources.find((source) => source.url === GDP_SUMMARY_PDF_RESULT.url);
    expect(summary?.evidenceLevel).toBe("extracted");
    expect(summary?.excerpt).toContain(SUMMARY_MARKER);
    // Measure D (minimal form): the extract's reach is observable
    // on the research result as domains.
    const result = originSearchGroundingToResearchResult(outcome);
    expect(result?.grounding?.extractedDomains).toContain("esri.cao.go.jp");
  });

  const GDP_NEWS_RESULT_FOR_GUARANTEE = {
    title: "GDP速報を伝える報道",
    url: "https://news.example.com/gdp-guarantee",
    content: LONG_EXCERPT,
    score: 0.7,
    published_date: "2026-11-16T00:00:00.000Z",
  };
});

/* ------------------------------------------------------------------ */
/* Round-6 measure 6-2 = measure 5-3c: deterministic release-page    */
/* candidates (ANSWER_STATISTICS_ROUND6_DIAGNOSIS_2026-11-27 §3;     */
/* design memo ANSWER_STATISTICS_ROUND5_MEASURE53C_DESIGN_MEMO).     */
/* The production B3 shape: across two rounds and three query        */
/* shapes the Labour Force Survey's monthly release page never       */
/* entered the candidate pool — the provider's index simply does     */
/* not return it. The topic table now carries the page's persistent  */
/* URLs, fetched directly into the pool when the plan fires.         */
/* ------------------------------------------------------------------ */

const RELEASE_PAGE_HTML_URL = "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/index.html";
const RELEASE_PAGE_PDF_URL = "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/pdf/gaiyou.pdf";
// The September 2026 release as the page states it: the value as an
// ordinary sentence, and the publication date in the text (the
// extract route reports no provider date).
const RELEASE_PAGE_TEXT =
  "労働力調査（基本集計）2026年（令和8年）9月分結果の概要。就業者数は6816万人でした。"
  + "完全失業率（季節調整値）は2.4％。前月に比べ0.1ポイントの低下。2026年10月31日に公表しました。";

describe("planOriginOfficialSourceQueries — release pages (measure 5-3c)", () => {
  it("the labour-force plan carries the topic's confirmed release page URLs", () => {
    const plan = planOriginOfficialSourceQueries(F06_QUESTION, NOW);
    expect(plan?.queries[0]?.topic).toBe("labour-force-statistics");
    expect(plan?.queries[0]?.releasePageUrls).toEqual([RELEASE_PAGE_HTML_URL, RELEASE_PAGE_PDF_URL]);
  });

  it("topics without confirmed release pages carry none (B1 and GDP unchanged)", () => {
    const b1 = planOriginOfficialSourceQueries("最新の有効求人倍率を教えてください。いつの分ですか？", NOW);
    expect(b1?.queries[0]?.topic).toBe("employment-and-pension");
    expect(b1?.queries[0]?.releasePageUrls).toBeUndefined();
    // GDP was checked and deliberately left out (round-6 diagnosis
    // §5, measure 6-3): the release summary exists only as an
    // edition-named PDF (a per-edition URL, which the field
    // forbids) and as a persistent-named DATA-TABLE PDF — the
    // document form round-6 §2 showed carries no quotable value
    // sentence. The ESRI menu page states the headline only as a
    // dashboard fragment (前期比 only, no 年率）, not the release's
    // value sentence.
    const gdp = planOriginOfficialSourceQueries("実質GDPの最新値を教えてください", NOW);
    expect(gdp?.queries[0]?.topic).toBe("gdp-and-economy");
    expect(gdp?.queries[0]?.releasePageUrls).toBeUndefined();
  });
});

describe("executeOriginSearchGrounding — measure 5-3c (deterministic release-page candidates)", () => {
  function releasePageAwareFetch(options?: { failExtract?: boolean }) {
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { include_domains?: string[] };
        // The production B3 shape: NEITHER search returns the
        // monthly release page — a value-less navigation page and
        // a blog are all the pool would ever hold.
        if (body.include_domains?.includes("stat.go.jp")) return jsonResponse({ results: [JILPT_NAV_RESULT] });
        return jsonResponse({ results: [BLOG_RESULT] });
      }
      if (url.includes("api.tavily.com/extract")) {
        if (options?.failExtract) throw new Error("extract unavailable");
        const body = JSON.parse(init?.body ?? "{}") as { urls?: string[] };
        const results = (body.urls ?? [])
          .filter((target) => target === RELEASE_PAGE_HTML_URL || target === RELEASE_PAGE_PDF_URL)
          .map((target) => ({ url: target, raw_content: RELEASE_PAGE_TEXT }));
        return jsonResponse({ results, failed_results: [] });
      }
      const host = new URL(url).hostname;
      if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return jsonResponse({ pages: [] });
      throw new Error(`unexpected URL: ${url}`);
    };
    return { fetchImpl, calls };
  }

  it("the release page enters the pool deterministically and is adopted, though no search returned it", async () => {
    const { fetchImpl, calls } = releasePageAwareFetch();
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(F06_QUESTION, deps));
    // The HTML release page was adopted with its official tier and
    // the extracted body; its title is the publication name.
    const release = outcome.sources.find((source) => source.url === RELEASE_PAGE_HTML_URL);
    expect(release).toBeDefined();
    expect(release?.authorityTier).toBe("official");
    expect(release?.evidenceLevel).toBe("extracted");
    expect(release?.title).toBe("労働力調査 基本集計");
    expect(release?.excerpt).toContain("完全失業率（季節調整値）は2.4％");
    expect(release?.dateVerified).toBe(true);
    // The summary PDF is a candidate too, but packet selection's
    // one-source-per-domain rule leaves the domain's slot to the
    // HTML page ahead of it — candidacy is deterministic,
    // adoption is not.
    expect(outcome.sources.some((source) => source.url === RELEASE_PAGE_PDF_URL)).toBe(false);
    expect(outcome.candidateStats?.domainCounts["stat.go.jp"]).toBe(2);
    // The fetch is recorded per URL, in table order (memo §2.4).
    const releaseIssued = (outcome.queriesIssued ?? []).filter((issued) => issued.kind === "official-release-page");
    expect(releaseIssued).toEqual([
      { provider: "tavily", kind: "official-release-page", query: RELEASE_PAGE_HTML_URL, url: RELEASE_PAGE_HTML_URL },
      { provider: "tavily", kind: "official-release-page", query: RELEASE_PAGE_PDF_URL, url: RELEASE_PAGE_PDF_URL },
    ]);
    // …and the same records reach the research result's metadata.
    const result = originSearchGroundingToResearchResult(outcome);
    expect(result.grounding?.queriesIssued?.filter((issued) => issued.kind === "official-release-page"))
      .toHaveLength(2);
    // The release page's edition cannot be read from its title or
    // URL, so the edition-keyed assessment stays cautious and the
    // insufficiency retry still fires — the deterministic candidate
    // passes through the same gates as every search candidate.
    expect(outcome.candidateStats?.officialRetry).toMatchObject({ reason: "stale-edition", fired: true });
    // Honest accounting: 3 searches (ordinary + official + retry)
    // + the batched release extract (2 pages = 1 credit) + the
    // extract stage's call (1 page back = 1 credit).
    expect(deps.counter?.usage("tavily", NOW)).toBe(5);
    expect(calls.filter((call) => call.url.includes("api.tavily.com/search"))).toHaveLength(3);
  });

  it("a failed release-page fetch is fail-open: the search pool grounds exactly as before", async () => {
    const { fetchImpl: baseFetch } = releasePageAwareFetch({ failExtract: true });
    // The search pool must ground on its own for this pin, so the
    // ordinary result is dated (the undated blog of the other tests
    // cannot carry a fresh_general pool alone — pre-existing gate
    // behaviour, unrelated to the release fetch).
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { include_domains?: string[] };
        if (!body.include_domains) {
          return jsonResponse({
            results: [{ ...BLOG_RESULT, published_date: "2026-11-18T00:00:00.000Z" }],
          });
        }
      }
      return baseFetch(url, init);
    };
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = groundedOf(await executeOriginSearchGrounding(F06_QUESTION, deps));
    expect(outcome.sources.some((source) => source.url === RELEASE_PAGE_HTML_URL)).toBe(false);
    expect(outcome.sources.some((source) => source.url === RELEASE_PAGE_PDF_URL)).toBe(false);
    expect(outcome.sources.some((source) => source.domain === "blog.example.com")).toBe(true);
    // The fetch WAS attempted, so its records stand even though it
    // produced no candidates.
    expect((outcome.queriesIssued ?? []).filter((issued) => issued.kind === "official-release-page"))
      .toHaveLength(2);
  });

  it("switch OFF: no release-page fetch is attempted and no record is written", async () => {
    const { fetchImpl, calls } = releasePageAwareFetch();
    const deps = makeDeps({ fetchImpl });
    await executeOriginSearchGrounding(F06_QUESTION, deps);
    expect(calls.every((call) => !(call.init?.body ?? "").includes("sokuhou/tsuki"))).toBe(true);
  });

  it("a topic without release pages (B1) never fetches one, even with the switch on", async () => {
    const { fetchImpl, calls } = officialAwareFetch();
    const deps = makeDeps({
      fetchImpl,
      env: { TAVILY_API_KEY: "tvly-test-key", ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE: "true" },
    });
    const outcome = await executeOriginSearchGrounding(
      "最新の有効求人倍率を教えてください。いつの分ですか？", deps,
    );
    const issued = outcome.kind === "not-applicable" ? [] : (outcome.queriesIssued ?? []);
    expect(issued.some((entry) => entry.kind === "official-release-page")).toBe(false);
    expect(calls.every((call) => !(call.init?.body ?? "").includes("sokuhou/tsuki"))).toBe(true);
  });
});
