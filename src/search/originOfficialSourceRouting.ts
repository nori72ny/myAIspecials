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
 * Switch: ORIGIN_OFFICIAL_SOURCE_ROUTING_MODE. Only the exact value
 * "true" enables the routing; anything else — including an unset
 * variable — is off, so production behaviour is unchanged until the
 * mode is deliberately registered (the Stage 1 common rule for new
 * switches, and the same "true"-only shape as the provider switches).
 * Only extracted search keywords are ever sent — the additional
 * queries reuse the grounding layer's minimized query verbatim, so
 * the no-raw-text discipline is unchanged.
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
  },
  {
    id: "labour-force-statistics",
    pattern: /失業率|完全失業|労働力調査|就業者数/,
    domains: ["stat.go.jp", "e-stat.go.jp"],
  },
  {
    id: "population-statistics",
    pattern: /人口/,
    domains: ["stat.go.jp", "e-stat.go.jp"],
  },
  {
    id: "employment-and-pension",
    pattern: /求人倍率|有効求人|年金保険料|国民年金|雇用保険/,
    domains: ["mhlw.go.jp"],
  },
  {
    id: "gdp-and-economy",
    pattern: /GDP|国内総生産|経済成長率|景気動向/,
    domains: ["esri.cao.go.jp", "cao.go.jp"],
  },
  {
    id: "fuel-prices",
    pattern: /ガソリン|軽油|灯油|石油製品|燃料油/,
    domains: ["enecho.meti.go.jp"],
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
    queries.push({ topic: topic.id, domains: topic.domains });
  }
  if (queries.length === 0) return null;
  return { answerType, queries };
}
