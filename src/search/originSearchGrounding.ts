/**
 * Search grounding orchestration (design doc SEARCH_GROUNDING_DESIGN_2026-11-07
 * §2.1 flow: classify -> route -> fetch -> verify freshness -> hand sources to
 * the existing generation path).
 *
 * This module only retrieves and verifies; generation stays in the existing
 * chat path (digest + synthesis with citation validation), and the model
 * provider / failover machinery is never touched. Retrieved web content is
 * data, never instructions: sources are handed over as structured records and
 * the synthesis prompt builder wraps them in an untrusted evidence packet.
 *
 * Latency budget (§2.7): a search call is cut at 5s and the whole retrieval
 * (including optional extract) at 8s, so grounding can never starve the
 * generation budget that PR #1115 established.
 */
import type { OriginResearchResult } from "../legacy/originResearchSource.js";
import {
  classifyOriginSearchQuestion,
  extractOriginMarketInstruments,
  extractOriginWeatherPlace,
  ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS,
  type OriginSearchFreshnessRequirement,
  type OriginSearchQuestionType,
} from "./originSearchClassifier.js";
import {
  defaultOriginSearchCache,
  ORIGIN_SEARCH_CACHE_TTL_MS,
  type OriginSearchTtlCache,
} from "./originSearchCache.js";
import {
  defaultOriginSearchUsageCounter,
  evaluateOriginSearchProviderAccess,
  type OriginSearchProviderEvidence,
  type OriginSearchProviderId,
  type OriginSearchUsageCounter,
} from "./originSearchProviderCatalog.js";
import {
  composeOriginMarketText,
  composeOriginWeatherText,
  extractTavilyPages,
  fetchOpenMeteoWeather,
  fetchStooqMarketQuotes,
  ORIGIN_TIER_WEIGHT,
  searchGdeltHeadlines,
  searchTavilySources,
  searchWikipediaSources,
  STOOQ_SOURCE_URL,
  type OriginMarketQuote,
  type OriginSearchFetch,
  type OriginSearchSource,
  type OriginWeatherForecast,
} from "./originSearchProviders.js";

/** §2.5: gate-failure answers must say what happened, not a bare refusal. */
export const ORIGIN_GROUNDING_UNAVAILABLE_MESSAGE_JA =
  "最新情報を確認しようとしましたが、信頼できる裏付けが取れませんでした。";
export const ORIGIN_GROUNDING_UNAVAILABLE_MESSAGE_EN =
  "I tried to verify the latest information, but could not obtain reliable sources to support an answer.";

export const ORIGIN_SEARCH_BUDGET_MS = {
  search: 5_000,
  total: 8_000,
} as const;

const MAX_SELECTED_SOURCES = 5;
const MAX_EXTRACT_URLS = 2;
const EXTRACT_SNIPPET_THRESHOLD = 600;

export interface OriginSearchGroundingDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: OriginSearchFetch;
  now?: () => number;
  catalog?: readonly OriginSearchProviderEvidence[];
  counter?: OriginSearchUsageCounter;
  cache?: OriginSearchTtlCache;
  budgets?: { searchMs?: number; totalMs?: number };
}

export interface OriginGroundedSource extends OriginSearchSource {
  /** True when a publication date existed and was inside the freshness window. */
  dateVerified: boolean;
}

export interface OriginSearchGroundingFreshnessStats {
  verifiedFreshCount: number;
  unknownDateCount: number;
  droppedStaleCount: number;
  droppedUndatedCount: number;
}

export type OriginSearchGroundingOutcome =
  | {
      kind: "grounded";
      questionType: Exclude<OriginSearchQuestionType, "no_search">;
      sources: OriginGroundedSource[];
      providersUsed: OriginSearchProviderId[];
      retrievedAt: string;
      freshness: OriginSearchGroundingFreshnessStats;
      freshnessVerified: boolean;
    }
  | {
      kind: "unavailable";
      questionType: Exclude<OriginSearchQuestionType, "no_search">;
      reason: "no-sources" | "no-fresh-sources" | "provider-error" | "monthly-cap-reached";
      freshness: OriginSearchGroundingFreshnessStats;
    }
  | { kind: "not-applicable"; reason: "no-search-needed" | "no-route-enabled" };

