import { describe, expect, it } from "vitest";
import {
  classifyOriginDomainTier,
  composeOriginMarketText,
  composeOriginWeatherText,
  extractTavilyPages,
  fetchOpenMeteoWeather,
  fetchStooqMarketQuotes,
  isSafeHttpsUrl,
  OriginSearchProviderError,
  parseGdeltSeenDate,
  parseStooqQuotesCsv,
  searchGdeltHeadlines,
  searchTavilySources,
  searchWikipediaSources,
  type OriginMarketQuoteRequest,
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

describe("isSafeHttpsUrl", () => {
  it("accepts ordinary https URLs on named hosts", () => {
    expect(isSafeHttpsUrl("https://www3.nhk.or.jp/news/html/20261107/example.html")).toBe(true);
    expect(isSafeHttpsUrl("https://en.wikipedia.org/wiki/Fuji")).toBe(true);
  });

  it("rejects non-https schemes, credentials, and localhost", () => {
    expect(isSafeHttpsUrl("http://example.com/page")).toBe(false);
    expect(isSafeHttpsUrl("https://user:pass@example.com/page")).toBe(false);
    expect(isSafeHttpsUrl("https://localhost/admin")).toBe(false);
    expect(isSafeHttpsUrl("https://printer.localhost/admin")).toBe(false);
  });

  it("rejects IP-literal hosts, including normalized integer/hex IPv4 spellings", () => {
    expect(isSafeHttpsUrl("https://127.0.0.1/admin")).toBe(false);
    expect(isSafeHttpsUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeHttpsUrl("https://192.168.1.1/admin")).toBe(false);
    expect(isSafeHttpsUrl("https://10.0.0.5/internal")).toBe(false);
    expect(isSafeHttpsUrl("https://[::1]/admin")).toBe(false);
    expect(isSafeHttpsUrl("https://[fe80::1]/admin")).toBe(false);
    expect(isSafeHttpsUrl("https://2130706433/admin")).toBe(false);
    expect(isSafeHttpsUrl("https://0x7f.1/admin")).toBe(false);
  });
});

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

  it("anchors the offset-less current.time wall clock to Asia/Tokyo", async () => {
    // Regression (production, 2026-11-07): the API returns current.time in
    // the requested timezone with no offset ("2026-11-07T14:15"). Stored
    // verbatim it was parsed as UTC on the server and the label rendered
    // 9 hours late ("23:15時点"). These assertions hold under any process
    // timezone (TZ=UTC included): the anchored offset makes observedAt an
    // absolute instant and the formatter is pinned to Asia/Tokyo.
    const { fetchImpl } = routedFetch([
      routes[0] as (typeof routes)[number],
      {
        match: "api.open-meteo.com/v1/forecast",
        respond: () => ({
          current: {
            time: "2026-11-07T14:15",
            temperature_2m: 18.4,
            relative_humidity_2m: 41,
            apparent_temperature: 15.8,
            weather_code: 0,
          },
          daily: {
            time: ["2026-11-07", "2026-11-08"],
            weather_code: [0, 1],
            temperature_2m_max: [19.1, 16.9],
            temperature_2m_min: [10.1, 9.1],
            precipitation_probability_max: [45, 0],
          },
        }),
      },
    ]);
    const forecast = await fetchOpenMeteoWeather("東京", { fetchImpl, nowMs: NOW });
    expect(forecast.current.observedAt).toBe("2026-11-07T14:15:00+09:00");
    expect(composeOriginWeatherText(forecast)).toContain("現在（11/7 14:15時点）");
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

  function isGeocodingApiUrl(rawUrl: string): boolean {
    try {
      return new URL(rawUrl).hostname === "geocoding-api.open-meteo.com";
    } catch {
      return false;
    }
  }

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
      .filter((call) => isGeocodingApiUrl(call.url))
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
      if (isGeocodingApiUrl(url)) {
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

  it("records the search rank as a descending provider score on the 0..1 scale", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "/w/rest.php/v1/search/page",
        respond: () => ({
          pages: [
            { key: "東京", title: "東京", excerpt: "東京は日本の首都である。" },
            { key: "東京都", title: "東京都", excerpt: "東京都は日本の都道府県の一つである。" },
            { key: "東京駅", title: "東京駅", excerpt: "東京駅は東京都にある鉄道駅である。" },
          ],
        }),
      },
      {
        match: "/w/rest.php/v1/page/",
        respond: () => ({ latest: { timestamp: "2026-10-01T00:00:00Z" } }),
      },
    ]);
    const sources = await searchWikipediaSources("東京", { fetchImpl });
    expect(sources.map((source) => source.title)).toEqual(["東京", "東京都", "東京駅"]);
    expect(sources[0]?.providerScore).toBe(1);
    expect(sources[1]?.providerScore).toBeCloseTo(2 / 3);
    expect(sources[2]?.providerScore).toBeCloseTo(1 / 3);
  });

  it("screens out a candidate whose title and excerpt miss the query topic, before fetching its metadata", async () => {
    const { fetchImpl, calls } = routedFetch([
      {
        match: "/w/rest.php/v1/search/page",
        respond: () => ({
          pages: [
            { key: "富士山", title: "富士山", excerpt: "富士山は日本の活火山で、標高は3,775.51メートルである。" },
            { key: "ゆるキャン△", title: "ゆるキャン△", excerpt: "ゆるキャン△は、あfろによる日本の漫画作品。女子高生が野外活動でキャンプを楽しむ物語。" },
          ],
        }),
      },
      {
        match: "/w/rest.php/v1/page/",
        respond: () => ({ latest: { timestamp: "2026-10-01T00:00:00Z" } }),
      },
    ]);
    const sources = await searchWikipediaSources("富士山 標高", { fetchImpl });
    // The on-topic hit survives unchanged; the off-topic hit is dropped and
    // its bare-metadata endpoint is never requested.
    expect(sources.map((source) => source.title)).toEqual(["富士山"]);
    expect(sources[0]?.providerScore).toBe(1);
    const bareCalls = calls.filter((call) => call.url.includes("/w/rest.php/v1/page/"));
    expect(bareCalls).toHaveLength(1);
  });

  it("returns no sources when every candidate misses the query topic", async () => {
    const { fetchImpl, calls } = routedFetch([
      {
        match: "/w/rest.php/v1/search/page",
        respond: () => ({
          pages: [
            { key: "鬼滅の刃", title: "鬼滅の刃", excerpt: "鬼滅の刃は、吾峠呼世晴による日本の漫画作品である。" },
          ],
        }),
      },
      {
        match: "/w/rest.php/v1/page/",
        respond: () => ({ latest: { timestamp: "2026-10-01T00:00:00Z" } }),
      },
    ]);
    const sources = await searchWikipediaSources("都道府県 面積", { fetchImpl });
    expect(sources).toEqual([]);
    expect(calls.filter((call) => call.url.includes("/w/rest.php/v1/page/"))).toHaveLength(0);
  });

  it("searches with the topic terms only and keeps the on-topic article for a goal-shaped query", async () => {
    const { fetchImpl, calls } = routedFetch([
      {
        match: "/w/rest.php/v1/search/page",
        respond: () => ({
          // The live API's actual top 3 for the shaped query
          // "富士山 標高" (captured 2026-11-11, excerpts trimmed).
          pages: [
            { key: "富士山", title: "富士山", excerpt: "富士山北麓の一部地域（現在の山梨県富士吉田市など）では、富士山の標高2600 m付近に現れる農鳥（のうとり）の出現する時期によって、農作物の豊作・凶作を判断する言い伝えがある。" },
            { key: "富士山有料道路", title: "富士山有料道路", excerpt: "山梨県南都留郡富士河口湖町船津から、富士山の北斜面を登って富士山五合目（吉田口五合目）までの、延長約29.5キロメートル、標高差約1200メートルの山岳ドライブウェイである。" },
            { key: "山", title: "山", excerpt: "日本国内では、最高峰は富士山（標高3,776m）である。対してもっとも低い山は仙台市の日和山（標高3m）であるが、山の定義によりとらえ方はさまざまである。" },
          ],
        }),
      },
      {
        match: "/w/rest.php/v1/page/",
        respond: () => ({ latest: { timestamp: "2026-10-01T00:00:00Z" } }),
      },
    ]);
    const sources = await searchWikipediaSources("富士山の標高について簡単に調べて、2〜3行でまとめてください", { fetchImpl });
    // The request carries the topic terms only, not the goal sentence.
    const searchCall = calls.find((call) => call.url.includes("/w/rest.php/v1/search/page"));
    expect(searchCall).toBeDefined();
    expect(new URL(searchCall!.url).searchParams.get("q")).toBe("富士山 標高");
    // "山" matches both topic terms in its excerpt but neither in its
    // title, so it is screened out; the on-topic hits survive in rank
    // order and only they consume metadata fetches.
    expect(sources.map((source) => source.title)).toEqual(["富士山", "富士山有料道路"]);
    expect(sources[0]?.providerScore).toBe(1);
    expect(calls.filter((call) => call.url.includes("/w/rest.php/v1/page/"))).toHaveLength(2);
  });

  it("screens out the production hit whose lead merely mentions the topic terms (a different mountain)", async () => {
    const { fetchImpl, calls } = routedFetch([
      {
        match: "/w/rest.php/v1/search/page",
        respond: () => ({
          pages: [
            // Production regression fixture (2026-11-11): the verbatim
            // live-API excerpt for 御嶽山. It contains both topic terms
            // (富士山 and 標高), so the excerpt-count screen alone let
            // it become the run's only source for the goal "富士山の
            // 標高について調べて" — but the article is about a
            // different mountain and its title matches neither term.
            { key: "御嶽山", title: "御嶽山", excerpt: "御嶽山（おんたけさん）は、長野県木曽郡木曽町・王滝村と岐阜県下呂市・高山市にまたがり、東日本火山帯の西端に位置する複合成層火山。大きな裾野を広げる独立峰である。標高3,067 mで日本国内の火山としては富士山に次いで2番目に高い（日本国内の山としては14番目に標高が高い）。" },
          ],
        }),
      },
      {
        match: "/w/rest.php/v1/page/",
        respond: () => ({ latest: { timestamp: "2026-10-01T00:00:00Z" } }),
      },
    ]);
    const sources = await searchWikipediaSources("富士山の標高について簡単に調べて、2〜3行でまとめてください", { fetchImpl });
    expect(sources).toEqual([]);
    expect(calls.filter((call) => call.url.includes("/w/rest.php/v1/page/"))).toHaveLength(0);
  });

  it("screens out the production hit whose snippet quotes the topic words from its reference list", async () => {
    const { fetchImpl, calls } = routedFetch([
      {
        match: "/w/rest.php/v1/search/page",
        respond: () => ({
          pages: [
            // Production regression fixture (2026-11-11): the verbatim
            // live-API snippet for 鬼滅の刃 on the autumn-leaves goal.
            // The snippet is drawn from the article's reference list and
            // quotes a cited title containing 紅葉 and 見頃 (two of the
            // three topic terms), so the excerpt-count screen alone let
            // it through; the article itself is about a manga and its
            // title matches no topic term.
            { key: "鬼滅の刃", title: "鬼滅の刃", excerpt: "「竈門炭治郎の故郷か? 鬼滅の刃の聖地が熊本にもあった! 鬼舞辻無惨のアジトか? 熊本に竈門と鬼の住処を見つけた!!」くまきゅー、2020年5月19日。2021年9月23日閲覧。 「今話題「竈門神社」の紅葉が見頃!」薩摩川内観光物産ガイド こころ、2020年10月20日。2021年9月23日閲覧。" },
          ],
        }),
      },
      {
        match: "/w/rest.php/v1/page/",
        respond: () => ({ latest: { timestamp: "2026-10-01T00:00:00Z" } }),
      },
    ]);
    const sources = await searchWikipediaSources("京都の紅葉の見頃について簡単に調べて、3〜5行でまとめてください", { fetchImpl });
    const searchCall = calls.find((call) => call.url.includes("/w/rest.php/v1/search/page"));
    expect(searchCall).toBeDefined();
    expect(new URL(searchCall!.url).searchParams.get("q")).toBe("京都 紅葉 見頃");
    expect(sources).toEqual([]);
    expect(calls.filter((call) => call.url.includes("/w/rest.php/v1/page/"))).toHaveLength(0);
  });

  it("keeps only the on-topic hit from the shaped autumn-leaves search", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "/w/rest.php/v1/search/page",
        respond: () => ({
          // The live API's actual top 3 for the shaped query
          // "京都 紅葉 見頃" (captured 2026-11-11, excerpts trimmed).
          pages: [
            { key: "紅葉", title: "紅葉", excerpt: "日本における紅葉は、8月下旬から北海道の大雪山を手始めに始まり、徐々に南下する。紅葉の見頃の推移を桜前線と対比して紅葉前線（こうようぜんせん）と呼ぶ。紅葉が始まってから完了するまでは約1か月かかる。見頃は開始後20 - 25日程度である。" },
            { key: "花見", title: "花見", excerpt: "現在でも、日本料理店などが趣向を凝らした花見弁当の注文に応じている。北海道では、桜の見頃は本州より遅く4月下旬から5月中旬頃であり、花見の際にジンギスカンを食べる習慣がある。" },
            { key: "京成バラ園", title: "京成バラ園", excerpt: "園内にある散策の森や、池の周りの自然風庭園には様々な草花が咲いている。特にゴールデンウィーク頃に咲く「ハンカチの木」は日本でもまだ珍しく、見頃を迎える。" },
          ],
        }),
      },
      {
        match: "/w/rest.php/v1/page/",
        respond: () => ({ latest: { timestamp: "2026-10-01T00:00:00Z" } }),
      },
    ]);
    const sources = await searchWikipediaSources("京都の紅葉の見頃について簡単に調べて、3〜5行でまとめてください", { fetchImpl });
    expect(sources.map((source) => source.title)).toEqual(["紅葉"]);
    expect(sources[0]?.providerScore).toBe(1);
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

