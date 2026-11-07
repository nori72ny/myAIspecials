import { describe, expect, it } from "vitest";
import {
  classifyOriginDomainTier,
  composeOriginWeatherText,
  extractTavilyPages,
  fetchOpenMeteoWeather,
  OriginSearchProviderError,
  parseGdeltSeenDate,
  searchGdeltHeadlines,
  searchTavilySources,
  searchWikipediaSources,
  type OriginSearchFetch,
} from "./originSearchProviders";

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

function routedFetch(routes: Array<{ match: string; respond: (call: RecordedCall) => unknown }>) {
  const calls: RecordedCall[] = [];
  const fetchImpl: OriginSearchFetch = async (url, init) => {
    const call: RecordedCall = { url, init };
    calls.push(call);
    for (const route of routes) {
      if (url.includes(route.match)) return jsonResponse(route.respond(call));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  return { fetchImpl, calls };
}

const NOW = Date.parse("2026-11-07T12:00:00.000Z");

describe("fetchOpenMeteoWeather", () => {
  const routes = [
    {
      match: "geocoding-api.open-meteo.com",
      respond: () => ({
        results: [{ name: "東京", admin1: "東京都", country: "日本", latitude: 35.6895, longitude: 139.6917 }],
      }),
    },
    {
      match: "api.open-meteo.com/v1/forecast",
      respond: () => ({
        current: {
          time: "2026-11-07T12:00",
          temperature_2m: 18.5,
          relative_humidity_2m: 55,
          apparent_temperature: 18.1,
          weather_code: 1,
        },
        daily: {
          time: ["2026-11-07", "2026-11-08"],
          weather_code: [1, 61],
          temperature_2m_max: [21.2, 17.4],
          temperature_2m_min: [12.3, 10.1],
          precipitation_probability_max: [20, 80],
        },
      }),
    },
  ];

  it("geocodes the place and parses the forecast", async () => {
    const { fetchImpl, calls } = routedFetch(routes);
    const forecast = await fetchOpenMeteoWeather("東京", { fetchImpl, nowMs: NOW });
    expect(calls[0]?.url).toContain("name=%E6%9D%B1%E4%BA%AC");
    expect(calls[1]?.url).toContain("latitude=35.6895");
    expect(forecast.place).toBe("東京");
    expect(forecast.current.temperatureC).toBe(18.5);
    expect(forecast.current.weatherLabel).toBe("ほぼ晴れ");
    expect(forecast.days).toHaveLength(2);
    expect(forecast.days[1]?.precipitationProbabilityMaxPercent).toBe(80);
  });

  it("composes a deterministic answer text with CC BY attribution", async () => {
    const { fetchImpl } = routedFetch(routes);
    const forecast = await fetchOpenMeteoWeather("東京", { fetchImpl, nowMs: NOW });
    const text = composeOriginWeatherText(forecast);
    expect(text).toContain("東京");
    expect(text).toContain("18.5");
    expect(text).toContain("最高 21.2°C / 最低 12.3°C");
    expect(text).toContain("降水確率 最大80%");
    expect(text).toContain("Open-Meteo");
    expect(text).toContain("CC BY 4.0");
  });

  it("fails with no-results when the place cannot be geocoded", async () => {
    const { fetchImpl } = routedFetch([
      { match: "geocoding-api.open-meteo.com", respond: () => ({ results: [] }) },
    ]);
    await expect(fetchOpenMeteoWeather("存在しない場所", { fetchImpl, nowMs: NOW })).rejects.toMatchObject({
      name: "OriginSearchProviderError",
      code: "no-results",
    });
  });

  const tokyoResult = {
    results: [{ name: "東京", admin1: "東京都", country: "日本", latitude: 35.6895, longitude: 139.6917 }],
  };

  function geocodingByName(cities: Record<string, unknown>) {
    return {
      match: "geocoding-api.open-meteo.com",
      respond: (call: RecordedCall) => {
        const name = new URL(call.url).searchParams.get("name") ?? "";
        return cities[name] ?? { results: [] };
      },
    };
  }

  function geocodingNamesOf(calls: RecordedCall[]): Array<string | null> {
    return calls
      .filter((call) => call.url.includes("geocoding-api.open-meteo.com"))
      .map((call) => new URL(call.url).searchParams.get("name"));
  }

  it("retries a bare Japanese name with administrative suffixes until one resolves", async () => {
    // Mirrors the live behaviour (2026-11-07): name=東京 and name=東京市 return
    // nothing, name=東京都 resolves.
    const { fetchImpl, calls } = routedFetch([
      geocodingByName({ "東京都": tokyoResult }),
      routes[1] as (typeof routes)[number],
    ]);
    const forecast = await fetchOpenMeteoWeather("東京", { fetchImpl, nowMs: NOW });
    expect(forecast.current.temperatureC).toBe(18.5);
    expect(geocodingNamesOf(calls)).toEqual(["東京", "東京市", "東京都"]);
  });

  it("still retries for 京都, whose trailing 都 is part of the proper name", async () => {
    const kyotoResult = {
      results: [{ name: "京都市", admin1: "京都府", country: "日本", latitude: 35.02107, longitude: 135.75385 }],
    };
    const { fetchImpl, calls } = routedFetch([
      geocodingByName({ "京都市": kyotoResult }),
      routes[1] as (typeof routes)[number],
    ]);
    const forecast = await fetchOpenMeteoWeather("京都", { fetchImpl, nowMs: NOW });
    expect(forecast.current.temperatureC).toBe(18.5);
    expect(geocodingNamesOf(calls)).toEqual(["京都", "京都市"]);
  });

  it("does not retry when the name already carries an administrative suffix", async () => {
    const { fetchImpl, calls } = routedFetch([
      geocodingByName({ "東京都": tokyoResult }),
      routes[1] as (typeof routes)[number],
    ]);
    const forecast = await fetchOpenMeteoWeather("東京都", { fetchImpl, nowMs: NOW });
    expect(forecast.current.temperatureC).toBe(18.5);
    expect(geocodingNamesOf(calls)).toEqual(["東京都"]);
  });

  it("tries every suffix candidate before failing with no-results", async () => {
    const { fetchImpl, calls } = routedFetch([
      geocodingByName({}),
      routes[1] as (typeof routes)[number],
    ]);
    await expect(fetchOpenMeteoWeather("札幌", { fetchImpl, nowMs: NOW })).rejects.toMatchObject({
      name: "OriginSearchProviderError",
      code: "no-results",
    });
    expect(geocodingNamesOf(calls)).toEqual(["札幌", "札幌市", "札幌都", "札幌府", "札幌県"]);
  });

  it("does not append suffixes for non-Japanese names", async () => {
    const { fetchImpl, calls } = routedFetch([
      geocodingByName({}),
      routes[1] as (typeof routes)[number],
    ]);
    await expect(fetchOpenMeteoWeather("Tokyo", { fetchImpl, nowMs: NOW })).rejects.toMatchObject({
      name: "OriginSearchProviderError",
      code: "no-results",
    });
    expect(geocodingNamesOf(calls)).toEqual(["Tokyo"]);
  });

  it("does not retry suffix candidates when geocoding itself fails", async () => {
    let geocodingCalls = 0;
    const fetchImpl: OriginSearchFetch = async (url) => {
      if (url.includes("geocoding-api.open-meteo.com")) {
        geocodingCalls += 1;
        return jsonResponse({ reason: "upstream boom" }, 500);
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    await expect(fetchOpenMeteoWeather("東京", { fetchImpl, nowMs: NOW })).rejects.toMatchObject({
      name: "OriginSearchProviderError",
      code: "http",
      status: 500,
    });
    expect(geocodingCalls).toBe(1);
  });
});

describe("searchGdeltHeadlines", () => {
  it("parses articles, converts seendate, drops unsafe URLs and duplicate domains", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "api.gdeltproject.org",
        respond: () => ({
          articles: [
            { url: "https://www3.nhk.or.jp/news/html/20261107/k1001.html", title: "主要ニュース1", domain: "nhk.or.jp", seendate: "20261107T103000Z" },
            { url: "https://www3.nhk.or.jp/news/html/20261107/k1002.html", title: "同じドメインの続報", domain: "nhk.or.jp", seendate: "20261107T113000Z" },
            { url: "http://insecure.example.com/story", title: "httpは除外", domain: "example.com", seendate: "20261107T113000Z" },
            { url: "https://www.asahi.com/articles/DA3S1.html", title: "主要ニュース2", domain: "asahi.com", seendate: "20261107T093000Z" },
          ],
        }),
      },
    ]);
    const sources = await searchGdeltHeadlines("日本 ニュース", { fetchImpl });
    expect(sources).toHaveLength(2);
    expect(sources[0]?.publishedAt).toBe("2026-11-07T10:30:00Z");
    expect(sources[0]?.authorityTier).toBe("major-news");
    expect(sources[0]?.excerpt).toBe("主要ニュース1");
    expect(sources.every((source) => source.url.startsWith("https://"))).toBe(true);
  });

  it("parses only the documented seendate shape", () => {
    expect(parseGdeltSeenDate("20261107T103000Z")).toBe("2026-11-07T10:30:00Z");
    expect(parseGdeltSeenDate("2026-11-07")).toBeUndefined();
    expect(parseGdeltSeenDate(undefined)).toBeUndefined();
  });
});