interface ResolvedDeps {
  env: NodeJS.ProcessEnv;
  fetchImpl?: OriginSearchFetch;
  now: () => number;
  catalog?: readonly OriginSearchProviderEvidence[];
  counter: OriginSearchUsageCounter;
  cache: OriginSearchTtlCache;
  searchMs: number;
  totalMs: number;
}

function resolveDeps(deps: OriginSearchGroundingDeps): ResolvedDeps {
  return {
    env: deps.env ?? process.env,
    fetchImpl: deps.fetchImpl,
    now: deps.now ?? Date.now,
    catalog: deps.catalog,
    counter: deps.counter ?? defaultOriginSearchUsageCounter,
    cache: deps.cache ?? defaultOriginSearchCache,
    searchMs: deps.budgets?.searchMs ?? ORIGIN_SEARCH_BUDGET_MS.search,
    totalMs: deps.budgets?.totalMs ?? ORIGIN_SEARCH_BUDGET_MS.total,
  };
}

function providerAccess(
  providerId: OriginSearchProviderId,
  deps: ResolvedDeps,
  units: number,
) {
  return evaluateOriginSearchProviderAccess(providerId, {
    env: deps.env,
    nowMs: deps.now(),
    catalog: deps.catalog,
    counter: deps.counter,
    units,
  });
}

function tavilyApiKey(deps: ResolvedDeps): string {
  const key = deps.env.TAVILY_API_KEY;
  return typeof key === "string" ? key.trim() : "";
}

/* ------------------------------------------------------------------ */
/* Freshness gate (§2.5 item 3)                                        */
/* ------------------------------------------------------------------ */

export function evaluateOriginSourceFreshness(
  sources: readonly OriginSearchSource[],
  requirement: OriginSearchFreshnessRequirement,
  questionType: Exclude<OriginSearchQuestionType, "no_search">,
  retrievedAtMs: number,
): { kept: OriginGroundedSource[]; stats: OriginSearchGroundingFreshnessStats } {
  const stats: OriginSearchGroundingFreshnessStats = {
    verifiedFreshCount: 0,
    unknownDateCount: 0,
    droppedStaleCount: 0,
    droppedUndatedCount: 0,
  };
  const kept: OriginGroundedSource[] = [];
  for (const source of sources) {
    const publishedMs = source.publishedAt ? Date.parse(source.publishedAt) : Number.NaN;
    if (Number.isFinite(publishedMs)) {
      const ageMs = retrievedAtMs - publishedMs;
      if (requirement.maxSourceAgeMs !== null && (ageMs > requirement.maxSourceAgeMs || ageMs < 0)) {
        stats.droppedStaleCount += 1;
        continue;
      }
      stats.verifiedFreshCount += 1;
      kept.push({ ...source, dateVerified: true });
      continue;
    }
    // No parseable publication date.
    if (requirement.strictPublicationDate) {
      stats.droppedUndatedCount += 1;
      continue;
    }
    stats.unknownDateCount += 1;
    kept.push({ ...source, dateVerified: false });
  }
  // fresh_general asserts currency, so an answer may not rest on undated
  // sources alone; price/policy pages (official product/policy pages are
  // commonly undated) may, and are flagged via freshnessVerified instead.
  if (questionType === "fresh_general" && stats.verifiedFreshCount === 0 && kept.length > 0) {
    stats.droppedUndatedCount += stats.unknownDateCount;
    return { kept: [], stats };
  }
  return { kept, stats };
}

/* ------------------------------------------------------------------ */
/* Source selection (§2.3: dedupe domains, official first, top 3-5)    */
/* ------------------------------------------------------------------ */

