import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import {
  classifyOriginDomainTier,
  type OriginSourceAuthorityTier,
} from "../search/originSearchProviders.js";
import {
  parseOriginOfficialEdition,
  type OriginOfficialEdition,
} from "../search/originOfficialEdition.js";
import {
  buildGroundedResearchEvidencePacket,
  type RecoveryEvidencePacket,
} from "./groundedResearchEvidencePacket.js";

/**
 * Recovery build Stage 1, PR-3: answer-type value extraction and
 * cross-source voting (RECOVERY_BUILD_STAGE1_DESIGN_2026-11-18, PR-3;
 * adoption: EXTERNAL_CONSULT_CHAT100_ADOPTION_2026-11-18 item 3).
 *
 * Round 5's F group failed in a specific way: the sources often DID
 * carry the current value, but nothing in the pipeline ever decided
 * which stated value was the value. F-07 is the canonical case — the
 * answer adopted Worldometers' UN-based estimate (122,256,017) while
 * the Statistics Bureau's October 1 estimate (1億2269万) sat in
 * another source, stated independently by a news report as well.
 *
 * This module makes that decision deterministically, with no model
 * call and no prompt change:
 *  - `classifyRecoveryAnswerType` puts the question into one of 12
 *    answer types;
 *  - `extractRecoveryCandidateValues` pulls typed candidate values
 *    out of the PR-2 evidence packet's sentences (never the raw
 *    excerpt), each candidate carrying its source's domain, authority
 *    tier, publication date and a title-only flag;
 *  - `voteRecoveryValues` groups candidates by normalized value and
 *    scores each group by the summed weights of the INDEPENDENT
 *    domains stating it (official 3 / major-news 2 / specialist 2 /
 *    general 1, per the design — deliberately not ORIGIN_TIER_WEIGHT,
 *    which is the search layer's own scale) plus a +1 recency bonus
 *    for the group holding the newest value date (the date a
 *    candidate's own sentence states, else its source's publication
 *    date). A value is "confirmed" only when at least two
 *    independent domains state it, it is not title-only, and it
 *    out-scores every other eligible group. A tie at the top is
 *    "contested"; a lone value is "single"; and when an eligible
 *    rival holds a strictly newer value date than the score leader,
 *    the vote degrades to "contested" rather than confirming what
 *    may be the stale value (the date-conflict guard, F-03).
 *
 * Guards the round-5 data forced (each is pinned by a test):
 *  - title-only values never confirm (adoption item 3's boundary);
 *  - a count stated as a change (▲53万人, 53万人減) is not a level:
 *    delta candidates are dropped unless the question itself asks
 *    about a change;
 *  - a rate stated inside a forecast frame (予測/予想/見通し/見込/
 *    想定/仮定/シナリオ/展望) with no fact marker in the same
 *    sentence is not a stated fact (F-03's forecast tables quote
 *    1.25% as an assumption; the fact sentences say 引き上げた/決定);
 *  - a price immediately labelled 基準/目標 is a target, not the
 *    current price (F-04's 基準175円);
 *  - in a change construction (1.00%から1.25%へ / 0.75%→1.25%) the
 *    left-hand rate is the PREVIOUS value and is not counted as a
 *    statement of the current one (F-03: counting it is what let
 *    the stale 1.0% out-poll the current 1.25%);
 *  - recency is judged by the value's own date — the date its
 *    sentence states, else the source's publication date — never
 *    by retrieval order (the design's freshness rule);
 *  - team names are normalized over a bounded suffix/prefix table
 *    so ソフトバンク and 福岡ソフトバンクホークス vote together
 *    (F-09).
 *
 * PR-3 stops at producing the confirmed value. Wiring into answers
 * (the template direct answer) is PR-4; the only production touch
 * here is a shadow-mode log hook in the chat router that records the
 * vote — flat scalar fields only, values logged solely for scalar
 * types — and never touches the answer. The confirmed value is NOT a
 * substitute for the publication gate: PR-4's template excludes the
 * gate's fatal classes (ages, office-holders, law names) by design.
 *
 * Round 7 (ANSWER_ROUND7_DIAGNOSIS_2026-11-27, measure S-1) adds
 * the edition discipline the round-6 statistics failures forced.
 * The vote above judged a value's newness by the date of the
 * article restating it, but a periodic statistic's newness is its
 * EDITION — the reference period the release reports （令和8年9月分,
 * 2026年7-9月期）. Old values are restated as history inside new
 * articles, so the stale group held BOTH the newest article date
 * and the most domains and won on the old rules in all three
 * measured questions (unemployment, job-offer ratio, GDP). Each
 * candidate now also carries the edition its statement belongs to
 * — read from its own sentence first, else from its source (title,
 * then the source's own text, the reading PR-2's packet and the
 * reconstruction's measure C already apply to sources) — and a
 * group whose edition is strictly older than the newest edition
 * stated anywhere in the pool is disqualified: it can neither
 * confirm nor arbitrate. A group stating no edition is of unknown
 * vintage and is never disqualified by this rule (an unknown
 * vintage is not a stale one, the same discipline as measure C);
 * a pool stating a single edition behaves exactly as before.
 */

export type RecoveryAnswerType =
  | "rate_percent"
  | "price_money"
  | "count_people"
  | "count_seats"
  | "date"
  | "person_name"
  | "team_name"
  | "version"
  | "law_existence"
  | "procedure"
  | "calculation"
  | "existence"
  | "other";

