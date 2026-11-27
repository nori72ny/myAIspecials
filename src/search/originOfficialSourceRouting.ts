/**
 * Official-source routing for statistical questions
 * (F_GROUP_SOURCE_FIX_DESIGN_2026-11-19, measures B + C).
 *
 * Round 6's F group (latest official statistics) stayed at 3/15 for a
 * structural reason, not a model reason: on the six freshness refusals
 * the adopted source pool was EMPTY — the search never reached a
 * primary official domain, and official statistics pages that were
 * reached carry no explicit date in the extracted text, so the
 * freshness gate discarded them as undated. The recovery layer
 * (PR-3 vote / PR-4 template) works on the adopted pool, so an empty
 * pool means zero candidates; and when the pool held only unofficial
 * sources, the template confirmed a STALE value twice (F-03 policy
 * rate "0.25%", F-15 GDP "1.0%") — the pool's quality, not the voting
 * mechanism, is the defect. Official statistics are current by
 * publication schedule (a monthly figure is the latest until the next
 * scheduled release), so judging them by date strings inside the page
 * is structurally wrong for this source class.
 *
 * This module is the deterministic, search-side half of the fix:
 *  - B: when the question is a statistical / current-value question
 *    (the recovery build's answer-type classification, restricted to
 *    its value-bearing types) AND matches a curated topic, up to
 *    MAX_OFFICIAL_SOURCE_QUERIES additional Tavily searches are
 *    issued with `include_domains` restricted to that topic's
 *    official domains. The ordinary queries are never replaced —
 *    these are additions only, and each costs the usual 1 basic
 *    credit, accounted against the same monthly self cap.
 *  - C lives in originSearchGrounding's freshness gate: with the
 *    switch on, an official-tier source is never dropped merely for
 *    having no extractable publication date (see
 *    evaluateOriginSourceFreshness). Dated official sources still
 *    face the age window, and unofficial sources are judged exactly
 *    as before. Survivors flow into the adopted pool with their
 *    official tier intact, so the PR-3 vote weighs them at the
 *    official weight (3) with no vote-side change.
 *
 * Round-5 measures (ANSWER_STATISTICS_ROUND5_DIAGNOSIS_2026-11-27):
 *  - 5-1: the type gate opens from the topic side — an `other`
 *    question asking for a current value is planned when a curated
 *    topic matches (isStatisticalCurrentValueRequest). The GDP
 *    phrasing 「実質GDPの最新値」 classified as `other` and never
 *    reached this module's topic table at all.
 *  - 5-3a: the first-pass official query uses the release form
 *    (buildOfficialReleaseQueryText — publication name + expected
 *    edition) instead of the minimized-question long form.
 *  - 5-3c (round-6 measure 6-2, ANSWER_STATISTICS_ROUND6_DIAGNOSIS_
 *    2026-11-27 §3): a topic may carry releasePageUrls — the
 *    publisher's own page that keeps carrying the LATEST release.
 *    When the plan fires, the grounding layer fetches those URLs
 *    directly (Tavily extract) and adds them to the candidate pool,
 *    so reaching the current release page no longer depends on the
 *    search provider's index returning it. The round-6 diagnosis
 *    confirmed the Labour Force Survey's monthly release page never
 *    entered the pool across two rounds and three query shapes —
 *    a candidate-generation gap no query text can close. The
 *    deterministic candidates face every existing gate (freshness,
 *    edition-keyed material assessment, packet selection) exactly
 *    like search candidates; candidacy is deterministic, adoption
 *    is not. Only labour-force-statistics carries URLs today: its
 *    two URLs were confirmed on the publisher's site at
 *    implementation time (see the topic entry). GDP was checked and
 *    deliberately NOT given URLs — the release summary exists only
 *    as an edition-named PDF (a per-edition URL, which this field
 *    forbids) and as a persistent-named DATA-TABLE PDF (the
 *    document form round-6 §2 showed carries no quotable value
 *    sentence); the ESRI menu page is a dashboard fragment, not the
 *    release's value sentence (round-6 diagnosis §5, measure 6-3).
 *
 * The domain map is a small curated table, one entry per topic —
 * never per question. Every domain was confirmed against the primary
 * source named by the round-6 answer keys (f-keys-round6.md):
 *  - monetary policy: the Bank of Japan publishes the policy rate
 *    (F-03's key cites the BOJ decision);
 *  - labour-force / population statistics: the Statistics Bureau's
 *    Labour Force Survey (F-06) and Population Estimates (F-07) —
 *    e-stat is the government's official statistics portal carrying
 *    the same releases;
 *  - employment / pension: MHLW publishes the job-offers ratio
 *    (F-05) and the National Pension premium (F-08);
 *  - GDP: the Cabinet Office's ESRI publishes the national accounts
 *    (F-15);
 *  - fuel prices: METI's Agency for Natural Resources and Energy
 *    publishes the Petroleum Product Price Survey (F-04's key names
 *    経済産業省・資源エネルギー庁 as the publisher; the survey
 *    contractor's own domain is deliberately NOT listed — it is not
 *    the publishing authority the key cites);
 *  - elections: the Ministry of Internal Affairs and Communications
 *    administers national elections (F-14);
 *  - cabinet: the Prime Minister's Office publishes the cabinet
 *    roster (F-01).
 * All of them sit under go.jp, so the search layer already tiers
 * them "official"; this map only steers retrieval toward them.
 *
 * Round-8 deepening (F_GROUP_ROUND8_PROBE_2026-11-26): the probe
 * confirmed the adopted pool still held ZERO primary publication
 * pages for the five central F items, so two additions ride the
 * same switch:
 *  - A: the additional queries now aim at the publication page —
 *    each topic carries its release name (releaseTerms), appended
 *    to the minimized query for the domain-restricted search (see
 *    buildOfficialSourceQueryText).
 *  - B: when the adopted pool is materially insufficient — no
 *    value-bearing span at all, or values only from regional
 *    publications — the grounding layer fires ONE more restricted
 *    search, for the release name alone (see
 *    assessOfficialMaterialInsufficiency and, in the grounding
 *    layer, the retry it gates). At most one retry per question.
 *
 * Switch: ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE. Only the exact value
 * "true" enables the routing; anything else — including an unset
 * variable — is off, so production behaviour is unchanged until the
 * mode is deliberately registered (the Stage 1 common rule for new
 * switches, and the same "true"-only shape as the provider switches).
 * Only extracted search keywords are ever sent — the additional
 * queries are built from the grounding layer's minimized query and
 * the curated release names, so the no-raw-text discipline is
 * unchanged.
 */