describe("searchWikipediaSources", () => {
  it("returns encyclopedia sources with revision timestamps and a policy User-Agent", async () => {
    const { fetchImpl, calls } = routedFetch([
      {
        match: "/w/rest.php/v1/search/page",
        respond: () => ({
          pages: [{ key: "光合成", title: "光合成", excerpt: "<span>光合成</span>は植物が光エネルギーを使う反応。" }],
        }),
      },
      {
        match: "/w/rest.php/v1/page/",
        respond: () => ({
          html_url: "https://ja.wikipedia.org/wiki/光合成",
          latest: { timestamp: "2026-10-01T00:00:00Z" },
        }),
      },
    ]);
    const sources = await searchWikipediaSources("光合成 とは", { fetchImpl });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.domain).toBe("ja.wikipedia.org");
    expect(sources[0]?.publishedAt).toBe("2026-10-01T00:00:00Z");
    expect(sources[0]?.excerpt).toContain("植物が光エネルギーを使う反応");
    expect(calls[0]?.init?.headers?.["User-Agent"]).toContain("ORIGIN-Personal");
  });

  it("decodes HTML entities in a single pass without double-decoding", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "/w/rest.php/v1/search/page",
        respond: () => ({
          pages: [{
            key: "Tom_and_Jerry",
            title: "Tom &amp; Jerry &#39;Best&#39; &quot;Show&quot;",
            excerpt: "A &amp; B &lt;x&gt; &amp;lt;",
          }],
        }),
      },
      {
        match: "/w/rest.php/v1/page/",
        respond: () => ({
          html_url: "https://en.wikipedia.org/wiki/Tom_and_Jerry",
          latest: { timestamp: "2026-10-01T00:00:00Z" },
        }),
      },
    ]);
    const sources = await searchWikipediaSources("Tom and Jerry", { fetchImpl });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.title).toBe("Tom & Jerry 'Best' \"Show\"");
    // "&amp;lt;" is doubly-encoded text: it must decode once to the literal
    // string "&lt;", never collapse further into "<".
    expect(sources[0]?.excerpt).toBe("A & B <x> &lt;");
  });
});