/**
 * A source as the extraction sees it. Production passes
 * OriginResearchSource; the offline replay ledger passes its
 * { title, domain, body, url } shape. `body` is accepted as the
 * excerpt's alias so both callers share one code path.
 */
export type RecoveryValueSourceInput = Pick<
  OriginResearchSource,
  "title" | "url" | "domain" | "authorityTier" | "revisionTimestamp"
> &
  Partial<Pick<OriginResearchSource, "excerpt">> & {
    body?: string;
    publishedAt?: string;
  };

export interface RecoveryCandidateValue {
  type: RecoveryAnswerType;
  /** The value as written in the source (NFKC-normalized surface). */
  displayValue: string;
  /** Canonical form used for cross-source agreement. */
  normalizedValue: string;
  /** Unit where the type has one ("%", "倍", "円", "人", "議席"). */
  unit?: string;
  /** 0-based index into the sources array the packet was built from. */
  sourceIndex: number;
  domain: string;
  authorityTier: OriginSourceAuthorityTier;
  /** ISO timestamp when the source reports one; absent otherwise. */
  publishedAt?: string;
  /**
   * The value's own date as stated in its sentence (ISO), when the
   * sentence states one. Takes precedence over publishedAt for
   * recency: it is when the VALUE is from, not when the page is from.
   */
  statedDate?: string;
  /**
   * The edition (reference period) this statement of the value
   * belongs to, when one can be read — the candidate's own sentence
   * first, else its source (round 7, measure S-1). The comparable
   * sort key (year * 100 + month) the vote's edition discipline
   * compares; the label is the edition as written, for diagnostics.
   */
  editionSortKey?: number;
  editionLabel?: string;
  /** True when this occurrence is the source's title sentence. */
  inTitleOnly: boolean;
  /** The packet sentence's rule score (PR-2). */
  packetScore: number;
}

export interface RecoveryValueVoteGroup {
  normalizedValue: string;
  displayValue: string;
  unit?: string;
  /** Independent domains stating this value. */
  domains: string[];
  /** Summed domain weights plus the recency bonus when earned. */
  score: number;
  /** Every occurrence of this value is title-only. */
  titleOnly: boolean;
  candidateCount: number;
  /**
   * The newest edition any statement of this value belongs to
   * (round 7, measure S-1), when at least one statement's edition
   * could be read.
   */
  editionSortKey?: number;
  /**
   * True when this group's edition is strictly older than the
   * newest edition stated in the pool: the group is a superseded
   * edition and can neither confirm nor arbitrate (round 7).
   */
  editionDisqualified?: boolean;
}

export interface RecoveryValueVote {
  status: "confirmed" | "contested" | "single";
  type: RecoveryAnswerType;
  /** Display form of the winning value (what PR-4 would print). */
  value: string;
  normalizedValue: string;
  unit?: string;
  /** Independent domains backing the winning value. */
  domains: string[];
  score: number;
  /** Every group considered, best first (shadow diagnostics). */
  groups: RecoveryValueVoteGroup[];
}

// ---------------------------------------------------------------------------
// Answer-type classification
// ---------------------------------------------------------------------------

/**
 * Classify the question into one of the design's 12 answer types.
 * Order is load-bearing: the most specific value signal wins (a
 * question about the policy RATE that also asks when it was decided
 * is a rate question first — F-03), and a bare 何年 (a duration) is
 * not a date question (E-02's limitation period).
 */
export function classifyRecoveryAnswerType(question: string): RecoveryAnswerType {
  const q = question.normalize("NFKC");
  if (/[×✕÷]/.test(q) || /計算(して|する|し)/.test(q)) return "calculation";
  if (
    /(法律|法案)/.test(q) &&
    /(ありますか|あるの|実在|存在|制定され|本当に)/.test(q)
  ) {
    return "law_existence";
  }
  if (/[一-龠]{1,8}法(という|は|が)/.test(q) && /(ありますか|実在|存在)/.test(q)) {
    return "law_existence";
  }
  if (/どうすれば|どうやったら|手順|手続き|やり方|方法を(教えて|知りたい)|申し込|申請(方法|手続)/.test(q)) {
    return "procedure";
  }
  if (/バージョン|最新版|version/i.test(q)) return "version";
  if (/価格|値段|いくら|料金/.test(q)) return "price_money";
  if (/率|倍率|金利|パーセント|％|%/.test(q)) return "rate_percent";
  if (/議席|定数/.test(q)) return "count_seats";
  if (/人口|人数|何人/.test(q)) return "count_people";
  if (/優勝校|優勝チーム|優勝(した|は|チーム|校)/.test(q)) return "team_name";
  if (/誰|氏名|総理大臣|知事|大統領|首相/.test(q)) return "person_name";
  if (/いつ|何年何月|何月何日|何日に|日付/.test(q)) return "date";
  if (/ありますか|存在しますか|実在しますか/.test(q)) return "existence";
  return "other";
}

// ---------------------------------------------------------------------------
// Surface helpers
// ---------------------------------------------------------------------------