import {
  classifyRecoveryAnswerType,
  type RecoveryAnswerType,
} from "../research/groundedResearchValueExtraction.js";
import {
  expectedLatestOriginOfficialEdition,
  originOfficialEditionQueryTerms,
  parseOriginOfficialEdition,
  type OriginOfficialEdition,
  type OriginOfficialEditionSchedule,
} from "./originOfficialEdition.js";
import {
  isRegionalOfficialSource,
  type OfficialMaterialSourceShape,
} from "./originRegionalOfficialSource.js";

// The regional predicate lives in its own leaf module
// (originRegionalOfficialSource.ts) so the grounding selection and
// the evidence packet can import it without closing a dependency
// cycle through this module; re-exported here so existing imports
// from the routing module keep working.
export { isRegionalOfficialSource, type OfficialMaterialSourceShape };

/** Only the exact string "true" enables official-source routing. */
export function resolveOriginOfficialSourceRoutingEnabled(
  env: NodeJS.ProcessEnv | undefined,
): boolean {
  return env?.ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE === "true";
}

/**
 * Answer types that ask for a current statistical value. The other
 * recovery types (law_existence / procedure / calculation /
 * existence / other) never trigger official queries: they are not
 * value questions, and widening the trigger would spend credits on
 * questions this measure is not about.
 */
const STATISTICAL_ANSWER_TYPES: ReadonlySet<RecoveryAnswerType> = new Set([
  "rate_percent",
  "price_money",
  "count_people",
  "count_seats",
  "date",
  "version",
  "team_name",
  "person_name",
]);