describe("classifyOriginDomainTier", () => {
  it("treats wikipedia.org / wikidata.org hosts and subdomains as specialist", () => {
    expect(classifyOriginDomainTier("wikipedia.org")).toBe("specialist");
    expect(classifyOriginDomainTier("wikidata.org")).toBe("specialist");
    expect(classifyOriginDomainTier("ja.wikipedia.org")).toBe("specialist");
    expect(classifyOriginDomainTier("www.wikidata.org")).toBe("specialist");
    expect(classifyOriginDomainTier("en.m.wikipedia.org")).toBe("specialist");
  });

  it("does not match lookalike hosts that merely end with the domain string", () => {
    expect(classifyOriginDomainTier("evilwikipedia.org")).toBe("general");
    expect(classifyOriginDomainTier("notwikidata.org")).toBe("general");
    expect(classifyOriginDomainTier("wikipedia.org.example.com")).toBe("general");
  });

  it("falls through to general for empty or unparseable input", () => {
    expect(classifyOriginDomainTier("")).toBe("general");
    expect(classifyOriginDomainTier("::not-a-domain::")).toBe("general");
  });
});

describe("searchTavilySources", () => {
  it("sends a basic search with topic/time_range and the key only in the Authorization header", async () => {
    const { fetchImpl, calls } = routedFetch([
      {
        match: "api.tavily.com/search",
        respond: () => ({
          results: [
            {
              title: "iPhone 17 - Apple",
              url: "https://www.apple.com/jp/iphone-17/",
              content: "iPhone 17の価格は128,800円から。",
              score: 0.91,
              published_date: "2026-10-15T00:00:00.000Z",
            },
            { title: "http result", url: "http://example.com/x", content: "dropped", score: 0.5 },
          ],
        }),
      },
    ]);
    const outcome = await searchTavilySources("iPhone 最新 価格", {
      fetchImpl,
      apiKey: "tvly-test-key",
      topic: "general",
      timeRange: "month",
    });
    expect(outcome.creditsUsed).toBe(1);
    expect(outcome.sources).toHaveLength(1);
    expect(outcome.sources[0]?.authorityTier).toBe("official");
    expect(outcome.sources[0]?.publishedAt).toBe("2026-10-15T00:00:00.000Z");
    const call = calls[0];
    expect(call?.url).toBe("https://api.tavily.com/search");
    expect(call?.url).not.toContain("tvly-test-key");
    expect(call?.init?.headers?.Authorization).toBe("Bearer tvly-test-key");
    const body = JSON.parse(call?.init?.body ?? "{}") as Record<string, unknown>;
    expect(body.search_depth).toBe("basic");
    expect(body.topic).toBe("general");
    expect(body.time_range).toBe("month");
    expect(body.include_answer).toBe(false);
  });
});