export function selectOriginSearchSources<T extends OriginSearchSource>(
  candidates: readonly T[],
  limit = MAX_SELECTED_SOURCES,
): T[] {
  const seenUrls = new Set<string>();
  const unique: T[] = [];
  for (const source of candidates) {
    if (!source.title || !source.url) continue;
    const key = source.url.split("#")[0];
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    unique.push(source);
  }
  const sorted = [...unique].sort((a, b) => {
    const tierDiff = ORIGIN_TIER_WEIGHT[b.authorityTier] - ORIGIN_TIER_WEIGHT[a.authorityTier];
    if (tierDiff !== 0) return tierDiff;
    const scoreDiff = (b.providerScore ?? 0) - (a.providerScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const dateDiff = (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0);
    return dateDiff;
  });
  const seenDomains = new Set<string>();
  const selected: T[] = [];
  for (const source of sorted) {
    if (source.domain && seenDomains.has(source.domain)) continue;
    if (source.domain) seenDomains.add(source.domain);
    selected.push(source);
    if (selected.length >= limit) break;
  }
  return selected;
}

/* ------------------------------------------------------------------ */
/* Route execution                                                     */
/* ------------------------------------------------------------------ */

interface RouteResult {
  sources: OriginSearchSource[];
  errored: boolean;
}

async function cachedCandidates(
  deps: ResolvedDeps,
  cacheKey: string,
  ttlMs: number,
  load: () => Promise<OriginSearchSource[]>,
): Promise<RouteResult> {
  const cached = deps.cache.get<OriginSearchSource[]>(cacheKey, deps.now());
  if (cached) return { sources: cached, errored: false };
  try {
    const sources = await load();
    deps.cache.set(cacheKey, sources, ttlMs, deps.now());
    return { sources, errored: false };
  } catch {
    return { sources: [], errored: true };
  }
}

async function runTavilyRoute(
  deps: ResolvedDeps,
  query: string,
  topic: "general" | "news",
  timeRange: "day" | "week" | "month" | "year" | null,
  timeoutMs: number,
): Promise<RouteResult> {
  const cacheKey = `cand:tavily:${topic}:${timeRange ?? "none"}:${query.toLowerCase()}`;
  return cachedCandidates(deps, cacheKey, ORIGIN_SEARCH_CACHE_TTL_MS.search, async () => {
    const outcome = await searchTavilySources(query, {
      fetchImpl: deps.fetchImpl,
      timeoutMs,
      apiKey: tavilyApiKey(deps),
      topic,
      timeRange,
    });
    deps.counter.record("tavily", outcome.creditsUsed, deps.now());
    return outcome.sources;
  });
}

async function runGdeltRoute(deps: ResolvedDeps, query: string, timeoutMs: number): Promise<RouteResult> {
  return cachedCandidates(deps, `cand:gdelt:${query.toLowerCase()}`, ORIGIN_SEARCH_CACHE_TTL_MS.news, () =>
    searchGdeltHeadlines(query, { fetchImpl: deps.fetchImpl, timeoutMs }),
  );
}

async function runWikipediaRoute(deps: ResolvedDeps, query: string, timeoutMs: number): Promise<RouteResult> {
  return cachedCandidates(deps, `cand:wikipedia:${query.toLowerCase()}`, ORIGIN_SEARCH_CACHE_TTL_MS.search, () =>
    searchWikipediaSources(query, { fetchImpl: deps.fetchImpl, timeoutMs }),
  );
}

export async function executeOriginSearchGrounding(
  message: string,
  depsInput: OriginSearchGroundingDeps = {},
): Promise<OriginSearchGroundingOutcome> {
  const deps = resolveDeps(depsInput);
  const startedAtMs = deps.now();
  const classification = classifyOriginSearchQuestion(message);
  if (classification.type === "no_search" || !classification.freshness) {
    return { kind: "not-applicable", reason: "no-search-needed" };
  }
  const questionType = classification.type;
  const requirement = classification.freshness;
  const query = classification.query;
  const retrievedAt = new Date(startedAtMs).toISOString();
  const emptyStats: OriginSearchGroundingFreshnessStats = {
    verifiedFreshCount: 0,
    unknownDateCount: 0,
    droppedStaleCount: 0,
    droppedUndatedCount: 0,
  };

  if (questionType === "weather") {
    const weather = await fetchOriginWeatherAnswer(message, undefined, depsInput);
    if (weather.ok === false) {
      return weather.reason === "provider-not-enabled"
        ? { kind: "not-applicable", reason: "no-route-enabled" }
        : { kind: "unavailable", questionType, reason: "provider-error", freshness: emptyStats };
    }
    return {
      kind: "grounded",
      questionType,
      sources: [{
        title: `${weather.forecast.place}の天気予報（Open-Meteo）`,
        url: weather.forecast.sourceUrl,
        excerpt: weather.text,
        publishedAt: weather.forecast.retrievedAt,
        providerId: "open-meteo",
        domain: "open-meteo.com",
        authorityTier: "official",
        evidenceLevel: "extracted",
        dateVerified: true,
      }],
      providersUsed: ["open-meteo"],
      retrievedAt,
      freshness: { verifiedFreshCount: 1, unknownDateCount: 0, droppedStaleCount: 0, droppedUndatedCount: 0 },
      freshnessVerified: true,
    };
  }

  if (questionType === "market") {
    // Dedicated keyless route first (Stooq), mirroring the weather branch:
    // a composed, timestamped quote packet. When Stooq cannot serve (route
    // disabled, no instrument identified, or the provider failed), the
    // existing generic market route below runs unchanged — the honest
    // fail-closed behaviour of the generic path is the fallback, never a
    // guessed number.
    const market = await fetchOriginMarketAnswer(message, depsInput);
    if (market.ok) {
      const newest = market.quotes.reduce((a, b) => (a.date + a.time >= b.date + b.time ? a : b));
      return {
        kind: "grounded",
        questionType,
        sources: [{
          title: "市場データ（Stooq）",
          url: STOOQ_SOURCE_URL,
          excerpt: market.text,
          publishedAt: `${newest.date}T${newest.time}Z`,
          providerId: "stooq",
          domain: "stooq.com",
          authorityTier: "specialist",
          evidenceLevel: "extracted",
          dateVerified: true,
        }],
        providersUsed: ["stooq"],
        retrievedAt,
        freshness: { verifiedFreshCount: 1, unknownDateCount: 0, droppedStaleCount: 0, droppedUndatedCount: 0 },
        freshnessVerified: true,
      };
    }
  }

  if (!query) {
    return { kind: "unavailable", questionType, reason: "no-sources", freshness: emptyStats };
  }

  const remainingMs = () => Math.max(0, deps.totalMs - (deps.now() - startedAtMs));
  const searchTimeoutMs = () => Math.max(1, Math.min(deps.searchMs, remainingMs()));

  const tavilyAccess = providerAccess("tavily", deps, 1);
  const gdeltAccess = providerAccess("gdelt", deps, 0);
  const wikipediaAccess = providerAccess("wikipedia", deps, 0);
  const tavilyEnabled = tavilyAccess.enabled && tavilyApiKey(deps).length > 0;
  const capReached = tavilyAccess.enabled === false && tavilyAccess.reason === "monthly-cap-reached";

  const routes: Array<Promise<RouteResult>> = [];
  const routeProviders: OriginSearchProviderId[] = [];
  const addRoute = (providerId: OriginSearchProviderId, run: Promise<RouteResult>) => {
    routeProviders.push(providerId);
    routes.push(run);
  };

  switch (questionType) {
    case "news":
      if (gdeltAccess.enabled) addRoute("gdelt", runGdeltRoute(deps, query, searchTimeoutMs()));
      if (tavilyEnabled) addRoute("tavily", runTavilyRoute(deps, query, requirement.tavilyTopic, requirement.tavilyTimeRange, searchTimeoutMs()));
      break;
    case "market":
    case "price_spec":
    case "policy":
      if (tavilyEnabled) addRoute("tavily", runTavilyRoute(deps, query, requirement.tavilyTopic, requirement.tavilyTimeRange, searchTimeoutMs()));
      break;
    case "fresh_general":
      if (tavilyEnabled) addRoute("tavily", runTavilyRoute(deps, query, requirement.tavilyTopic, requirement.tavilyTimeRange, searchTimeoutMs()));
      if (wikipediaAccess.enabled) addRoute("wikipedia", runWikipediaRoute(deps, query, searchTimeoutMs()));
      break;
    case "stable":
      if (wikipediaAccess.enabled) addRoute("wikipedia", runWikipediaRoute(deps, query, searchTimeoutMs()));
      break;
    default:
      break;
  }

  if (routes.length === 0) {
    if (capReached) return { kind: "unavailable", questionType, reason: "monthly-cap-reached", freshness: emptyStats };
    return { kind: "not-applicable", reason: "no-route-enabled" };
  }

  let results = await Promise.all(routes);
  let candidates = results.flatMap((result) => result.sources);
  const providersUsed = routeProviders.filter((_, index) => (results[index]?.sources.length ?? 0) > 0);

  // Stable facts: only when Wikipedia found nothing may the generic route be
  // used (§2.3), and then without a freshness window.
  if (questionType === "stable" && candidates.length === 0 && tavilyEnabled) {
    const fallback = await runTavilyRoute(deps, query, "general", null, searchTimeoutMs());
    results = [...results, fallback];
    if (fallback.sources.length > 0) providersUsed.push("tavily");
    candidates = fallback.sources;
  }

  if (candidates.length === 0) {
    const allErrored = results.every((result) => result.errored);
    return {
      kind: "unavailable",
      questionType,
      reason: allErrored ? "provider-error" : "no-sources",
      freshness: emptyStats,
    };
  }

  const { kept, stats } = evaluateOriginSourceFreshness(candidates, requirement, questionType, startedAtMs);
  if (kept.length === 0) {
    return { kind: "unavailable", questionType, reason: "no-fresh-sources", freshness: stats };
  }

  let selected = selectOriginSearchSources(kept);

  // Extract (§2.3): only when snippets are thin or the type is number-critical
  // (price_spec / policy), only the top 2, and only inside the total budget.
  const snippetChars = selected.reduce((sum, source) => sum + source.excerpt.length, 0);
  const extractWanted = questionType === "price_spec" || questionType === "policy" || snippetChars < EXTRACT_SNIPPET_THRESHOLD;
  if (extractWanted && tavilyEnabled && remainingMs() >= 1_000) {
    const extractAccess = providerAccess("tavily", deps, 1);
    if (extractAccess.enabled) {
      try {
        const targets = selected.slice(0, MAX_EXTRACT_URLS).map((source) => source.url);
        const extract = await extractTavilyPages(targets, {
          fetchImpl: deps.fetchImpl,
          timeoutMs: Math.max(1, remainingMs()),
          apiKey: tavilyApiKey(deps),
        });
        if (extract.creditsUsed > 0) deps.counter.record("tavily", extract.creditsUsed, deps.now());
        if (extract.pages.size > 0) {
          selected = selected.map((source) => {
            const text = extract.pages.get(source.url);
            return text ? { ...source, excerpt: text, evidenceLevel: "extracted" as const } : source;
          });
          if (!providersUsed.includes("tavily")) providersUsed.push("tavily");
        }
      } catch {
        // Extract is an enhancement only; snippets remain the evidence.
      }
    }
  }

  return {
    kind: "grounded",
    questionType,
    sources: selected,
    providersUsed,
    retrievedAt,
    freshness: stats,
    freshnessVerified: stats.verifiedFreshCount > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Weather service for the chat router's dedicated weather branch      */
/* ------------------------------------------------------------------ */

export type OriginWeatherAnswerResult =
  | { ok: true; forecast: OriginWeatherForecast; text: string }
  | { ok: false; reason: "provider-not-enabled" | "place-unknown" | "provider-error" };

export async function fetchOriginWeatherAnswer(
  message: string,
  userLocation: unknown,
  depsInput: OriginSearchGroundingDeps = {},
): Promise<OriginWeatherAnswerResult> {
  const deps = resolveDeps(depsInput);
  const access = evaluateOriginSearchProviderAccess("open-meteo", {
    env: deps.env,
    nowMs: deps.now(),
    catalog: deps.catalog,
    counter: deps.counter,
    units: 0,
  });
  if (!access.enabled) return { ok: false, reason: "provider-not-enabled" };
  const place = extractOriginWeatherPlace(message, userLocation);
  if (!place) return { ok: false, reason: "place-unknown" };
  const cacheKey = `weather:${place.toLowerCase()}`;
  const cached = deps.cache.get<OriginWeatherForecast>(cacheKey, deps.now());
  if (cached) return { ok: true, forecast: cached, text: composeOriginWeatherText(cached) };
  try {
    const forecast = await fetchOpenMeteoWeather(place, {
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.searchMs,
      nowMs: deps.now(),
    });
    deps.cache.set(cacheKey, forecast, ORIGIN_SEARCH_CACHE_TTL_MS.weather, deps.now());
    return { ok: true, forecast, text: composeOriginWeatherText(forecast) };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

/* ------------------------------------------------------------------ */
/* Market service for the grounding market branch (Stooq, keyless)     */
/* ------------------------------------------------------------------ */

export type OriginMarketAnswerResult =
  | { ok: true; quotes: OriginMarketQuote[]; text: string }
  | { ok: false; reason: "provider-not-enabled" | "no-instruments" | "provider-error" };

export async function fetchOriginMarketAnswer(
  message: string,
  depsInput: OriginSearchGroundingDeps = {},
): Promise<OriginMarketAnswerResult> {
  const deps = resolveDeps(depsInput);
  const access = evaluateOriginSearchProviderAccess("stooq", {
    env: deps.env,
    nowMs: deps.now(),
    catalog: deps.catalog,
    counter: deps.counter,
    units: 0,
  });
  if (!access.enabled) return { ok: false, reason: "provider-not-enabled" };
  const instruments = extractOriginMarketInstruments(message);
  if (instruments.length === 0) return { ok: false, reason: "no-instruments" };
  const requests = instruments.map((instrument) => ({
    symbol: instrument.symbol,
    labelJa: instrument.labelJa,
    unit: instrument.unit,
  }));
  const cacheKey = `market:${requests.map((request) => request.symbol).join(",")}`;
  const retrievedAt = new Date(deps.now()).toISOString();
  const cached = deps.cache.get<OriginMarketQuote[]>(cacheKey, deps.now());
  if (cached) return { ok: true, quotes: cached, text: composeOriginMarketText(cached, retrievedAt) };
  try {
    const quotes = await fetchStooqMarketQuotes(requests, {
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.searchMs,
    });
    deps.cache.set(cacheKey, quotes, ORIGIN_SEARCH_CACHE_TTL_MS.market, deps.now());
    return { ok: true, quotes, text: composeOriginMarketText(quotes, retrievedAt) };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

/* ------------------------------------------------------------------ */
/* Adapter + default research executor composition                     */
/* ------------------------------------------------------------------ */

const SEARCH_PROVIDER_LABELS: Readonly<Record<OriginSearchProviderId, string>> = {
  tavily: "Tavily",
  gdelt: "GDELT",
  wikipedia: "Wikipedia",
  "open-meteo": "Open-Meteo",
  stooq: "Stooq",
};

export function originSearchGroundingToResearchResult(
  outcome: Extract<OriginSearchGroundingOutcome, { kind: "grounded" }>,
): OriginResearchResult {
  return {
    ok: true,
    sources: outcome.sources.map((source, index) => ({
      title: source.title,
      url: source.url,
      excerpt: source.excerpt,
      revisionTimestamp: source.publishedAt,
      sourceType: source.providerId === "wikipedia" ? "encyclopedia" as const : "web-search" as const,
      // "official-domain-match" is reserved for user-requested official-domain
      // constraints; provider-side tier knowledge must not be upgraded into it.
      sourceAuthority: source.providerId === "wikipedia" ? "secondary-reference" as const : "unclassified" as const,
      domain: source.domain,
      rank: index + 1,
      evidenceLevel: source.evidenceLevel === "extracted" ? "page-verified" as const : "snippet" as const,
      retrievedAt: outcome.retrievedAt,
      freshness: outcome.questionType === "stable"
        ? "unknown" as const
        : source.dateVerified ? "recent" as const : "unknown" as const,
    })),
    searchProvider: outcome.providersUsed.length === 1
      ? SEARCH_PROVIDER_LABELS[outcome.providersUsed[0]] as OriginResearchResult["searchProvider"]
      : "SearchGrounding",
    grounding: {
      questionType: outcome.questionType,
      providersUsed: outcome.providersUsed,
      freshnessVerified: outcome.freshnessVerified,
      verifiedFreshSourceCount: outcome.freshness.verifiedFreshCount,
      unknownDateSourceCount: outcome.freshness.unknownDateCount,
      droppedStaleSourceCount: outcome.freshness.droppedStaleCount,
      droppedUndatedSourceCount: outcome.freshness.droppedUndatedCount,
    },
  };
}

/**
 * Default research executor: the search-grounding pipeline first, the legacy
 * research implementation only when grounding is not applicable (no search
 * needed, or no route is enabled yet — e.g. the Tavily key is not registered
 * or the free-terms evidence has expired). When an enabled route ran and
 * could not produce verified sources, the honest failure is returned as-is:
 * an unverified answer must not be dressed up by a weaker path.
 */
export function createDefaultOriginResearchExecutor(
  deps: OriginSearchGroundingDeps,
  legacyResearch: (query: string) => Promise<OriginResearchResult>,
): (query: string) => Promise<OriginResearchResult> {
  return async (query: string) => {
    const outcome = await executeOriginSearchGrounding(query, deps);
    if (outcome.kind === "grounded") return originSearchGroundingToResearchResult(outcome);
    if (outcome.kind === "unavailable") {
      return {
        ok: false,
        sources: [],
        failure: { stage: "web-search", code: "NO_RESULTS" },
        groundingFailure: outcome.reason,
      };
    }
    return legacyResearch(query);
  };
}

export { ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS };
