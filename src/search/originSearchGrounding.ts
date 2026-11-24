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
import type {
  OriginResearchGroundingMetadata,
  OriginResearchResult,
} from "../legacy/originResearchSource.js";
import {
  classifyOriginSearchQuestion,
  extractOriginMarketInstruments,
  extractOriginWeatherPlace,
  minimizeOriginSearchQuery,
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
  searchWikipediaSourcesObserved,
  STOOQ_SOURCE_URL,
  type OriginMarketQuote,
  type OriginSearchFetch,
  type OriginSearchSource,
  type OriginSourceAuthorityTier,
  type OriginWeatherForecast,
} from "./originSearchProviders.js";
import {
  planOriginOfficialSourceQueries,
  resolveOriginOfficialSourceRoutingEnabled,
} from "./originOfficialSourceRouting.js";

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
  /**
   * Opt-in reclassification: when the classifier returns `no_search`,
   * ground the query as if it were of this type (same minimized query,
   * the named type's freshness requirement) instead of returning
   * not-applicable. For callers that have already decided a search is
   * required — the agent's `web_search_grounding` tool, whose queries
   * are fact-shaped goal strings the classifier would otherwise leave
   * unsearched. Only the `no_search` outcome is affected; every other
   * classification is untouched, and unset (the default) the behaviour
   * is exactly as before.
   */
  noSearchFallbackType?: Exclude<OriginSearchQuestionType, "no_search">;
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

/**
 * Domain / tier tallies of the freshness gate's drops, split by drop
 * reason (observation completion, SEARCH_RELIABILITY_95_PLAN_2026-11-24
 * 案1). The aggregate stats above say HOW MANY candidates the gate
 * dropped as stale vs undated; these tallies say WHOSE candidates they
 * were, so a refusal can be attributed after the fact — e.g. whether
 * the official-domain candidates a routing measure steered in actually
 * reached the gate and were dropped as undated, or never arrived at
 * all. Tallies only — no titles, excerpts, or URLs.
 */
export interface OriginSearchFreshnessDropTallies {
  staleDomainCounts: Readonly<Record<string, number>>;
  staleTierCounts: Readonly<Record<OriginSourceAuthorityTier, number>>;
  undatedDomainCounts: Readonly<Record<string, number>>;
  undatedTierCounts: Readonly<Record<OriginSourceAuthorityTier, number>>;
}

function emptyTierCounts(): Record<OriginSourceAuthorityTier, number> {
  return { official: 0, "major-news": 0, specialist: 0, general: 0 };
}

export function emptyOriginSearchFreshnessDropTallies(): OriginSearchFreshnessDropTallies {
  return {
    staleDomainCounts: {},
    staleTierCounts: emptyTierCounts(),
    undatedDomainCounts: {},
    undatedTierCounts: emptyTierCounts(),
  };
}

/**
 * Observation of the pre-gate candidate set (recon 2026-11-15, I-8).
 * Counts and codes only — no titles, excerpts, or URLs — in the same
 * style as the freshness stats above, so a thin or off-topic packet can
 * be attributed after the fact (provider sparsity vs freshness drops vs
 * relevance-screen drops) instead of guessed at. Present on outcomes of
 * the generic route pipeline; the dedicated weather / market outcomes
 * and the early cap / no-route returns have no candidate set to observe
 * and omit it.
 */