describe("extractTavilyPages", () => {
  it("maps extracted text and charges 1 credit per 5 successful URLs", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "api.tavily.com/extract",
        respond: () => ({
          results: [
            { url: "https://www.apple.com/jp/iphone-17/", raw_content: "iPhone 17 価格 128,800円" },
            { url: "https://www.itmedia.co.jp/news/1.html", raw_content: "発売日は2026年9月19日" },
          ],
          failed_results: [{ url: "https://example.com/fail", error: "timeout" }],
        }),
      },
    ]);
    const outcome = await extractTavilyPages(
      ["https://www.apple.com/jp/iphone-17/", "https://www.itmedia.co.jp/news/1.html"],
      { fetchImpl, apiKey: "tvly-test-key" },
    );
    expect(outcome.pages.size).toBe(2);
    expect(outcome.pages.get("https://www.apple.com/jp/iphone-17/")).toContain("128,800円");
    expect(outcome.failedUrls).toEqual(["https://example.com/fail"]);
    expect(outcome.creditsUsed).toBe(1);
  });
});

describe("timeout handling", () => {
  it("aborts a hanging provider call at the configured timeout", async () => {
    const hangingFetch: OriginSearchFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    const error = await searchTavilySources("query", {
      fetchImpl: hangingFetch,
      apiKey: "tvly-test-key",
      topic: "general",
      timeRange: null,
      timeoutMs: 20,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginSearchProviderError);
    expect((error as OriginSearchProviderError).code).toBe("timeout");
  });
});
