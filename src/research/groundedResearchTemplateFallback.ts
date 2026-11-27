import {
  classifyRecoveryAnswerType,
  extractRecoveryValues,
  RECOVERY_TIER_WEIGHT,
  voteRecoveryValues,
  type RecoveryAnswerType,
  type RecoveryCandidateValue,
  type RecoveryValueSourceInput,
} from "./groundedResearchValueExtraction.js";
import { ORIGIN_OFFICIAL_SOURCE_TOPICS } from "../search/originOfficialSourceRouting.js";
import { originSourcePeriodAnnotation } from "../search/originOfficialEdition.js";

/**
 * Recovery build Stage 1, PR-4: the template direct-answer fallback
 * (RECOVERY_BUILD_STAGE1_DESIGN_2026-11-18, PR-4; adoption:
 * EXTERNAL_CONSULT_CHAT100_ADOPTION_2026-11-18 item 3).
 *
 * Round 5's freshness refusals (F-04/05/06/09/15) shared one shape:
 * the search layer DID retrieve sources stating the current value,
 * but the freshness gate dropped every candidate — periodic official
 * values (the weekly gasoline price, the monthly job-offer ratio,
 * the unemployment rate, quarterly GDP) are published on a cycle, so
 * "the page is not brand new" discarded values that are in fact the
 * latest published ones. The design's answer is that a value's
 * newness is judged by the VALUE's publication point, not the page's
 * retrieval freshness — and that when PR-3's cross-source vote has
 * confirmed a value, a deterministic template may state it directly,
 * with its as-of date and its sources, instead of refusing.
 *
 * This module is that template. It is pure and deterministic — no
 * model call, no prompt change — and it fires only on a CONFIRMED
 * scalar value:
 *
 *  - the answer type must be one of the templated scalar types
 *    (price_money / rate_percent / count_people / count_seats /
 *    date / team_name / version). Person names, law existence,
 *    procedures, calculations and everything else are excluded by
 *    design: the publication gate's fatal classes (ages, current
 *    office-holders, law names, statutory capacity) must not be
 *    weakened by a template that asserts them (F-01 stays with
 *    PR-2's evidence packet);
 *  - the value must be confirmed by PR-3's vote — at least two
 *    independent domains stating it, never title-only — or, when
 *    the vote is contested, resolved by the freshness arbitration
 *    below. A single-source value never fires;
 *  - the winning value's newest publication date (a candidate's
 *    source publication date, else the date its own sentence
 *    states) must lie within 365 days before `nowMs` — the
 *    fresh_general ceiling — and must exist at all: an undated
 *    value's currency cannot be verified, so it never fires.
 *
 * Freshness arbitration (the F-03 case): PR-3's date-conflict guard
 * degrades a vote to "contested" when an eligible rival holds a
 * strictly newer value date than the score leader (round 5: five
 * domains still mention June's 1.0%, three state September's
 * 1.25%). PR-4 arbitrates deterministically between the TWO
 * STRONGEST eligible groups by domain support (the summed tier
 * weights of the independent domains stating the value, before
 * PR-3's recency bonus): the stale-but-popular leader and its
 * strongest challenger — the one with the strictly newest
 * publication point wins. The pool is capped at two on purpose:
 * F-03's sources also state "2%" (the inflation target, carried
 * by two general blogs in October), and a date-only pick among
 * ALL eligible groups would state that instead of the policy
 * rate; a weakly supported group has neither the strongest
 * support nor the claim to be the contested value. A
 * tie, or no dated group in the pool, leaves the question
 * unanswered — the arbitration never guesses. This cannot
 * contradict PR-3's guard: the guard exists precisely to hand this
 * case to a date rule, and a vote PR-3 already confirmed is always
 * its own freshest eligible group (the guard degrades any vote
 * whose leader is not).
 *
 * Event-shaped answers (F-14, the most recent national election)
 * are NOT templated here: the answer is an event name plus a date,
 * PR-3 extracts no scalar candidate for it, and a date alone run
 * through this template would produce a sentence that does not
 * answer the question. F-14 is deferred to PR-5's nonexistence /
 * conditional-answer work and recorded as such in the design.
 *
 * The switch is ORIGIN_RECOVERY_TEMPLATE_FALLBACK_MODE
 * ("off" default / "shadow" / "enforce"). This function computes
 * the same result in shadow and enforce; the CALLER decides what
 * shadow means (the chat router logs the attempt and delivers the
 * original answer byte-identically; enforce delivers the template
 * after the publication gate has also passed it). Mode "off"
 * short-circuits before any extraction.
 *
 * Official-support guard (F_GROUP_SOURCE_FIX_DESIGN_2026-11-19 §4,
 * the re-activation safety condition): round 6 measured this
 * template firing on pools that held NO official source at all —
 * the stale policy rate "0.25%" (F-03) and a forecast presented as
 * the GDP actual "1.0%" (F-15) both won their votes on unofficial
 * sources alone, while the offline ledger recovered the correct
 * values from official ones. The defect was the pool, not the vote,
 * so the vote itself is unchanged; what changes is whether the
 * template may state the confirmed value directly. For the
 * statistical scalar types (price_money / rate_percent /
 * count_people / count_seats), the winning value must be backed by
 * at least one official-domain source — a non-title-only candidate
 * in the winning group that either carries the "official"
 * authority tier or sits on a domain from the official-source
 * routing map. Neither existing judgment suffices alone, and no
 * third definition is introduced: the tier (classifyOriginDomainTier,
 * the judgment PR-3 weighs at 3) covers go.jp / lg.jp government
 * surfaces and vendor-official domains, but the Bank of Japan —
 * F-03's publisher — is not a go.jp host (boj.or.jp tiers
 * "general"); the routing map (ORIGIN_OFFICIAL_SOURCE_TOPICS,
 * #1380) is the curated statistical-publisher list that names it,
 * but covers only its eight topics. Their union is the codebase's
 * official-domain judgment for this guard. The other templated
 * types (date / team_name / version) are outside the guard's scope
 * and behave exactly as before. A winner without official support
 * does not fire: the question falls back to the ordinary answer
 * path, and the block is reported with reason
 * "no-official-support" so the router's structured recovery log
 * can tell it apart.
 *
 * Round 7 (ANSWER_ROUND7_DIAGNOSIS_2026-11-27, measure S-1): the
 * vote and this arbitration now read the EDITION. PR-3 disqualifies
 * a group whose stated edition is strictly older than the pool's
 * newest stated edition, and this module mirrors that
 * disqualification in its own eligibility, arbitrates contested
 * votes by edition before publication date, and — when a winning
 * group is entirely undated but carries a readable edition — lets
 * the edition serve as the value's date of last resort for the
 * freshness window (the deterministic release-page candidate's
 * shape: no provider date, no date in its value sentence, its
 * currency provable only by its edition).
 */

export type RecoveryTemplateFallbackMode = "off" | "shadow" | "enforce";

/**
 * Selected by ORIGIN_RECOVERY_TEMPLATE_FALLBACK_MODE. Only the exact
 * values "shadow" and "enforce" enable the fallback; everything
 * else — including an unset variable — is off, so production
 * behavior is unchanged until the mode is deliberately registered
 * (Stage 1 common rule: switches default OFF / shadow).
 */
export function resolveRecoveryTemplateFallbackMode(
  env: NodeJS.ProcessEnv | undefined,
): RecoveryTemplateFallbackMode {
  if (env?.ORIGIN_RECOVERY_TEMPLATE_FALLBACK_MODE === "shadow") return "shadow";
  if (env?.ORIGIN_RECOVERY_TEMPLATE_FALLBACK_MODE === "enforce") return "enforce";
  return "off";
}

/** Answer types the template may state. Everything else never fires. */
export const RECOVERY_TEMPLATE_TYPES: ReadonlySet<RecoveryAnswerType> = new Set([
  "price_money",
  "rate_percent",
  "count_people",
  "count_seats",
  "date",
  "team_name",
  "version",
]);

/**
 * The statistical scalar types (§4 guard scope): values published
 * as official statistics, where a stale figure confirmed by
 * unofficial sources alone is the measured round-6 failure. Only
 * these types require official-domain support to fire; the other
 * templated types are unchanged.
 */
export const RECOVERY_TEMPLATE_OFFICIAL_SUPPORT_TYPES: ReadonlySet<RecoveryAnswerType> = new Set([
  "price_money",
  "rate_percent",
  "count_people",
  "count_seats",
]);

/**
 * Every domain the official-source routing map (#1380) names, across
 * all topics — reused verbatim, not re-listed. A candidate domain
 * matches on the exact host or a dot-boundary suffix, the same
 * matching classifyOriginDomainTier applies to its own sets.
 */
const OFFICIAL_ROUTING_DOMAINS: ReadonlySet<string> = new Set(
  ORIGIN_OFFICIAL_SOURCE_TOPICS.flatMap((topic) => topic.domains),
);

function isOfficialRoutingDomain(domain: string): boolean {
  if (!domain) return false;
  for (const known of OFFICIAL_ROUTING_DOMAINS) {
    if (domain === known || domain.endsWith(`.${known}`)) return true;
  }
  return false;
}

/** §4's "official domain": the official tier, or a routing-map domain. */
function hasOfficialTierOrDomain(candidate: RecoveryCandidateValue): boolean {
  return candidate.authorityTier === "official" || isOfficialRoutingDomain(candidate.domain);
}

/** The fresh_general ceiling: a confirmed value older than this is not stated as current. */
export const RECOVERY_TEMPLATE_MAX_VALUE_AGE_MS = 365 * 24 * 60 * 60 * 1000;
/** Small tolerance for publication timestamps marginally ahead of the clock. */
const RECOVERY_TEMPLATE_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export interface RecoveryTemplateConfirmingSource {
  title: string;
  url: string;
  domain: string;
  /**
   * The source's period annotation (follow-up measure 3): its
   * stated edition （対象：令和○年○月分） or, failing that, its
   * stated date — the same rule the reconstruction landing
   * applies, so a template landing names the vintage of the
   * sources confirming its value instead of leaving the as-of
   * date in the opening sentence as the only vintage signal.
   * Absent when the source states neither.
   */
  annotation?: string;
}

export interface RecoveryTemplateFallbackResult {
  fired: boolean;
  mode: RecoveryTemplateFallbackMode;
  type: RecoveryAnswerType;
  /** Why the template did not fire (code vocabulary; never user-facing). */
  reason?:
    | "mode-off"
    | "type-not-templated"
    | "no-candidates"
    | "not-confirmed"
    | "contested-without-freshness-winner"
    | "no-official-support"
    | "value-undated"
    | "value-future-dated"
    | "value-stale";
  voteStatus?: "confirmed" | "contested" | "single" | "none";
  /** How the winning value was settled when the template fired. */
  resolution?: "vote" | "freshness-arbitration";
  /** The templated answer body (present only when fired). */
  text?: string;
  /** Display form of the stated value, unit included where the type has one. */
  value?: string;
  normalizedValue?: string;
  unit?: string;
  /** Independent domains backing the stated value. */
  domains: string[];
  /** ISO date (YYYY-MM-DD) of the value's newest publication point. */
  asOf?: string;
  /** The sources that state the winning value (the only ones listed). */
  confirmingSources: RecoveryTemplateConfirmingSource[];
}

