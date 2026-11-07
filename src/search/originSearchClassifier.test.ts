import { describe, expect, it } from "vitest";
import {
  classifyOriginSearchQuestion,
  extractOriginWeatherPlace,
  minimizeOriginSearchQuery,
  ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS,
} from "./originSearchClassifier";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("classifyOriginSearchQuestion", () => {
  it("classifies a weather question with its place", () => {
    const result = classifyOriginSearchQuestion("明日の東京の天気と、最高・最低気温、降水確率を教えてください");
    expect(result.type).toBe("weather");
    expect(result.place).toBe("東京");
  });

  it("classifies rain questions as weather", () => {
    expect(classifyOriginSearchQuestion("今週末の大阪は雨が降りそうですか？").type).toBe("weather");
  });

  it("classifies breaking-news questions as news with a strict 3-day window", () => {
    const result = classifyOriginSearchQuestion("昨日から今日にかけて、日本に関する主要なニュースを3つ教えてください");
    expect(result.type).toBe("news");
    expect(result.freshness?.strictPublicationDate).toBe(true);
    expect(result.freshness?.maxSourceAgeMs).toBe(3 * DAY_MS);
    expect(result.freshness?.tavilyTopic).toBe("news");
  });

  it("classifies sports results as news", () => {
    expect(classifyOriginSearchQuestion("サッカー日本代表の直近の試合結果を教えてください").type).toBe("news");
  });

  it("classifies FX / index questions as market with a 1-day window", () => {
    const result = classifyOriginSearchQuestion("現在のドル円レートと、日経平均株価の直近の終値を教えてください");
    expect(result.type).toBe("market");
    expect(result.freshness?.maxSourceAgeMs).toBe(1 * DAY_MS);
    expect(result.freshness?.tavilyTimeRange).toBe("day");
  });

  it("classifies product price / release questions as price_spec", () => {
    const result = classifyOriginSearchQuestion("iPhone の最新モデルの、日本での価格と発売日を教えてください");
    expect(result.type).toBe("price_spec");
    expect(result.freshness?.maxSourceAgeMs).toBe(28 * DAY_MS);
    expect(result.freshness?.tavilyTimeRange).toBe("month");
  });

  it("classifies spec questions for a named product as price_spec", () => {
    expect(classifyOriginSearchQuestion("最新の MacBook Air のチップ、メモリ、価格を教えてください").type).toBe("price_spec");
  });

  it("classifies a nonexistent product's price question as price_spec (grounding must fail later, not the classifier)", () => {
    expect(classifyOriginSearchQuestion("「ORIGIN Phone X2」というスマホの価格と発売日を教えてください").type).toBe("price_spec");
  });

  it("classifies wage / benefit questions as policy with a 180-day window", () => {
    const wage = classifyOriginSearchQuestion("現在の最低賃金（全国平均と東京都）と、いつの改定のものか教えてください");
    expect(wage.type).toBe("policy");
    expect(wage.freshness?.maxSourceAgeMs).toBe(180 * DAY_MS);
    expect(classifyOriginSearchQuestion("児童手当の現在の支給額と対象年齢を教えてください").type).toBe("policy");
  });

  it("classifies general latest-information questions as fresh_general capped at 1 year", () => {
    const result = classifyOriginSearchQuestion("ChatGPT の最新モデルの名前と主な特徴を教えてください");
    expect(result.type).toBe("fresh_general");
    expect(result.freshness?.maxSourceAgeMs).toBe(365 * DAY_MS);
    expect(result.freshness?.tavilyTimeRange).toBe("year");
    expect(classifyOriginSearchQuestion("日本の消費者物価指数の直近公表分の前年比と、その公表日を教えてください").type).toBe("fresh_general");
    expect(classifyOriginSearchQuestion("Android の最新バージョンと、配信が始まった時期を教えてください").type).toBe("fresh_general");
  });

  it("classifies definition questions as stable without a freshness limit", () => {
    const result = classifyOriginSearchQuestion("光合成とは何ですか？意味を教えてください");
    expect(result.type).toBe("stable");
    expect(result.freshness?.maxSourceAgeMs).toBeNull();
    expect(ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS.stable.maxSourceAgeMs).toBeNull();
  });

  it("does not treat a weather concept question as a forecast", () => {
    expect(classifyOriginSearchQuestion("天気とは何ですか").type).toBe("stable");
  });

  it("does not treat a pricing concept question as a live price lookup", () => {
    expect(classifyOriginSearchQuestion("価格戦略とは何ですか").type).toBe("stable");
  });

  it("keeps plain factual questions on the normal chat path", () => {
    expect(classifyOriginSearchQuestion("日本の首都はどこですか？").type).toBe("no_search");
  });

  it("keeps transformations of supplied text off the search path", () => {
    expect(classifyOriginSearchQuestion("この文章を要約してください：人工知能は発展している").type).toBe("no_search");
  });

  it("keeps deterministic calculations off the search path", () => {
    expect(classifyOriginSearchQuestion("17 × 24 はいくつですか？計算してください").type).toBe("no_search");
  });

  it("keeps ordinary chat off the search path", () => {
    expect(classifyOriginSearchQuestion("猫の短い詩を書いてください").type).toBe("no_search");
    expect(classifyOriginSearchQuestion("").type).toBe("no_search");
  });
});

describe("minimizeOriginSearchQuery", () => {
  it("strips personal data and framing from the outgoing query", () => {
    const query = minimizeOriginSearchQuery(
      "私のメール taro.yamada@example.com と電話 090-1234-5678 について、最新の iPhone の価格を教えてください。郵便番号は 123-4567 です",
    );
    expect(query).not.toContain("taro.yamada@example.com");
    expect(query).not.toContain("090");
    expect(query).not.toContain("1234");
    expect(query).not.toContain("123-4567");
    expect(query).not.toContain("教えてください");
    expect(query).not.toContain("私の");
    expect(query).toContain("iPhone");
    expect(query).toContain("価格");
  });

  it("strips URLs and long numeric IDs", () => {
    const query = minimizeOriginSearchQuery("注文番号 123456789012 の商品 https://example.com/item の価格を教えて");
    expect(query).not.toContain("123456789012");
    expect(query).not.toContain("https://example.com");
  });

  it("never returns the raw question unchanged when framing is present", () => {
    const raw = "東京の天気を教えてください";
    const query = minimizeOriginSearchQuery(raw);
    expect(query).not.toBe(raw);
    expect(query).toContain("東京");
    expect(query).toContain("天気");
  });
});

describe("extractOriginWeatherPlace", () => {
  it("prefers an explicit user location", () => {
    expect(extractOriginWeatherPlace("天気は？", "大阪市")).toBe("大阪市");
  });

  it("finds known Japanese places", () => {
    expect(extractOriginWeatherPlace("明日の大阪の天気を教えて")).toBe("大阪");
    expect(extractOriginWeatherPlace("今日の札幌の天気は？")).toBe("札幌");
  });

  it("maps English city names to canonical Japanese names for geocoding", () => {
    expect(extractOriginWeatherPlace("What is the weather in London tomorrow?")).toBe("ロンドン");
  });

  it("returns null when no place can be determined", () => {
    expect(extractOriginWeatherPlace("今日はとても良い天気なので、近くの公園へ散歩に行きたいと思います")).toBeNull();
  });
});