/* ------------------------------------------------------------------ */
/* Stooq market quotes                                                 */
/* ------------------------------------------------------------------ */

const STOOQ_REQUESTS: OriginMarketQuoteRequest[] = [
  { symbol: "usdjpy", labelJa: "ドル円（USD/JPY）", unit: "円" },
  { symbol: "^NKX", labelJa: "日経平均株価", unit: "円" },
];

const STOOQ_CSV = [
  "Symbol,Date,Time,Open,High,Low,Close,Volume",
  "USDJPY,2026-11-06,22:59:55,157.80,158.10,157.55,157.94,0",
  "^NKX,2026-11-06,15:30:00,58077.90,58200.00,57300.00,57434.77,0",
  "",
].join("\n");

function textResponse(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

describe("parseStooqQuotesCsv", () => {
  it("parses the documented CSV shape and preserves request order", () => {
    const quotes = parseStooqQuotesCsv(STOOQ_CSV, STOOQ_REQUESTS);
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ symbol: "usdjpy", date: "2026-11-06", time: "22:59:55", close: 157.94 });
    expect(quotes[1]).toMatchObject({ symbol: "^NKX", close: 57434.77 });
  });

  it("rejects an HTML response (key demand / proof-of-work / limit page)", () => {
    expect(parseStooqQuotesCsv("<html><body>Access denied</body></html>", STOOQ_REQUESTS)).toEqual([]);
  });

  it("rejects a CSV whose header does not match the documented shape", () => {
    expect(parseStooqQuotesCsv("foo,bar\n1,2", STOOQ_REQUESTS)).toEqual([]);
  });

  it("drops rows with N/A or non-numeric prices instead of guessing", () => {
    const csv = [
      "Symbol,Date,Time,Open,High,Low,Close,Volume",
      "USDJPY,2026-11-06,22:59:55,N/A,N/A,N/A,N/A,N/A",
      "^NKX,2026-11-06,15:30:00,58077.90,58200.00,57300.00,57434.77,0",
    ].join("\n");
    const quotes = parseStooqQuotesCsv(csv, STOOQ_REQUESTS);
    expect(quotes.map((quote) => quote.symbol)).toEqual(["^NKX"]);
  });

  it("drops rows with malformed date/time stamps", () => {
    const csv = [
      "Symbol,Date,Time,Open,High,Low,Close,Volume",
      "USDJPY,06/11/2026,10pm,157.80,158.10,157.55,157.94,0",
    ].join("\n");
    expect(parseStooqQuotesCsv(csv, STOOQ_REQUESTS)).toEqual([]);
  });
});

