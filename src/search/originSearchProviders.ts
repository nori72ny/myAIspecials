/**
 * Search provider clients for search grounding (design doc
 * SEARCH_GROUNDING_DESIGN_2026-11-07 §1.2, §2.3).
 *
 * Every request is bounded by an explicit timeout (§2.7: a search call gets at
 * most 5 seconds). Failures raise OriginSearchProviderError and the grounding
 * orchestrator fails that route closed; nothing here retries or falls back to
 * a paid service. The Tavily API key is passed in by the caller from the
 * environment and is only ever placed in the Authorization header — never in
 * a URL, a log line, or a returned value.
 */
import type { OriginSearchProviderId } from "./originSearchProviderCatalog.js";

export interface OriginSearchFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type OriginSearchFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<OriginSearchFetchResponse>;

export const defaultOriginSearchFetch: OriginSearchFetch = (url, init) =>
  fetch(url, init) as Promise<OriginSearchFetchResponse>;

export type OriginSearchProviderErrorCode =
  | "timeout"
  | "http"
  | "network"
  | "invalid-response"
  | "no-results";

export class OriginSearchProviderError extends Error {
  readonly code: OriginSearchProviderErrorCode;
  readonly providerId: OriginSearchProviderId;
  readonly status?: number;

  constructor(providerId: OriginSearchProviderId, code: OriginSearchProviderErrorCode, status?: number) {
    super(`search provider ${providerId} failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "OriginSearchProviderError";
    this.providerId = providerId;
    this.code = code;
    this.status = status;
  }
}

export type OriginSourceAuthorityTier = "official" | "major-news" | "specialist" | "general";

export interface OriginSearchSource {
  title: string;
  url: string;
  excerpt: string;
  /** ISO publication / revision / first-seen timestamp when the provider reports one. */
  publishedAt?: string;
  providerId: OriginSearchProviderId;
  domain: string;
  authorityTier: OriginSourceAuthorityTier;
  evidenceLevel: "snippet" | "extracted";
  providerScore?: number;
}

export interface OriginSearchProviderDeps {
  fetchImpl?: OriginSearchFetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const USER_AGENT = "ORIGIN-Personal/1.0 (https://origin-personal.vercel.app; search-grounding)";

export function originDomainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname !== "localhost";
  } catch {
    return false;
  }
}

const OFFICIAL_DOMAIN_SUFFIXES: readonly string[] = ["go.jp", "lg.jp"];
const OFFICIAL_DOMAINS: ReadonlySet<string> = new Set([
  "apple.com", "microsoft.com", "google.com", "openai.com", "anthropic.com",
  "github.com", "samsung.com", "sony.com", "nintendo.co.jp", "mozilla.org",
]);
const MAJOR_NEWS_DOMAINS: ReadonlySet<string> = new Set([
  "nhk.or.jp", "asahi.com", "mainichi.jp", "yomiuri.co.jp", "nikkei.com",
  "sankei.com", "jiji.com", "tokyo-np.co.jp", "chunichi.co.jp", "nishinippon.co.jp",
  "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "theguardian.com",
  "nytimes.com", "washingtonpost.com", "cnn.com", "bloomberg.com", "wsj.com", "ft.com",
]);
const SPECIALIST_DOMAINS: ReadonlySet<string> = new Set([
  "itmedia.co.jp", "impress.co.jp", "zdnet.com", "theverge.com", "wired.com",
  "arstechnica.com", "techcrunch.com", "nature.com", "science.org",
]);
const ENCYCLOPEDIA_DOMAINS: ReadonlySet<string> = new Set(["wikipedia.org", "wikidata.org"]);

function matchesDomainSet(domain: string, set: ReadonlySet<string>): boolean {
  for (const known of set) {
    if (domain === known || domain.endsWith(`.${known}`)) return true;
  }
  return false;
}

export function classifyOriginDomainTier(domain: string): OriginSourceAuthorityTier {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  // Exact host or dot-boundary suffix only: "evilwikipedia.org" must not be
  // treated as part of wikipedia.org (callers pass URL-parsed hostnames, and
  // unparseable input arrives here as "" and falls through to "general").
  if (matchesDomainSet(normalized, ENCYCLOPEDIA_DOMAINS)) return "specialist";
  if (matchesDomainSet(normalized, OFFICIAL_DOMAINS)) return "official";
  if (OFFICIAL_DOMAIN_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))) return "official";
  if (matchesDomainSet(normalized, MAJOR_NEWS_DOMAINS)) return "major-news";
  if (matchesDomainSet(normalized, SPECIALIST_DOMAINS)) return "specialist";
  return "general";
}

export const ORIGIN_TIER_WEIGHT: Readonly<Record<OriginSourceAuthorityTier, number>> = {
  official: 4,
  "major-news": 3,
  specialist: 2,
  general: 1,
};

async function requestText(
  providerId: OriginSearchProviderId,
  deps: OriginSearchProviderDeps,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? defaultOriginSearchFetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new OriginSearchProviderError(providerId, "http", response.status);
    return await response.text();
  } catch (error) {
    if (error instanceof OriginSearchProviderError) throw error;
    if (controller.signal.aborted) throw new OriginSearchProviderError(providerId, "timeout");
    throw new OriginSearchProviderError(providerId, "network");
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson<T>(
  providerId: OriginSearchProviderId,
  deps: OriginSearchProviderDeps,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<T> {
  const text = await requestText(providerId, deps, url, init);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OriginSearchProviderError(providerId, "invalid-response");
  }
}

const HTML_ENTITY_DECODE_MAP: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

function stripHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]+>/g, " ")
    // Single-pass decoding: each entity token is replaced exactly once and its
    // replacement is never rescanned, so doubly-encoded text such as
    // "&amp;lt;" decodes to the literal text "&lt;" instead of "<".
    .replace(/&(?:amp|quot|#39|apos|lt|gt);/g, (entity) => HTML_ENTITY_DECODE_MAP[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Open-Meteo (weather, §1.2 / §2.3)                                   */
/* ------------------------------------------------------------------ */

const WMO_WEATHER_LABELS_JA: Readonly<Record<number, string>> = {
  0: "晴れ", 1: "ほぼ晴れ", 2: "晴れ時々くもり", 3: "くもり",
  45: "霧", 48: "霧",
  51: "弱い霧雨", 53: "霧雨", 55: "霧雨",
  56: "着氷性の霧雨", 57: "着氷性の霧雨",
  61: "弱い雨", 63: "雨", 65: "強い雨",
  66: "着氷性の雨", 67: "着氷性の雨",
  71: "弱い雪", 73: "雪", 75: "強い雪", 77: "雪あられ",
  80: "にわか雨", 81: "にわか雨", 82: "激しいにわか雨",
  85: "にわか雪", 86: "にわか雪",
  95: "雷雨", 96: "雹を伴う雷雨", 99: "雹を伴う雷雨",
};

export function openMeteoWeatherLabelJa(code: number): string {
  return WMO_WEATHER_LABELS_JA[code] ?? "不明";
}

export interface OriginWeatherDay {
  date: string;
  weatherCode: number;
  weatherLabel: string;
  maxC: number;
  minC: number;
  precipitationProbabilityMaxPercent: number | null;
}

export interface OriginWeatherForecast {
  place: string;
  region?: string;
  country?: string;
  current: {
    temperatureC: number;
    apparentTemperatureC: number;
    humidityPercent: number;
    weatherCode: number;
    weatherLabel: string;
    observedAt: string;
  };
  days: OriginWeatherDay[];
  retrievedAt: string;
  sourceUrl: "https://open-meteo.com/";
}

interface OpenMeteoGeocodingResponse {
  results?: Array<{
    name?: string;
    admin1?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  }>;
}

interface OpenMeteoForecastResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: Array<number | null>;
  };
}

/**
 * Japanese administrative suffixes. With language=ja, the Open-Meteo
 * geocoding index often only carries the fully suffixed form of a place
 * (東京都, 大阪市, 札幌市, ...), so a bare name such as 東京 or 大阪 returns
 * zero results even though the place exists. When the original name yields
 * no result we retry with the most likely suffixes appended, in the order
 * 市 → 都 → 府 → 県 (measured 2026-11-07: 東京→東京都, 大阪→大阪市,
 * 京都→京都市, 札幌→札幌市 all resolve within one or two retries). Only
 * an empty geocoding result triggers a retry: transport/HTTP failures
 * propagate unchanged so a real outage is never masked by extra lookups.
 * The total number of geocoding requests stays bounded (original + 4).
 */
const JAPANESE_ADMIN_SUFFIXES: readonly string[] = ["都", "府", "県", "市", "区", "町", "村"];
const GEOCODING_SUFFIX_RETRY_ORDER: readonly string[] = ["市", "都", "府", "県"];
const JAPANESE_TEXT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

function geocodingNameCandidates(place: string): string[] {
  const candidates = [place];
  const isJapanesePlace = JAPANESE_TEXT_PATTERN.test(place);
  // A trailing suffix only counts as an administrative suffix when a real
  // base name (2+ chars) precedes it: 京都 ends in the character 都 as part
  // of the proper name itself, so it must still earn suffix retries
  // (京都→京都市), while 東京都 / 大阪市 skip them as intended.
  const alreadySuffixed = JAPANESE_ADMIN_SUFFIXES.some(
    (suffix) => place.endsWith(suffix) && place.length - suffix.length >= 2,
  );
  if (isJapanesePlace && !alreadySuffixed) {
    for (const suffix of GEOCODING_SUFFIX_RETRY_ORDER) candidates.push(place + suffix);
  }
  return candidates;
}

type OpenMeteoGeocodingResult = NonNullable<OpenMeteoGeocodingResponse["results"]>[number];

async function geocodeOpenMeteoPlace(
  place: string,
  deps: OriginSearchProviderDeps,
): Promise<OpenMeteoGeocodingResult | null> {
  for (const name of geocodingNameCandidates(place)) {
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=ja&format=json`;
    const geo = await requestJson<OpenMeteoGeocodingResponse>("open-meteo", deps, geocodingUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    const location = geo.results?.[0];
    if (location && typeof location.latitude === "number" && typeof location.longitude === "number") {
      return location;
    }
  }
  return null;
}

/**
 * Open-Meteo returns `current.time` as a wall-clock string in the requested
 * timezone (this client always requests Asia/Tokyo) with NO UTC offset,
 * e.g. "2026-11-07T14:15". Kept verbatim, `new Date(...)` parses it in the
 * server process timezone (UTC on Vercel) and the later Asia/Tokyo
 * formatting shifts the displayed label by +9h (measured 2026-11-07 in
 * production: a 14:15 JST observation was labelled 23:15). Anchor the wall
 * clock to Tokyo explicitly — Japan is always UTC+9, no DST — so
 * `observedAt` denotes the true instant. Strings that already carry an
 * offset or have an unexpected shape are returned unchanged.
 */
function openMeteoTokyoWallClockToIso(time: string): string {
  const match = time.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return time;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}+09:00`;
}

export async function fetchOpenMeteoWeather(
  place: string,
  deps: OriginSearchProviderDeps & { nowMs?: number } = {},
): Promise<OriginWeatherForecast> {
  const location = await geocodeOpenMeteoPlace(place, deps);
  if (!location) {
    throw new OriginSearchProviderError("open-meteo", "no-results");
  }
  const forecastUrl = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${location.latitude}&longitude=${location.longitude}`
    + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
    + "&timezone=Asia%2FTokyo&forecast_days=7";
  const forecast = await requestJson<OpenMeteoForecastResponse>("open-meteo", deps, forecastUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  const current = forecast.current;
  if (!current || typeof current.temperature_2m !== "number" || typeof current.weather_code !== "number") {
    throw new OriginSearchProviderError("open-meteo", "invalid-response");
  }
  const days: OriginWeatherDay[] = (forecast.daily?.time ?? []).slice(0, 7).map((date, index) => {
    const code = forecast.daily?.weather_code?.[index] ?? -1;
    return {
      date,
      weatherCode: code,
      weatherLabel: openMeteoWeatherLabelJa(code),
      maxC: forecast.daily?.temperature_2m_max?.[index] ?? Number.NaN,
      minC: forecast.daily?.temperature_2m_min?.[index] ?? Number.NaN,
      precipitationProbabilityMaxPercent: forecast.daily?.precipitation_probability_max?.[index] ?? null,
    };
  }).filter((day) => Number.isFinite(day.maxC) && Number.isFinite(day.minC));
  if (days.length === 0) throw new OriginSearchProviderError("open-meteo", "invalid-response");
  const nowMs = deps.nowMs ?? Date.now();
  return {
    place: typeof location.name === "string" && location.name ? location.name : place,
    region: typeof location.admin1 === "string" ? location.admin1 : undefined,
    country: typeof location.country === "string" ? location.country : undefined,
    current: {
      temperatureC: current.temperature_2m,
      apparentTemperatureC: typeof current.apparent_temperature === "number" ? current.apparent_temperature : current.temperature_2m,
      humidityPercent: typeof current.relative_humidity_2m === "number" ? current.relative_humidity_2m : 0,
      weatherCode: current.weather_code,
      weatherLabel: openMeteoWeatherLabelJa(current.weather_code),
      observedAt: typeof current.time === "string" ? openMeteoTokyoWallClockToIso(current.time) : new Date(nowMs).toISOString(),
    },
    days,
    retrievedAt: new Date(nowMs).toISOString(),
    sourceUrl: "https://open-meteo.com/",
  };
}

function formatTokyoDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDayLabel(date: string, index: number): string {
  const parsed = new Date(`${date}T00:00:00+09:00`);
  const monthDay = Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(parsed);
  if (index === 0) return `今日（${monthDay}）`;
  if (index === 1) return `明日（${monthDay}）`;
  return monthDay;
}

export function composeOriginWeatherText(forecast: OriginWeatherForecast): string {
  const placeLabel = forecast.region && forecast.region !== forecast.place
    ? `${forecast.place}（${forecast.region}）`
    : forecast.place;
  const lines = [
    `${placeLabel}の天気`,
    `現在（${formatTokyoDateTime(forecast.current.observedAt)}時点）: ${forecast.current.weatherLabel}、気温 ${forecast.current.temperatureC}°C（体感 ${forecast.current.apparentTemperatureC}°C）、湿度 ${forecast.current.humidityPercent}%`,
    ...forecast.days.slice(0, 2).map((day) => {
      const probability = day.precipitationProbabilityMaxPercent === null
        ? "降水確率 不明"
        : `降水確率 最大${day.precipitationProbabilityMaxPercent}%`;
      return `${formatDayLabel(day.date, forecast.days.indexOf(day))}: ${day.weatherLabel}、最高 ${day.maxC}°C / 最低 ${day.minC}°C、${probability}`;
    }),
    `出典: Open-Meteo（https://open-meteo.com/）の気象データ（CC BY 4.0）。取得日時: ${formatTokyoDateTime(forecast.retrievedAt)}`,
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* GDELT (news headlines, §1.2 / §2.3)                                 */
/* ------------------------------------------------------------------ */

interface GdeltDocResponse {
  articles?: Array<{
    url?: string;
    title?: string;
    domain?: string;
    language?: string;
    seendate?: string;
  }>;
}

export function parseGdeltSeenDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

export async function searchGdeltHeadlines(
  query: string,
  deps: OriginSearchProviderDeps = {},
): Promise<OriginSearchSource[]> {
  const url = "https://api.gdeltproject.org/api/v2/doc/doc"
    + `?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=25&sort=datedesc`;
  const payload = await requestJson<GdeltDocResponse>("gdelt", deps, url, {
    headers: { "User-Agent": USER_AGENT },
  });
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  const seenDomains = new Set<string>();
  const seenTitles = new Set<string>();
  const sources: OriginSearchSource[] = [];
  for (const article of articles) {
    const articleUrl = typeof article.url === "string" ? article.url : "";
    const title = stripHtml(article.title);
    if (!articleUrl || !title || !isSafeHttpsUrl(articleUrl)) continue;
    const domain = originDomainOf(articleUrl);
    if (!domain || seenDomains.has(domain)) continue;
    const titleKey = title.toLowerCase().replace(/[\s\p{P}]+/gu, "");
    if (seenTitles.has(titleKey)) continue;
    seenDomains.add(domain);
    seenTitles.add(titleKey);
    sources.push({
      title,
      url: articleUrl,
      // GDELT returns metadata only (no snippet); the headline itself is the
      // retrieved text for this route, per the Phase 0 design.
      excerpt: title,
      publishedAt: parseGdeltSeenDate(article.seendate),
      providerId: "gdelt",
      domain,
      authorityTier: classifyOriginDomainTier(domain),
      evidenceLevel: "snippet",
    });
    if (sources.length >= 8) break;
  }
  return sources;
}

/* ------------------------------------------------------------------ */
/* Wikipedia / Wikidata (stable facts, §1.2 / §2.3)                    */
/* ------------------------------------------------------------------ */

interface WikipediaSearchResponse {
  pages?: Array<{ key?: string; title?: string; excerpt?: string; description?: string }>;
}

interface WikipediaBareResponse {
  html_url?: string;
  latest?: { timestamp?: string };
}

export async function searchWikipediaSources(
  query: string,
  deps: OriginSearchProviderDeps & { language?: "ja" | "en" } = {},
): Promise<OriginSearchSource[]> {
  const language = deps.language ?? (/[ぁ-んァ-ヶ一-龠]/.test(query) ? "ja" : "en");
  const origin = `https://${language}.wikipedia.org`;
  const headers = { "User-Agent": USER_AGENT };
  const searchUrl = `${origin}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=3`;
  const payload = await requestJson<WikipediaSearchResponse>("wikipedia", deps, searchUrl, { headers });
  const pages = Array.isArray(payload.pages) ? payload.pages.slice(0, 3) : [];
  const sources: OriginSearchSource[] = [];
  for (const page of pages) {
    const key = typeof page.key === "string" ? page.key : "";
    const title = stripHtml(page.title) || key;
    const excerpt = stripHtml(page.excerpt) || stripHtml(page.description);
    if (!key || !title || !excerpt) continue;
    let url = `${origin}/wiki/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
    let publishedAt: string | undefined;
    try {
      const bare = await requestJson<WikipediaBareResponse>(
        "wikipedia",
        deps,
        `${origin}/w/rest.php/v1/page/${encodeURIComponent(key)}/bare`,
        { headers },
      );
      if (typeof bare.html_url === "string" && bare.html_url.startsWith(origin)) url = bare.html_url;
      if (typeof bare.latest?.timestamp === "string") publishedAt = bare.latest.timestamp;
    } catch {
      // Metadata is best-effort; the search result itself is still usable.
    }
    if (!isSafeHttpsUrl(url)) continue;
    sources.push({
      title,
      url,
      excerpt: excerpt.slice(0, 1200),
      publishedAt,
      providerId: "wikipedia",
      domain: originDomainOf(url),
      authorityTier: "specialist",
      evidenceLevel: "snippet",
    });
  }
  return sources;
}

/* ------------------------------------------------------------------ */
/* Tavily (general search + extract, §1.1 / §2.3)                      */
/* ------------------------------------------------------------------ */

interface TavilySearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
    published_date?: string;
  }>;
}

interface TavilyExtractResponse {
  results?: Array<{ url?: string; raw_content?: string }>;
  failed_results?: Array<{ url?: string }>;
}

export interface TavilySearchOutcome {
  sources: OriginSearchSource[];
  /** Basic search is exactly 1 credit (verified pricing, 2026-11-07). */
  creditsUsed: number;
}

export async function searchTavilySources(
  query: string,
  deps: OriginSearchProviderDeps & {
    apiKey: string;
    topic: "general" | "news";
    timeRange: "day" | "week" | "month" | "year" | null;
    maxResults?: number;
  },
): Promise<TavilySearchOutcome> {
  const body: Record<string, unknown> = {
    query,
    topic: deps.topic,
    search_depth: "basic",
    max_results: deps.maxResults ?? 5,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  };
  if (deps.timeRange) body.time_range = deps.timeRange;
  const payload = await requestJson<TavilySearchResponse>("tavily", deps, "https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const results = Array.isArray(payload.results) ? payload.results : [];
  const sources: OriginSearchSource[] = [];
  for (const result of results) {
    const url = typeof result.url === "string" ? result.url : "";
    const title = stripHtml(result.title);
    if (!url || !title || !isSafeHttpsUrl(url)) continue;
    const publishedAt = typeof result.published_date === "string" && Number.isFinite(Date.parse(result.published_date))
      ? new Date(result.published_date).toISOString()
      : undefined;
    sources.push({
      title,
      url,
      excerpt: stripHtml(result.content).slice(0, 1500),
      publishedAt,
      providerId: "tavily",
      domain: originDomainOf(url),
      authorityTier: classifyOriginDomainTier(originDomainOf(url)),
      evidenceLevel: "snippet",
      providerScore: typeof result.score === "number" ? result.score : undefined,
    });
  }
  return { sources, creditsUsed: 1 };
}

export interface TavilyExtractOutcome {
  /** Full text by URL for successful extractions. */
  pages: Map<string, string>;
  failedUrls: string[];
  /** 1 credit per 5 successful URLs; 0 when nothing succeeded. */
  creditsUsed: number;
}

export async function extractTavilyPages(
  urls: readonly string[],
  deps: OriginSearchProviderDeps & { apiKey: string },
): Promise<TavilyExtractOutcome> {
  const targets = urls.filter(isSafeHttpsUrl).slice(0, 5);
  if (targets.length === 0) return { pages: new Map(), failedUrls: [], creditsUsed: 0 };
  const payload = await requestJson<TavilyExtractResponse>("tavily", deps, "https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ urls: targets, extract_depth: "basic", format: "text" }),
  });
  const pages = new Map<string, string>();
  for (const result of payload.results ?? []) {
    if (typeof result.url === "string" && typeof result.raw_content === "string" && result.raw_content.trim()) {
      pages.set(result.url, result.raw_content.replace(/\s+/g, " ").trim().slice(0, 2000));
    }
  }
  const failedUrls = (payload.failed_results ?? [])
    .map((entry) => entry.url)
    .filter((url): url is string => typeof url === "string");
  return {
    pages,
    failedUrls,
    creditsUsed: pages.size > 0 ? Math.ceil(pages.size / 5) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Stooq (market data: FX / indices / stocks / crypto / commodities)   */
/*                                                                     */
/* Keyless CSV snapshot endpoint. Only fixed provider symbols are ever */
/* sent — never user text. Stooq describes its quotes as delayed, so   */
/* every composed answer carries an explicit delay note plus the       */
/* quote's own date/time exactly as reported. Since 2026, third-party  */
/* reports conflict on whether Stooq's CSV endpoints still answer      */
/* keyless requests (some report an API-key demand page instead of     */
/* CSV). The parser therefore accepts only a strict CSV shape: an      */
/* HTML or key-demand response is an invalid-response failure and the  */
/* route fails closed (see originSearchProviderCatalog "stooq" note).  */
/* ------------------------------------------------------------------ */

export interface OriginMarketQuoteRequest {
  symbol: string;
  labelJa: string;
  unit: string;
}

export interface OriginMarketQuote extends OriginMarketQuoteRequest {
  /** Quote date exactly as reported by Stooq (YYYY-MM-DD). */
  date: string;
  /** Quote time exactly as reported by Stooq (HH:MM:SS, timezone not stated by the provider). */
  time: string;
  open: number;
  high: number;
  low: number;
  /** Latest price: the current quote while the market is open, else the last close. */
  close: number;
}

const STOOQ_QUOTE_FIELDS = "sd2t2ohlcv";
const STOOQ_HEADER_PREFIX = "Symbol,Date,Time,Open,High,Low,Close";

function parseStooqFiniteNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === "N/A") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Strict parser for the Stooq snapshot CSV. Anything that is not the
 * documented shape — an HTML page (key demand / proof-of-work / rate-limit
 * notice), a missing header, N/A values, non-numeric prices — yields no
 * quote for that row, and a response with zero usable quotes is rejected
 * by the caller as invalid. Values are never repaired or guessed.
 */
export function parseStooqQuotesCsv(
  csvText: string,
  requests: readonly OriginMarketQuoteRequest[],
): OriginMarketQuote[] {
  const text = (csvText ?? "").replace(/^\uFEFF/, "").trim();
  if (!text || text.startsWith("<") || !text.startsWith(STOOQ_HEADER_PREFIX)) return [];
  const bySymbol = new Map<string, OriginMarketQuoteRequest>();
  for (const request of requests) bySymbol.set(request.symbol.toLowerCase(), request);
  const quotes: OriginMarketQuote[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const columns = line.split(",");
    if (columns.length < 7) continue;
    const symbol = (columns[0] ?? "").trim().toLowerCase();
    const request = bySymbol.get(symbol);
    if (!request || seen.has(symbol)) continue;
    const date = (columns[1] ?? "").trim();
    const time = (columns[2] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) continue;
    const open = parseStooqFiniteNumber(columns[3]);
    const high = parseStooqFiniteNumber(columns[4]);
    const low = parseStooqFiniteNumber(columns[5]);
    const close = parseStooqFiniteNumber(columns[6]);
    if (open === null || high === null || low === null || close === null) continue;
    seen.add(symbol);
    quotes.push({ ...request, date, time, open, high, low, close });
  }
  // Preserve the caller's instrument order regardless of CSV row order.
  return requests
    .map((request) => quotes.find((quote) => quote.symbol === request.symbol))
    .filter((quote): quote is OriginMarketQuote => quote !== undefined);
}

export async function fetchStooqMarketQuotes(
  requests: readonly OriginMarketQuoteRequest[],
  deps: OriginSearchProviderDeps = {},
): Promise<OriginMarketQuote[]> {
  if (requests.length === 0) throw new OriginSearchProviderError("stooq", "no-results");
  const symbols = requests.map((request) => encodeURIComponent(request.symbol)).join(",");
  const url = `https://stooq.com/q/l/?s=${symbols}&f=${STOOQ_QUOTE_FIELDS}&h&e=csv`;
  const csv = await requestText("stooq", deps, url, { headers: { "User-Agent": USER_AGENT } });
  const quotes = parseStooqQuotesCsv(csv, requests);
  if (quotes.length === 0) throw new OriginSearchProviderError("stooq", "invalid-response");
  return quotes;
}

export const STOOQ_SOURCE_URL = "https://stooq.com/";

function formatMarketValue(value: number): string {
  return value.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function composeOriginMarketText(quotes: readonly OriginMarketQuote[], retrievedAtIso: string): string {
  const lines = [
    "市場データ（Stooq）",
    ...quotes.map((quote) => {
      const change = quote.close - quote.open;
      const changePercent = quote.open !== 0 ? (change / quote.open) * 100 : 0;
      const changeText = `${change >= 0 ? "+" : ""}${formatMarketValue(change)}（${change >= 0 ? "+" : ""}${changePercent.toFixed(2)}%、始値比）`;
      return `${quote.labelJa}: ${formatMarketValue(quote.close)}${quote.unit}（${quote.date} ${quote.time} 時点の値、始値 ${formatMarketValue(quote.open)}${quote.unit} / 高値 ${formatMarketValue(quote.high)}${quote.unit} / 安値 ${formatMarketValue(quote.low)}${quote.unit}、始値比 ${changeText}）`;
    }),
    "注記: Stooq の相場データは遅延配信です。表示した日時は Stooq が返したデータ自体の日時（タイムゾーンは提供元表記のまま）で、リアルタイム値ではありません。市場が開いている時間帯は最新の遅延値、休場時は直近の終値です。",
    `出典: Stooq（https://stooq.com/）の相場データ。取得日時: ${formatTokyoDateTime(retrievedAtIso)}`,
  ];
  return lines.join("\n");
}