/** NFKC plus the minus-sign variants folded to "-". */
function normalizeSurface(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[−‐]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical numeric string: "170.0" and "170" agree; "-0.0" is "0". */
function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

const JP_UNIT_MULTIPLIER: Readonly<Record<string, number>> = {
  "億": 100_000_000,
  "万": 10_000,
  "千": 1_000,
};

/**
 * A Japanese number expression: one or more digit runs closed by a
 * magnitude unit (億/万/千), optionally followed by one bare digit
 * run — "1億2269万", "1億2281万2千", "53万", "122,256,017". Each
 * segment is digits-then-one-unit, so the pattern cannot backtrack
 * over a digit run the way a free (unit|digits)* alternation would.
 */
const JP_NUMBER_EXPRESSION =
  /(?:\d[\d,]*(?:\.\d+)?\s*[億万千]\s*)+(?:\d[\d,]*(?:\.\d+)?)?|\d[\d,]*(?:\.\d+)?/g;

interface JpNumberMatch {
  text: string;
  value: number;
  start: number;
  end: number;
}

function parseJpNumberExpression(expression: string): number {
  let total = 0;
  for (const segment of expression.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([億万千])?/g)) {
    const digits = Number(segment[1].replace(/,/g, ""));
    if (!Number.isFinite(digits)) continue;
    total += digits * (segment[2] ? JP_UNIT_MULTIPLIER[segment[2]] : 1);
  }
  return total;
}

function findJpNumbers(sentence: string): JpNumberMatch[] {
  const matches: JpNumberMatch[] = [];
  for (const match of sentence.matchAll(JP_NUMBER_EXPRESSION)) {
    const text = match[0];
    if (!text || !/\d/.test(text)) continue;
    matches.push({
      text,
      value: parseJpNumberExpression(text),
      start: match.index,
      end: match.index + text.length,
    });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Per-type extractors (operate on one normalized packet sentence)
// ---------------------------------------------------------------------------

const FORECAST_MARKERS = /予測|予想|見通し|見込|想定|仮定|シナリオ|展望/;
const FACT_MARKERS = /決定|公表|速報|結果|引き上げた|引き下げた|となった|でした|成立/;

/** A rate stated as a forecast/assumption, with no fact marker, is not a fact. */
function isForecastOnly(sentence: string): boolean {
  return FORECAST_MARKERS.test(sentence) && !FACT_MARKERS.test(sentence);
}

interface RawCandidate {
  displayValue: string;
  normalizedValue: string;
  unit?: string;
}

/**
 * The latest full date a sentence states (YYYY年M月D日 or YYYY年M月）.
 * The design's freshness rule is that a value's newness is judged by
 * the value's own date, not the source's: a September article and a
 * June article both "state" 1.0%, but only the September-dated
 * sentence states it as September's value.
 */
function latestStatedDate(sentence: string): string | undefined {
  let best: string | undefined;
  for (const match of sentence.matchAll(/(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?/g)) {
    const iso = `${match[1]}-${match[2].padStart(2, "0")}-${(match[3] ?? "1").padStart(2, "0")}`;
    if (!best || iso > best) best = iso;
  }
  for (const match of sentence.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    if (!best || iso > best) best = iso;
  }
  return best;
}

/**
 * The newest edition a text states, read chunk by chunk (round 7,
 * measure S-1): parseOriginOfficialEdition reads ONE edition per
 * text (its first formal label), so a whole excerpt — which may
 * name several editions — is read sentence by sentence and the
 * newest reading wins. Used for the source-level edition of a
 * candidate whose own sentence states none: a release page's
 * heading names the edition while its value sentence states the
 * bare figure (the deterministic release-page candidate of round 6
 * carries its edition only there).
 */
function newestEditionInText(text: string): OriginOfficialEdition | null {
  let best: OriginOfficialEdition | null = null;
  for (const chunk of text.split(/[。！？!?\n]+/)) {
    const edition = parseOriginOfficialEdition(chunk);
    if (edition && (!best || edition.sortKey > best.sortKey)) best = edition;
  }
  return best;
}

function extractRateCandidates(sentence: string): RawCandidate[] {
  if (isForecastOnly(sentence)) return [];
  const matches = [...sentence.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(%|パーセント|倍)/g)];
  const out: RawCandidate[] = [];
  matches.forEach((match, index) => {
    // In a change construction (1.00%から1.25%へ / 0.75%→1.25%) the
    // value on the left is the PREVIOUS value, stated as history —
    // counting it as a statement of the current rate is what made
    // round 5's stale 1.0% out-poll the current 1.25% (F-03). It is
    // excluded whenever a successor value follows in the sentence.
    if (index < matches.length - 1) {
      const after = sentence.slice(
        (match.index ?? 0) + match[0].length,
        (match.index ?? 0) + match[0].length + 2,
      );
      if (/^\s*(から|→)/.test(after)) return;
    }
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) return;
    const unit = match[2] === "パーセント" ? "%" : match[2];
    out.push({
      displayValue: `${match[1]}${match[2]}`,
      normalizedValue: canonicalNumber(value),
      unit,
    });
  });
  return out;
}

/** Offset of `unit` in the few characters after a number, when only whitespace intervenes; -1 otherwise. */
function unitOffsetAfter(sentence: string, end: number, unit: string): number {
  const tail = sentence.slice(end, end + 6);
  const offset = tail.indexOf(unit);
  if (offset < 0 || !/^\s*$/.test(tail.slice(0, offset))) return -1;
  return offset;
}

function extractPriceCandidates(sentence: string): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const num of findJpNumbers(sentence)) {
    if (unitOffsetAfter(sentence, num.end, "円") < 0) continue;
    // A price immediately labelled 基準/目標 is a target, not the
    // current price (F-04: "12月に基準175円へ").
    const before = sentence.slice(Math.max(0, num.start - 3), num.start);
    if (/(基準|目標)$/.test(before.trimEnd())) continue;
    out.push({
      displayValue: `${num.text}円`,
      normalizedValue: canonicalNumber(num.value),
      unit: "円",
    });
  }
  return out;
}