export interface OriginSearchCandidateStats {
  /** Candidates that reached the freshness gate (post relevance screen). */
  totalCount: number;
  domainCounts: Readonly<Record<string, number>>;
  tierCounts: Readonly<Record<OriginSourceAuthorityTier, number>>;
  /** Dropped by the relevance screen before the gate (screened routes). */
  droppedByScreenCount: number;
  /** Dropped by the freshness gate (stale + undated). */
  droppedByFreshnessCount: number;
  /**
   * Candidates that passed the freshness gate (observation completion,
   * SEARCH_RELIABILITY_95_PLAN_2026-11-24 案1). Together with
   * totalCount and droppedByFreshnessCount this closes the gate's
   * arithmetic: totalCount = keptCount + droppedByFreshnessCount.
   */
  keptCount: number;
  /**
   * Candidates adopted into the evidence packet by source selection.
   * keptCount = selectedCount + droppedBySelectionCount.
   */
  selectedCount: number;
  /** Dropped at source selection (post gate), total and by reason. */
  droppedBySelectionCount: number;
  selectionDropReasonCounts: Readonly<{
    missingIdentity: number;
    duplicateUrl: number;
    duplicateDomain: number;
    overLimit: number;
  }>;
  /** Freshness-gate drops by reason, with domain / tier tallies. */
  freshnessDropTallies: OriginSearchFreshnessDropTallies;
  /**
   * Domain / tier tallies of the relevance-screen drops across routes
   * (Tavily and Wikipedia). Absent contributions on a cache hit: the
   * cached set is already the post-screen candidate set, so — exactly
   * like the screen count above — a cached route reports nothing new.
   */
  screenDropDomainCounts: Readonly<Record<string, number>>;
  screenDropTierCounts: Readonly<Record<OriginSourceAuthorityTier, number>>;
}

interface CandidateStatsInputs {
  /** Candidates that reached the freshness gate (post relevance screen). */
  candidates: readonly OriginSearchSource[];
  droppedByScreenCount: number;
  screenDropDomainCounts: Readonly<Record<string, number>>;
  screenDropTierCounts: Readonly<Record<OriginSourceAuthorityTier, number>>;
  freshness: OriginSearchGroundingFreshnessStats;
  freshnessDropTallies: OriginSearchFreshnessDropTallies;
  /** Candidates that passed the freshness gate. */
  keptCount: number;
  /**
   * Selection observation, or null when selection never ran (no
   * candidate reached the gate, or none survived it): the selection
   * fields then report zeroes rather than a fabricated disposition.
   */
  selection: OriginSearchSelectionObservation | null;
}

