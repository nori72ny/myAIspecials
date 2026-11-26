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
  },
  {
    id: "population-statistics",
    pattern: /人口/,
    domains: ["stat.go.jp", "e-stat.go.jp"],
    releaseTerms: "人口推計",
  },
  {
    id: "employment-and-pension",
    pattern: /求人倍率|有効求人|年金保険料|国民年金|雇用保険/,
    domains: ["mhlw.go.jp"],
    releaseTerms: "一般職業紹介状況",
  },
  {
    id: "gdp-and-economy",
    pattern: /GDP|国内総生産|経済成長率|景気動向/,
    domains: ["esri.cao.go.jp", "cao.go.jp"],
    releaseTerms: "四半期別GDP速報",
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
    queries.push({
      topic: topic.id,
      domains: topic.domains,
      ...(topic.releaseTerms ? { releaseTerms: topic.releaseTerms } : {}),
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
): string {
  const base = baseQuery.trim();
  if (!releaseTerms) return base;
  const headTerm = releaseTerms.split(/\s+/)[0];
  if (headTerm && base.includes(headTerm)) return base;
  return `${base} ${releaseTerms}`.trim();
}

/**
 * The retry query (measure B): the release name alone. The first-pass
 * official search already paired the release name with the question's
 * own terms; a retry that merely repeats it would return the same
 * candidates, so the retry asks for the publication itself — the
 * release index / latest-release page is what the pool is missing.
 */
export function buildOfficialRetryQueryText(releaseTerms: string): string {
  return releaseTerms.trim();
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

/**
 * The 47 prefectures, kanji stems and romaji slugs — a fixed
 * geographic vocabulary, used only to recognize REGIONAL content
 * (a prefectural bureau's release of its own local figure) as
 * distinct from the national publication. A regional figure is real
 * data, but it is not the national value a statistics question asks
 * for (round 8, F-05: the adopted pool's only value-bearing source
 * was the Miyagi labour bureau's prefectural PDF).
 */
const PREFECTURE_KANJI_STEMS: readonly string[] = [
  "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬",
  "埼玉", "千葉", "東京", "神奈川", "新潟", "富山", "石川", "福井", "山梨", "長野",
  "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
  "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡",
  "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
];
const PREFECTURE_ROMAJI_SLUGS: readonly string[] = [
  "hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima",
  "ibaraki", "tochigi", "gunma", "saitama", "chiba", "tokyo", "kanagawa",
  "niigata", "toyama", "ishikawa", "fukui", "yamanashi", "nagano", "gifu",
  "shizuoka", "aichi", "mie", "shiga", "kyoto", "osaka", "hyogo", "nara",
  "wakayama", "tottori", "shimane", "okayama", "hiroshima", "yamaguchi",
  "tokushima", "kagawa", "ehime", "kochi", "fukuoka", "saga", "nagasaki",
  "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa",
];
/**
 * Hosts that serve only regional (prefectural) content: the MHLW
 * local-bureau portal host, under which every prefectural labour
 * bureau publishes (jsite.mhlw.go.jp/miyagi-roudoukyoku/…). The host
 * is official, but nothing on it is the national release.
 */
const REGIONAL_ONLY_HOSTS: ReadonlySet<string> = new Set(["jsite.mhlw.go.jp"]);

export interface OfficialMaterialSourceShape {
  title: string;
  url: string;
  excerpt: string;
  domain: string;
  authorityTier: string;
}

/** True when the source is a regional (prefectural) publication. */
export function isRegionalOfficialSource(source: OfficialMaterialSourceShape): boolean {
  if (REGIONAL_ONLY_HOSTS.has(source.domain)) return true;
  const title = (source.title ?? "").normalize("NFKC");
  if (PREFECTURE_KANJI_STEMS.some((name) => title.includes(name))) return true;
  const url = (source.url ?? "").toLowerCase();
  return PREFECTURE_ROMAJI_SLUGS.some((slug) => url.includes(slug));
}

export type OfficialMaterialInsufficiencyReason = "no-numeric-span" | "regional-only";

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
 * measure 2). Two insufficiency shapes, both measured in round 8:
 *  - "no-numeric-span" (F-06): no adopted excerpt carries the value
 *    at all — the pool is navigation text and metadata pages;
 *  - "regional-only" (F-05): values exist, but every value-bearing
 *    source is a regional publication and no national official
 *    source carries a value — the national figure never arrived.
 * A pool whose values ride unofficial NON-regional sources (the
 * F-03 shape) is NOT insufficient by this measure: the first-pass
 * official query is that case's remedy, and widening the retry
 * trigger beyond the two measured shapes would spend credits on
 * pools the probe did not indict. An empty pool is not judged here
 * either — that is the freshness gate's territory (measure C), not
 * a material gap.
 */
export function assessOfficialMaterialInsufficiency(
  sources: readonly OfficialMaterialSourceShape[],
): OfficialMaterialAssessment {
  const valueBearing = sources.filter((source) => excerptHasOfficialValueToken(source.excerpt));
  const nationalOfficialValueCount = valueBearing.filter(
    (source) => source.authorityTier === "official" && !isRegionalOfficialSource(source),
  ).length;
  if (valueBearing.length === 0) {
    return { sufficient: false, reason: "no-numeric-span", valueBearingCount: 0, nationalOfficialValueCount: 0 };
  }
  if (
    nationalOfficialValueCount === 0
    && valueBearing.every((source) => isRegionalOfficialSource(source))
  ) {
    return {
      sufficient: false,
      reason: "regional-only",
      valueBearingCount: valueBearing.length,
      nationalOfficialValueCount: 0,
    };
  }
  return { sufficient: true, valueBearingCount: valueBearing.length, nationalOfficialValueCount };
}