export interface OriginOfficialSourceTopic {
  id: string;
  pattern: RegExp;
  /** Official domains for the topic (1–2). One query covers them all. */
  domains: readonly string[];
  /**
   * The topic's publication (release) name — the document series the
   * publisher issues the value in (round-8 deepening of measure B:
   * F_GROUP_ROUND8_PROBE_2026-11-26, measure 1). The round-8 probe
   * confirmed the failure was not the domain restriction itself but
   * its aim: a domain-restricted search over the bare minimized query
   * surfaces the organization's top pages and prefectural sub-pages,
   * while the value lives on the RELEASE page (the Labour Force
   * Survey results page, the job-offers release, the population
   * estimates release…). Appending the release name steers the
   * restricted search at that page. Every name below is the
   * publisher's own release title, confirmed against the primary
   * source the answer keys cite — never a per-question invention.
   * Topics whose releases have no single stable title (elections:
   * the release name changes with each election; cabinet: the roster
   * page is the publication) carry none and keep the bare query.
   */
  releaseTerms?: string;
  /**
   * The topic's publication schedule for edition targeting
   * (follow-up measure 2, ANSWER_FOLLOWUP_DIAGNOSIS_2026-11-26):
   * monthly statistics whose edition is certainly public two
   * months behind the current month （一般職業紹介状況： 9月分は
   * 10月30日公表、労働力調査： 9月分は10月31日公表 — the
   * two-months-back edition exists on every day of every month),
   * and the GDP preliminary, public about 45 days after the
   * quarter ends (2026年7-9月期1次速報： 11月16日公表）. The
   * schedule is the publisher's own calendar — the basis for the
   * expected-latest-edition lower bound, never a freshness guess.
   * Topics without a periodic edition （金融政策決定会合 is an
   * event, not an edition; fuel prices are a weekly survey named
   * by date) carry none.
   */
  edition?: OriginOfficialEditionSchedule;
  /**
   * The topic's release pages (measure 5-3c, design memo
   * ANSWER_STATISTICS_ROUND5_MEASURE53C_DESIGN_MEMO_2026-11-27
   * §2.1): URLs of pages that keep carrying the LATEST release —
   * the monthly results page itself, or the summary document under
   * its persistent file name. Never an edition-specific document
   * or a past-edition archive: pinning an edition's URL would break
   * the freshness discipline the edition key enforces. At most two
   * per topic (the results page plus its summary). Each URL was
   * confirmed on the publisher's site before being written here
   * (memo §2.2): the page exists, it is the current edition's
   * release page, and the value's sentence is extractable from it
   * as an ordinary sentence.
   */
  releasePageUrls?: readonly string[];
}

/**
 * Curated topic → official-domain map, in priority order: when a
 * question matches several topics, earlier topics claim the query
 * budget first. Labour-force statistics precede the employment topic
 * because the unemployment rate's primary publisher is the
 * Statistics Bureau (Labour Force Survey), not MHLW.
 */
export const ORIGIN_OFFICIAL_SOURCE_TOPICS: readonly OriginOfficialSourceTopic[] = [
  {
    id: "monetary-policy",
    pattern: /日銀|日本銀行|政策金利|金融政策|無担保コール/,
    domains: ["boj.or.jp"],
    releaseTerms: "金融政策決定会合",
  },
  {
    id: "labour-force-statistics",
    pattern: /失業率|完全失業|労働力調査|就業者数/,
    domains: ["stat.go.jp", "e-stat.go.jp"],
    releaseTerms: "労働力調査 基本集計",
    edition: { cycle: "monthly", lagMonths: 2 },
    // Release pages (measure 5-3c), confirmed on stat.go.jp on
    // 2026-11-27 (memo §2.2 procedure): the monthly results page
    // 「労働力調査（基本集計）月次結果」 is the September 2026
    // （令和8年9月分） release page at confirmation time and states
    // the value as an ordinary sentence （完全失業率（季節調整値）
    // は2.4％。); the summary PDF is linked from that page under
    // its persistent file name (overwritten with each month's
    // release) and states the same sentence. Both are republished
    // in place for every new edition — neither URL names an
    // edition.
    releasePageUrls: [
      "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/index.html",
      "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/pdf/gaiyou.pdf",
    ],
  },
  {
    id: "population-statistics",
    pattern: /人口/,
    domains: ["stat.go.jp", "e-stat.go.jp"],
    releaseTerms: "人口推計",
    edition: { cycle: "monthly", lagMonths: 2 },
  },
  {
    id: "employment-and-pension",
    pattern: /求人倍率|有効求人|年金保険料|国民年金|雇用保険/,
    domains: ["mhlw.go.jp"],
    releaseTerms: "一般職業紹介状況",
    edition: { cycle: "monthly", lagMonths: 2 },
  },
  {
    id: "gdp-and-economy",
    pattern: /GDP|国内総生産|経済成長率|景気動向/,
    domains: ["esri.cao.go.jp", "cao.go.jp"],
    releaseTerms: "四半期別GDP速報",
    edition: { cycle: "quarterly", lagDaysAfterPeriodEnd: 45 },
  },
  {
    id: "fuel-prices",
    pattern: /ガソリン|軽油|灯油|石油製品|燃料油/,
    domains: ["enecho.meti.go.jp"],
    releaseTerms: "石油製品価格調査",
  },
  {
    id: "elections",
    pattern: /選挙|総選挙|衆院選|参院選|議席/,
    domains: ["soumu.go.jp"],
  },
  {
    id: "cabinet",
    pattern: /内閣総理大臣|総理大臣|首相/,
    domains: ["kantei.go.jp"],
  },
];