function summarizeCandidateStats(inputs: CandidateStatsInputs): OriginSearchCandidateStats {
  const domainCounts: Record<string, number> = {};
  const tierCounts: Record<OriginSourceAuthorityTier, number> = {
    official: 0,
    "major-news": 0,
    specialist: 0,
    general: 0,
  };
  for (const candidate of inputs.candidates) {
    if (candidate.domain) domainCounts[candidate.domain] = (domainCounts[candidate.domain] ?? 0) + 1;
    tierCounts[candidate.authorityTier] += 1;
  }
  const selection = inputs.selection;
  return {
    totalCount: inputs.candidates.length,
    domainCounts,
    tierCounts,
    droppedByScreenCount: inputs.droppedByScreenCount,
    droppedByFreshnessCount: inputs.freshness.droppedStaleCount + inputs.freshness.droppedUndatedCount,
    keptCount: inputs.keptCount,
    selectedCount: selection?.selectedCount ?? 0,
    droppedBySelectionCount: selection
      ? selection.droppedMissingIdentityCount
        + selection.droppedDuplicateUrlCount
        + selection.droppedDuplicateDomainCount
        + selection.droppedOverLimitCount
      : 0,
    selectionDropReasonCounts: {
      missingIdentity: selection?.droppedMissingIdentityCount ?? 0,
      duplicateUrl: selection?.droppedDuplicateUrlCount ?? 0,
      duplicateDomain: selection?.droppedDuplicateDomainCount ?? 0,
      overLimit: selection?.droppedOverLimitCount ?? 0,
    },
    freshnessDropTallies: inputs.freshnessDropTallies,
    screenDropDomainCounts: inputs.screenDropDomainCounts,
    screenDropTierCounts: inputs.screenDropTierCounts,
  };
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
      candidateStats?: OriginSearchCandidateStats;
    }
  | {
      kind: "unavailable";
      questionType: Exclude<OriginSearchQuestionType, "no_search">;
      reason: "no-sources" | "no-fresh-sources" | "provider-error" | "monthly-cap-reached";
      freshness: OriginSearchGroundingFreshnessStats;
      candidateStats?: OriginSearchCandidateStats;
      /**
       * Recovery build Stage 1, PR-4: when the freshness gate dropped
       * every candidate (reason "no-fresh-sources"), up to five of the
       * candidates that REACHED the gate are carried here — title,
       * excerpt, domain, publication date and tier intact — so the
       * template direct-answer fallback can re-judge the values by
       * their own publication points instead of the gate's window.
       * Absent for the other reasons (no candidates reached the gate).
       * These sources are NOT citable evidence: they failed the gate,
       * and only the PR-4 fallback may read them, under its own
       * confirmation rules.
       */
      droppedSources?: OriginSearchSource[];
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
  noSearchFallbackType?: Exclude<OriginSearchQuestionType, "no_search">;
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
    noSearchFallbackType: deps.noSearchFallbackType,
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
  options?: {
    /**
     * F-group measure C (F_GROUP_SOURCE_FIX_DESIGN_2026-11-19): an
     * official-tier source is never dropped merely for having no
     * extractable publication date. Official statistics pages often
     * state no date in the extracted text, and their currency is set
     * by the publication schedule — the page carries the latest
     * released figure until the next scheduled release — so the
     * undated drop, applied to this tier, emptied the adopted pool
     * on every round-6 freshness refusal. The exemption is narrow by
     * construction: dated official sources still face the age window
     * (an old dated release is genuinely old), unofficial sources are
     * judged exactly as before, and the survivor is kept with
     * dateVerified false — it is "official, undated", never upgraded
     * to verified-fresh. Set only when the official-source routing
     * switch is on; unset, the gate is byte-for-byte the old one.
     */
    officialUndatedExempt?: boolean;
  },
): { kept: OriginGroundedSource[]; stats: OriginSearchGroundingFreshnessStats; dropTallies: OriginSearchFreshnessDropTallies } {
  const stats: OriginSearchGroundingFreshnessStats = {
    verifiedFreshCount: 0,
    unknownDateCount: 0,
    droppedStaleCount: 0,
    droppedUndatedCount: 0,
  };
  // Observation only (案1): every drop below also tallies the dropped
  // candidate's domain and tier under its reason, in step with the
  // aggregate counts, so the two can never drift apart.
  const staleDomainCounts: Record<string, number> = {};
  const staleTierCounts = emptyTierCounts();
  const undatedDomainCounts: Record<string, number> = {};
  const undatedTierCounts = emptyTierCounts();
  const tallyUndatedDrop = (source: OriginSearchSource) => {
    if (source.domain) undatedDomainCounts[source.domain] = (undatedDomainCounts[source.domain] ?? 0) + 1;
    undatedTierCounts[source.authorityTier] += 1;
  };
  const dropTallies: OriginSearchFreshnessDropTallies = {
    staleDomainCounts,
    staleTierCounts,
    undatedDomainCounts,
    undatedTierCounts,
  };
  const kept: OriginGroundedSource[] = [];
  for (const source of sources) {
    const publishedMs = source.publishedAt ? Date.parse(source.publishedAt) : Number.NaN;
    if (Number.isFinite(publishedMs)) {
      const ageMs = retrievedAtMs - publishedMs;
      if (requirement.maxSourceAgeMs !== null && (ageMs > requirement.maxSourceAgeMs || ageMs < 0)) {
        stats.droppedStaleCount += 1;
        if (source.domain) staleDomainCounts[source.domain] = (staleDomainCounts[source.domain] ?? 0) + 1;
        staleTierCounts[source.authorityTier] += 1;
        continue;
      }
      stats.verifiedFreshCount += 1;
      kept.push({ ...source, dateVerified: true });
      continue;
    }
    // No parseable publication date.
    if (requirement.strictPublicationDate) {
      if (options?.officialUndatedExempt && source.authorityTier === "official") {
        stats.unknownDateCount += 1;
        kept.push({ ...source, dateVerified: false });
        continue;
      }
      stats.droppedUndatedCount += 1;
      tallyUndatedDrop(source);
      continue;
    }
    stats.unknownDateCount += 1;
    kept.push({ ...source, dateVerified: false });
  }
  // fresh_general asserts currency, so an answer may not rest on undated
  // sources alone; price/policy pages (official product/policy pages are
  // commonly undated) may, and are flagged via freshnessVerified instead.
  // Measure C narrows this wipe the same way as the strict drop above:
  // with the exemption on, official-tier undated sources may carry a
  // fresh_general pool (their currency is schedule-based, above), while
  // unofficial undated sources still cannot carry one alone.
  if (questionType === "fresh_general" && stats.verifiedFreshCount === 0 && kept.length > 0) {
    if (options?.officialUndatedExempt) {
      const officialKept = kept.filter((source) => source.authorityTier === "official");
      const droppedHere = kept.length - officialKept.length;
      if (droppedHere > 0) {
        stats.droppedUndatedCount += droppedHere;
        stats.unknownDateCount -= droppedHere;
        for (const source of kept) {
          if (source.authorityTier !== "official") tallyUndatedDrop(source);
        }
      }
      return { kept: officialKept, stats, dropTallies };
    }
    stats.droppedUndatedCount += stats.unknownDateCount;
    for (const source of kept) tallyUndatedDrop(source);
    return { kept: [], stats, dropTallies };
  }
  return { kept, stats, dropTallies };
}

