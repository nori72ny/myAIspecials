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
  /**
   * Byte access, when the implementation offers it (the real
   * fetch Response does). Optional so existing test doubles that
   * only model `text()` stay valid; callers that need the raw
   * bytes — the keyless page fetch decoding a page in its own
   * declared charset — use it when present and fall back to
   * `text()` otherwise.
   */
  arrayBuffer?(): Promise<ArrayBuffer>;
  /**
   * Minimal header access (the real Response's Headers shape),
   * for the same caller: the Content-Type charset outranks the
   * page's own meta declaration when both exist.
   */
  headers?: { get(name: string): string | null };
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
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
    // IP literals are never legitimate citation/extract targets here, and
    // they are the canonical way to aim a URL at loopback / link-local /
    // private addresses (SSRF). The URL parser has already normalized
    // integer and hex IPv4 spellings to dotted-quad form, so a digits-and-
    // dots hostname is an IPv4 literal; a colon means an IPv6 literal.
    // (Security audit 2026-11-08, defense-in-depth.)
    if (/^[0-9.]+$/.test(hostname) || hostname.includes(":")) return false;
    return true;
  } catch {
    return false;
  }
}

const OFFICIAL_DOMAIN_SUFFIXES: readonly string[] = ["go.jp", "lg.jp"];
const OFFICIAL_DOMAINS: ReadonlySet<string> = new Set([
  "apple.com", "microsoft.com", "google.com", "openai.com", "anthropic.com",
  "github.com", "samsung.com", "sony.com", "nintendo.co.jp", "mozilla.org",
]);
/**
 * Vendor domains are official only on their product surfaces (recon
 * 2026-11-15, C3 / I-2): the bare host, plus subdomains whose first label
 * names a sales / product / support surface (store.google.com,
 * support.apple.com, ...). Every other subdomain — developers.,
 * cloud., docs., and any future sibling — is NOT the product's official
 * page for a price or policy question and must not inherit the top tier:
 * with suffix matching, developers.google.com (a structured-data doc)
 * and cloud.google.com (a botnet article) both ranked as "official"
 * (weight 4) ahead of every on-topic source in a production price
 * packet. Public-sector suffixes (go.jp / lg.jp) keep suffix matching
 * via OFFICIAL_DOMAIN_SUFFIXES: every host under them is a government
 * surface by construction.
 */
const OFFICIAL_VENDOR_SUBDOMAIN_LABELS: ReadonlySet<string> = new Set([
  "store", "shop", "support", "help",
]);

function isOfficialDomain(domain: string): boolean {
  if (OFFICIAL_DOMAINS.has(domain)) return true;
  const firstDot = domain.indexOf(".");
  if (firstDot <= 0) return false;
  const label = domain.slice(0, firstDot);
  const rest = domain.slice(firstDot + 1);
  return OFFICIAL_VENDOR_SUBDOMAIN_LABELS.has(label) && OFFICIAL_DOMAINS.has(rest);
}
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
  if (isOfficialDomain(normalized)) return "official";
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

/**
 * Reduce a directly fetched page's HTML to plain body text — the
 * keyless counterpart of the extract route's text format, used for
 * the deterministic release-page candidates (Tavily-resilience
 * measure, ANSWER_ROUND8_REGRESSION_DIAGNOSIS_2026-11-27 対策3).
 * Boilerplate blocks (script / style / header / footer / nav /
 * aside / form) are removed whole before stripping, because a raw
 * page's document order leads with its global navigation while the
 * extract route returns the main content; the remaining text goes
 * through the same tag stripping and entity decoding as provider
 * snippets, is whitespace-collapsed, and is capped at the extract
 * route's 2,000 characters, so a directly fetched page and an
 * extracted page enter the candidate pool in the same shape.
 */
export function extractOriginPageText(html: string): string {
  const withoutBoilerplate = (html ?? "").replace(
    /<(script|style|noscript|header|footer|nav|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " ",
  );
  return stripHtml(withoutBoilerplate).slice(0, 2000);
}

/**
 * Map a declared charset label to one this decoder supports, or
 * null when the label names anything else. Japanese official
 * pages still publish in Shift_JIS (the Labour Force Survey
 * monthly page is the standing case) or, more rarely, EUC-JP;
 * everything else the keyless fetch meets is UTF-8. Unsupported
 * labels fall through to the next declaration source instead of
 * being handed to the decoder, so a wrong or exotic label can
 * never mojibake a page a later source would have read correctly.
 */
function supportedPageCharset(label: string | null | undefined): string | null {
  if (!label) return null;
  const key = label.trim().toLowerCase().replace(/_/g, "-");
  if (key === "utf-8" || key === "utf8") return "utf-8";
  if (key === "euc-jp" || key === "eucjp") return "euc-jp";
  if (
    key === "shift-jis" || key === "sjis" || key === "x-sjis"
    || key === "windows-31j" || key === "ms932" || key === "cp932"
  ) return "shift_jis";
  return null;
}

function pageCharsetFromContentType(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const match = contentType.match(/charset\s*=\s*"?([^";\s]+)"?/i);
  return supportedPageCharset(match?.[1]);
}

/** How much of a page's head is scanned for a meta charset. */
const PAGE_CHARSET_META_SCAN_BYTES = 4096;