/** Hard cap on additional official queries per question (design §2). */
export const MAX_OFFICIAL_SOURCE_QUERIES = 2;

export interface OriginOfficialSourceQuery {
  topic: string;
  domains: readonly string[];
  /** The topic's publication name, when it has one (see the topic map). */
  releaseTerms?: string;
  /**
   * The newest edition that must exist at plan time (follow-up
   * measure 2a/2c), computed from the topic's publication schedule
   * and the caller's clock. Present only when a clock was supplied
   * and the topic carries a schedule. It is a lower bound: the
   * adopted pool is stale only when its newest adopted official
   * edition is older than this.
   */
  expectedEdition?: OriginOfficialEdition;
  /** The expected edition in both notations, for query text (measure 2a). */
  editionTerms?: readonly string[];
  /**
   * The topic's release pages (measure 5-3c), carried from the
   * topic table: when this query is planned, the grounding layer
   * fetches these URLs directly into the candidate pool.
   */
  releasePageUrls?: readonly string[];
}

export interface OriginOfficialSourcePlan {
  answerType: RecoveryAnswerType;
  /** At most MAX_OFFICIAL_SOURCE_QUERIES entries, priority order. */
  queries: OriginOfficialSourceQuery[];
}

/**
 * Current-value request markers for the topic-side gate (round-5
 * measure 5-1, ANSWER_STATISTICS_ROUND5_DIAGNOSIS_2026-11-27 §2.2).
 * The recovery classifier is vocabulary-based: it puts a question
 * into a value type only when the wording carries a value word
 * （率・倍率・％…), so "実質GDPの最新値" — no rate word in it —
 * classifies as `other` and the plan below returned null before any
 * topic was even consulted. The GDP topic's pattern, release name
 * and edition schedule all existed; the type gate made them
 * unreachable for the most natural phrasing of the question, and
 * with no plan there is no domain-restricted search, no edition
 * key and no material-insufficiency retry for that question at all.
 * The gate is therefore opened from the topic side: an `other`
 * question that asks for a current value (one of these markers) is
 * planned like a statistical question when a curated topic matches.
 * Only `other` gets the second look — the classifier's specific
 * non-value types (procedure / law_existence / calculation /
 * existence) keep their null, exactly as before.
 */
const STATISTICAL_CURRENT_VALUE_REQUEST_PATTERN =
  /最新値|最新の値|現在の値|最新の数値|現在の数値|最新データ|最新のデータ|現在のデータ/;

/**
 * Explanation-shape guard for the same gate: a question asking what
 * something IS — or how a figure is defined or computed — is not
 * asking for its current value, even when it names one ("実質GDPの
 * 最新値とは何ですか" defines the term; it does not request the
 * figure). The measured non-firing case is 「実質GDPとは何か」,
 * which carries no current-value marker anyway; the guard covers
 * the marker-carrying explanation shapes.
 */
const STATISTICAL_EXPLANATION_REQUEST_PATTERN =
  /とは|って何|の意味|意味を教えて|仕組み|定義|決め方|求め方|算出方法|計算方法/;

export function isStatisticalCurrentValueRequest(normalizedMessage: string): boolean {
  return (
    STATISTICAL_CURRENT_VALUE_REQUEST_PATTERN.test(normalizedMessage)
    && !STATISTICAL_EXPLANATION_REQUEST_PATTERN.test(normalizedMessage)
  );
}

/**
 * Plan the additional official-domain queries for a question, or
 * null when the question is not a statistical value question or no
 * curated topic matches. A topic whose domain set duplicates an
 * already-planned query (labour-force and population share the
 * Statistics Bureau domains) does not consume a second query.
 */
export function planOriginOfficialSourceQueries(
  message: string,
  nowMs?: number,
): OriginOfficialSourcePlan | null {
  const answerType = classifyRecoveryAnswerType(message);
  const normalized = message.normalize("NFKC");
  if (!STATISTICAL_ANSWER_TYPES.has(answerType)) {
    // Round-5 measure 5-1: the type gate opens from the topic side
    // for an `other` question that asks for a current value (see
    // isStatisticalCurrentValueRequest). The topic loop below is
    // the second half of the gate — no topic match still plans
    // nothing — so a current-value phrasing alone never spends a
    // query on an unmapped subject.
    if (answerType !== "other" || !isStatisticalCurrentValueRequest(normalized)) {
      return null;
    }
  }
  const queries: OriginOfficialSourceQuery[] = [];
  const plannedDomainSets = new Set<string>();
  for (const topic of ORIGIN_OFFICIAL_SOURCE_TOPICS) {
    if (queries.length >= MAX_OFFICIAL_SOURCE_QUERIES) break;
    if (!topic.pattern.test(normalized)) continue;
    const domainKey = [...topic.domains].sort().join(",");
    if (plannedDomainSets.has(domainKey)) continue;
    plannedDomainSets.add(domainKey);
    // Edition targeting (measure 2a): with a clock, the plan names
    // the edition that must be the latest — computed from the
    // topic's publication schedule, never a hardcoded string — so
    // the restricted search aims at the current release page, not
    // at whichever edition the provider happens to rank first.
    const expectedEdition = topic.edition && nowMs !== undefined
      ? expectedLatestOriginOfficialEdition(topic.edition, nowMs)
      : null;
    queries.push({
      topic: topic.id,
      domains: topic.domains,
      ...(topic.releaseTerms ? { releaseTerms: topic.releaseTerms } : {}),
      ...(expectedEdition
        ? { expectedEdition, editionTerms: originOfficialEditionQueryTerms(expectedEdition) }
        : {}),
      ...(topic.releasePageUrls ? { releasePageUrls: topic.releasePageUrls } : {}),
    });
  }
  if (queries.length === 0) return null;
  return { answerType, queries };
}

/**
 * The query text for a planned official-domain search (measure A):
 * the minimized query plus the topic's release name, so the
 * domain-restricted search ranks the publication page itself instead
 * of the organization's top pages. When the minimized query already
 * names the release (its first term), nothing is appended — the same
 * text twice would only distort the relevance screen's term set.
 */
export function buildOfficialSourceQueryText(
  baseQuery: string,
  releaseTerms: string | undefined,
  editionTerms?: readonly string[],
): string {
  const base = baseQuery.trim();
  const editionSuffix = editionTerms && editionTerms.length > 0
    ? editionTerms.filter((term) => !base.includes(term)).join(" ")
    : "";
  const withEdition = (text: string): string =>
    (editionSuffix ? `${text} ${editionSuffix}` : text).trim();
  if (!releaseTerms) return withEdition(base);
  const headTerm = releaseTerms.split(/\s+/)[0];
  if (headTerm && base.includes(headTerm)) return withEdition(base);
  return withEdition(`${base} ${releaseTerms}`);
}

/**
 * The release query (round-5 measure 5-3a): the publication name
 * plus the expected edition's terms, in both notations — nothing
 * else. The round-5 diagnosis measured the first-pass official
 * query (minimized question + release name + edition terms) still
 * missing the Labour Force Survey's monthly release page on
 * stat.go.jp, while the retry's short form is the shape that
 * reaches release pages; the first pass now uses the same short
 * form, so the domain-restricted search asks for the publication
 * itself from the start. Topics without a release name have no
 * short form and keep the minimized-query form
 * (buildOfficialSourceQueryText).
 */