/* ------------------------------------------------------------------ */
/* Source selection (§2.3: dedupe domains, official first, top 3-5)    */
/* ------------------------------------------------------------------ */

/**
 * Disposition of the candidates source selection did not adopt
 * (observation completion, SEARCH_RELIABILITY_95_PLAN_2026-11-24 案1).
 * Selection was the one pipeline stage with no record at all: a
 * candidate that passed the freshness gate could vanish here — a
 * duplicate of an adopted URL, a second hit from an adopted domain,
 * or simply beyond the packet limit — indistinguishable from never
 * having arrived. The reasons are counted in the order the selection
 * applies them; once the packet is full, every remaining candidate
 * counts as overLimit (the binding constraint, exactly where the
 * selection loop stops).
 */
export interface OriginSearchSelectionObservation {
  selectedCount: number;
  droppedMissingIdentityCount: number;
  droppedDuplicateUrlCount: number;
  droppedDuplicateDomainCount: number;
  droppedOverLimitCount: number;
}

export function selectOriginSearchSources<T extends OriginSearchSource>(
  candidates: readonly T[],
  limit = MAX_SELECTED_SOURCES,
): T[] {
  return selectOriginSearchSourcesWithObservation(candidates, limit).selected;
}

export function selectOriginSearchSourcesWithObservation<T extends OriginSearchSource>(
  candidates: readonly T[],
  limit = MAX_SELECTED_SOURCES,
): { selected: T[]; observation: OriginSearchSelectionObservation } {
  const seenUrls = new Set<string>();
  const unique: T[] = [];
  let droppedMissingIdentityCount = 0;
  let droppedDuplicateUrlCount = 0;
  for (const source of candidates) {
    if (!source.title || !source.url) {
      droppedMissingIdentityCount += 1;
      continue;
    }
    const key = source.url.split("#")[0];
    if (seenUrls.has(key)) {
      droppedDuplicateUrlCount += 1;
      continue;
    }
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
  let droppedDuplicateDomainCount = 0;
  let droppedOverLimitCount = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const source = sorted[index];
    if (source.domain && seenDomains.has(source.domain)) {
      droppedDuplicateDomainCount += 1;
      continue;
    }
    if (source.domain) seenDomains.add(source.domain);
    selected.push(source);
    if (selected.length >= limit) {
      droppedOverLimitCount = sorted.length - index - 1;
      break;
    }
  }
  return {
    selected,
    observation: {
      selectedCount: selected.length,
      droppedMissingIdentityCount,
      droppedDuplicateUrlCount,
      droppedDuplicateDomainCount,
      droppedOverLimitCount,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Route execution                                                     */
/* ------------------------------------------------------------------ */

interface RouteResult {
  sources: OriginSearchSource[];
  errored: boolean;
  /**
   * Candidates the route's relevance screen dropped before the gate
   * (the routes whose providers run a screen: Tavily and Wikipedia).
   * Absent on a cache hit: the cached set is already the post-screen
   * candidate set, so there is nothing new to count.
   */
  screenedOutCount?: number;
  /**
   * Domain / tier tallies of the screen drops (routes whose providers
   * report them: Tavily and Wikipedia). Same cache-hit absence as the
   * count above.
   */
  screenedOutDomainCounts?: Readonly<Record<string, number>>;
  screenedOutTierCounts?: Readonly<Record<OriginSourceAuthorityTier, number>>;
}

/**
 * Cache-save condition for candidate sets (recon 2026-11-15, I-6): a
 * set that came back empty — the provider found nothing usable, or the
 * relevance screen dropped every candidate — is never cached. Pinning
 * it for the TTL would repeat the same failure on every identical
 * re-ask inside the window instead of letting retrieval retry. A
 * non-empty ("normal") set is cached exactly as before, preserving the
 * quota-saving effect of the cache.
 */
function cacheableCandidateSet(sources: readonly OriginSearchSource[]): boolean {
  return sources.length > 0;
}

async function cachedCandidates(
  deps: ResolvedDeps,
  cacheKey: string,
  ttlMs: number,
  load: () => Promise<OriginSearchSource[]>,
  shouldCache: (sources: readonly OriginSearchSource[]) => boolean = () => true,
): Promise<RouteResult> {
  const cached = deps.cache.get<OriginSearchSource[]>(cacheKey, deps.now());
  if (cached) return { sources: cached, errored: false };
  try {
    const sources = await load();
    if (shouldCache(sources)) deps.cache.set(cacheKey, sources, ttlMs, deps.now());
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
  includeDomains?: readonly string[],
): Promise<RouteResult> {
  // Domain-restricted runs (official-source routing, measure B) get
  // their own cache entries: the restricted candidate set is a
  // different result from the unrestricted one for the same query,
  // and sharing the key would serve whichever ran first for both.
  const domainKey = includeDomains && includeDomains.length > 0
    ? `:domains=${[...includeDomains].sort().join(",")}`
    : "";
  const cacheKey = `cand:tavily:${topic}:${timeRange ?? "none"}${domainKey}:${query.toLowerCase()}`;
  let screenedOutCount = 0;
  let screenedOutDomainCounts: Readonly<Record<string, number>> | undefined;
  let screenedOutTierCounts: Readonly<Record<OriginSourceAuthorityTier, number>> | undefined;
  const result = await cachedCandidates(
    deps,
    cacheKey,
    ORIGIN_SEARCH_CACHE_TTL_MS.search,
    async () => {
      const outcome = await searchTavilySources(query, {
        fetchImpl: deps.fetchImpl,
        timeoutMs,
        apiKey: tavilyApiKey(deps),
        topic,
        timeRange,
        ...(includeDomains && includeDomains.length > 0 ? { includeDomains } : {}),
      });
      deps.counter.record("tavily", outcome.creditsUsed, deps.now());
      screenedOutCount = outcome.screenedOutCount;
      screenedOutDomainCounts = outcome.screenedOutDomainCounts;
      screenedOutTierCounts = outcome.screenedOutTierCounts;
      return outcome.sources;
    },
    cacheableCandidateSet,
  );
  return {
    ...result,
    screenedOutCount,
    ...(screenedOutDomainCounts ? { screenedOutDomainCounts } : {}),
    ...(screenedOutTierCounts ? { screenedOutTierCounts } : {}),
  };
}

async function runGdeltRoute(deps: ResolvedDeps, query: string, timeoutMs: number): Promise<RouteResult> {
  return cachedCandidates(
    deps,
    `cand:gdelt:${query.toLowerCase()}`,
    ORIGIN_SEARCH_CACHE_TTL_MS.news,
    () => searchGdeltHeadlines(query, { fetchImpl: deps.fetchImpl, timeoutMs }),
    cacheableCandidateSet,
  );
}

async function runWikipediaRoute(deps: ResolvedDeps, query: string, timeoutMs: number): Promise<RouteResult> {
  let screenedOutCount = 0;
  let screenedOutDomainCounts: Readonly<Record<string, number>> | undefined;
  let screenedOutTierCounts: Readonly<Record<OriginSourceAuthorityTier, number>> | undefined;
  const result = await cachedCandidates(
    deps,
    `cand:wikipedia:${query.toLowerCase()}`,
    ORIGIN_SEARCH_CACHE_TTL_MS.search,
    async () => {
      const outcome = await searchWikipediaSourcesObserved(query, { fetchImpl: deps.fetchImpl, timeoutMs });
      screenedOutCount = outcome.screenedOutCount;
      screenedOutDomainCounts = outcome.screenedOutDomainCounts;
      screenedOutTierCounts = outcome.screenedOutTierCounts;
      return outcome.sources;
    },
    cacheableCandidateSet,
  );
  return {
    ...result,
    screenedOutCount,
    ...(screenedOutDomainCounts ? { screenedOutDomainCounts } : {}),
    ...(screenedOutTierCounts ? { screenedOutTierCounts } : {}),
  };
}

export async function executeOriginSearchGrounding(
  message: string,
  depsInput: OriginSearchGroundingDeps = {},
): Promise<OriginSearchGroundingOutcome> {
  const deps = resolveDeps(depsInput);
  const startedAtMs = deps.now();
  const classified = classifyOriginSearchQuestion(message);
  // Opt-in reclassification (deps.noSearchFallbackType): only the
  // no_search outcome is rewritten, as the named type over the same
  // minimized query the classifier would have produced. Without the
  // opt-in — and for every signal-bearing question — this is exactly
  // the classifier's own verdict.
  const classification = classified.type === "no_search" && deps.noSearchFallbackType
    ? {
        type: deps.noSearchFallbackType,
        freshness: ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS[deps.noSearchFallbackType],
        query: minimizeOriginSearchQuery(message),
        rule: "no-search-fallback",
      }
    : classified;
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

  // Official-source routing (F_GROUP_SOURCE_FIX_DESIGN_2026-11-19,
  // measures B + C), switch-gated and off by default: for a
  // statistical value question matching a curated topic, plan up to
  // two additional domain-restricted Tavily queries. The plan is
  // computed BEFORE the access check so the monthly self cap is
  // charged honestly for every credit this request may spend
  // (1 ordinary + the planned additions); when the cap cannot cover
  // them, Tavily is disabled for the whole request exactly as if the
  // cap were reached by the ordinary query alone.
  const officialRoutingEnabled = resolveOriginOfficialSourceRoutingEnabled(deps.env);
  const officialPlan = officialRoutingEnabled
    ? planOriginOfficialSourceQueries(message)
    : null;

  const tavilyAccess = providerAccess("tavily", deps, 1 + (officialPlan?.queries.length ?? 0));
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
      if (tavilyEnabled) addRoute("tavily", runTavilyRoute(deps, query, requirement.tavilyTopic, requirement.tavilyTimeRange, searchTimeoutMs()));
      break;
    case "policy":
      if (tavilyEnabled) addRoute("tavily", runTavilyRoute(deps, query, requirement.tavilyTopic, requirement.tavilyTimeRange, searchTimeoutMs()));
      // Policy questions pair the encyclopedia route with Tavily, like
      // fresh_general (routing calibration, 2026-11-16 measurement
      // B-02): the type covers standing institutional facts — statutory
      // pension ages, benefit rules, labor-law tables — whose canonical
      // statements live in encyclopedic / official reference pages.
      // With Tavily alone, a pension-age question whose search results
      // fell outside the freshness window ended in the no-sources
      // refusal even though the fact is stable and well documented.
      // The pooled candidates still pass the policy freshness
      // requirement below (undated sources kept, stale-dated dropped),
      // so the freshness discipline is unchanged.
      if (wikipediaAccess.enabled) addRoute("wikipedia", runWikipediaRoute(deps, query, searchTimeoutMs()));
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

  // Measure B: the additional official-domain queries run alongside
  // the ordinary routes, over the same minimized query (extracted
  // keywords only — the raw message never leaves the process). Their
  // candidates join the same pool and face the same relevance screen
  // and freshness gate as every other candidate; the routing only
  // steers retrieval toward the primary source, it does not privilege
  // the results beyond the tier they already carry.
  if (officialPlan && tavilyEnabled) {
    for (const officialQuery of officialPlan.queries) {
      addRoute("tavily", runTavilyRoute(
        deps,
        query,
        requirement.tavilyTopic,
        requirement.tavilyTimeRange,
        searchTimeoutMs(),
        officialQuery.domains,
      ));
    }
  }

  if (routes.length === 0) {
    if (capReached) return { kind: "unavailable", questionType, reason: "monthly-cap-reached", freshness: emptyStats };
    return { kind: "not-applicable", reason: "no-route-enabled" };
  }

  let results = await Promise.all(routes);
  let candidates = results.flatMap((result) => result.sources);
  // Deduped: the official-source routes report the same provider id
  // as the ordinary Tavily route, and the provider list is a set of
  // who served, not a per-route tally.
  const providersUsed = [...new Set(routeProviders.filter((_, index) => (results[index]?.sources.length ?? 0) > 0))];

  // Stable facts: only when Wikipedia found nothing may the generic route be
  // used (§2.3), and then without a freshness window.
  if (questionType === "stable" && candidates.length === 0 && tavilyEnabled) {
    const fallback = await runTavilyRoute(deps, query, "general", null, searchTimeoutMs());
    results = [...results, fallback];
    if (fallback.sources.length > 0) providersUsed.push("tavily");
    candidates = fallback.sources;
  }

  const droppedByScreenCount = results.reduce((sum, result) => sum + (result.screenedOutCount ?? 0), 0);
  // Screen-drop tallies across routes (案1): summed over whichever
  // routes reported them; a cache-hit route reports nothing new, in
  // step with the count above.
  const screenDropDomainCounts: Record<string, number> = {};
  const screenDropTierCounts = emptyTierCounts();
  for (const result of results) {
    if (result.screenedOutDomainCounts) {
      for (const [domain, count] of Object.entries(result.screenedOutDomainCounts)) {
        screenDropDomainCounts[domain] = (screenDropDomainCounts[domain] ?? 0) + count;
      }
    }
    if (result.screenedOutTierCounts) {
      for (const tier of Object.keys(result.screenedOutTierCounts) as OriginSourceAuthorityTier[]) {
        screenDropTierCounts[tier] += result.screenedOutTierCounts[tier];
      }
    }
  }

  if (candidates.length === 0) {
    const allErrored = results.every((result) => result.errored);
    return {
      kind: "unavailable",
      questionType,
      reason: allErrored ? "provider-error" : "no-sources",
      freshness: emptyStats,
      candidateStats: summarizeCandidateStats({
        candidates,
        droppedByScreenCount,
        screenDropDomainCounts,
        screenDropTierCounts,
        freshness: emptyStats,
        freshnessDropTallies: emptyOriginSearchFreshnessDropTallies(),
        keptCount: 0,
        selection: null,
      }),
    };
  }

  const { kept, stats, dropTallies } = evaluateOriginSourceFreshness(
    candidates,
    requirement,
    questionType,
    startedAtMs,
    // Measure C: with the routing switch on, official-tier sources
    // are exempt from the undated drop (see the gate's own note).
    { officialUndatedExempt: officialRoutingEnabled },
  );
  if (kept.length === 0) {
    return {
      kind: "unavailable",
      questionType,
      reason: "no-fresh-sources",
      freshness: stats,
      candidateStats: summarizeCandidateStats({
        candidates,
        droppedByScreenCount,
        screenDropDomainCounts,
        screenDropTierCounts,
        freshness: stats,
        freshnessDropTallies: dropTallies,
        keptCount: 0,
        selection: null,
      }),
      // PR-4: every candidate here reached the freshness gate and was
      // dropped by it; carry the first five for the template fallback.
      droppedSources: candidates.slice(0, 5),
    };
  }

  const selection = selectOriginSearchSourcesWithObservation(kept);
  let selected = selection.selected;

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
    candidateStats: summarizeCandidateStats({
      candidates,
      droppedByScreenCount,
      screenDropDomainCounts,
      screenDropTierCounts,
      freshness: stats,
      freshnessDropTallies: dropTallies,
      keptCount: kept.length,
      selection: selection.observation,
    }),
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

/**
 * The grounding metadata both outcome kinds carry into the research
 * result: freshness aggregates always, and the pre-gate candidate
 * observation when the generic pipeline produced one. The candidate
 * stats are copied field by field (counts and domain/tier tallies
 * only — the outcome never holds titles, excerpts, or URLs here), so
 * the routers' search logs can attribute a thin or empty result to
 * the stage that dropped it.
 */
function groundingMetadataFromOutcome(
  questionType: Exclude<OriginSearchQuestionType, "no_search">,
  providersUsed: readonly OriginSearchProviderId[],
  freshnessVerified: boolean,
  freshness: OriginSearchGroundingFreshnessStats,
  candidateStats: OriginSearchCandidateStats | undefined,
): OriginResearchGroundingMetadata {
  return {
    questionType,
    providersUsed,
    freshnessVerified,
    verifiedFreshSourceCount: freshness.verifiedFreshCount,
    unknownDateSourceCount: freshness.unknownDateCount,
    droppedStaleSourceCount: freshness.droppedStaleCount,
    droppedUndatedSourceCount: freshness.droppedUndatedCount,
    ...(candidateStats
      ? {
          candidateStats: {
            totalCount: candidateStats.totalCount,
            domainCounts: candidateStats.domainCounts,
            tierCounts: candidateStats.tierCounts,
            droppedByScreenCount: candidateStats.droppedByScreenCount,
            droppedByFreshnessCount: candidateStats.droppedByFreshnessCount,
            // Full disposition chain (案1): gate survivors, packet
            // adoptions, and every drop stage with its reasons, so the
            // per-request record closes arithmetically at each stage.
            keptCount: candidateStats.keptCount,
            selectedCount: candidateStats.selectedCount,
            droppedBySelectionCount: candidateStats.droppedBySelectionCount,
            selectionDropReasonCounts: candidateStats.selectionDropReasonCounts,
            freshnessDropTallies: candidateStats.freshnessDropTallies,
            screenDropDomainCounts: candidateStats.screenDropDomainCounts,
            screenDropTierCounts: candidateStats.screenDropTierCounts,
          },
        }
      : {}),
  };
}

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
      // The tier itself travels in its own field (R-PR-8c): the records
      // path's selection and slot layers use it as decision material.
      authorityTier: source.authorityTier,
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
    grounding: groundingMetadataFromOutcome(
      outcome.questionType,
      outcome.providersUsed,
      outcome.freshnessVerified,
      outcome.freshness,
      outcome.candidateStats,
    ),
  };
}

/**
 * Default research executor: the search-grounding pipeline first, the legacy
 * research implementation only when grounding is not applicable (no search
 * needed, or no route is enabled yet — e.g. the Tavily key is not registered
 * or the free-terms evidence has expired). When an enabled route ran and
 * could not produce verified sources, the honest failure is returned as-is:
 * an unverified answer must not be dressed up by a weaker path. Callers that
 * pass `deps.noSearchFallbackType` narrow the not-applicable case: a
 * no-search-needed classification is then grounded as the named type.
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
        // The gate-failure metadata travels with the result so the
        // fail-closed log can attribute the empty outcome (which
        // stage dropped the candidates) instead of only naming the
        // failure code. No provider produced a usable source here,
        // so providersUsed is empty.
        grounding: groundingMetadataFromOutcome(
          outcome.questionType,
          [],
          outcome.freshness.verifiedFreshCount > 0,
          outcome.freshness,
          outcome.candidateStats,
        ),
        // PR-4: the freshness-dropped candidates travel in their own
        // field (never in `sources`, which is the citable set), in
        // the same field mapping as the grounded conversion, so the
        // template fallback can re-judge their values by publication
        // point. `retrievedAt` is the moment of this conversion —
        // the retrieval just happened.
        ...(outcome.droppedSources && outcome.droppedSources.length > 0
          ? {
              droppedSources: outcome.droppedSources.map((source, index) => ({
                title: source.title,
                url: source.url,
                excerpt: source.excerpt,
                revisionTimestamp: source.publishedAt,
                sourceType: source.providerId === "wikipedia" ? "encyclopedia" as const : "web-search" as const,
                sourceAuthority: source.providerId === "wikipedia" ? "secondary-reference" as const : "unclassified" as const,
                authorityTier: source.authorityTier,
                domain: source.domain,
                rank: index + 1,
                evidenceLevel: source.evidenceLevel === "extracted" ? "page-verified" as const : "snippet" as const,
                retrievedAt: new Date().toISOString(),
                freshness: "unknown" as const,
              })),
            }
          : {}),
      };
    }
    return legacyResearch(query);
  };
}

export { ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS };
