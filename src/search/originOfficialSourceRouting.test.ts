import { describe, expect, it } from "vitest";
import { ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS } from "./originSearchClassifier";
import {
  evaluateOriginSourceFreshness,
  executeOriginSearchGrounding,
  extractStatedPublicationMs,
  originSearchGroundingToResearchResult,
  selectOriginSearchSourcesWithObservation,
  type OriginSearchGroundingDeps,
  type OriginSearchGroundingOutcome,
} from "./originSearchGrounding";
import { OriginSearchUsageCounter } from "./originSearchProviderCatalog";
import { OriginSearchTtlCache } from "./originSearchCache";
import {
  assessOfficialMaterialInsufficiency,
  buildOfficialRetryQueryText,
  buildOfficialSourceQueryText,
  excerptHasOfficialValueToken,
  isRegionalOfficialSource,
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
  // The value rides the excerpt, so the adopted pool is materially
  // sufficient and the round-8 retry (measure B) does not fire.
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
  const fetchImpl: OriginSearchFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("api.tavily.com/search")) {
      const body = JSON.parse(init?.body ?? "{}") as { query?: string; include_domains?: string[] };
      if (body.include_domains?.includes("stat.go.jp")) {
        // First-pass official search misses; the retry — the release
        // name alone — finds the publication page.
        return jsonResponse({ results: body.query === "労働力調査 基本集計" ? [LABOUR_RELEASE_RESULT] : [] });
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
    expect(outcome.queriesIssued?.map((issued) => issued.kind)).toEqual(["ordinary", "ordinary", "official"]);
  });

  it("F-06 shape: a value-less pool fires exactly ONE retry (the release name alone), which brings the publication page", async () => {
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
    expect(bodies[2]?.query).toBe("労働力調査 基本集計");
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
    expect(outcome.queriesIssued?.map((issued) => issued.kind)).toEqual([
      "ordinary", "ordinary", "official", "official-retry",
    ]);
    expect(outcome.queriesIssued?.[3]).toEqual({
      provider: "tavily", kind: "official-retry", query: "労働力調査 基本集計",
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
      "ordinary", "ordinary", "official", "official-retry",
    ]);
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
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { query?: string; include_domains?: string[] };
        if (body.include_domains?.includes("mhlw.go.jp")) {
          return jsonResponse({ results: body.query === "一般職業紹介状況" ? [mhlwRelease] : [] });
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
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("api.tavily.com/search")) {
        const body = JSON.parse(init?.body ?? "{}") as { query?: string; include_domains?: string[] };
        if (body.query === "一般職業紹介状況 令和8年9月分 2026年9月分") {
          return jsonResponse({ results: [currentRelease] });
        }
        if (body.include_domains?.includes("mhlw.go.jp")) {
          return jsonResponse({ results: [staleRelease] });
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