const QUESTION_ASKS_CHANGE = /増減|変化|増えた|減った|増加|減少/;
function extractCountCandidates(
  sentence: string,
  question: string,
  unit: "人" | "議席",
): RawCandidate[] {
  const asksChange = QUESTION_ASKS_CHANGE.test(question);
  const out: RawCandidate[] = [];
  for (const num of findJpNumbers(sentence)) {
    const offset = unitOffsetAfter(sentence, num.end, unit);
    if (offset < 0) continue;
    if (!asksChange) {
      // A count stated as a change (▲53万人 / 53万人減 / 53万人
      // （0.43％）減少) is a delta, not the level the question asks
      // for (F-07). The change marker may sit a few characters past
      // the unit, behind a parenthesized rate; only filler characters
      // (brackets, digits, %, punctuation) may intervene.
      const before = sentence.slice(Math.max(0, num.start - 2), num.start);
      const unitEnd = num.end + offset + unit.length;
      const afterUnit = sentence.slice(unitEnd, unitEnd + 14);
      if (
        /[▲△]/.test(before) ||
        /^[\s（(．.%％\d、，,）)]{0,12}(増加|減少|増|減)/.test(afterUnit)
      ) {
        continue;
      }
    }
    out.push({
      displayValue: `${num.text}${unit}`,
      normalizedValue: canonicalNumber(num.value),
      unit,
    });
  }
  return out;
}

function extractDateCandidates(sentence: string): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const match of sentence.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
    const iso = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    out.push({ displayValue: match[0], normalizedValue: iso });
  }
  for (const match of sentence.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    out.push({ displayValue: match[0], normalizedValue: `${match[1]}-${match[2]}-${match[3]}` });
  }
  return out;
}

function extractVersionCandidates(sentence: string): RawCandidate[] {
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  const push = (token: string) => {
    if (seen.has(token)) return;
    seen.add(token);
    out.push({ displayValue: token, normalizedValue: token });
  };
  for (const match of sentence.matchAll(/\b(\d{2}H[12])\b/g)) push(match[1]);
  for (const match of sentence.matchAll(/(?:バージョン|version)\s*[:：]?\s*v?(\d+(?:\.\d+){1,3})/gi)) {
    push(match[1]);
  }
  for (const match of sentence.matchAll(/\bv(\d+\.\d+(?:\.\d+)?)\b/g)) push(match[1]);
  return out;
}

const ROLE_WORDS = "内閣総理大臣|総理大臣|首相|知事|大統領|市長";
/** Kanji compounds that sit next to role words but are events/offices, not people. */
const PERSON_NON_NAMES = new Set([
  "記者会見", "首相官邸", "官邸", "内閣", "会見", "一覧", "公式", "発表", "就任", "指名",
]);
function extractPersonCandidates(sentence: string): RawCandidate[] {
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const name = raw.replace(/\s+/g, "");
    if (name.length < 2 || name.length > 5) return;
    if (new RegExp(ROLE_WORDS).test(name)) return;
    if (PERSON_NON_NAMES.has(name) || name.endsWith("会見") || name.includes("記者")) return;
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ displayValue: name, normalizedValue: name });
  };
  for (const match of sentence.matchAll(
    new RegExp(`(?:${ROLE_WORDS})\\s*(?:は|の|に)?\\s*([一-龠]{2,4}(?:\\s[一-龠]{1,4})?)`, "g"),
  )) {
    push(match[1]);
  }
  for (const match of sentence.matchAll(
    new RegExp(`([一-龠]{2,4}(?:\\s[一-龠]{1,4})?)\\s*(?:${ROLE_WORDS})(?:は|が|の)`, "g"),
  )) {
    push(match[1]);
  }
  return out;
}

const TEAM_GENERIC_KATAKANA = new Set(["シリーズ", "プロ野球", "チャンピオン"]);
/**
 * Bounded normalization for Japanese pro-baseball team names: the
 * same club is stated as ソフトバンク (short) and ソフトバンク
 * ホークス / 福岡ソフトバンクホークス (full), and the two forms
 * must land in one vote group (round 5, F-09). A trailing nickname
 * suffix and a leading home-city prefix are stripped when a core of
 * at least 2 characters remains; the display form keeps the
 * strongest occurrence's surface.
 */
const TEAM_NAME_SUFFIXES = [
  "ホークス", "イーグルス", "ライオンズ", "ファイターズ", "バファローズ",
  "マリーンズ", "スワローズ", "ジャイアンツ", "タイガース", "ドラゴンズ",
];
const TEAM_NAME_PREFIXES = [
  "福岡", "北海道", "東北", "横浜", "広島", "千葉", "埼玉", "大阪", "神戸", "仙台", "名古屋", "東京",
];
function normalizeTeamName(name: string): string {
  let core = name;
  for (const suffix of TEAM_NAME_SUFFIXES) {
    if (core.endsWith(suffix) && core.length - suffix.length >= 2) {
      core = core.slice(0, core.length - suffix.length);
      break;
    }
  }
  for (const prefix of TEAM_NAME_PREFIXES) {
    if (core.startsWith(prefix) && core.length - prefix.length >= 3) {
      core = core.slice(prefix.length);
      break;
    }
  }
  return core;
}
function extractTeamCandidates(sentence: string, question: string): RawCandidate[] {
  if (!/優勝|日本一|制覇/.test(sentence)) return [];
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const normalized = normalizeTeamName(name);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ displayValue: name, normalizedValue: normalized });
  };
  // Katakana team names stated as the subject of the win
  // (ソフトバンクが4連勝で…日本一): the run must be followed by a
  // particle, which keeps generic words like シリーズ2026 out.
  for (const match of sentence.matchAll(/([ァ-ヶー]{3,})\s*(?=[がはをにのと])/g)) {
    const name = match[1];
    if (TEAM_GENERIC_KATAKANA.has(name)) continue;
    push(name);
  }
  // University winners (箱根駅伝 shape): only when the question is
  // about a winning school.
  if (/優勝校|大学/.test(question)) {
    for (const match of sentence.matchAll(/([一-龠]{2,6}(?:大学|学院))\s*(?=[がはをにのと])/g)) {
      push(match[1]);
    }
  }
  return out;
}

