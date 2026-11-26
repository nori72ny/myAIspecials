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
}

export interface OriginOfficialSourcePlan {
  answerType: RecoveryAnswerType;
  /** At most MAX_OFFICIAL_SOURCE_QUERIES entries, priority order. */
  queries: OriginOfficialSourceQuery[];
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
  if (!STATISTICAL_ANSWER_TYPES.has(answerType)) return null;
  const normalized = message.normalize("NFKC");
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
 * The retry query (measure B): the release name alone. The first-pass
 * official search already paired the release name with the question's
 * own terms; a retry that merely repeats it would return the same
 * candidates, so the retry asks for the publication itself — the
 * release index / latest-release page is what the pool is missing.
 */
export function buildOfficialRetryQueryText(
  releaseTerms: string,
  editionTerms?: readonly string[],
): string {
  const base = releaseTerms.trim();
  if (!editionTerms || editionTerms.length === 0) return base;
  // The stale-edition retry (measure 2c): the pool HAS the release,
  // only in an old edition — so the retry names the edition that
  // must exist, in both notations, alongside the release name.
  const suffix = editionTerms.filter((term) => !base.includes(term)).join(" ");
  return (suffix ? `${base} ${suffix}` : base).trim();
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