export function buildOfficialReleaseQueryText(
  releaseTerms: string,
  editionTerms?: readonly string[],
): string {
  const base = releaseTerms.trim();
  if (!editionTerms || editionTerms.length === 0) return base;
  // The edition terms name the edition that must exist alongside
  // the release name. Measure 2c first attached them for the
  // stale-edition retry reason (the pool HAS the release, only in
  // an old edition); round-4 measure 3-5 extends them to every
  // insufficiency reason — a regional-only pool has no national
  // edition at all, and the release name alone ranks the
  // publisher's annual and index pages above the current monthly
  // release page.
  const suffix = editionTerms.filter((term) => !base.includes(term)).join(" ");
  return (suffix ? `${base} ${suffix}` : base).trim();
}

/**
 * The retry query (measure B): the release name alone — the same
 * short form the first pass now uses (round-5 measure 5-3a). A
 * retry that merely repeated the first pass's long form would
 * return the same candidates; asking for the publication itself —
 * the release index / latest-release page — is what the pool is
 * missing. (The first pass and the retry now share the query text;
 * the retry still earns its credit because it runs AFTER the
 * adopted pool is known to be insufficient and bypasses the
 * candidate cache — a cached read would return the very set that
 * was just judged insufficient — and its candidates re-enter
 * selection with the post-retry edition key.)
 */
export function buildOfficialRetryQueryText(
  releaseTerms: string,
  editionTerms?: readonly string[],
): string {
  return buildOfficialReleaseQueryText(releaseTerms, editionTerms);
}

/* ------------------------------------------------------------------ */
/* Material insufficiency (measure B's detection half)                 */
/* ------------------------------------------------------------------ */

/**
 * Whether an excerpt carries a value-shaped token: a decimal number
 * (2.4, 1.19, -0.0 — the shape of a published statistic) or a digit
 * run bound to a value unit (%, 倍, 円, 万人, 億円, 兆円, ドル,
 * ポイント, 件). Navigation text, dataset metadata and figure
 * captions ("図1", "2026年9月分") carry neither shape: a bare year or
 * a figure number is not the statistic the question asks for, and
 * counting it as material would declare the F-06 pool (two adopted
 * pages, zero value spans) sufficient.
 */
const OFFICIAL_VALUE_TOKEN_PATTERN =
  /\d[\d,]*\.\d+|\d[\d,]*\s*(?:%|倍|円|万人|億円|兆円|ドル|ポイント|件)/;

export function excerptHasOfficialValueToken(excerpt: string): boolean {
  return OFFICIAL_VALUE_TOKEN_PATTERN.test((excerpt ?? "").normalize("NFKC"));
}

export type OfficialMaterialInsufficiencyReason =
  | "no-numeric-span"
  | "regional-only"
  | "stale-edition";

export interface OfficialMaterialAssessment {
  sufficient: boolean;
  /** Why the adopted pool is not material enough (present only when insufficient). */
  reason?: OfficialMaterialInsufficiencyReason;
  /** Adopted sources whose excerpts carry a value-shaped token. */
  valueBearingCount: number;
  /** Value-bearing sources that are national official publications. */
  nationalOfficialValueCount: number;
}

/**
 * Judge the ADOPTED pool of a statistical question (round-8 probe,
 * measure 2). Three insufficiency shapes, each measured in
 * production:
 *  - "no-numeric-span" (F-06): no adopted excerpt carries the value
 *    at all — the pool is navigation text and metadata pages;
 *  - "regional-only" (F-05): no national official source carries a
 *    value, but a regional publication does — the national figure
 *    never arrived, a prefectural one stands in its place. A
 *    secondary source's value does not mask this shape (remeasure
 *    diagnosis 2026-11-26, measure 3-2): the F-06 re-measurement
 *    pool held the national value only in a news headline while a
 *    prefectural fragment carried the quotable value, and the old
 *    every-value-is-regional condition never fired;
 *  - "stale-edition" (F-05 follow-up, 2026-11-26): values arrived
 *    from national official publications, but only in editions
 *    older than the one the publication schedule says must exist —
 *    the current figure never arrived, an old one did. The same
 *    reason covers editions the parser cannot read at all: with an
 *    expected edition standing, a national official value whose
 *    edition is unreadable cannot be shown to BE the current
 *    figure (round-3 measure 3-4).
 * A pool whose values ride ONLY unofficial non-regional sources
 * (the F-03 shape — no regional value in the pool at all) is NOT
 * insufficient by this measure: the first-pass official query is
 * that case's remedy, and widening the retry trigger beyond the
 * measured shapes would spend credits on pools the probe did not
 * indict. An empty pool is not judged here either — that is the
 * freshness gate's territory (measure C), not a material gap.
 */