function extractRawCandidates(
  type: RecoveryAnswerType,
  sentence: string,
  question: string,
): RawCandidate[] {
  switch (type) {
    case "rate_percent":
      return extractRateCandidates(sentence);
    case "price_money":
      return extractPriceCandidates(sentence);
    case "count_people":
      return extractCountCandidates(sentence, question, "人");
    case "count_seats":
      return extractCountCandidates(sentence, question, "議席");
    case "date":
      return extractDateCandidates(sentence);
    case "version":
      return extractVersionCandidates(sentence);
    case "person_name":
      return extractPersonCandidates(sentence);
    case "team_name":
      return extractTeamCandidates(sentence, question);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Source metadata
// ---------------------------------------------------------------------------

interface SourceMeta {
  domain: string;
  authorityTier: OriginSourceAuthorityTier;
  publishedAt?: string;
}

function domainOfSource(source: RecoveryValueSourceInput): string {
  if (source.domain) return source.domain.toLowerCase().replace(/^www\./, "");
  try {
    return new URL(source.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function metaOfSource(source: RecoveryValueSourceInput): SourceMeta {
  const domain = domainOfSource(source);
  return {
    domain,
    authorityTier: source.authorityTier ?? classifyOriginDomainTier(domain),
    publishedAt: source.publishedAt ?? source.revisionTimestamp,
  };
}

// ---------------------------------------------------------------------------
// Extraction over the packet
// ---------------------------------------------------------------------------

/**
 * Extract typed candidate values from the evidence packet's
 * sentences. Each packet sentence is matched against the type's
 * patterns on an NFKC-normalized copy (full-width digits and the
 * full-width percent sign fold to their half-width forms, so
 * １億2269万 and 1億2269万 are the same value); the candidate keeps
 * the source metadata of the sentence's source.
 */
export function extractRecoveryCandidateValues(
  question: string,
  packet: RecoveryEvidencePacket,
  sources?: readonly RecoveryValueSourceInput[],
): RecoveryCandidateValue[] {
  const type = classifyRecoveryAnswerType(question);
  if (
    type === "law_existence" ||
    type === "procedure" ||
    type === "calculation" ||
    type === "existence" ||
    type === "other"
  ) {
    return [];
  }
  const metas = (sources ?? []).map(metaOfSource);
  // Round 7 (measure S-1): the edition each source belongs to —
  // its title's edition, else the newest edition its own text
  // states. When the caller passes no sources, the packet's own
  // sentences are the only text available and are read the same
  // way (title sentences included). A candidate whose sentence
  // states an edition binds to THAT edition (an article titled
  // with September's release can still state August's value as
  // history, in a sentence that names August); only a sentence
  // stating none falls back to its source's edition.
  const sourceEditions = new Map<number, OriginOfficialEdition>();
  if (sources) {
    sources.forEach((source, index) => {
      const edition =
        parseOriginOfficialEdition(source.title ?? "") ??
        newestEditionInText(source.excerpt ?? source.body ?? "");
      if (edition) sourceEditions.set(index, edition);
    });
  } else {
    for (const sentence of packet.sentences) {
      const edition = parseOriginOfficialEdition(sentence.text);
      if (!edition) continue;
      const previous = sourceEditions.get(sentence.sourceIndex);
      if (!previous || edition.sortKey > previous.sortKey) {
        sourceEditions.set(sentence.sourceIndex, edition);
      }
    }
  }
  const candidates: RecoveryCandidateValue[] = [];
  for (const sentence of packet.sentences) {
    const meta = metas[sentence.sourceIndex];
    const normalizedSentence = normalizeSurface(sentence.text);
    const statedDate = latestStatedDate(normalizedSentence);
    const edition =
      parseOriginOfficialEdition(normalizedSentence) ??
      sourceEditions.get(sentence.sourceIndex);
    for (const raw of extractRawCandidates(type, normalizedSentence, question)) {
      candidates.push({
        type,
        displayValue: raw.displayValue,
        normalizedValue: raw.normalizedValue,
        ...(raw.unit ? { unit: raw.unit } : {}),
        sourceIndex: sentence.sourceIndex,
        domain: meta?.domain ?? "",
        authorityTier: meta?.authorityTier ?? "general",
        ...(meta?.publishedAt ? { publishedAt: meta.publishedAt } : {}),
        ...(statedDate ? { statedDate } : {}),
        ...(edition
          ? { editionSortKey: edition.sortKey, editionLabel: edition.label }
          : {}),
        inTitleOnly: sentence.origin === "title",
        packetScore: sentence.score,
      });
    }
  }
  return candidates;
}

/** Design weights (PR-3): official 3 / major-news 2 / specialist 2 / general 1. */
export const RECOVERY_TIER_WEIGHT: Readonly<Record<OriginSourceAuthorityTier, number>> = {
  official: 3,
  "major-news": 2,
  specialist: 2,
  general: 1,
};

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

/**
 * Vote over candidate values. Candidates are self-describing (each
 * carries its domain and tier), so the optional `sources` argument —
 * accepted for the replay harness's (extractions, sources) call
 * shape — is not needed and is ignored.
 *
 * A group is eligible to confirm when at least two independent
 * domains state the value and not every occurrence is title-only.
 * Exactly one eligible group confirms; two or more eligible groups
 * confirm only when the best out-scores the runner-up, otherwise
 * the vote is "contested". With no eligible group the best group is
 * reported as "single" so shadow diagnostics can see how close it
 * came. Returns null when there are no candidates at all.
 *
 * Round 7 (measure S-1): a group whose stated edition is strictly
 * older than the newest edition stated anywhere in the pool is
 * disqualified before any of the above — it is not eligible, and
 * the "single" fallback never reports it as the leading value.
 */
export function voteRecoveryValues(
  candidates: readonly RecoveryCandidateValue[],
  _sources?: readonly RecoveryValueSourceInput[],
): RecoveryValueVote | null {
  void _sources;
  if (candidates.length === 0) return null;
  const type = candidates[0].type;

  // Recency bonus: the group holding the globally newest value date
  // earns +1 (design: 最新日＋1). A candidate's value date is its
  // sentence's stated date when present, else the source's
  // publication date. Ledger sources carry no publication dates, so
  // there the bonus rides on stated dates alone.
  const recencyMsOf = (candidate: RecoveryCandidateValue): number => {
    const raw = candidate.statedDate ?? candidate.publishedAt;
    if (!raw) return Number.NaN;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : Number.NaN;
  };
  let newestRecencyMs = Number.NaN;
  for (const candidate of candidates) {
    const ms = recencyMsOf(candidate);
    if (Number.isFinite(ms) && (!Number.isFinite(newestRecencyMs) || ms > newestRecencyMs)) {
      newestRecencyMs = ms;
    }
  }

  interface MutableGroup extends RecoveryValueVoteGroup {
    domainWeights: Map<string, number>;
    /** Strength of the occurrence the display form came from. */
    bestStrength: readonly [number, number, number];
    /** Newest value date among the group's candidates (NaN when undated). */
    newestRecencyMs: number;
    /** Newest edition among the group's candidates (undefined when unread). */
    editionSortKey: number | undefined;
  }
  const groupsByKey = new Map<string, MutableGroup>();
  for (const candidate of candidates) {
    const key = `${candidate.normalizedValue}||${candidate.unit ?? ""}`;
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        normalizedValue: candidate.normalizedValue,
        displayValue: candidate.displayValue,
        ...(candidate.unit ? { unit: candidate.unit } : {}),
        domains: [],
        score: 0,
        titleOnly: true,
        candidateCount: 0,
        domainWeights: new Map(),
        bestStrength: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
        newestRecencyMs: Number.NaN,
        editionSortKey: undefined,
      };
      groupsByKey.set(key, group);
    }
    group.candidateCount += 1;
    if (
      candidate.editionSortKey !== undefined &&
      (group.editionSortKey === undefined || candidate.editionSortKey > group.editionSortKey)
    ) {
      group.editionSortKey = candidate.editionSortKey;
    }
    const candidateRecencyMs = recencyMsOf(candidate);
    if (
      Number.isFinite(candidateRecencyMs) &&
      (!Number.isFinite(group.newestRecencyMs) || candidateRecencyMs > group.newestRecencyMs)
    ) {
      group.newestRecencyMs = candidateRecencyMs;
    }
    if (!candidate.inTitleOnly) group.titleOnly = false;
    const weight = RECOVERY_TIER_WEIGHT[candidate.authorityTier];
    const domainKey = candidate.domain || `source-${candidate.sourceIndex}`;
    const previous = group.domainWeights.get(domainKey);
    if (previous === undefined || weight > previous) {
      group.domainWeights.set(domainKey, weight);
    }
    // The group's display form comes from its strongest occurrence:
    // highest tier weight, then newest value date, then best packet
    // score (an undated occurrence sorts as -Infinity).
    const recencyMs = recencyMsOf(candidate);
    const strength: readonly [number, number, number] = [
      weight,
      Number.isFinite(recencyMs) ? recencyMs : Number.NEGATIVE_INFINITY,
      candidate.packetScore,
    ];
    const [bestWeight, bestPublished, bestScore] = group.bestStrength;
    if (
      strength[0] > bestWeight ||
      (strength[0] === bestWeight && strength[1] > bestPublished) ||
      (strength[0] === bestWeight && strength[1] === bestPublished && strength[2] > bestScore)
    ) {
      group.displayValue = candidate.displayValue;
      group.bestStrength = strength;
    }
  }

  const finalized: Array<{ newestRecencyMs: number; group: RecoveryValueVoteGroup }> =
    [...groupsByKey.values()].map((group) => {
    let score = 0;
    for (const weight of group.domainWeights.values()) score += weight;
    return {
      newestRecencyMs: group.newestRecencyMs,
      group: {
        normalizedValue: group.normalizedValue,
        displayValue: group.displayValue,
        ...(group.unit ? { unit: group.unit } : {}),
        domains: [...group.domainWeights.keys()].filter((d) => !d.startsWith("source-")),
        score,
        titleOnly: group.titleOnly,
        candidateCount: group.candidateCount,
        ...(group.editionSortKey !== undefined
          ? { editionSortKey: group.editionSortKey }
          : {}),
      } satisfies RecoveryValueVoteGroup,
    };
  });
  const groups: RecoveryValueVoteGroup[] = finalized.map((entry) => entry.group);
  // Recency bonus, applied on the finalized groups: a group earns +1
  // when one of its candidates carries the newest value date.
  if (Number.isFinite(newestRecencyMs)) {
    const newestKeys = new Set(
      candidates
        .filter((c) => recencyMsOf(c) === newestRecencyMs)
        .map((c) => `${c.normalizedValue}||${c.unit ?? ""}`),
    );
    for (const group of groups) {
      if (newestKeys.has(`${group.normalizedValue}||${group.unit ?? ""}`)) group.score += 1;
    }
  }
  // Edition discipline (round 7, measure S-1): the newest edition
  // stated anywhere in the pool sets the bar. A group whose own
  // edition is strictly older is a superseded edition — however
  // many domains restate it, and however new the articles restating
  // it are — and is disqualified from confirming or arbitrating.
  // The bar is pool-wide, not eligibility-wide: in the B1 shape the
  // current value's group is itself ineligible (a single domain),
  // yet its edition is what proves the eligible stale group old.
  // A group stating no edition is of unknown vintage and is never
  // disqualified (measure C's discipline); with no edition read
  // anywhere, nothing here changes.
  const poolNewestEditionSortKey = groups.reduce<number | undefined>(
    (max, group) =>
      group.editionSortKey !== undefined &&
      (max === undefined || group.editionSortKey > max)
        ? group.editionSortKey
        : max,
    undefined,
  );
  const isEditionDisqualified = (group: RecoveryValueVoteGroup): boolean =>
    poolNewestEditionSortKey !== undefined &&
    group.editionSortKey !== undefined &&
    group.editionSortKey < poolNewestEditionSortKey;
  for (const group of groups) {
    if (isEditionDisqualified(group)) group.editionDisqualified = true;
  }
  const eligible = groups.filter(
    (group) => !group.titleOnly && group.domains.length >= 2 && !group.editionDisqualified,
  );
  const ranked = [...groups].sort(
    (a, b) => b.score - a.score || b.candidateCount - a.candidateCount,
  );
  // The "single" fallback winner is picked from the groups that
  // survive the edition discipline: reporting a disqualified stale
  // group as the leading value would hand PR-4's diagnostics (and
  // any future consumer) the superseded figure as the pool's best.
  // The returned `groups` list keeps every group, disqualified
  // ones flagged, exactly as before.
  const rankedLivePool = ranked.filter((group) => !group.editionDisqualified);
  const rankedLive = rankedLivePool.length > 0 ? rankedLivePool : ranked;
  const rankedEligible = [...eligible].sort(
    (a, b) => b.score - a.score || b.candidateCount - a.candidateCount,
  );

  // Date-conflict guard: when an eligible rival holds a strictly
  // newer value date than the score leader, the leader may be the
  // STALE value kept alive by older articles (round 5's F-03: five
  // domains mention June's 1.0%, three state September's 1.25%).
  // Confirming the stale side is the one outcome worse than no
  // confirmation, so the vote degrades to contested and PR-4's
  // freshness rules arbitrate with full publication dates.
  const eligibleFinalized = finalized.filter(
    (entry) =>
      !entry.group.titleOnly &&
      entry.group.domains.length >= 2 &&
      !entry.group.editionDisqualified,
  );
  const newestEligibleMs = eligibleFinalized.reduce(
    (max, entry) =>
      Number.isFinite(entry.newestRecencyMs) && entry.newestRecencyMs > max
        ? entry.newestRecencyMs
        : max,
    Number.NEGATIVE_INFINITY,
  );
  const topFinalized = eligibleFinalized.find((entry) => entry.group === rankedEligible[0]);
  const dateConflict =
    rankedEligible.length >= 2 &&
    Number.isFinite(newestEligibleMs) &&
    (!Number.isFinite(topFinalized?.newestRecencyMs) ||
      (topFinalized?.newestRecencyMs ?? 0) < newestEligibleMs);

  let status: RecoveryValueVote["status"];
  let winner: RecoveryValueVoteGroup;
  if (rankedEligible.length === 1) {
    status = "confirmed";
    winner = rankedEligible[0];
  } else if (rankedEligible.length >= 2) {
    if (!dateConflict && rankedEligible[0].score > rankedEligible[1].score) {
      status = "confirmed";
      winner = rankedEligible[0];
    } else {
      status = "contested";
      winner = rankedEligible[0];
    }
  } else {
    status = "single";
    winner = rankedLive[0];
  }

  return {
    status,
    type,
    value: winner.displayValue,
    normalizedValue: winner.normalizedValue,
    ...(winner.unit ? { unit: winner.unit } : {}),
    domains: winner.domains,
    score: winner.score,
    groups: ranked,
  };
}

// ---------------------------------------------------------------------------
// Combined entry points (packet built internally)
// ---------------------------------------------------------------------------

function toPacketSources(
  sources: readonly RecoveryValueSourceInput[],
): Array<{ title: string; excerpt: string }> {
  return sources.map((source) => ({
    title: source.title ?? "",
    excerpt: source.excerpt ?? source.body ?? "",
  }));
}

/**
 * Extract candidates straight from sources (the packet is built
 * inside). The packet is built PER SOURCE and merged, not once
 * globally: the packet's global top-8 lets one verbose source crowd
 * out another source's answer-bearing line entirely (round 5, F-07:
 * the Statistics Bureau's headline line ranked below Worldometers'
 * boilerplate and methodology lines, so the official value never
 * reached the vote). Cross-source voting presupposes that every
 * source's strongest sentences are visible; a per-source packet is
 * what guarantees that, at the same per-source cap PR-2 set.
 */
export function extractRecoveryValues(
  sources: readonly RecoveryValueSourceInput[],
  question: string,
): RecoveryCandidateValue[] {
  const packetSources = toPacketSources(sources);
  const candidates: RecoveryCandidateValue[] = [];
  sources.forEach((source, sourceIndex) => {
    const packet = buildGroundedResearchEvidencePacket(
      [packetSources[sourceIndex]],
      question,
    );
    // The single-source packet numbers its source 0; remap to the
    // caller's index so candidates keep pointing at their source.
    const remapped: RecoveryEvidencePacket = {
      sentences: packet.sentences.map((sentence) => ({ ...sentence, sourceIndex })),
    };
    candidates.push(...extractRecoveryCandidateValues(question, remapped, sources));
  });
  return candidates;
}

/** Extract and vote in one call (the replay harness's combined shape). */
export function extractAndVoteRecoveryValues(
  sources: readonly RecoveryValueSourceInput[],
  question: string,
): RecoveryValueVote | null {
  return voteRecoveryValues(extractRecoveryValues(sources, question));
}

// ---------------------------------------------------------------------------
// Shadow-mode wiring (the only production touch in PR-3)
// ---------------------------------------------------------------------------

export type RecoveryValueVoteMode = "off" | "shadow";

/**
 * Selected by ORIGIN_RECOVERY_VALUE_VOTE_MODE. Only the exact value
 * "shadow" enables the shadow hook; everything else — including an
 * unset variable — is off, so production behavior is unchanged
 * until the mode is deliberately registered (Stage 1 common rule:
 * switches default OFF / shadow).
 */
export function resolveRecoveryValueVoteMode(
  env: NodeJS.ProcessEnv | undefined,
): RecoveryValueVoteMode {
  return env?.ORIGIN_RECOVERY_VALUE_VOTE_MODE === "shadow" ? "shadow" : "off";
}

/** Types whose confirmed value is a pure scalar, safe to log as a number/code. */
const SCALAR_VOTE_TYPES: ReadonlySet<RecoveryAnswerType> = new Set([
  "rate_percent",
  "price_money",
  "count_people",
  "count_seats",
  "date",
  "version",
]);

/**
 * Shadow-mode hook for the grounded-research path, mirroring
 * logOriginPublicationGateShadow: run extraction + voting, log flat
 * scalar fields only, never throw and never touch the answer. The
 * confirmed value itself is logged only for scalar types (a number,
 * a date, a version token — the same "numbers and codes" discipline
 * as the other diagnostics); person/team names are recorded as
 * status and counts only.
 */
export function logRecoveryValueVoteShadow(input: {
  requestId: string;
  question: string;
  sources: readonly RecoveryValueSourceInput[];
  logger?: (message: string, fields: Record<string, unknown>) => void;
}): RecoveryValueVote | null {
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const type = classifyRecoveryAnswerType(input.question);
    const candidates = extractRecoveryValues(input.sources, input.question);
    const vote = voteRecoveryValues(candidates);
    logger("[origin-chat] recovery value vote (shadow)", {
      requestId: input.requestId,
      recoveryVoteType: type,
      recoveryVoteStatus: vote?.status ?? "none",
      recoveryCandidateCount: candidates.length,
      recoveryVoteDomainCount: vote?.domains.length ?? 0,
      recoveryVoteScore: vote?.score ?? 0,
      ...(vote && SCALAR_VOTE_TYPES.has(vote.type)
        ? { recoveryVoteValue: vote.normalizedValue.slice(0, 40) }
        : {}),
    });
    return vote;
  } catch (error) {
    logger("[origin-chat] recovery value vote (shadow) failed", {
      requestId: input.requestId,
      recoveryVoteError: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