describe("fetchStooqMarketQuotes", () => {
  it("requests only the fixed symbols and returns parsed quotes", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      return textResponse(STOOQ_CSV);
    };
    const quotes = await fetchStooqMarketQuotes(STOOQ_REQUESTS, { fetchImpl });
    expect(quotes).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("https://stooq.com/q/l/?s=usdjpy,%5ENKX");
    expect(calls[0]?.url).toContain("f=sd2t2ohlcv");
  });

  it("fails closed (invalid-response) when the endpoint returns an HTML page", async () => {
    const fetchImpl: OriginSearchFetch = async () => textResponse("<html>Please enter your API key</html>");
    const error = await fetchStooqMarketQuotes(STOOQ_REQUESTS, { fetchImpl }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginSearchProviderError);
    expect((error as OriginSearchProviderError).code).toBe("invalid-response");
    expect((error as OriginSearchProviderError).providerId).toBe("stooq");
  });

  it("propagates HTTP failures as http errors", async () => {
    const fetchImpl: OriginSearchFetch = async () => textResponse("nope", 503);
    const error = await fetchStooqMarketQuotes(STOOQ_REQUESTS, { fetchImpl }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginSearchProviderError);
    expect((error as OriginSearchProviderError).code).toBe("http");
    expect((error as OriginSearchProviderError).status).toBe(503);
  });
});

describe("composeOriginMarketText", () => {
  it("includes values, quote timestamps, the delay note and the source", () => {
    const quotes = parseStooqQuotesCsv(STOOQ_CSV, STOOQ_REQUESTS);
    const text = composeOriginMarketText(quotes, "2026-11-08T03:00:00.000Z");
    expect(text).toContain("ドル円（USD/JPY）: 157.94円");
    expect(text).toContain("日経平均株価: 57,434.77円");
    expect(text).toContain("2026-11-06 15:30:00 時点の値");
    expect(text).toContain("遅延");
    expect(text).toContain("出典: Stooq（https://stooq.com/）");
  });
});
