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
  assessOfficialMaterialInsufficiency,
  buildOfficialRetryQueryText,
  buildOfficialSourceQueryText,
  planOriginOfficialSourceQueries,
  resolveOriginOfficialSourceRoutingEnabled,
  type OriginOfficialSourcePlan,
} from "./originOfficialSourceRouting.js";
import { parseOriginOfficialEdition } from "./originOfficialEdition.js";
import { isRegionalOfficialSource } from "./originRegionalOfficialSource.js";

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
 * One search the grounding pipeline issued (observation, round-8
 * measure D: F_GROUP_ROUND8_PROBE_2026-11-26 §対策案4). The round-8
 * collection recorded NOTHING about which queries ran on which
 * route, so "the official query never fired" and "it fired but its
 * results were dropped" were indistinguishable after the fact. The
 * query text recorded here is the minimized query (extracted
 * keywords only — the raw user text never leaves the process, so
 * there is nothing personal to record), plus the domain restriction
 * for official-route searches.
 */
export interface OriginSearchIssuedQuery {
  provider: OriginSearchProviderId;
  kind: "ordinary" | "official" | "official-retry" | "stable-fallback";
  query: string;
  includeDomains?: readonly string[];
}

/**
 * The freshness gate's per-candidate decision (observation, round-8
 * measure D). The aggregate stats say how many candidates fell as
 * stale vs undated; this record says, for each candidate that
 * reached the gate, WHAT was decided and on WHICH date the decision
 * rested — the provider-reported date, or (measure C) the
 * publication date the source's own text states. Domain and tier
 * only, plus the basis date — no titles, excerpts, or URLs, in the
 * same discipline as the drop tallies.
 */
export interface OriginSourceFreshnessDecision {
  domain: string;
  tier: OriginSourceAuthorityTier;
  outcome: "kept-verified" | "kept-undated" | "dropped-stale" | "dropped-undated";
  basis: "provider-date" | "text-date" | "none";
  /** ISO date (YYYY-MM-DD) the decision rested on; null when dateless. */
  basisDate: string | null;
}

/**
 * The material-insufficiency retry's observation (round-8 measure
 * B). Present only when the adopted pool of a statistical question
 * was judged insufficient; `fired` is false when the retry could
 * not run (no release name for the topic, the monthly cap, or the
 * latency budget), so a detected-but-unretried gap is itself
 * attributable instead of silent.
 */
export interface OriginSearchOfficialRetryObservation {
  reason: "no-numeric-span" | "regional-only" | "stale-edition";
  fired: boolean;
  /** Candidates the retry search returned (post relevance screen). */
  candidateCount: number;
  /** Retry candidates that passed the freshness gate. */
  keptCount: number;
  /** Retry-kept sources present in the final adopted selection. */
  adoptedCount: number;
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
  /**
   * The freshness gate's per-candidate decisions, with the basis
   * date each decision rested on (round-8 measure D). One entry per
   * candidate that reached the gate, in candidate order.
   */
  freshnessDecisions: readonly OriginSourceFreshnessDecision[];
  /**
   * The material-insufficiency retry (round-8 measure B), present
   * only when the adopted pool was judged insufficient.
   */
  officialRetry?: OriginSearchOfficialRetryObservation;
}

interface CandidateStatsInputs {
  /** Candidates that reached the freshness gate (post relevance screen). */
  candidates: readonly OriginSearchSource[];
  droppedByScreenCount: number;
  screenDropDomainCounts: Readonly<Record<string, number>>;
  screenDropTierCounts: Readonly<Record<OriginSourceAuthorityTier, number>>;
  freshness: OriginSearchGroundingFreshnessStats;
  freshnessDropTallies: OriginSearchFreshnessDropTallies;
  /** The gate's per-candidate decisions (round-8 measure D). */
  freshnessDecisions: readonly OriginSourceFreshnessDecision[];
  /** Candidates that passed the freshness gate. */
  keptCount: number;
  /**
   * Selection observation, or null when selection never ran (no
   * candidate reached the gate, or none survived it): the selection
   * fields then report zeroes rather than a fabricated disposition.
   */
  selection: OriginSearchSelectionObservation | null;
  /** The measure-B retry observation, when insufficiency was detected. */
  officialRetry?: OriginSearchOfficialRetryObservation;
}

/** Sum two freshness-gate results (the measure-B retry gates its own
 * candidates separately, then merges into the request's record). */