function pageCharsetFromMeta(bytes: Uint8Array): string | null {
  // The declaration itself is ASCII in every supported encoding,
  // so a byte-wise latin1 read of the head finds it without
  // knowing the encoding first. One regex covers both forms:
  // <meta charset="Shift_JIS"> and the http-equiv variant whose
  // content attribute carries "text/html; charset=EUC-JP".
  const head = bytes.subarray(0, PAGE_CHARSET_META_SCAN_BYTES);
  let headText = "";
  for (const byte of head) headText += String.fromCharCode(byte);
  const match = headText.match(/<meta\s[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i);
  return supportedPageCharset(match?.[1]);
}

/**
 * Decode a directly fetched page's bytes with the charset the
 * page declares — HTTP Content-Type first, then the document's
 * own meta declaration, then UTF-8 (the `text()` default the
 * fetch used before this measure, and still the fallback for
 * pages that declare nothing). Measured defect (2026-11-27):
 * the Labour Force Survey monthly page is served as Shift_JIS
 * with no HTTP charset, so a UTF-8 read garbled it into
 * replacement characters and the value sentence never reached
 * the candidate text — invisible to the UTF-8 fixtures.
 */
export function decodeOriginPageHtml(bytes: Uint8Array, contentType?: string | null): string {
  const charset = pageCharsetFromContentType(contentType) ?? pageCharsetFromMeta(bytes) ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/* ------------------------------------------------------------------ */
/* JMA (weather, §1.2 / §2.3)                                          */
/* ------------------------------------------------------------------ */

/**
 * Weather route: the Japan Meteorological Agency (気象庁) bosai
 * forecast JSON, adopted 2026-11-27 by owner decision, replacing
 * Open-Meteo. Places are resolved to JMA region codes from the
 * official area table, so no coordinates ever leave the server —
 * the structural defect of the previous route, whose request URLs
 * embedded latitude/longitude while its terms documented 90-day
 * retention of request logs and a non-commercial-only free tier.
 * Keyless and free with no billing path; the data is published
 * under the Public Data License with attribution to 気象庁.
 *
 * Japan only, deterministically: a place the area table cannot
 * resolve to exactly one forecast area is NOT guessed — resolution
 * returns null and the caller falls back to the generic search
 * route (or answers honestly), never to an invented forecast.
 */

export const JMA_SOURCE_URL = "https://www.jma.go.jp/bosai/forecast/";
const JMA_AREA_TABLE_URL = "https://www.jma.go.jp/bosai/common/const/area.json";

function jmaForecastDataUrl(officeCode: string): string {
  return `https://www.jma.go.jp/bosai/forecast/data/forecast/${officeCode}.json`;
}

function jmaOverviewDataUrl(officeCode: string): string {
  return `https://www.jma.go.jp/bosai/forecast/data/overview_forecast/${officeCode}.json`;
}

/**
 * Fallback labels for JMA weather codes, used only for the weekly
 * element's days: the short-term element carries JMA's own weather
 * text, the weekly element carries codes alone. The table follows
 * JMA's code structure (hundreds = 晴れ/くもり/雨/雪 base, tens and
 * units = 時々/一時/後 patterns); codes outside the standard set
 * read 不明 rather than a guessed label.
 */
export function jmaWeatherCodeLabelJa(code: number): string {
  const base = Math.floor(code / 100);
  const suffix = code % 100;
  const baseLabel = { 1: "晴れ", 2: "くもり", 3: "雨", 4: "雪" }[base];
  if (!baseLabel) return "不明";
  const later = (word: string) => `${baseLabel}後${word}`;
  switch (suffix) {
    case 0: return baseLabel;
    case 1: return base === 1 ? "晴れ時々くもり" : `${baseLabel}時々晴れ`;
    case 2: return base <= 2 ? `${baseLabel}一時雨` : `${baseLabel}一時晴れ`;
    case 3: return base <= 2 ? `${baseLabel}時々雨` : `${baseLabel}時々晴れ`;
    case 4: return base === 4 ? "雪一時雨" : `${baseLabel}一時雪`;
    case 5: return base === 4 ? "雪時々雨" : `${baseLabel}時々雪`;
    case 6: return base === 4 ? "雪一時雨" : `${baseLabel}一時雨か雪`;
    case 7: return base === 4 ? "雪時々雨" : `${baseLabel}時々雨か雪`;
    case 8: return base === 3 ? "雨一時雷雨" : base === 4 ? "雪一時雪か雷雨" : `${baseLabel}一時雨か雷雨`;
    case 10: return base === 1 ? "晴れ後時々くもり" : later("時々晴れ");
    case 11: return base === 1 ? "晴れ後くもり" : later("晴れ");
    case 12: return base <= 2 ? later("一時雨") : later("一時晴れ");
    case 13: return base <= 2 ? later("時々雨") : later("時々晴れ");
    case 14: return base <= 2 ? later("雨") : later("晴れ");
    case 15: return base === 4 ? later("一時雨") : later("一時雪");
    case 16: return base === 4 ? later("時々雨") : later("時々雪");
    case 17: return base === 4 ? later("雨") : later("雨か雪");
    case 18: return base === 3 ? "雨後雷雨" : base === 4 ? "雪後雪か雷雨" : later("雨か雷雨");
    default: return "不明";
  }
}

export interface OriginWeatherDay {
  date: string;
  weatherCode: number;
  weatherLabel: string;
  maxC: number | null;
  minC: number | null;
  precipitationProbabilityMaxPercent: number | null;
}

export interface OriginWeatherForecast {
  place: string;
  region?: string;
  publishingOffice: string;
  reportDatetime: string;
  overviewText?: string;
  days: OriginWeatherDay[];
  retrievedAt: string;
  sourceUrl: "https://www.jma.go.jp/bosai/forecast/";
}

/* ------------------------- area table ------------------------- */

export interface JmaAreaEntry {
  name: string;
  parent?: string;
  children: string[];
}

export interface JmaAreaTable {
  offices: Readonly<Record<string, JmaAreaEntry>>;
  class10s: Readonly<Record<string, JmaAreaEntry>>;
  class15s: Readonly<Record<string, JmaAreaEntry>>;
  class20s: Readonly<Record<string, JmaAreaEntry>>;
}

function parseJmaAreaEntries(value: unknown): Record<string, JmaAreaEntry> {
  const entries: Record<string, JmaAreaEntry> = {};
  if (!value || typeof value !== "object") return entries;
  for (const [code, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name) continue;
    entries[code] = {
      name: record.name,
      parent: typeof record.parent === "string" ? record.parent : undefined,
      children: Array.isArray(record.children)
        ? record.children.filter((child): child is string => typeof child === "string")
        : [],
    };
  }
  return entries;
}

export function parseJmaAreaTable(payload: unknown): JmaAreaTable | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const table: JmaAreaTable = {
    offices: parseJmaAreaEntries(record.offices),
    class10s: parseJmaAreaEntries(record.class10s),
    class15s: parseJmaAreaEntries(record.class15s),
    class20s: parseJmaAreaEntries(record.class20s),
  };
  return Object.keys(table.offices).length > 0 && Object.keys(table.class10s).length > 0 ? table : null;
}

export async function fetchJmaAreaTable(
  deps: OriginSearchProviderDeps,
): Promise<JmaAreaTable> {
  const payload = await requestJson<unknown>("jma", deps, JMA_AREA_TABLE_URL, {
    headers: { "User-Agent": USER_AGENT },
  });
  const table = parseJmaAreaTable(payload);
  if (!table) throw new OriginSearchProviderError("jma", "invalid-response");
  return table;
}

const JMA_PLACE_SUFFIXES: readonly string[] = ["都", "府", "県", "市", "区", "町", "村"];

/**
 * The comparable core of a place or area name: a trailing 地方 and
 * one trailing administrative suffix are dropped, but only when a
 * real base name (2+ chars) precedes the suffix — 京都 ends in the
 * character 都 as part of the proper name itself, so it keeps it,
 * while 東京都→東京, 大阪府→大阪, 京都府→京都, 札幌市→札幌.
 */
export function jmaPlaceCore(name: string): string {
  let core = (name ?? "").normalize("NFKC").trim();
  if (core.endsWith("地方") && core.length - 2 >= 2) core = core.slice(0, -2);
  for (const suffix of JMA_PLACE_SUFFIXES) {
    if (core.endsWith(suffix) && core.length - suffix.length >= 2) {
      core = core.slice(0, -suffix.length);
      break;
    }
  }
  return core;
}

export interface JmaResolvedArea {
  /** The place name as the user phrased it (display). */
  placeName: string;
  officeCode: string;
  officeName: string;
  class10Code: string;
  class10Name: string;
  /** Index of the class10 within the office's class10 children; the
   * bosai temps points follow the same order, as a fallback when no
   * point name matches the place. */
  class10Index: number;
}

function jmaOfficeClass10Codes(table: JmaAreaTable, officeCode: string): string[] {
  const office = table.offices[officeCode];
  if (!office) return [];
  return office.children.filter((code) => table.class10s[code]);
}

function jmaResolveWithinOffice(
  table: JmaAreaTable,
  officeCode: string,
  placeCore: string,
  placeName: string,
  preferredClass10Code?: string,
): JmaResolvedArea | null {
  const office = table.offices[officeCode];
  if (!office) return null;
  const class10Codes = jmaOfficeClass10Codes(table, officeCode);
  if (class10Codes.length === 0) return null;
  let class10Code = preferredClass10Code && class10Codes.includes(preferredClass10Code)
    ? preferredClass10Code
    : undefined;
  if (!class10Code) {
    class10Code = class10Codes.find((code) => jmaPlaceCore(table.class10s[code]!.name) === placeCore)
      ?? class10Codes[0]!;
  }
  const class10 = table.class10s[class10Code]!;
  return {
    placeName,
    officeCode,
    officeName: office.name,
    class10Code,
    class10Name: class10.name,
    class10Index: class10Codes.indexOf(class10Code),
  };
}

function jmaNameMatches(entryName: string, placeRaw: string, placeCore: string): boolean {
  if (entryName === placeRaw) return true;
  const entryCore = jmaPlaceCore(entryName);
  if (entryCore === placeCore) return true;
  // Prefix: 沖縄 resolves to the office named 沖縄本島地方. Kept
  // unique-only by the caller, so a prefix can never pick between
  // two different forecast areas.
  return placeCore.length >= 2 && entryCore.startsWith(placeCore);
}

/**
 * Deterministic place -> forecast-area resolution over the official
 * area table. Steps, in order: the 北海道 special case (no office
 * is named 北海道 — the island is split into seven offices, and
 * Sapporo's office is the standing default), offices, primary
 * subdivisions (class10), then municipalities and secondary
 * subdivisions (class20/class15) walked up their parent chain.
 * A step whose matches resolve to more than one distinct forecast
 * area fails closed (null): an ambiguous place is not guessed.
 */
export function resolveJmaArea(table: JmaAreaTable, place: string): JmaResolvedArea | null {
  const placeRaw = (place ?? "").normalize("NFKC").trim();
  if (!placeRaw) return null;
  const placeCore = jmaPlaceCore(placeRaw);

  if (placeCore === "北海道") {
    return jmaResolveWithinOffice(table, "016000", placeCore, placeRaw, "016010");
  }

  const officeMatches = Object.keys(table.offices).filter((code) =>
    jmaNameMatches(table.offices[code]!.name, placeRaw, placeCore));
  if (officeMatches.length > 0) {
    const resolved = officeMatches
      .map((code) => jmaResolveWithinOffice(table, code, placeCore, placeRaw))
      .filter((candidate): candidate is JmaResolvedArea => candidate !== null);
    const distinct = new Map(resolved.map((candidate) => [`${candidate.officeCode}:${candidate.class10Code}`, candidate]));
    return distinct.size === 1 ? [...distinct.values()][0]! : null;
  }

  const class10Matches = Object.keys(table.class10s).filter((code) =>
    jmaNameMatches(table.class10s[code]!.name, placeRaw, placeCore));
  if (class10Matches.length > 0) {
    const resolved = class10Matches
      .map((code) => {
        const parent = table.class10s[code]!.parent;
        return parent ? jmaResolveWithinOffice(table, parent, placeCore, placeRaw, code) : null;
      })
      .filter((candidate): candidate is JmaResolvedArea => candidate !== null);
    const distinct = new Map(resolved.map((candidate) => [`${candidate.officeCode}:${candidate.class10Code}`, candidate]));
    return distinct.size === 1 ? [...distinct.values()][0]! : null;
  }

  const leafMatches: Array<{ officeCode: string; class10Code: string }> = [];
  const leafEntries = [...Object.entries(table.class20s), ...Object.entries(table.class15s)];
  for (const [code, entry] of leafEntries) {
    if (!jmaNameMatches(entry.name, placeRaw, placeCore)) continue;
    let currentCode: string | undefined = code;
    let class10Code: string | undefined;
    const seen = new Set<string>();
    while (currentCode && !seen.has(currentCode)) {
      seen.add(currentCode);
      if (table.class10s[currentCode]) class10Code = currentCode;
      if (table.offices[currentCode]) break;
      currentCode = table.class20s[currentCode]?.parent
        ?? table.class15s[currentCode]?.parent
        ?? table.class10s[currentCode]?.parent
        ?? table.offices[currentCode]?.parent;
    }
    if (currentCode && table.offices[currentCode] && class10Code) {
      leafMatches.push({ officeCode: currentCode, class10Code });
    }
  }
  if (leafMatches.length > 0) {
    const distinct = new Map(leafMatches.map((match) => [`${match.officeCode}:${match.class10Code}`, match]));
    if (distinct.size !== 1) return null;
    const only = [...distinct.values()][0]!;
    return jmaResolveWithinOffice(table, only.officeCode, placeCore, placeRaw, only.class10Code);
  }

  return null;
}

/* ------------------------- forecast ------------------------- */

interface JmaForecastAreaSeries {
  area?: { name?: string; code?: string };
  weatherCodes?: string[];
  weathers?: string[];
  pops?: string[];
  temps?: string[];
  tempsMin?: string[];
  tempsMax?: string[];
}

interface JmaTimeSeries {
  timeDefines?: string[];
  areas?: JmaForecastAreaSeries[];
}

interface JmaForecastElement {
  publishingOffice?: string;
  reportDatetime?: string;
  timeSeries?: JmaTimeSeries[];
}

interface JmaOverviewResponse {
  publishingOffice?: string;
  reportDatetime?: string;
  targetArea?: string;
  headlineText?: string;
  text?: string;
}

function jmaDatePart(isoDateTime: string): string {
  return typeof isoDateTime === "string" ? isoDateTime.slice(0, 10) : "";
}

function parseJmaNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeJmaWeatherText(text: string): string {
  return text.replace(/[\s　]+/g, " ").trim();
}

export async function fetchJmaWeather(
  area: JmaResolvedArea,
  deps: OriginSearchProviderDeps & { nowMs?: number } = {},
): Promise<OriginWeatherForecast> {
  const payload = await requestJson<unknown>("jma", deps, jmaForecastDataUrl(area.officeCode), {
    headers: { "User-Agent": USER_AGENT },
  });
  const elements = Array.isArray(payload) ? (payload as JmaForecastElement[]) : [];
  const shortTerm = elements[0];
  if (!shortTerm || !Array.isArray(shortTerm.timeSeries) || typeof shortTerm.reportDatetime !== "string") {
    throw new OriginSearchProviderError("jma", "invalid-response");
  }
  const weekly = elements[1];

  // The overview text is enrichment only: its failure never fails
  // the forecast itself.
  let overview: JmaOverviewResponse | undefined;
  try {
    overview = await requestJson<JmaOverviewResponse>("jma", deps, jmaOverviewDataUrl(area.officeCode), {
      headers: { "User-Agent": USER_AGENT },
    });
  } catch {
    overview = undefined;
  }

  const weatherSeries = shortTerm.timeSeries[0];
  const areaWeather = weatherSeries?.areas?.find((candidate) => candidate.area?.code === area.class10Code)
    ?? weatherSeries?.areas?.[0];
  if (!weatherSeries || !areaWeather || !Array.isArray(weatherSeries.timeDefines)) {
    throw new OriginSearchProviderError("jma", "invalid-response");
  }

  // Precipitation probabilities: short-term 6-hour slots, max per day.
  const popsByDate = new Map<string, number>();
  const popsSeries = shortTerm.timeSeries[1];
  const areaPops = popsSeries?.areas?.find((candidate) => candidate.area?.code === area.class10Code);
  (popsSeries?.timeDefines ?? []).forEach((define, index) => {
    const value = parseJmaNumber(areaPops?.pops?.[index]);
    if (value === null) return;
    const date = jmaDatePart(define);
    const current = popsByDate.get(date);
    if (current === undefined || value > current) popsByDate.set(date, value);
  });

  // Temperatures: the temps points follow the office's class10 order;
  // a point whose name core matches the place wins, else the point at
  // the class10's index, else the first point.
  const tempsSeries = shortTerm.timeSeries[2];
  const points = tempsSeries?.areas ?? [];
  const placeCore = jmaPlaceCore(area.placeName);
  const tempsPoint = points.find((candidate) => jmaPlaceCore(candidate.area?.name ?? "") === placeCore)
    ?? points[area.class10Index]
    ?? points[0];
  const shortTermTempsByDate = new Map<string, { minC: number | null; maxC: number | null }>();
  (tempsSeries?.timeDefines ?? []).forEach((define, index) => {
    const value = parseJmaNumber(tempsPoint?.temps?.[index]);
    if (value === null) return;
    const date = jmaDatePart(define);
    const entry = shortTermTempsByDate.get(date) ?? { minC: null, maxC: null };
    // JMA publishes the day's low against the 00:00 define and the
    // day's high against the 09:00 define.
    if (define.slice(11, 13) === "00") entry.minC = value;
    else if (define.slice(11, 13) === "09") entry.maxC = value;
    shortTermTempsByDate.set(date, entry);
  });

  // Weekly element: codes/pops per day and min/max per temps point.
  const weeklyWeatherSeries = weekly?.timeSeries?.[0];
  const weeklyAreaWeather = weeklyWeatherSeries?.areas?.find((candidate) => candidate.area?.code === area.class10Code);
  const weeklyByDate = new Map<string, { weatherCode: number | null; pop: number | null }>();
  (weeklyWeatherSeries?.timeDefines ?? []).forEach((define, index) => {
    weeklyByDate.set(jmaDatePart(define), {
      weatherCode: parseJmaNumber(weeklyAreaWeather?.weatherCodes?.[index]),
      pop: parseJmaNumber(weeklyAreaWeather?.pops?.[index]),
    });
  });
  const weeklyTempsSeries = weekly?.timeSeries?.[1];
  const weeklyTempsPoint = weeklyTempsSeries?.areas?.find((candidate) => candidate.area?.code === tempsPoint?.area?.code)
    ?? weeklyTempsSeries?.areas?.find((candidate) => jmaPlaceCore(candidate.area?.name ?? "") === placeCore)
    ?? weeklyTempsSeries?.areas?.[0];
  const weeklyTempsByDate = new Map<string, { minC: number | null; maxC: number | null }>();
  (weeklyTempsSeries?.timeDefines ?? []).forEach((define, index) => {
    weeklyTempsByDate.set(jmaDatePart(define), {
      minC: parseJmaNumber(weeklyTempsPoint?.tempsMin?.[index]),
      maxC: parseJmaNumber(weeklyTempsPoint?.tempsMax?.[index]),
    });
  });

  const shortTermDates = weatherSeries.timeDefines.map(jmaDatePart);
  const dates = [...shortTermDates];
  for (const date of weeklyByDate.keys()) {
    if (!dates.includes(date)) dates.push(date);
  }
  const days: OriginWeatherDay[] = [];
  for (const date of dates.slice(0, 7)) {
    const shortIndex = shortTermDates.indexOf(date);
    const weeklyEntry = weeklyByDate.get(date);
    const weatherCode = (shortIndex >= 0 ? parseJmaNumber(areaWeather.weatherCodes?.[shortIndex]) : null)
      ?? weeklyEntry?.weatherCode
      ?? -1;
    const weatherLabel = shortIndex >= 0 && typeof areaWeather.weathers?.[shortIndex] === "string"
      ? normalizeJmaWeatherText(areaWeather.weathers[shortIndex]!)
      : jmaWeatherCodeLabelJa(weatherCode);
    if (!weatherLabel) continue;
    const temps = shortTermTempsByDate.get(date) ?? weeklyTempsByDate.get(date);
    days.push({
      date,
      weatherCode,
      weatherLabel,
      maxC: temps?.maxC ?? null,
      minC: temps?.minC ?? null,
      precipitationProbabilityMaxPercent: popsByDate.get(date) ?? weeklyEntry?.pop ?? null,
    });
  }
  if (days.length === 0) throw new OriginSearchProviderError("jma", "invalid-response");

  const nowMs = deps.nowMs ?? Date.now();
  const overviewText = typeof overview?.text === "string"
    ? overview.text.replace(/\s+/g, " ").trim().slice(0, 400)
    : "";
  return {
    place: area.placeName,
    region: area.class10Name !== area.placeName ? area.class10Name : undefined,
    publishingOffice: typeof shortTerm.publishingOffice === "string" && shortTerm.publishingOffice
      ? shortTerm.publishingOffice
      : "気象庁",
    reportDatetime: shortTerm.reportDatetime,
    ...(overviewText ? { overviewText } : {}),
    days,
    retrievedAt: new Date(nowMs).toISOString(),
    sourceUrl: JMA_SOURCE_URL,
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

function tokyoDateString(instantIso: string): string {
  const date = new Date(instantIso);
  if (Number.isNaN(date.getTime())) return instantIso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatJmaDayLabel(date: string, todayDate: string): string {
  const parsed = new Date(`${date}T00:00:00+09:00`);
  const monthDay = Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(parsed);
  if (date === todayDate) return `今日（${monthDay}）`;
  const tomorrow = new Date(`${todayDate}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date === tomorrow.toISOString().slice(0, 10)) return `明日（${monthDay}）`;
  return monthDay;
}

export function composeOriginWeatherText(forecast: OriginWeatherForecast): string {
  const placeLabel = forecast.region && forecast.region !== forecast.place
    ? `${forecast.place}（${forecast.region}）`
    : forecast.place;
  const today = tokyoDateString(forecast.retrievedAt);
  const lines = [
    `${placeLabel}の天気`,
    `発表: ${forecast.publishingOffice} ${formatTokyoDateTime(forecast.reportDatetime)}発表`,
    ...forecast.days.slice(0, 2).map((day) => {
      const temps = day.minC !== null && day.maxC !== null
        ? `最高 ${day.maxC}°C / 最低 ${day.minC}°C`
        : day.maxC !== null
          ? `最高 ${day.maxC}°C`
          : day.minC !== null
            ? `最低 ${day.minC}°C`
            : null;
      const probability = day.precipitationProbabilityMaxPercent === null
        ? "降水確率 不明"
        : `降水確率 最大${day.precipitationProbabilityMaxPercent}%`;
      return [ `${formatJmaDayLabel(day.date, today)}: ${day.weatherLabel}`, temps, probability ]
        .filter((part): part is string => part !== null)
        .join("、");
    }),
    ...(forecast.overviewText ? [`概況: ${forecast.overviewText}`] : []),
    `出典: 気象庁（https://www.jma.go.jp/bosai/forecast/）の気象データ。取得日時: ${formatTokyoDateTime(forecast.retrievedAt)}`,
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

/*
 * Relevance screen, shared by the Wikipedia and Tavily routes (the
 * predicate below is provider-neutral; each route applies it to its own
 * candidates). It was built for Wikipedia first, where the failure mode
 * was measured in production; the Tavily route gained the same screen
 * in 2026-11-15 (recon I-1) after a price question's packet filled with
 * vendor-domain pages that merely shared common words with the query.
 *
 * Wikipedia full-text search ranks by relevance, but its hits are not
 * guaranteed on-topic for a long, goal-shaped query: a popular article
 * whose text merely shares common words with the goal can rank in the top
 * 3. Downstream, every candidate shares one domain (ja.wikipedia.org), so
 * source selection can keep only one of them — without a topic check the
 * survivor was decided by revision recency, not by relevance, and an
 * unrelated article (a popular work that happens to mention the goal's
 * words) could become the run's only "encyclopedia" source.
 *
 * The screen follows the legacy research filter's approach
 * (meaningfulQueryTerms / sourceMatchesIntent in
 * legacy/originResearchSource.ts), re-implemented small and local so the
 * grounding layer gains no new dependency on the legacy module: extract
 * the query's topic terms (generic instruction words removed) and require
 * the candidate's title or excerpt to cover them — at least two distinct
 * terms, or the only term when the query yields just one. When no topic
 * term can be extracted the screen is a no-op, exactly like the legacy
 * filter. If every candidate is screened out the caller sees zero
 * sources, which is what lets the stable route's Tavily fallback fire.
 *
 * Two reinforcements, both from production evidence (2026-11-11): the
 * excerpt-count screen alone let unrelated articles through, because a
 * candidate can *mention* the query's words without being *about* them —
 * a different mountain whose lead gives its elevation and names the
 * queried mountain as the taller one, and a popular work whose search
 * snippet is drawn from its reference list, quoting an article title
 * that contains the query's words. So (1) the search itself is issued
 * with the extracted topic terms only: full-text search ranks
 * goal-shaped sentences by shared common words and can leave the
 * on-topic article out of the top 3 entirely, while the same terms as a
 * keyword query rank it first; and (2) a candidate must be about at
 * least one topic term, proven by a title hit — excerpt matches alone
 * no longer suffice. A correct article whose title happens to share no
 * term with the query is dropped too; that fails closed into the same
 * Tavily fallback, which is the safe direction.
 */
const TOPIC_GENERIC_LATIN_TERMS: ReadonlySet<string> = new Set([
  "the", "and", "for", "from", "with", "about", "please", "explain", "summary", "summarize",
  "research", "source", "sources", "official", "help", "support", "latest", "recent", "current",
  "information", "news", "updates", "short", "brief", "using", "based", "method", "how",
]);

const TOPIC_GENERIC_JAPANESE_TERMS: ReadonlySet<string> = new Set([
  "公式", "ヘルプ", "サポート", "出典", "情報", "公開情報", "最新", "現在", "説明", "方法", "確認",
  "調査", "要約", "短く", "簡単", "詳しく", "最新情報", "複数", "ソース", "複数ソース",
]);

function searchTopicTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").toLowerCase();
  const terms: string[] = [];
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9._-]{1,}/g)) {
    const value = match[0].replace(/^www\./, "");
    if (!TOPIC_GENERIC_LATIN_TERMS.has(value) && !terms.includes(value)) terms.push(value);
  }
  for (const match of normalized.matchAll(/[ァ-ヶー一-龠]{2,}/g)) {
    const value = match[0];
    if (!TOPIC_GENERIC_JAPANESE_TERMS.has(value) && !terms.includes(value)) terms.push(value);
  }
  return terms.slice(0, 18);
}

function searchCandidateMatchesTopic(title: string, excerpt: string, topicTerms: readonly string[]): boolean {
  if (topicTerms.length === 0) return true;
  // Aboutness first: at least one topic term must appear in the title.
  // Excerpt-only matches passed production hits that merely mention the
  // query's words (see the note above), so they no longer suffice.
  const normalizedTitle = title.normalize("NFKC").toLowerCase();
  if (!topicTerms.some((term) => normalizedTitle.includes(term))) return false;
  const haystack = `${title} ${excerpt}`.normalize("NFKC").toLowerCase();
  const matched = topicTerms.filter((term) => haystack.includes(term)).length;
  return matched >= Math.min(2, topicTerms.length);
}

interface WikipediaBareResponse {
  html_url?: string;
  latest?: { timestamp?: string };
}

export interface WikipediaSearchOutcome {
  sources: OriginSearchSource[];
  /**
   * Candidates dropped by the relevance screen before their metadata
   * fetch (observation completion, SEARCH_RELIABILITY_95_PLAN_2026-11-24
   * 案1): this route's screen drops were previously invisible — unlike
   * the Tavily route, which has always reported its count — so a pool
   * emptied here could not be told apart from the provider returning
   * nothing. Tallies only; this route's domain is the Wikipedia host
   * and its tier is always "specialist", matching the source records.
   */
  screenedOutCount: number;
  screenedOutDomainCounts: Readonly<Record<string, number>>;
  screenedOutTierCounts: Readonly<Record<OriginSourceAuthorityTier, number>>;
}

export async function searchWikipediaSources(
  query: string,
  deps: OriginSearchProviderDeps & { language?: "ja" | "en" } = {},
): Promise<OriginSearchSource[]> {
  const outcome = await searchWikipediaSourcesObserved(query, deps);
  return outcome.sources;
}

export async function searchWikipediaSourcesObserved(
  query: string,
  deps: OriginSearchProviderDeps & { language?: "ja" | "en" } = {},
): Promise<WikipediaSearchOutcome> {
  const language = deps.language ?? (/[ぁ-んァ-ヶ一-龠]/.test(query) ? "ja" : "en");
  const origin = `https://${language}.wikipedia.org`;
  const headers = { "User-Agent": USER_AGENT };
  const topicTerms = searchTopicTerms(query);
  // Search with the topic terms only (see the relevance-screen note
  // above): the raw, goal-shaped query ranks unrelated articles first.
  // When no topic term can be extracted the query is sent unchanged.
  const searchQuery = topicTerms.length > 0 ? topicTerms.join(" ") : query;
  const searchUrl = `${origin}/w/rest.php/v1/search/page?q=${encodeURIComponent(searchQuery)}&limit=3`;
  const payload = await requestJson<WikipediaSearchResponse>("wikipedia", deps, searchUrl, { headers });
  const pages = Array.isArray(payload.pages) ? payload.pages.slice(0, 3) : [];
  const sources: OriginSearchSource[] = [];
  let screenedOutCount = 0;
  const screenedOutDomainCounts: Record<string, number> = {};
  const screenedOutTierCounts: Record<OriginSourceAuthorityTier, number> = {
    official: 0,
    "major-news": 0,
    specialist: 0,
    general: 0,
  };
  for (const [index, page] of pages.entries()) {
    const key = typeof page.key === "string" ? page.key : "";
    const title = stripHtml(page.title) || key;
    const excerpt = stripHtml(page.excerpt) || stripHtml(page.description);
    if (!key || !title || !excerpt) continue;
    // Relevance screen: an off-topic hit is dropped before its metadata
    // fetch, so it can neither win source selection nor consume the
    // route's one same-domain slot.
    if (!searchCandidateMatchesTopic(title, excerpt, topicTerms)) {
      screenedOutCount += 1;
      const screenedDomain = `${language}.wikipedia.org`;
      screenedOutDomainCounts[screenedDomain] = (screenedOutDomainCounts[screenedDomain] ?? 0) + 1;
      screenedOutTierCounts.specialist += 1;
      continue;
    }
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
      // Preserve the search engine's relevance order as a provider score
      // on the same 0..1 scale Tavily's relevance scores already use
      // (top hit highest, descending by rank), so source selection keeps
      // the best-ranked hit of this domain instead of degrading to a
      // revision-recency contest among equal scores.
      providerScore: (pages.length - index) / pages.length,
    });
  }
  return { sources, screenedOutCount, screenedOutDomainCounts, screenedOutTierCounts };
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
  /**
   * Candidates that passed the basic shape checks but were dropped by
   * the relevance screen (see searchCandidateMatchesTopic). Count only —
   * the dropped titles / excerpts are never retained.
   */
  screenedOutCount: number;
  /**
   * Domain / tier tallies of the screened-out candidates (observation
   * completion, SEARCH_RELIABILITY_95_PLAN_2026-11-24 案1): which
   * outlets the screen is dropping is part of attributing a thin or
   * empty candidate pool after the fact. Tallies only, in the same
   * discipline as the count above — no titles, excerpts, or URLs.
   */
  screenedOutDomainCounts: Readonly<Record<string, number>>;
  screenedOutTierCounts: Readonly<Record<OriginSourceAuthorityTier, number>>;
}

export async function searchTavilySources(
  query: string,
  deps: OriginSearchProviderDeps & {
    apiKey: string;
    topic: "general" | "news";
    timeRange: "day" | "week" | "month" | "year" | null;
    maxResults?: number;
    /**
     * Restrict results to these domains (Tavily's include_domains).
     * Used by the official-source routing
     * (F_GROUP_SOURCE_FIX_DESIGN_2026-11-19, measure B) to aim an
     * additional query at a topic's official domains; unset on every
     * ordinary query, which stays unrestricted exactly as before.
     */
    includeDomains?: readonly string[];
  },
): Promise<TavilySearchOutcome> {
  const body: Record<string, unknown> = {
    query,
    topic: deps.topic,
    search_depth: "basic",
    // 10 candidates per request (recon 2026-11-15, I-3): a basic search
    // costs 1 credit per request regardless of the result count, so a
    // wider candidate pool is free — and the freshness gate plus the
    // relevance screen below need material to drop from. Selection
    // still caps the packet at MAX_SELECTED_SOURCES downstream.
    max_results: deps.maxResults ?? 10,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  };
  if (deps.timeRange) body.time_range = deps.timeRange;
  if (deps.includeDomains && deps.includeDomains.length > 0) {
    body.include_domains = [...deps.includeDomains];
  }
  const payload = await requestJson<TavilySearchResponse>("tavily", deps, "https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const results = Array.isArray(payload.results) ? payload.results : [];
  // Relevance screen (recon 2026-11-15, I-1): the same deterministic
  // topic-term predicate the Wikipedia route uses. Tavily candidates
  // previously had no aboutness check at all, so a page that merely
  // shares common words with the query (a vendor's developer doc or
  // cloud-infrastructure article for a product price question) could
  // take a packet slot — and, on a vendor domain, the top slot. When no
  // topic term can be extracted the predicate is a no-op, exactly like
  // the Wikipedia route; when every candidate is screened out the
  // caller sees zero sources and the grounding layer fails closed.
  const topicTerms = searchTopicTerms(query);
  const sources: OriginSearchSource[] = [];
  let screenedOutCount = 0;
  const screenedOutDomainCounts: Record<string, number> = {};
  const screenedOutTierCounts: Record<OriginSourceAuthorityTier, number> = {
    official: 0,
    "major-news": 0,
    specialist: 0,
    general: 0,
  };
  for (const result of results) {
    const url = typeof result.url === "string" ? result.url : "";
    const title = stripHtml(result.title);
    if (!url || !title || !isSafeHttpsUrl(url)) continue;
    const excerpt = stripHtml(result.content).slice(0, 1500);
    if (!searchCandidateMatchesTopic(title, excerpt, topicTerms)) {
      screenedOutCount += 1;
      const screenedDomain = originDomainOf(url);
      if (screenedDomain) {
        screenedOutDomainCounts[screenedDomain] = (screenedOutDomainCounts[screenedDomain] ?? 0) + 1;
        screenedOutTierCounts[classifyOriginDomainTier(screenedDomain)] += 1;
      }
      continue;
    }
    const publishedAt = typeof result.published_date === "string" && Number.isFinite(Date.parse(result.published_date))
      ? new Date(result.published_date).toISOString()
      : undefined;
    sources.push({
      title,
      url,
      excerpt,
      publishedAt,
      providerId: "tavily",
      domain: originDomainOf(url),
      authorityTier: classifyOriginDomainTier(originDomainOf(url)),
      evidenceLevel: "snippet",
      providerScore: typeof result.score === "number" ? result.score : undefined,
    });
  }
  return { sources, creditsUsed: 1, screenedOutCount, screenedOutDomainCounts, screenedOutTierCounts };
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