export interface RecoveryTemplateFallbackInput {
  question: string;
  /** Production shape: the sources to extract from (kept or dropped). */
  sources?: readonly RecoveryValueSourceInput[];
  /**
   * Replay-harness alias for `sources` (the ledger passes its source
   * objects under this name). `sources` wins when both are present.
   */
  candidates?: readonly RecoveryValueSourceInput[];
  /** Accepted for harness compatibility; the type is classified from the question. */
  answerType?: string;
  env?: NodeJS.ProcessEnv;
  mode?: RecoveryTemplateFallbackMode;
  nowMs?: number;
  language?: "ja" | "en";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupKey(normalizedValue: string, unit: string | undefined): string {
  return `${normalizedValue}||${unit ?? ""}`;
}

/** A candidate's publication point: its source's publication date, else the date its sentence states. */
function publicationMsOf(candidate: RecoveryCandidateValue): number {
  const raw = candidate.publishedAt ?? candidate.statedDate;
  if (!raw) return Number.NaN;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function publicationTextOf(candidate: RecoveryCandidateValue): string | undefined {
  return candidate.publishedAt ?? candidate.statedDate;
}

interface GroupStats {
  newestMs: number;
  newestText?: string;
  domains: Set<string>;
  titleOnly: boolean;
  /**
   * §4 guard input: a body (non-title-only) candidate in this
   * group is official-domain support (official tier or a
   * routing-map domain) — the same never-title-only discipline
   * PR-3's confirmation applies.
   */
  officialSupport: boolean;
  sourceIndexes: Set<number>;
  candidateCount: number;
  /** Summed per-domain tier weights (PR-3's base score, before its recency bonus). */
  baseScore: number;
  domainWeights: Map<string, number>;
  /**
   * The newest edition any statement of this value belongs to
   * (round 7, measure S-1), when at least one statement's edition
   * could be read.
   */
  editionSortKey?: number;
}

function groupStatsOf(
  candidates: readonly RecoveryCandidateValue[],
): Map<string, GroupStats> {
  const stats = new Map<string, GroupStats>();
  for (const candidate of candidates) {
    const key = groupKey(candidate.normalizedValue, candidate.unit);
    let entry = stats.get(key);
    if (!entry) {
      entry = {
        newestMs: Number.NaN,
        domains: new Set(),
        titleOnly: true,
        officialSupport: false,
        sourceIndexes: new Set(),
        candidateCount: 0,
        baseScore: 0,
        domainWeights: new Map(),
      };
      stats.set(key, entry);
    }
    if (candidate.domain) entry.domains.add(candidate.domain);
    if (!candidate.inTitleOnly) entry.titleOnly = false;
    if (
      candidate.editionSortKey !== undefined &&
      (entry.editionSortKey === undefined || candidate.editionSortKey > entry.editionSortKey)
    ) {
      entry.editionSortKey = candidate.editionSortKey;
    }
    if (!candidate.inTitleOnly && hasOfficialTierOrDomain(candidate)) {
      entry.officialSupport = true;
    }
    entry.sourceIndexes.add(candidate.sourceIndex);
    entry.candidateCount += 1;
    const domainKey = candidate.domain || `source-${candidate.sourceIndex}`;
    const weight = RECOVERY_TIER_WEIGHT[candidate.authorityTier];
    const previous = entry.domainWeights.get(domainKey);
    if (previous === undefined || weight > previous) {
      entry.domainWeights.set(domainKey, weight);
    }
    const ms = publicationMsOf(candidate);
    if (Number.isFinite(ms) && (!Number.isFinite(entry.newestMs) || ms > entry.newestMs)) {
      entry.newestMs = ms;
      entry.newestText = publicationTextOf(candidate);
    }
  }
  for (const entry of stats.values()) {
    let score = 0;
    for (const weight of entry.domainWeights.values()) score += weight;
    entry.baseScore = score;
  }
  return stats;
}

/** "2026-09-15" out of an ISO date or timestamp, as written (no timezone shift). */
function isoDatePart(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function japaneseDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

/** Question as it may be echoed in the template: collapsed, bounded, quote-safe. */
function templateTopic(question: string, language: "ja" | "en"): string {
  const topic = question
    .normalize("NFKC")
    .replace(/[\s「」『』"“”]+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[？?。\s]+$/u, "");
  return topic || (language === "en" ? "your question" : "ご質問の件");
}

function domainOfSource(source: RecoveryValueSourceInput): string {
  if (source.domain) return source.domain.toLowerCase().replace(/^www\./, "");
  try {
    return new URL(source.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function buildTemplateText(input: {
  language: "ja" | "en";
  topic: string;
  asOfIso: string;
  value: string;
  domains: readonly string[];
  confirmingSources: readonly RecoveryTemplateConfirmingSource[];
}): string {
  const lines = input.confirmingSources.map((source, index) => {
    const id = `S${index + 1}`;
    const head = input.language === "en"
      ? (source.domain ? `- ${id}: ${source.title} (${source.domain})` : `- ${id}: ${source.title}`)
      : (source.domain ? `- ${id}: ${source.title}（${source.domain}）` : `- ${id}: ${source.title}`);
    const headed = source.annotation ? `${head} ${source.annotation}` : head;
    return source.url ? `${headed}\n  ${source.url}` : headed;
  });
  if (input.language === "en") {
    return `For ${input.topic}, the information published as of ${input.asOfIso} gives ${input.value} (sources: ${input.domains.join(", ")}). Please check the official announcement for the definitive information.\n\n## Sources\n${lines.join("\n")}`;
  }
  return `${input.topic}について、${japaneseDateLabel(input.asOfIso)}の公表情報では${input.value}です（出典：${input.domains.join("、")}）。確定の情報は公式の発表でご確認ください。\n\n## 出典\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// The fallback
// ---------------------------------------------------------------------------

/**
 * Try the template direct answer over the given sources (the kept
 * grounded sources at the router's T3 site, the freshness-dropped
 * candidates at its T4 site, or a ledger source set in replay).
 * Returns a result object in every case — never throws on malformed
 * input — with `fired: false` and a reason code whenever any
 * condition is unmet.
 */
export function tryRecoveryTemplateFallback(
  input: RecoveryTemplateFallbackInput,
): RecoveryTemplateFallbackResult {
  const mode = input.mode ?? resolveRecoveryTemplateFallbackMode(input.env);
  const type = classifyRecoveryAnswerType(input.question);
  const base: RecoveryTemplateFallbackResult = {
    fired: false,
    mode,
    type,
    domains: [],
    confirmingSources: [],
  };
  if (mode === "off") return { ...base, reason: "mode-off" };
  if (!RECOVERY_TEMPLATE_TYPES.has(type)) {
    return { ...base, reason: "type-not-templated" };
  }
  const sources = input.sources ?? input.candidates ?? [];
  const nowMs = input.nowMs ?? Date.now();
  const language = input.language ?? "ja";

  const candidates = extractRecoveryValues(sources, input.question);
  const vote = voteRecoveryValues(candidates);
  if (!vote) return { ...base, reason: "no-candidates", voteStatus: "none" };

  const stats = groupStatsOf(candidates);
  // Edition discipline (round 7, measure S-1), mirroring PR-3's:
  // the newest edition stated anywhere in the pool sets the bar,
  // and a group stating a strictly older edition is a superseded
  // edition — it is not eligible here either, so it can neither be
  // confirmed through the vote's winner nor win the arbitration.
  // A group stating no edition is of unknown vintage, never
  // disqualified; with no edition read anywhere, nothing changes.
  const poolNewestEditionSortKey = candidates.reduce<number | undefined>(
    (max, candidate) =>
      candidate.editionSortKey !== undefined &&
      (max === undefined || candidate.editionSortKey > max)
        ? candidate.editionSortKey
        : max,
    undefined,
  );
  const isEditionDisqualified = (entry: GroupStats): boolean =>
    poolNewestEditionSortKey !== undefined &&
    entry.editionSortKey !== undefined &&
    entry.editionSortKey < poolNewestEditionSortKey;
  const eligibleKeys = new Set(
    [...stats.entries()]
      .filter(
        ([, entry]) =>
          !entry.titleOnly && entry.domains.size >= 2 && !isEditionDisqualified(entry),
      )
      .map(([key]) => key),
  );

  let winnerKey: string | undefined;
  let resolution: RecoveryTemplateFallbackResult["resolution"];
  if (vote.status === "confirmed") {
    winnerKey = groupKey(vote.normalizedValue, vote.unit);
    resolution = "vote";
  } else if (vote.status === "contested") {
    // Freshness arbitration over the two strongest eligible groups
    // by domain support (base score, then candidate count, then
    // value for determinism): the strictly newest publication point
    // wins; a tie or a dateless pool does not fire (see the module
    // header for the pool cap and why this cannot contradict PR-3's
    // date-conflict guard).
    const pool = [...eligibleKeys]
      .map((key) => ({ key, entry: stats.get(key) }))
      .filter((item): item is { key: string; entry: GroupStats } => Boolean(item.entry))
      .sort(
        (a, b) =>
          b.entry.baseScore - a.entry.baseScore ||
          b.entry.candidateCount - a.entry.candidateCount ||
          (a.key < b.key ? -1 : 1),
      )
      .slice(0, 2);
    // Round 7 (measure S-1): the arbitration compares EDITIONS
    // before publication points — a stale value restated in a
    // newer article must not win on its article's date (defect B
    // of the round-7 diagnosis). A group stating no edition sorts
    // below every editioned group here; between groups whose
    // editions tie (or state none), the strictly newest
    // publication point still decides, exactly as before. A pool
    // member with neither an edition nor a date cannot win.
    let bestEdition = -1;
    let bestMs = Number.NaN;
    let bestKey: string | undefined;
    let tied = false;
    for (const { key, entry } of pool) {
      const edition = entry.editionSortKey ?? -1;
      const ms = entry.newestMs;
      if (edition < 0 && !Number.isFinite(ms)) continue;
      const msKey = Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
      const bestMsKey = Number.isFinite(bestMs) ? bestMs : Number.NEGATIVE_INFINITY;
      if (
        bestKey === undefined ||
        edition > bestEdition ||
        (edition === bestEdition && msKey > bestMsKey)
      ) {
        bestEdition = edition;
        bestMs = ms;
        bestKey = key;
        tied = false;
      } else if (edition === bestEdition && msKey === bestMsKey) {
        tied = true;
      }
    }
    if (bestKey && !tied) {
      winnerKey = bestKey;
      resolution = "freshness-arbitration";
    }
  } else {
    return { ...base, reason: "not-confirmed", voteStatus: vote.status };
  }
  if (!winnerKey || !resolution) {
    return { ...base, reason: "contested-without-freshness-winner", voteStatus: vote.status };
  }

  const winnerStats = stats.get(winnerKey);
  const winnerGroup = vote.groups.find(
    (group) => groupKey(group.normalizedValue, group.unit) === winnerKey,
  );
  if (!winnerStats || !winnerGroup) {
    return { ...base, reason: "not-confirmed", voteStatus: vote.status };
  }

  // §4 official-support guard: for the statistical scalar types,
  // a confirmed (or freshness-arbitrated) winner backed only by
  // unofficial sources must not be stated directly — round 6's
  // F-03/F-15 fatals were exactly this shape. The vote's outcome
  // is untouched; only the template's licence to state it is.
  if (
    RECOVERY_TEMPLATE_OFFICIAL_SUPPORT_TYPES.has(type) &&
    !winnerStats.officialSupport
  ) {
    return { ...base, reason: "no-official-support", voteStatus: vote.status };
  }

  // Freshness window (design): the value's newest publication point
  // must exist and lie within 365 days before now — the template
  // states the value as the latest published one, which an undated
  // or year-old value cannot claim.
  //
  // Round 7 (diagnosis Q3): a winning group can be entirely undated
  // — the deterministic release-page candidate's extract carries no
  // provider date and its value sentence states none — yet still
  // carry a readable edition, which IS the value's vintage. The
  // edition then serves as the date of last resort, at its
  // reference month's start: the same convention the search layer's
  // edition-date fallback already applies to undated official
  // sources (originSearchGrounding). The window checks below run
  // on that effective date unchanged, so an old edition is still
  // refused as stale; only a current edition rescues an undated
  // winner, and the as-of it prints is the edition's month start.
  let winnerMs = winnerStats.newestMs;
  let winnerText = winnerStats.newestText;
  if (!Number.isFinite(winnerMs) && winnerStats.editionSortKey !== undefined) {
    const editionYear = Math.floor(winnerStats.editionSortKey / 100);
    const editionMonth = winnerStats.editionSortKey % 100;
    winnerMs = Date.UTC(editionYear, editionMonth - 1, 1);
    winnerText = `${editionYear}-${String(editionMonth).padStart(2, "0")}-01`;
  }
  if (!Number.isFinite(winnerMs)) {
    return { ...base, reason: "value-undated", voteStatus: vote.status };
  }
  if (winnerMs > nowMs + RECOVERY_TEMPLATE_FUTURE_TOLERANCE_MS) {
    return { ...base, reason: "value-future-dated", voteStatus: vote.status };
  }
  if (nowMs - winnerMs > RECOVERY_TEMPLATE_MAX_VALUE_AGE_MS) {
    return { ...base, reason: "value-stale", voteStatus: vote.status };
  }
  const asOf = isoDatePart(winnerText);
  if (!asOf) return { ...base, reason: "value-undated", voteStatus: vote.status };

  const confirmingSources: RecoveryTemplateConfirmingSource[] = [...winnerStats.sourceIndexes]
    .sort((a, b) => a - b)
    .map((sourceIndex) => sources[sourceIndex])
    .filter((source): source is RecoveryValueSourceInput => Boolean(source))
    .map((source) => {
      const annotation = originSourcePeriodAnnotation(
        {
          title: source.title ?? "",
          revisionTimestamp: source.publishedAt ?? source.revisionTimestamp,
        },
        language,
      );
      return {
        title: source.title ?? "",
        url: source.url ?? "",
        domain: domainOfSource(source),
        ...(annotation ? { annotation } : {}),
      };
    });

  const text = buildTemplateText({
    language,
    topic: templateTopic(input.question, language),
    asOfIso: asOf,
    value: winnerGroup.displayValue,
    domains: winnerGroup.domains,
    confirmingSources,
  });

  return {
    fired: true,
    mode,
    type,
    voteStatus: vote.status,
    resolution,
    text,
    value: winnerGroup.displayValue,
    normalizedValue: winnerGroup.normalizedValue,
    ...(winnerGroup.unit ? { unit: winnerGroup.unit } : {}),
    domains: winnerGroup.domains,
    asOf,
    confirmingSources,
  };
}