function mergeFreshnessStats(
  a: OriginSearchGroundingFreshnessStats,
  b: OriginSearchGroundingFreshnessStats,
): OriginSearchGroundingFreshnessStats {
  return {
    verifiedFreshCount: a.verifiedFreshCount + b.verifiedFreshCount,
    unknownDateCount: a.unknownDateCount + b.unknownDateCount,
    droppedStaleCount: a.droppedStaleCount + b.droppedStaleCount,
    droppedUndatedCount: a.droppedUndatedCount + b.droppedUndatedCount,
  };
}

function mergeFreshnessDropTallies(
  a: OriginSearchFreshnessDropTallies,
  b: OriginSearchFreshnessDropTallies,
): OriginSearchFreshnessDropTallies {
  const mergeCounts = (x: Readonly<Record<string, number>>, y: Readonly<Record<string, number>>) => {
    const out: Record<string, number> = { ...x };
    for (const [key, count] of Object.entries(y)) out[key] = (out[key] ?? 0) + count;
    return out;
  };
  const mergeTiers = (
    x: Readonly<Record<OriginSourceAuthorityTier, number>>,
    y: Readonly<Record<OriginSourceAuthorityTier, number>>,
  ): Record<OriginSourceAuthorityTier, number> => ({
    official: x.official + y.official,
    "major-news": x["major-news"] + y["major-news"],
    specialist: x.specialist + y.specialist,
    general: x.general + y.general,
  });
  return {
    staleDomainCounts: mergeCounts(a.staleDomainCounts, b.staleDomainCounts),
    staleTierCounts: mergeTiers(a.staleTierCounts, b.staleTierCounts),
    undatedDomainCounts: mergeCounts(a.undatedDomainCounts, b.undatedDomainCounts),
    undatedTierCounts: mergeTiers(a.undatedTierCounts, b.undatedTierCounts),
  };
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
    freshnessDecisions: inputs.freshnessDecisions,
    ...(inputs.officialRetry ? { officialRetry: inputs.officialRetry } : {}),
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
      /** Searches this request issued, in order (round-8 measure D). */
      queriesIssued?: readonly OriginSearchIssuedQuery[];
    }
  | {
      kind: "unavailable";
      questionType: Exclude<OriginSearchQuestionType, "no_search">;
      reason: "no-sources" | "no-fresh-sources" | "provider-error" | "monthly-cap-reached";
      freshness: OriginSearchGroundingFreshnessStats;
      candidateStats?: OriginSearchCandidateStats;
      /** Searches this request issued, in order (round-8 measure D). */
      queriesIssued?: readonly OriginSearchIssuedQuery[];
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

const STATED_DATE_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * The newest full calendar date a source's own text states
 * (measure C's basis date): Gregorian `YYYY年M月D日` / ISO
 * `YYYY-MM-DD`, or a Reiwa era date (令和N年 = 2018 + N, 令和元年 =
 * 2019). Official release pages state their publication date in the
 * text ("令和7年11月18日公表") even when the provider reports no
 * date — or reports the page's first-seen date, which for a
 * periodically updated release page is years older than the current
 * release. Only FULL dates count: a bare "2026年9月分" is the
 * statistic's reference period, not its publication date, and
 * judging by it would misdate the release by its publication lag.
 * Dates after the retrieval moment (plus a day of clock tolerance)
 * are not publication dates of anything already published and are
 * ignored. Returns the newest qualifying date as epoch ms, or null.
 */
export function extractStatedPublicationMs(text: string, retrievedAtMs: number): number | null {
  const normalized = (text ?? "").normalize("NFKC");
  let newest: number | null = null;
  const consider = (year: number, month: number, day: number) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    const ms = Date.UTC(year, month - 1, day);
    if (!Number.isFinite(ms)) return;
    if (ms > retrievedAtMs + STATED_DATE_FUTURE_TOLERANCE_MS) return;
    if (newest === null || ms > newest) newest = ms;
  };
  for (const match of normalized.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
    consider(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  for (const match of normalized.matchAll(/令和(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/g)) {
    consider(2018 + (match[1] === "元" ? 1 : Number(match[1])), Number(match[2]), Number(match[3]));
  }
  for (const match of normalized.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    consider(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return newest;
}

function isoDatePartOfMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

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
    /**
     * F-group measure C, round-8 form (F_GROUP_ROUND8_PROBE_
     * 2026-11-26, measure 3): an official-tier source is judged by
     * the publication date its own text states when the provider's
     * date cannot serve — missing entirely, or stale while the text
     * states a newer release date. Official statistics are current
     * by publication schedule, and the release page's stated date IS
     * the event/publication date; the provider's date for such a
     * page is a page-level timestamp (first seen / last revised),
     * which is exactly the "page update date" the probe indicted
     * for F-04 (the weekly gasoline survey, whose key value was one
     * week old while every found source fell to the page-age
     * window). The rule is official-tier only and switch-bound like
     * the undated exemption: unofficial sources are judged by the
     * provider date exactly as before, and an official source whose
     * stated date is ALSO outside the window is dropped as stale —
     * the basis changes, the window does not widen.
     */
    officialStatedDate?: boolean;
  },
): { kept: OriginGroundedSource[]; stats: OriginSearchGroundingFreshnessStats; dropTallies: OriginSearchFreshnessDropTallies; decisions: OriginSourceFreshnessDecision[] } {
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
  // Per-candidate decisions (round-8 measure D), indexed by the
  // candidate's position so the fresh_general wipe below can rewrite
  // the entries of the sources it drops after all (the kept array
  // holds spreads of the candidates, not the candidates themselves).
  const decisionRecords: Array<OriginSourceFreshnessDecision | undefined> = sources.map(() => undefined);
  const recordDecision = (
    index: number,
    source: OriginSearchSource,
    outcome: OriginSourceFreshnessDecision["outcome"],
    basis: OriginSourceFreshnessDecision["basis"],
    basisMs: number | null,
  ) => {
    if (index < 0) return;
    decisionRecords[index] = {
      domain: source.domain,
      tier: source.authorityTier,
      outcome,
      basis,
      basisDate: basisMs !== null && Number.isFinite(basisMs) ? isoDatePartOfMs(basisMs) : null,
    };
  };
  const kept: OriginGroundedSource[] = [];
  const keptCandidateIndexes: number[] = [];
  for (const [candidateIndex, source] of sources.entries()) {
    const publishedMs = source.publishedAt ? Date.parse(source.publishedAt) : Number.NaN;
    // Exactly the pre-measure-C test, factored out: with no age
    // window (stable) every dated source is fresh; with a window,
    // the age must lie inside it (a future date is outside).
    const providerFresh = Number.isFinite(publishedMs)
      && (requirement.maxSourceAgeMs === null
        || (retrievedAtMs - publishedMs <= requirement.maxSourceAgeMs && retrievedAtMs - publishedMs >= 0));
    if (providerFresh) {
      stats.verifiedFreshCount += 1;
      kept.push({ ...source, dateVerified: true });
      keptCandidateIndexes.push(candidateIndex);
      recordDecision(candidateIndex, source, "kept-verified", "provider-date", publishedMs);
      continue;
    }
    // Measure C (round-8 form): the provider date is missing or
    // stale. For an official-tier source, the publication date its
    // own text states is the basis instead — a release page's
    // stated date is the release's date, whatever the page-level
    // timestamp says. Official tier only; the window is unchanged.
    if (options?.officialStatedDate && source.authorityTier === "official") {
      const statedMs = extractStatedPublicationMs(`${source.title} ${source.excerpt}`, retrievedAtMs);
      if (statedMs !== null) {
        const statedAgeMs = retrievedAtMs - statedMs;
        if (requirement.maxSourceAgeMs === null || statedAgeMs <= requirement.maxSourceAgeMs) {
          stats.verifiedFreshCount += 1;
          kept.push({ ...source, dateVerified: true });
          keptCandidateIndexes.push(candidateIndex);
          recordDecision(candidateIndex, source, "kept-verified", "text-date", statedMs);
          continue;
        }
        stats.droppedStaleCount += 1;
        if (source.domain) staleDomainCounts[source.domain] = (staleDomainCounts[source.domain] ?? 0) + 1;
        staleTierCounts[source.authorityTier] += 1;
        recordDecision(candidateIndex, source, "dropped-stale", "text-date", statedMs);
        continue;
      }
    }
    if (Number.isFinite(publishedMs)) {
      // Dated, and outside the window (or ahead of the clock).
      stats.droppedStaleCount += 1;
      if (source.domain) staleDomainCounts[source.domain] = (staleDomainCounts[source.domain] ?? 0) + 1;
      staleTierCounts[source.authorityTier] += 1;
      recordDecision(candidateIndex, source, "dropped-stale", "provider-date", publishedMs);
      continue;
    }
    // No parseable publication date.
    if (requirement.strictPublicationDate) {
      if (options?.officialUndatedExempt && source.authorityTier === "official") {
        stats.unknownDateCount += 1;
        kept.push({ ...source, dateVerified: false });
        keptCandidateIndexes.push(candidateIndex);
        recordDecision(candidateIndex, source, "kept-undated", "none", null);
        continue;
      }
      stats.droppedUndatedCount += 1;
      tallyUndatedDrop(source);
      recordDecision(candidateIndex, source, "dropped-undated", "none", null);
      continue;
    }
    stats.unknownDateCount += 1;
    kept.push({ ...source, dateVerified: false });
    keptCandidateIndexes.push(candidateIndex);
    recordDecision(candidateIndex, source, "kept-undated", "none", null);
  }
  // Assembled at each return, after any wipe rewrites below.
  const buildDecisions = () => decisionRecords.filter(
    (decision): decision is OriginSourceFreshnessDecision => Boolean(decision),
  );
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
        for (const [keptIndex, source] of kept.entries()) {
          if (source.authorityTier !== "official") {
            tallyUndatedDrop(source);
            recordDecision(keptCandidateIndexes[keptIndex] ?? -1, source, "dropped-undated", "none", null);
          }
        }
      }
      return { kept: officialKept, stats, dropTallies, decisions: buildDecisions() };
    }
    stats.droppedUndatedCount += stats.unknownDateCount;
    for (const [keptIndex, source] of kept.entries()) {
      tallyUndatedDrop(source);
      recordDecision(keptCandidateIndexes[keptIndex] ?? -1, source, "dropped-undated", "none", null);
    }
    return { kept: [], stats, dropTallies, decisions: buildDecisions() };
  }
  return { kept, stats, dropTallies, decisions: buildDecisions() };
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

/**
 * Deterministic signals of a data-table page (remeasure diagnosis
 * 2026-11-26, measure 2-1): an official release exists as a summary
 * page, where the value is stated in prose, and as table pages,
 * where it sits inside a grid. The extract stage reads a bounded
 * head of the page and the downstream stages need the value as a
 * sentence, so a table page can never serve a statistics question
 * the way its summary page can — yet nothing in the tier / provider
 * score / recency order knew the difference, and the GDP pool
 * adopted the time-series table over the release summary. The
 * signal is the publisher's own page vocabulary (time-series table
 * / time series / data list), read from the title, then the URL.
 */
const DATA_TABLE_PAGE_SIGNALS: readonly string[] = ["時系列表", "時系列", "データ一覧"];

export function isDataTablePage(source: Pick<OriginSearchSource, "title" | "url">): boolean {
  const title = (source.title ?? "").normalize("NFKC");
  if (DATA_TABLE_PAGE_SIGNALS.some((signal) => title.includes(signal))) return true;
  const url = (source.url ?? "").toLowerCase();
  return DATA_TABLE_PAGE_SIGNALS.some((signal) => url.includes(signal));
}

export function selectOriginSearchSourcesWithObservation<T extends OriginSearchSource>(
  candidates: readonly T[],
  limit = MAX_SELECTED_SOURCES,
  options?: { editionDateFallback?: boolean; officialSubRanking?: boolean },
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
  // The recency key (follow-up measure 2b): the provider date when
  // the source carries one; otherwise — only under the official
  // routing switch — the EDITION the source's title states, at its
  // reference month's start. A statistics release's currency is
  // its edition, and providers return publication pages with no
  // publishedAt at all: without the fallback, two editions of the
  // same release tied at 0 and the provider's stale-first order
  // decided which one the packet led with (production F-05).
  const recencyMs = (source: T): number => {
    if (source.publishedAt) {
      const ms = Date.parse(source.publishedAt);
      if (Number.isFinite(ms)) return ms;
    }
    if (options?.editionDateFallback) {
      const edition = parseOriginOfficialEdition(source.title);
      if (edition) return Date.UTC(edition.year, edition.month - 1, 1);
    }
    return 0;
  };
  // Official sub-ranking (remeasure diagnosis 2026-11-26, measures
  // 2-1 and 3-1; only under the official routing switch, like the
  // edition fallback above): WITHIN the official tier — the tier
  // itself never changes — two distinctions the old order was blind
  // to. A regional (prefectural) publication ranks below the
  // national one whenever a national official source is in the
  // pool at all: a prefectural bureau's figure is not the national
  // value, however fresh or well-scored its page is. And a
  // data-table page ranks below the release's summary page: the
  // value sits in a grid there, unreachable as a sentence. The
  // regional key outweighs the table key (a regional summary still
  // ranks below a national table page — authority first, page
  // kind second). Because extract targets are the head of this
  // order, the sub-ranking also decides what gets extracted.
  const hasNationalOfficial = options?.officialSubRanking
    ? unique.some(
      (source) => source.authorityTier === "official" && !isRegionalOfficialSource(source),
    )
    : false;
  const officialSubRank = (source: T): number => {
    if (!options?.officialSubRanking || source.authorityTier !== "official") return 0;
    let rank = 0;
    if (hasNationalOfficial && isRegionalOfficialSource(source)) rank += 2;
    if (isDataTablePage(source)) rank += 1;
    return rank;
  };
  const sorted = [...unique].sort((a, b) => {
    const tierDiff = ORIGIN_TIER_WEIGHT[b.authorityTier] - ORIGIN_TIER_WEIGHT[a.authorityTier];
    if (tierDiff !== 0) return tierDiff;
    const subRankDiff = officialSubRank(a) - officialSubRank(b);
    if (subRankDiff !== 0) return subRankDiff;
    const scoreDiff = (b.providerScore ?? 0) - (a.providerScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return recencyMs(b) - recencyMs(a);
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

/**
 * The extract targets (round-3 measure 2-3,
 * ANSWER_STATISTICS_ROUND3_DIAGNOSIS_2026-11-26): the head of the
 * adopted pool, at most MAX_EXTRACT_URLS — with one guarantee for
 * the statistical + official case. The GDP re-measurement adopted
 * the release's summary page yet the packet still ran on snippet
 * fragments: whether the summary's BODY text arrives depends on
 * the extract stage reaching it, and the head of the pool is not
 * by construction the release summary — the publisher's index and
 * portal pages (also national official, also not data-table
 * pages) compete for the same two slots on provider score. So one
 * slot is reserved for the release summary: among the pool's
 * national official pages that are not data-table pages (the
 * summary shape, read with the same negative signal as the
 * sub-ranking, measure 2-1), the page that reads as the release's
 * own summary — its title states an edition (the monthly
 * publishers' form), or it is titled 結果の概要 (the quarterly
 * publishers' form: a GDP release's edition is a period, not a
 * 月分） — takes the reserved slot ahead of index and portal
 * pages, which name the release series but never an edition or a
 * result summary; with no such page in the pool, the topmost
 * non-table national official takes it, exactly as measure 2-3
 * states.
 * Data-table pages keep their demoted place: the guarantee never
 * promotes one, and outside the statistical + official case the
 * targets are the pool's head exactly as before.
 */
export function selectOriginSearchExtractTargets<T extends OriginSearchSource>(
  selected: readonly T[],
  statisticalOfficialExtract: boolean,
): T[] {
  const targets = selected.slice(0, MAX_EXTRACT_URLS);
  if (!statisticalOfficialExtract) return targets;
  const summaryCandidates = selected.filter(
    (source) =>
      source.authorityTier === "official"
      && !isRegionalOfficialSource(source)
      && !isDataTablePage(source),
  );
  const guaranteed =
    summaryCandidates.find(
      (source) =>
        parseOriginOfficialEdition(source.title) !== null
        || source.title.includes("結果の概要"),
    )
    ?? summaryCandidates[0];
  if (!guaranteed || targets.includes(guaranteed)) return targets;
  return [...targets.slice(0, MAX_EXTRACT_URLS - 1), guaranteed];
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
    ? planOriginOfficialSourceQueries(message, deps.now())
    : null;

  const tavilyAccess = providerAccess("tavily", deps, 1 + (officialPlan?.queries.length ?? 0));
  const gdeltAccess = providerAccess("gdelt", deps, 0);
  const wikipediaAccess = providerAccess("wikipedia", deps, 0);
  const tavilyEnabled = tavilyAccess.enabled && tavilyApiKey(deps).length > 0;
  const capReached = tavilyAccess.enabled === false && tavilyAccess.reason === "monthly-cap-reached";

  const routes: Array<Promise<RouteResult>> = [];
  const routeProviders: OriginSearchProviderId[] = [];
  // Round-8 measure D: every search this request issues is recorded
  // (minimized query text only), in issue order, so a thin outcome
  // can be attributed to the queries that actually ran.
  const queriesIssued: OriginSearchIssuedQuery[] = [];
  const addRoute = (providerId: OriginSearchProviderId, run: Promise<RouteResult>, issued?: OriginSearchIssuedQuery) => {
    routeProviders.push(providerId);
    routes.push(run);
    if (issued) queriesIssued.push(issued);
  };
  const ordinaryIssued = (provider: OriginSearchProviderId): OriginSearchIssuedQuery => ({
    provider,
    kind: "ordinary",
    query,
  });

  switch (questionType) {
    case "news":
      if (gdeltAccess.enabled) addRoute("gdelt", runGdeltRoute(deps, query, searchTimeoutMs()), ordinaryIssued("gdelt"));
      if (tavilyEnabled) addRoute("tavily", runTavilyRoute(deps, query, requirement.tavilyTopic, requirement.tavilyTimeRange, searchTimeoutMs()), ordinaryIssued("tavily"));
      break;
    case "market":
    case "price_spec":
      if (tavilyEnabled) addRoute("tavily", runTavilyRoute(deps, query, requirement.tavilyTopic, requirement.tavilyTimeRange, searchTimeoutMs()), ordinaryIssued("tavily"));
      break;
    case "policy":
      if (tavilyEnabled) addRoute("tavily", runTavilyRoute(deps, query, requirement.tavilyTopic, requirement.tavilyTimeRange, searchTimeoutMs()), ordinaryIssued("tavily"));
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
      if (wikipediaAccess.enabled) addRoute("wikipedia", runWikipediaRoute(deps, query, searchTimeoutMs()), ordinaryIssued("wikipedia"));
      break;
    case "fresh_general":
      if (tavilyEnabled) addRoute("tavily", runTavilyRoute(deps, query, requirement.tavilyTopic, requirement.tavilyTimeRange, searchTimeoutMs()), ordinaryIssued("tavily"));
      if (wikipediaAccess.enabled) addRoute("wikipedia", runWikipediaRoute(deps, query, searchTimeoutMs()), ordinaryIssued("wikipedia"));
      break;
    case "stable":
      if (wikipediaAccess.enabled) addRoute("wikipedia", runWikipediaRoute(deps, query, searchTimeoutMs()), ordinaryIssued("wikipedia"));
      break;
    default:
      break;
  }

  // Measure B: the additional official-domain queries run alongside
  // the ordinary routes. Round-8 measure A aims them at the
  // publication page: the query text pairs the minimized query
  // (extracted keywords only — the raw message never leaves the
  // process) with the topic's release name. Their candidates join
  // the same pool and face the same relevance screen and freshness
  // gate as every other candidate; the routing only steers
  // retrieval toward the primary source, it does not privilege the
  // results beyond the tier they already carry.
  if (officialPlan && tavilyEnabled) {
    for (const officialQuery of officialPlan.queries) {
      const officialQueryText = buildOfficialSourceQueryText(query, officialQuery.releaseTerms, officialQuery.editionTerms);
      addRoute("tavily", runTavilyRoute(
        deps,
        officialQueryText,
        requirement.tavilyTopic,
        requirement.tavilyTimeRange,
        searchTimeoutMs(),
        officialQuery.domains,
      ), { provider: "tavily", kind: "official", query: officialQueryText, includeDomains: officialQuery.domains });
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
    queriesIssued.push({ provider: "tavily", kind: "stable-fallback", query });
    if (fallback.sources.length > 0) providersUsed.push("tavily");
    candidates = fallback.sources;
  }

  let droppedByScreenCount = results.reduce((sum, result) => sum + (result.screenedOutCount ?? 0), 0);
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
        freshnessDecisions: [],
        keptCount: 0,
        selection: null,
      }),
      queriesIssued,
    };
  }

  // Measure C: with the routing switch on, official-tier sources
  // are exempt from the undated drop and are judged by the
  // publication date their own text states when the provider date
  // cannot serve (see the gate's own notes).
  const gateOptions = {
    officialUndatedExempt: officialRoutingEnabled,
    officialStatedDate: officialRoutingEnabled,
  };
  const initialGate = evaluateOriginSourceFreshness(
    candidates,
    requirement,
    questionType,
    startedAtMs,
    gateOptions,
  );
  let kept = initialGate.kept;
  let stats = initialGate.stats;
  let dropTallies = initialGate.dropTallies;
  let freshnessDecisions = initialGate.decisions;
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
        freshnessDecisions,
        keptCount: 0,
        selection: null,
      }),
      queriesIssued,
      // PR-4: every candidate here reached the freshness gate and was
      // dropped by it; carry the first five for the template fallback.
      droppedSources: candidates.slice(0, 5),
    };
  }

  let selection = selectOriginSearchSourcesWithObservation(
    kept,
    MAX_SELECTED_SOURCES,
    { editionDateFallback: officialRoutingEnabled, officialSubRanking: officialRoutingEnabled },
  );
  let selected = selection.selected;

  // Material-insufficiency retry (round-8 measure B): the adopted
  // pool of a statistical question can be non-empty yet carry no
  // usable value — navigation-only spans (F-06) or regional figures
  // standing in for the national one (F-05). That is the stop rule's
  // "required fact missing" case, so exactly ONE more search is
  // fired: the first planned topic's release name alone, restricted
  // to its official domains. Its candidates face the same relevance
  // screen and freshness gate, merge into the same pool, and the
  // selection is re-run over the union; the first selection's
  // disposition is superseded by the final one. The retry never
  // fires twice, never fires for a sufficient pool, and never fires
  // when the gate emptied the pool (that is measure C's territory).
  let officialRetry: OriginSearchOfficialRetryObservation | undefined;
  if (officialPlan && tavilyEnabled) {
    const assessment = assessOfficialMaterialInsufficiency(selected, {
      expectedEdition: officialPlan.queries[0]?.expectedEdition ?? null,
    });
    if (!assessment.sufficient && assessment.reason) {
      const retryTopic = officialPlan.queries[0];
      let fired = false;
      let retryCandidateCount = 0;
      let retryKeptCount = 0;
      let retryAdoptedCount = 0;
      if (retryTopic?.releaseTerms && remainingMs() >= 1_000) {
        const retryAccess = providerAccess("tavily", deps, 1);
        if (retryAccess.enabled) {
          fired = true;
          const retryQueryText = assessment.reason === "stale-edition"
            ? buildOfficialRetryQueryText(retryTopic.releaseTerms, retryTopic.editionTerms)
            : buildOfficialRetryQueryText(retryTopic.releaseTerms);
          const retryResult = await runTavilyRoute(
            deps,
            retryQueryText,
            requirement.tavilyTopic,
            requirement.tavilyTimeRange,
            searchTimeoutMs(),
            retryTopic.domains,
          );
          queriesIssued.push({
            provider: "tavily",
            kind: "official-retry",
            query: retryQueryText,
            includeDomains: retryTopic.domains,
          });
          if (retryResult.sources.length > 0 && !providersUsed.includes("tavily")) {
            providersUsed.push("tavily");
          }
          droppedByScreenCount += retryResult.screenedOutCount ?? 0;
          if (retryResult.screenedOutDomainCounts) {
            for (const [domain, count] of Object.entries(retryResult.screenedOutDomainCounts)) {
              screenDropDomainCounts[domain] = (screenDropDomainCounts[domain] ?? 0) + count;
            }
          }
          if (retryResult.screenedOutTierCounts) {
            for (const tier of Object.keys(retryResult.screenedOutTierCounts) as OriginSourceAuthorityTier[]) {
              screenDropTierCounts[tier] += retryResult.screenedOutTierCounts[tier];
            }
          }
          retryCandidateCount = retryResult.sources.length;
          if (retryCandidateCount > 0) {
            candidates = [...candidates, ...retryResult.sources];
            const retryGate = evaluateOriginSourceFreshness(
              retryResult.sources,
              requirement,
              questionType,
              startedAtMs,
              gateOptions,
            );
            stats = mergeFreshnessStats(stats, retryGate.stats);
            dropTallies = mergeFreshnessDropTallies(dropTallies, retryGate.dropTallies);
            freshnessDecisions = [...freshnessDecisions, ...retryGate.decisions];
            const keptUrls = new Set(kept.map((source) => source.url.split("#")[0]));
            const newKept = retryGate.kept.filter((source) => !keptUrls.has(source.url.split("#")[0]));
            retryKeptCount = newKept.length;
            if (newKept.length > 0) {
              kept = [...kept, ...newKept];
              selection = selectOriginSearchSourcesWithObservation(
                kept,
                MAX_SELECTED_SOURCES,
                { editionDateFallback: officialRoutingEnabled, officialSubRanking: officialRoutingEnabled },
              );
              selected = selection.selected;
              const selectedUrls = new Set(selected.map((source) => source.url.split("#")[0]));
              retryAdoptedCount = newKept.filter((source) => selectedUrls.has(source.url.split("#")[0])).length;
            }
          }
        }
      }
      officialRetry = {
        reason: assessment.reason,
        fired,
        candidateCount: retryCandidateCount,
        keptCount: retryKeptCount,
        adoptedCount: retryAdoptedCount,
      };
    }
  }

  // Extract (§2.3): only when snippets are thin or the type is number-critical
  // (price_spec / policy), only the top 2, and only inside the total budget.
  // Round-3 measure 2-3: in the statistical + official case one of
  // the two slots is reserved for the release summary page (see
  // selectOriginSearchExtractTargets), so the summary's body text
  // is not left to slot chance against index and portal pages.
  // Follow-up measure A (ANSWER_SOURCES_ONLY_DIAGNOSIS_2026-11-26):
  // a statistical question whose adopted pool already holds an
  // official-tier source extracts too. The official publication page
  // states its value in the body, while the search snippet is capped
  // at 1500 characters and may never carry it — and every downstream
  // stage (synthesis cards, evidence packet, value vote) can only
  // work with text that actually arrived, so snippet-bound evidence
  // made the latest official value unreachable even when the pool
  // held the right page. officialPlan is non-null exactly when
  // official routing is on AND the answer type is statistical
  // (STATISTICAL_ANSWER_TYPES) AND a curated topic matched, so this
  // widening stays inside "statistical + official adopted" and no
  // other question class starts extracting.
  const snippetChars = selected.reduce((sum, source) => sum + source.excerpt.length, 0);
  const statisticalOfficialExtract =
    officialPlan !== null && selected.some((source) => source.authorityTier === "official");
  const extractWanted =
    questionType === "price_spec" ||
    questionType === "policy" ||
    snippetChars < EXTRACT_SNIPPET_THRESHOLD ||
    statisticalOfficialExtract;
  if (extractWanted && tavilyEnabled && remainingMs() >= 1_000) {
    const extractAccess = providerAccess("tavily", deps, 1);
    if (extractAccess.enabled) {
      try {
        const targets = selectOriginSearchExtractTargets(selected, statisticalOfficialExtract)
          .map((source) => source.url);
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

  // Stated-date completion (follow-up measure 3, the extract-time
  // half of measure E's material expansion): an adopted source the
  // provider returned WITHOUT a publication date keeps the vintage
  // its own text states, when that text states a full date
  // deterministically — the same stated-date reading the freshness
  // gate already trusts for official pages. This runs after the
  // gate and selection, so it changes no admission decision; it
  // only stops the adopted source's own stated date from being
  // lost on the way to the answer, where the date annotation
  // (measure E) reads it. No full date stated → no completion: an
  // unknown vintage stays unknown.
  if (officialRoutingEnabled) {
    selected = selected.map((source) => {
      if (source.publishedAt) return source;
      const statedMs = extractStatedPublicationMs(
        `${source.title}\n${source.excerpt}`,
        startedAtMs,
      );
      return statedMs === null
        ? source
        : { ...source, publishedAt: new Date(statedMs).toISOString() };
    });
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
      freshnessDecisions,
      keptCount: kept.length,
      selection: selection.observation,
      ...(officialRetry ? { officialRetry } : {}),
    }),
    queriesIssued,
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
  queriesIssued?: readonly OriginSearchIssuedQuery[],
  extractedDomains?: readonly string[],
): OriginResearchGroundingMetadata {
  return {
    questionType,
    providersUsed,
    freshnessVerified,
    verifiedFreshSourceCount: freshness.verifiedFreshCount,
    unknownDateSourceCount: freshness.unknownDateCount,
    droppedStaleSourceCount: freshness.droppedStaleCount,
    droppedUndatedSourceCount: freshness.droppedUndatedCount,
    // Round-3 measure D: which adopted sources the extract stage
    // actually reached (domains only), so a sources-only landing
    // can be attributed between "extract never targeted the page"
    // and "the fetched text held no value sentence".
    ...(extractedDomains && extractedDomains.length > 0
      ? { extractedDomains }
      : {}),
    // Round-8 measure D: the searches this request issued (routes
    // and minimized query texts), so the research record can tell
    // "the official query never fired" from "it fired and lost".
    ...(queriesIssued && queriesIssued.length > 0
      ? {
          queriesIssued: queriesIssued.map((issued) => ({
            provider: issued.provider,
            kind: issued.kind,
            query: issued.query,
            ...(issued.includeDomains ? { includeDomains: issued.includeDomains } : {}),
          })),
        }
      : {}),
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
            // Round-8 measure D: per-candidate gate decisions with
            // their basis dates, and the measure-B retry record.
            freshnessDecisions: candidateStats.freshnessDecisions,
            ...(candidateStats.officialRetry
              ? { officialRetry: candidateStats.officialRetry }
              : {}),
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
      outcome.queriesIssued,
      outcome.sources
        .filter((source) => source.evidenceLevel === "extracted")
        .map((source) => source.domain),
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
          outcome.queriesIssued,
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
