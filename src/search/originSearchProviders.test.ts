import { describe, expect, it } from "vitest";
import {
  classifyOriginDomainTier,
  composeOriginFxText,
  composeOriginMarketText,
  composeOriginWeatherText,
  convertOriginFxAmount,
  decodeOriginPageHtml,
  extractOriginPageText,
  extractTavilyPages,
  fetchFrankfurterRate,
  fetchJmaAreaTable,
  fetchJmaWeather,
  fetchStooqMarketQuotes,
  jmaPlaceCore,
  jmaWeatherCodeLabelJa,
  parseFrankfurterRate,
  parseJmaAreaTable,
  resolveJmaArea,
  isSafeHttpsUrl,
  OriginSearchProviderError,
  parseGdeltSeenDate,
  parseStooqQuotesCsv,
  searchGdeltHeadlines,
  searchTavilySources,
  searchWikipediaSources,
  searchWikipediaSourcesObserved,
  type OriginFxRate,
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

describe("JMA weather route", () => {
  // Subset of the official area table (www.jma.go.jp/bosai/common/const/
  // area.json), structurally faithful: offices -> class10s -> class15s
  // -> class20s parent chains. The full table carries every prefecture.
  const AREA_TABLE_PAYLOAD = {
    offices: {
      "016000": { name: "石狩・空知・後志地方", enName: "Ishikari Sorachi Shiribeshi", officeName: "札幌管区気象台", parent: "010100", children: ["016010", "016020", "016030"] },
      "130000": { name: "東京都", enName: "Tokyo", officeName: "気象庁", parent: "010300", children: ["130010", "130020"] },
      "140000": { name: "神奈川県", enName: "Kanagawa", officeName: "横浜地方気象台", parent: "010300", children: ["140010", "140020"] },
      "270000": { name: "大阪府", enName: "Osaka", officeName: "大阪管区気象台", parent: "010600", children: ["270000"] },
      "471000": { name: "沖縄本島地方", enName: "Okinawa Main Island", officeName: "沖縄気象台", parent: "011100", children: ["471010", "471020"] },
    },
    class10s: {
      "016010": { name: "石狩地方", enName: "Ishikari Region", parent: "016000", children: ["016011"] },
      "016020": { name: "空知地方", enName: "Sorachi Region", parent: "016000", children: ["016021"] },
      "016030": { name: "後志地方", enName: "Shiribeshi Region", parent: "016000", children: ["016031"] },
      "130010": { name: "東京地方", enName: "Tokyo Region", parent: "130000", children: ["130011", "130012"] },
      "130020": { name: "伊豆諸島北部", enName: "Northern Izu Islands", parent: "130000", children: ["130021"] },
      "140010": { name: "東部", enName: "Eastern Region", parent: "140000", children: ["140011"] },
      "140020": { name: "西部", enName: "Western Region", parent: "140000", children: ["140021"] },
      "270000": { name: "大阪府", enName: "Osaka", parent: "270000", children: ["270001"] },
      "471010": { name: "本島中南部", enName: "Central and Southern Okinawa Island", parent: "471000", children: ["471011"] },
      "471020": { name: "本島北部", enName: "Northern Okinawa Island", parent: "471000", children: ["471021"] },
    },
    class15s: {
      "016011": { name: "札幌市周辺", parent: "016010", children: ["0160111"] },
      "130011": { name: "２３区西部", parent: "130010", children: ["1300111"] },
      "130012": { name: "２３区東部", parent: "130010", children: ["1300121"] },
      "140011": { name: "横浜・川崎", parent: "140010", children: ["1400111"] },
      "270001": { name: "大阪市周辺", parent: "270000", children: ["2700011"] },
      "471011": { name: "那覇市周辺", parent: "471010", children: ["4710111"] },
    },
    class20s: {
      "0160111": { name: "札幌市", parent: "016011" },
      "1300111": { name: "新宿区", parent: "130011" },
      "1300121": { name: "千代田区", parent: "130012" },
      "1400111": { name: "横浜市", parent: "140011" },
      "2700011": { name: "大阪市", parent: "270001" },
      "4710111": { name: "那覇市", parent: "471011" },
    },
  };

  // Trimmed from the live bosai payload for 東京都 (130000) published
  // 2026-11-27 17:00 JST (real shape, captured 2026-11-27).
  const TOKYO_FORECAST_PAYLOAD = [
    {
      publishingOffice: "気象庁",
      reportDatetime: "2026-11-27T17:00:00+09:00",
      timeSeries: [
        {
          timeDefines: ["2026-11-27T17:00:00+09:00", "2026-11-28T00:00:00+09:00", "2026-11-29T00:00:00+09:00"],
          areas: [
            { area: { name: "東京地方", code: "130010" }, weatherCodes: ["111", "313", "100"], weathers: ["晴れ　夜 くもり 所により 夜遅く 雨", "雨　昼前　から　くもり", "晴れ"], winds: ["南の風", "南の風", "西の風"], waves: ["０．５メートル", "０．５メートル", "１メートル"] },
            { area: { name: "伊豆諸島北部", code: "130020" }, weatherCodes: ["114", "203", "101"], weathers: ["晴れ　後　くもり　夜遅く　雨", "くもり　時々　雨", "晴れ　時々　くもり"], winds: ["南西の風", "南の風", "西の風"], waves: ["２メートル", "２メートル", "３メートル"] },
          ],
        },
        {
          timeDefines: ["2026-11-27T18:00:00+09:00", "2026-11-28T00:00:00+09:00", "2026-11-28T06:00:00+09:00", "2026-11-28T12:00:00+09:00", "2026-11-28T18:00:00+09:00"],
          areas: [
            { area: { name: "東京地方", code: "130010" }, pops: ["20", "90", "60", "20", "10"] },
            { area: { name: "伊豆諸島北部", code: "130020" }, pops: ["60", "100", "40", "50", "10"] },
          ],
        },
        {
          timeDefines: ["2026-11-28T00:00:00+09:00", "2026-11-28T09:00:00+09:00"],
          areas: [
            { area: { name: "東京", code: "44132" }, temps: ["10", "20"] },
            { area: { name: "大島", code: "44172" }, temps: ["15", "20"] },
          ],
        },
      ],
    },
    {
      publishingOffice: "気象庁",
      reportDatetime: "2026-11-27T17:00:00+09:00",
      timeSeries: [
        {
          timeDefines: ["2026-11-28T00:00:00+09:00", "2026-11-29T00:00:00+09:00", "2026-11-30T00:00:00+09:00"],
          areas: [
            { area: { name: "東京地方", code: "130010" }, weatherCodes: ["313", "100", "101"], pops: ["", "10", "20"], reliabilities: ["", "", "A"] },
          ],
        },
        {
          timeDefines: ["2026-11-28T00:00:00+09:00", "2026-11-29T00:00:00+09:00", "2026-11-30T00:00:00+09:00"],
          areas: [
            { area: { name: "東京", code: "44132" }, tempsMin: ["", "7", "5"], tempsMinUpper: ["", "8", "6"], tempsMinLower: ["", "5", "3"], tempsMax: ["", "16", "16"], tempsMaxUpper: ["", "18", "18"], tempsMaxLower: ["", "14", "15"] },
          ],
        },
      ],
    },
  ];

  const TOKYO_OVERVIEW_PAYLOAD = {
    publishingOffice: "気象庁",
    reportDatetime: "2026-11-27T16:38:00+09:00",
    targetArea: "東京都",
    headlineText: "",
    text: " 関東甲信地方は、高気圧に緩やかに覆われています。\n\n 東京地方は、晴れています。",
  };

  const NOW_JMA = Date.parse("2026-11-27T12:00:00.000Z");
  const areaTable = () => {
    const table = parseJmaAreaTable(AREA_TABLE_PAYLOAD);
    if (!table) throw new Error("fixture area table must parse");
    return table;
  };

  describe("parseJmaAreaTable / fetchJmaAreaTable", () => {
    it("parses the official area table shape", () => {
      const table = areaTable();
      expect(table.offices["130000"]?.name).toBe("東京都");
      expect(table.class10s["130010"]?.parent).toBe("130000");
      expect(table.class20s["1300111"]?.name).toBe("新宿区");
    });

    it("rejects payloads without offices/class10s", () => {
      expect(parseJmaAreaTable(null)).toBeNull();
      expect(parseJmaAreaTable({})).toBeNull();
      expect(parseJmaAreaTable({ offices: {}, class10s: {} })).toBeNull();
    });

    it("fetches and parses the area table from the official URL", async () => {
      const { fetchImpl, calls } = routedFetch([
        { match: "bosai/common/const/area.json", respond: () => AREA_TABLE_PAYLOAD },
      ]);
      const table = await fetchJmaAreaTable({ fetchImpl });
      expect(calls[0]?.url).toBe("https://www.jma.go.jp/bosai/common/const/area.json");
      expect(table.offices["270000"]?.name).toBe("大阪府");
    });
  });

  describe("jmaPlaceCore", () => {
    it("strips one administrative suffix or 地方 when a real base precedes it", () => {
      expect(jmaPlaceCore("東京都")).toBe("東京");
      expect(jmaPlaceCore("大阪府")).toBe("大阪");
      expect(jmaPlaceCore("京都府")).toBe("京都");
      expect(jmaPlaceCore("大阪市")).toBe("大阪");
      expect(jmaPlaceCore("東京地方")).toBe("東京");
    });

    it("keeps 京都 intact: its trailing 都 is part of the proper name", () => {
      expect(jmaPlaceCore("京都")).toBe("京都");
    });
  });

  describe("resolveJmaArea", () => {
    it("resolves prefecture names to their office and primary subdivision", () => {
      const table = areaTable();
      expect(resolveJmaArea(table, "東京")).toMatchObject({ officeCode: "130000", class10Code: "130010", class10Name: "東京地方" });
      expect(resolveJmaArea(table, "東京都")).toMatchObject({ officeCode: "130000", class10Code: "130010" });
      expect(resolveJmaArea(table, "大阪")).toMatchObject({ officeCode: "270000", class10Code: "270000" });
      expect(resolveJmaArea(table, "大阪市")).toMatchObject({ officeCode: "270000", class10Code: "270000" });
    });

    it("resolves city and ward names by walking the parent chain", () => {
      const table = areaTable();
      expect(resolveJmaArea(table, "札幌")).toMatchObject({ officeCode: "016000", class10Code: "016010", class10Name: "石狩地方" });
      expect(resolveJmaArea(table, "横浜")).toMatchObject({ officeCode: "140000", class10Code: "140010" });
      expect(resolveJmaArea(table, "新宿")).toMatchObject({ officeCode: "130000", class10Code: "130010" });
      expect(resolveJmaArea(table, "那覇")).toMatchObject({ officeCode: "471000", class10Code: "471010" });
    });

    it("resolves 沖縄 by unique prefix and 北海道 to the Sapporo office", () => {
      const table = areaTable();
      expect(resolveJmaArea(table, "沖縄")).toMatchObject({ officeCode: "471000", class10Code: "471010" });
      expect(resolveJmaArea(table, "北海道")).toMatchObject({ officeCode: "016000", class10Code: "016010" });
    });

    it("resolves subdivision names directly", () => {
      const table = areaTable();
      expect(resolveJmaArea(table, "石狩地方")).toMatchObject({ officeCode: "016000", class10Code: "016010" });
      expect(resolveJmaArea(table, "東京地方")).toMatchObject({ officeCode: "130000", class10Code: "130010" });
    });

    it("returns null for non-Japanese and unknown places instead of guessing", () => {
      const table = areaTable();
      expect(resolveJmaArea(table, "ロンドン")).toBeNull();
      expect(resolveJmaArea(table, "存在しない場所")).toBeNull();
      expect(resolveJmaArea(table, "")).toBeNull();
    });
  });

  describe("jmaWeatherCodeLabelJa", () => {
    it("labels the standard code patterns and refuses unknown codes", () => {
      expect(jmaWeatherCodeLabelJa(100)).toBe("晴れ");
      expect(jmaWeatherCodeLabelJa(101)).toBe("晴れ時々くもり");
      expect(jmaWeatherCodeLabelJa(111)).toBe("晴れ後くもり");
      expect(jmaWeatherCodeLabelJa(200)).toBe("くもり");
      expect(jmaWeatherCodeLabelJa(313)).toBe("雨後時々晴れ");
      expect(jmaWeatherCodeLabelJa(402)).toBe("雪一時晴れ");
      expect(jmaWeatherCodeLabelJa(999)).toBe("不明");
    });
  });

  describe("fetchJmaWeather", () => {
    const routes = [
      { match: "bosai/forecast/data/forecast/130000.json", respond: () => TOKYO_FORECAST_PAYLOAD },
      { match: "bosai/forecast/data/overview_forecast/130000.json", respond: () => TOKYO_OVERVIEW_PAYLOAD },
    ];

    it("parses the short-term and weekly elements into days", async () => {
      const { fetchImpl, calls } = routedFetch(routes);
      const area = resolveJmaArea(areaTable(), "東京");
      if (!area) throw new Error("東京 must resolve");
      const forecast = await fetchJmaWeather(area, { fetchImpl, nowMs: NOW_JMA });
      expect(calls.map((call) => call.url)).toEqual([
        "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json",
        "https://www.jma.go.jp/bosai/forecast/data/overview_forecast/130000.json",
      ]);
      expect(forecast.place).toBe("東京");
      expect(forecast.region).toBe("東京地方");
      expect(forecast.publishingOffice).toBe("気象庁");
      expect(forecast.reportDatetime).toBe("2026-11-27T17:00:00+09:00");
      expect(forecast.sourceUrl).toBe("https://www.jma.go.jp/bosai/forecast/");
      expect(forecast.days).toHaveLength(4);
      // Today: JMA's own weather text (whitespace-normalized), the one
      // 6-hour pop slot of the day, and no temperatures (the 17:00
      // release publishes temps for tomorrow onward — not invented).
      expect(forecast.days[0]).toMatchObject({
        date: "2026-11-27",
        weatherCode: 111,
        weatherLabel: "晴れ 夜 くもり 所により 夜遅く 雨",
        minC: null,
        maxC: null,
        precipitationProbabilityMaxPercent: 20,
      });
      // Tomorrow: short-term temps (00:00 define = low, 09:00 = high)
      // and the max of the day's 6-hour pops.
      expect(forecast.days[1]).toMatchObject({
        date: "2026-11-28",
        weatherCode: 313,
        weatherLabel: "雨 昼前 から くもり",
        minC: 10,
        maxC: 20,
        precipitationProbabilityMaxPercent: 90,
      });
      // Day after: weekly temps/pops take over.
      expect(forecast.days[2]).toMatchObject({
        date: "2026-11-29",
        weatherCode: 100,
        weatherLabel: "晴れ",
        minC: 7,
        maxC: 16,
        precipitationProbabilityMaxPercent: 10,
      });
      // Weekly-only day: the label comes from the weather code table.
      expect(forecast.days[3]).toMatchObject({
        date: "2026-11-30",
        weatherCode: 101,
        weatherLabel: "晴れ時々くもり",
        minC: 5,
        maxC: 16,
        precipitationProbabilityMaxPercent: 20,
      });
      expect(forecast.overviewText).toContain("東京地方は、晴れています。");
    });

    it("composes a deterministic answer text with JMA attribution", async () => {
      const { fetchImpl } = routedFetch(routes);
      const area = resolveJmaArea(areaTable(), "東京");
      if (!area) throw new Error("東京 must resolve");
      const forecast = await fetchJmaWeather(area, { fetchImpl, nowMs: NOW_JMA });
      const text = composeOriginWeatherText(forecast);
      expect(text).toContain("東京（東京地方）の天気");
      expect(text).toContain("発表: 気象庁 11/27 17:00発表");
      expect(text).toContain("今日（11/27）: 晴れ 夜 くもり 所により 夜遅く 雨、降水確率 最大20%");
      expect(text).toContain("明日（11/28）: 雨 昼前 から くもり、最高 20°C / 最低 10°C、降水確率 最大90%");
      expect(text).toContain("概況:");
      expect(text).toContain("出典: 気象庁（https://www.jma.go.jp/bosai/forecast/）");
      expect(text).not.toContain("Open-Meteo");
    });

    it("still serves the forecast when the overview fetch fails", async () => {
      const { fetchImpl } = routedFetch([
        routes[0] as (typeof routes)[number],
        { match: "overview_forecast", respond: () => { throw new Error("boom"); } },
      ]);
      const area = resolveJmaArea(areaTable(), "東京");
      if (!area) throw new Error("東京 must resolve");
      const forecast = await fetchJmaWeather(area, { fetchImpl, nowMs: NOW_JMA });
      expect(forecast.days).toHaveLength(4);
      expect(forecast.overviewText).toBeUndefined();
      expect(composeOriginWeatherText(forecast)).not.toContain("概況:");
    });

    it("fails with invalid-response on a malformed forecast payload", async () => {
      const { fetchImpl } = routedFetch([
        { match: "bosai/forecast/data/forecast/130000.json", respond: () => ({ unexpected: true }) },
        { match: "overview_forecast", respond: () => TOKYO_OVERVIEW_PAYLOAD },
      ]);
      const area = resolveJmaArea(areaTable(), "東京");
      if (!area) throw new Error("東京 must resolve");
      await expect(fetchJmaWeather(area, { fetchImpl, nowMs: NOW_JMA })).rejects.toMatchObject({
        name: "OriginSearchProviderError",
        providerId: "jma",
        code: "invalid-response",
      });
    });

    it("propagates an HTTP failure of the forecast fetch", async () => {
      const fetchImpl: OriginSearchFetch = async () => jsonResponse({ reason: "upstream boom" }, 500);
      const area = resolveJmaArea(areaTable(), "東京");
      if (!area) throw new Error("東京 must resolve");
      await expect(fetchJmaWeather(area, { fetchImpl, nowMs: NOW_JMA })).rejects.toMatchObject({
        name: "OriginSearchProviderError",
        providerId: "jma",
        code: "http",
        status: 500,
      });
    });
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

  it("reports the screen drop with domain / tier tallies in the observed variant (案1)", async () => {
    const { fetchImpl } = routedFetch([
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
    const outcome = await searchWikipediaSourcesObserved("富士山 標高", { fetchImpl });
    expect(outcome.sources.map((source) => source.title)).toEqual(["富士山"]);
    expect(outcome.screenedOutCount).toBe(1);
    expect(outcome.screenedOutDomainCounts).toEqual({ "ja.wikipedia.org": 1 });
    expect(outcome.screenedOutTierCounts).toEqual({ official: 0, "major-news": 0, specialist: 1, general: 0 });
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

  it("keeps vendor bare hosts and product surfaces official (I-2)", () => {
    expect(classifyOriginDomainTier("google.com")).toBe("official");
    expect(classifyOriginDomainTier("www.google.com")).toBe("official");
    expect(classifyOriginDomainTier("store.google.com")).toBe("official");
    expect(classifyOriginDomainTier("support.google.com")).toBe("official");
    expect(classifyOriginDomainTier("apple.com")).toBe("official");
    expect(classifyOriginDomainTier("support.apple.com")).toBe("official");
    expect(classifyOriginDomainTier("shop.samsung.com")).toBe("official");
    expect(classifyOriginDomainTier("help.openai.com")).toBe("official");
    expect(classifyOriginDomainTier("support.mozilla.org")).toBe("official");
  });

  it("does not let developer / cloud / docs subdomains inherit the vendor's official tier (I-2)", () => {
    // Production fixture (2026-11-15): both hosts below carried the top
    // tier into a price packet whose question they did not answer.
    expect(classifyOriginDomainTier("developers.google.com")).toBe("general");
    expect(classifyOriginDomainTier("cloud.google.com")).toBe("general");
    expect(classifyOriginDomainTier("developer.apple.com")).toBe("general");
    expect(classifyOriginDomainTier("docs.microsoft.com")).toBe("general");
    expect(classifyOriginDomainTier("learn.microsoft.com")).toBe("general");
    expect(classifyOriginDomainTier("store.google.com.evil.com")).toBe("general");
  });

  it("keeps public-sector suffixes official without matching lookalikes", () => {
    expect(classifyOriginDomainTier("go.jp")).toBe("official");
    expect(classifyOriginDomainTier("kantei.go.jp")).toBe("official");
    expect(classifyOriginDomainTier("city.example.lg.jp")).toBe("official");
    expect(classifyOriginDomainTier("fakego.jp")).toBe("general");
    expect(classifyOriginDomainTier("go.jp.evil.com")).toBe("general");
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

  it("requests 10 results by default (I-3) and honors an explicit override", async () => {
    const fixture = {
      results: [
        {
          title: "iPhone 17 - Apple",
          url: "https://www.apple.com/jp/iphone-17/",
          content: "iPhone 17の価格は128,800円から。",
          score: 0.91,
        },
      ],
    };
    const { fetchImpl, calls } = routedFetch([
      { match: "api.tavily.com/search", respond: () => fixture },
    ]);
    await searchTavilySources("iPhone 最新 価格", {
      fetchImpl,
      apiKey: "tvly-test-key",
      topic: "general",
      timeRange: "month",
    });
    const defaultBody = JSON.parse(calls[0]?.init?.body ?? "{}") as Record<string, unknown>;
    expect(defaultBody.max_results).toBe(10);
    await searchTavilySources("iPhone 最新 価格", {
      fetchImpl,
      apiKey: "tvly-test-key",
      topic: "general",
      timeRange: "month",
      maxResults: 3,
    });
    const overrideBody = JSON.parse(calls[1]?.init?.body ?? "{}") as Record<string, unknown>;
    expect(overrideBody.max_results).toBe(3);
  });

  // Production fixture (2026-11-15, recon §1): for the price question
  // "Google Pixel 10の価格を教えてください" the packet contained only
  // these two vendor pages — a structured-data doc and a botnet article —
  // and no price information at all.
  const PIXEL_OFF_TOPIC_RESULTS = [
    {
      title: "構造化データのマークアップについて | Google 検索セントラル",
      url: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
      content: "構造化データを追加すると、検索結果にリッチリザルトを表示できます。schema.org の語彙でページの意味を Google に伝え、検索エンジンが内容を理解しやすくします。",
      score: 0.82,
    },
    {
      title: "Google Cloud が XCPE ボットネットの拡散を観測",
      url: "https://cloud.google.com/blog/topics/threat-intelligence/xcpe-botnet",
      content: "感染した端末を踏み台にする大規模なボットネットの活動を観測しました。クラウドの監視体制と防御策について解説します。",
      score: 0.77,
    },
  ];
  const PIXEL_ON_TOPIC_RESULTS = [
    {
      title: "Google Pixel 10 - Google ストア",
      url: "https://store.google.com/jp/product/pixel_10",
      content: "Google Pixel 10 の価格は124,800円から。公式ストアで購入できます。",
      score: 0.93,
      published_date: "2026-11-01T00:00:00.000Z",
    },
    {
      title: "Google Pixel 10 の価格・スペック比較",
      url: "https://kakaku.com/item/google-pixel-10/",
      content: "Google Pixel 10 の最安価格とスペックを掲載。価格推移も確認できます。",
      score: 0.88,
      published_date: "2026-11-03T00:00:00.000Z",
    },
  ];

  it("screens out the measured off-topic vendor pages for a price query (I-1)", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "api.tavily.com/search",
        respond: () => ({ results: [...PIXEL_OFF_TOPIC_RESULTS, ...PIXEL_ON_TOPIC_RESULTS] }),
      },
    ]);
    const outcome = await searchTavilySources("Google Pixel 10の価格", {
      fetchImpl,
      apiKey: "tvly-test-key",
      topic: "general",
      timeRange: "month",
    });
    expect(outcome.sources).toHaveLength(2);
    expect(outcome.sources[0]?.domain).toBe("store.google.com");
    expect(outcome.sources[0]?.authorityTier).toBe("official");
    expect(outcome.sources[1]?.domain).toBe("kakaku.com");
    expect(outcome.screenedOutCount).toBe(2);
    expect(outcome.creditsUsed).toBe(1);
  });

  it("tallies the screened-out candidates by domain and tier (案1)", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "api.tavily.com/search",
        respond: () => ({ results: [...PIXEL_OFF_TOPIC_RESULTS, ...PIXEL_ON_TOPIC_RESULTS] }),
      },
    ]);
    const outcome = await searchTavilySources("Google Pixel 10の価格", {
      fetchImpl,
      apiKey: "tvly-test-key",
      topic: "general",
      timeRange: "month",
    });
    expect(outcome.screenedOutCount).toBe(2);
    expect(outcome.screenedOutDomainCounts).toEqual({ "developers.google.com": 1, "cloud.google.com": 1 });
    expect(outcome.screenedOutTierCounts).toEqual({ official: 0, "major-news": 0, specialist: 0, general: 2 });
  });

  it("returns zero sources and counts every drop when all candidates are off-topic (I-1)", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "api.tavily.com/search",
        respond: () => ({ results: PIXEL_OFF_TOPIC_RESULTS }),
      },
    ]);
    const outcome = await searchTavilySources("Google Pixel 10の価格", {
      fetchImpl,
      apiKey: "tvly-test-key",
      topic: "general",
      timeRange: "month",
    });
    expect(outcome.sources).toEqual([]);
    expect(outcome.screenedOutCount).toBe(2);
  });

  it("does not screen when no topic term can be extracted from the query (I-1)", async () => {
    const { fetchImpl } = routedFetch([
      {
        match: "api.tavily.com/search",
        respond: () => ({
          results: [
            { title: "無関係なページ", url: "https://example.com/x", content: "トピック語を含まない抜粋。", score: 0.5 },
          ],
        }),
      },
    ]);
    const outcome = await searchTavilySources("あの その", {
      fetchImpl,
      apiKey: "tvly-test-key",
      topic: "general",
      timeRange: null,
    });
    expect(outcome.sources).toHaveLength(1);
    expect(outcome.screenedOutCount).toBe(0);
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

describe("extractOriginPageText", () => {
  it("removes boilerplate blocks whole and keeps the main text, entities decoded", () => {
    const html = "<html><head><title>公表ページ</title><script>var secret = 1;</script>"
      + "<style>.x { color: red; }</style></head><body>"
      + "<header><nav>ホーム サイトマップ</nav></header>"
      + "<main><p>完全失業率（季節調整値）は2.4％でした。</p><p>詳細は &quot;結果の概要&quot; を参照。</p></main>"
      + "<footer>総務省統計局</footer></body></html>";
    const text = extractOriginPageText(html);
    expect(text).toContain("完全失業率（季節調整値）は2.4％でした。");
    expect(text).toContain("詳細は \"結果の概要\" を参照。");
    expect(text).not.toContain("サイトマップ");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("color");
  });

  it("caps the text at the extract route's 2,000 characters and collapses whitespace", () => {
    const html = `<main><p>${"本文テキストです。\n".repeat(400)}</p></main>`;
    const text = extractOriginPageText(html);
    expect(text.length).toBe(2000);
    expect(text).not.toContain("\n");
  });

  it("returns an empty string for a page with no readable text", () => {
    expect(extractOriginPageText("<html><body><script>onlyCode();</script></body></html>")).toBe("");
    expect(extractOriginPageText("")).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* Declared-charset decoding (2026-11-27): the Labour Force Survey    */
/* monthly page is served as Shift_JIS with no HTTP charset, so a     */
/* UTF-8 read garbled its value sentence into replacement characters  */
/* and the direct-GET candidate arrived empty. The fixtures below     */
/* are real encoded bytes (base64), not strings: a string fixture     */
/* can never reproduce the defect. Each decodes to a page whose body  */
/* states 完全失業率（季節調整値）は2.4％です。                          */
/* ------------------------------------------------------------------ */

function fixtureBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

// <html><head><meta charset="Shift_JIS"></head><body><p>完全失業率（季節調整値）は2.4％です。</p></body></html> in Shift_JIS.
const SHIFT_JIS_META_PAGE_B64 =
  "PGh0bWw+PGhlYWQ+PG1ldGEgY2hhcnNldD0iU2hpZnRfSklTIj48L2hlYWQ+PGJvZHk+PHA+iq6RU464i8aXpoFpi0eQ35KykK6SbIFqgs0yLjSBk4LFgreBQjwvcD48L2JvZHk+PC9odG1sPg==";
// The same page shape with no meta declaration at all, in Shift_JIS.
const SHIFT_JIS_NO_META_PAGE_B64 =
  "PGh0bWw+PGhlYWQ+PHRpdGxlPpOdjHaLxzwvdGl0bGU+PC9oZWFkPjxib2R5PjxwPoqukVOOuIvGl6aBaYtHkN+SspCukmyBaoLNMi40gZOCxYK3gUI8L3A+PC9ib2R5PjwvaHRtbD4=";
// The same page with <meta charset="EUC-JP">, in EUC-JP.
const EUC_JP_META_PAGE_B64 =
  "PGh0bWw+PGhlYWQ+PG1ldGEgY2hhcnNldD0iRVVDLUpQIj48L2hlYWQ+PGJvZHk+PHA+tLDBtLy6tsjOqKHKtajA4cS0wLDDzaHLpM8yLjSh86THpLmhozwvcD48L2JvZHk+PC9odG1sPg==";
// The same page with the http-equiv declaration form, in EUC-JP.
const EUC_JP_HTTP_EQUIV_PAGE_B64 =
  "PGh0bWw+PGhlYWQ+PG1ldGEgaHR0cC1lcXVpdj0iQ29udGVudC1UeXBlIiBjb250ZW50PSJ0ZXh0L2h0bWw7IGNoYXJzZXQ9RVVDLUpQIj48L2hlYWQ+PGJvZHk+PHA+tLDBtLy6tsjOqKHKtajA4cS0wLDDzaHLpM8yLjSh86THpLmhozwvcD48L2JvZHk+PC9odG1sPg==";

describe("decodeOriginPageHtml", () => {
  it("decodes a Shift_JIS page by its meta declaration (the stat.go.jp shape: no HTTP charset)", () => {
    const html = decodeOriginPageHtml(fixtureBytes(SHIFT_JIS_META_PAGE_B64), "text/html");
    expect(html).toContain("完全失業率（季節調整値）は2.4％です。");
    expect(html).not.toContain("�");
    // The pre-fix read (UTF-8 over the same bytes) loses the
    // sentence entirely — the defect this measure closes.
    expect(new TextDecoder("utf-8").decode(fixtureBytes(SHIFT_JIS_META_PAGE_B64)))
      .not.toContain("完全失業率");
  });

  it("decodes a Shift_JIS page by its HTTP Content-Type charset when no meta exists", () => {
    const html = decodeOriginPageHtml(
      fixtureBytes(SHIFT_JIS_NO_META_PAGE_B64),
      "text/html; charset=Shift_JIS",
    );
    expect(html).toContain("完全失業率（季節調整値）は2.4％です。");
    expect(html).not.toContain("�");
  });

  it("decodes EUC-JP pages by meta declaration, in both declaration forms", () => {
    for (const base64 of [EUC_JP_META_PAGE_B64, EUC_JP_HTTP_EQUIV_PAGE_B64]) {
      const html = decodeOriginPageHtml(fixtureBytes(base64), "text/html");
      expect(html).toContain("完全失業率（季節調整値）は2.4％です。");
      expect(html).not.toContain("�");
    }
  });

  it("the HTTP charset outranks the meta declaration", () => {
    // UTF-8 bytes whose meta (wrongly, for this fixture) claims
    // Shift_JIS: the header wins, so the text survives intact.
    const utf8Bytes = new TextEncoder().encode(
      '<html><head><meta charset="Shift_JIS"></head><body><p>完全失業率（季節調整値）は2.4％です。</p></body></html>',
    );
    const html = decodeOriginPageHtml(utf8Bytes, "text/html; charset=UTF-8");
    expect(html).toContain("完全失業率（季節調整値）は2.4％です。");
    expect(html).not.toContain("�");
  });

  it("a page that declares nothing decodes as UTF-8, exactly as before", () => {
    const utf8Bytes = new TextEncoder().encode(
      "<html><head><title>統計局</title></head><body><p>完全失業率（季節調整値）は2.4％です。</p></body></html>",
    );
    for (const contentType of ["text/html", null, undefined]) {
      const html = decodeOriginPageHtml(utf8Bytes, contentType);
      expect(html).toContain("完全失業率（季節調整値）は2.4％です。");
      expect(html).not.toContain("�");
    }
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

/* ------------------------------------------------------------------ */
/* Frankfurter (FX reference rates)                                    */
/* ------------------------------------------------------------------ */

const FRANKFURTER_USD_JPY = {
  amount: 1,
  base: "USD",
  date: "2026-11-27",
  rates: { JPY: 156.78 },
};

describe("parseFrankfurterRate", () => {
  it("accepts the documented shape and returns the reported date and rate", () => {
    expect(parseFrankfurterRate(FRANKFURTER_USD_JPY, "USD", "JPY")).toEqual({
      date: "2026-11-27",
      rate: 156.78,
    });
  });

  it("rejects a response whose base is not the requested one", () => {
    const error = (() => {
      try {
        parseFrankfurterRate({ ...FRANKFURTER_USD_JPY, base: "EUR" }, "USD", "JPY");
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(OriginSearchProviderError);
    expect((error as OriginSearchProviderError).code).toBe("invalid-response");
    expect((error as OriginSearchProviderError).providerId).toBe("frankfurter");
  });

  it("rejects missing, non-numeric, zero and negative rates", () => {
    for (const rates of [{}, { JPY: "156.78" }, { JPY: 0 }, { JPY: -1 }, { EUR: 0.9 }]) {
      expect(() => parseFrankfurterRate({ ...FRANKFURTER_USD_JPY, rates }, "USD", "JPY"))
        .toThrow(OriginSearchProviderError);
    }
  });

  it("rejects a malformed date and non-object payloads", () => {
    expect(() => parseFrankfurterRate({ ...FRANKFURTER_USD_JPY, date: "27/11/2026" }, "USD", "JPY"))
      .toThrow(OriginSearchProviderError);
    expect(() => parseFrankfurterRate(null, "USD", "JPY")).toThrow(OriginSearchProviderError);
    expect(() => parseFrankfurterRate("<html>error</html>", "USD", "JPY")).toThrow(OriginSearchProviderError);
  });
});

describe("fetchFrankfurterRate", () => {
  it("requests only the currency codes (latest) and returns the parsed rate", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(FRANKFURTER_USD_JPY);
    };
    const rate = await fetchFrankfurterRate(
      { base: "USD", quote: "JPY" },
      { fetchImpl, nowMs: Date.parse("2026-11-28T03:00:00.000Z") },
    );
    expect(rate).toEqual({
      base: "USD",
      quote: "JPY",
      rate: 156.78,
      date: "2026-11-27",
      retrievedAt: "2026-11-28T03:00:00.000Z",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY");
  });

  it("uses the dated path when a specific date is requested", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl: OriginSearchFetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ amount: 1, base: "EUR", date: "2024-01-05", rates: { JPY: 160.25 } });
    };
    const rate = await fetchFrankfurterRate({ base: "EUR", quote: "JPY", date: "2024-01-05" }, { fetchImpl });
    expect(rate.rate).toBe(160.25);
    expect(rate.date).toBe("2024-01-05");
    expect(calls[0]?.url).toBe("https://api.frankfurter.dev/v1/2024-01-05?base=EUR&symbols=JPY");
  });

  it("propagates HTTP failures as http errors", async () => {
    const fetchImpl: OriginSearchFetch = async () => jsonResponse({ error: "not found" }, 404);
    const error = await fetchFrankfurterRate({ base: "USD", quote: "JPY" }, { fetchImpl })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginSearchProviderError);
    expect((error as OriginSearchProviderError).code).toBe("http");
    expect((error as OriginSearchProviderError).status).toBe(404);
  });
});

describe("convertOriginFxAmount", () => {
  it("multiplies the amount by the unit rate", () => {
    expect(convertOriginFxAmount(100, 156.78)).toBeCloseTo(15_678);
    expect(convertOriginFxAmount(1, 0.0064)).toBeCloseTo(0.0064);
    expect(convertOriginFxAmount(0, 156.78)).toBe(0);
  });
});

describe("composeOriginFxText", () => {
  const rate: OriginFxRate = {
    base: "USD",
    quote: "JPY",
    rate: 156.78,
    date: "2026-11-27",
    retrievedAt: "2026-11-28T03:00:00.000Z",
  };

  it("states the rate, its date, the reference-rate note and the source", () => {
    const text = composeOriginFxText(rate, { amount: null });
    expect(text).toContain("ドル円（USD/JPY）: 1ドル = 156.78円（2026年11月27日のレート）");
    expect(text).toContain("欧州中央銀行（ECB）などの公式な参考レート");
    expect(text).toContain("実勢レート");
    expect(text).toContain("出典: Frankfurter（https://frankfurter.dev/）");
    expect(text).not.toContain("= 15,678");
  });

  it("adds the converted amount line when an amount was asked", () => {
    const text = composeOriginFxText(rate, { amount: 100 });
    expect(text).toContain("100ドル = 15,678円（2026年11月27日のレートで換算）");
  });

  it("keeps small rates precise instead of rounding them to zero", () => {
    const text = composeOriginFxText(
      { base: "JPY", quote: "USD", rate: 0.006378, date: "2026-11-27", retrievedAt: "2026-11-28T03:00:00.000Z" },
      { amount: null },
    );
    expect(text).toContain("円ドル（JPY/USD）: 1円 = 0.006378ドル");
  });
});