export function assessOfficialMaterialInsufficiency(
  sources: readonly OfficialMaterialSourceShape[],
  editionContext?: { expectedEdition?: OriginOfficialEdition | null },
): OfficialMaterialAssessment {
  const valueBearing = sources.filter((source) => excerptHasOfficialValueToken(source.excerpt));
  const nationalOfficialValue = valueBearing.filter(
    (source) => source.authorityTier === "official" && !isRegionalOfficialSource(source),
  );
  const nationalOfficialValueCount = nationalOfficialValue.length;
  if (valueBearing.length === 0) {
    return { sufficient: false, reason: "no-numeric-span", valueBearingCount: 0, nationalOfficialValueCount: 0 };
  }
  // Regional-only (measure 3-2): the trigger is "no national
  // official value, but a regional value exists" — not "every
  // value is regional". A secondary source carrying a value-shaped
  // number (a news headline quoting the national figure) does not
  // put the national publication in the pool, so it must not
  // suppress the retry that goes and gets it.
  if (
    nationalOfficialValueCount === 0
    && valueBearing.some((source) => isRegionalOfficialSource(source))
  ) {
    return {
      sufficient: false,
      reason: "regional-only",
      valueBearingCount: valueBearing.length,
      nationalOfficialValueCount: 0,
    };
  }
  // Stale edition (follow-up measure 2c): values DID arrive from
  // national official publications, but the newest edition among
  // them is older than the edition the publisher's schedule says
  // must already exist — the pool answered with an old release
  // (the production F-05 shape: the newest adopted MHLW page was a
  // years-old edition ranked first by the provider). The edition
  // is read from the sources' own titles (then URLs).
  //
  // Round-3 robustness (measure 3-4,
  // ANSWER_STATISTICS_ROUND3_DIAGNOSIS_2026-11-26): the 2c rule
  // judged only editions it could READ, so a publisher whose title
  // format the parser does not know (the Statistics Bureau's
  // dual-calendar form was the measured case) made "only old
  // editions present" undetectable — the pool was declared
  // sufficient and the retry never fired. When an expected edition
  // stands and national official values ARE present, "no readable
  // edition among them at all" is therefore itself the
  // insufficiency signal: the pool cannot be shown to hold the
  // current figure, and the edition-targeted retry — which can
  // only ADD candidates — is the remedy. This stays inside the
  // scheduled topics (an expected edition exists only there) and
  // does not touch the F-03 shape, which has no national official
  // value to begin with.
  const expected = editionContext?.expectedEdition;
  if (expected) {
    const adoptedEditions = nationalOfficialValue
      .map((source) => parseOriginOfficialEdition(source.title) ?? parseOriginOfficialEdition(source.url))
      .filter((edition): edition is OriginOfficialEdition => edition !== null);
    if (adoptedEditions.length > 0) {
      const newestAdopted = Math.max(...adoptedEditions.map((edition) => edition.sortKey));
      if (newestAdopted < expected.sortKey) {
        return {
          sufficient: false,
          reason: "stale-edition",
          valueBearingCount: valueBearing.length,
          nationalOfficialValueCount,
        };
      }
    } else if (nationalOfficialValueCount > 0) {
      return {
        sufficient: false,
        reason: "stale-edition",
        valueBearingCount: valueBearing.length,
        nationalOfficialValueCount,
      };
    }
  }
  return { sufficient: true, valueBearingCount: valueBearing.length, nationalOfficialValueCount };
}
