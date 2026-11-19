import {
  buildGroundedResearchAbstainAnswer,
  researchLandingForAbstain,
  type OriginResearchLanding,
} from "../../research/groundedResearchOutcome.js";
import { JAPANESE_LAW_NAMES } from "./japaneseLawNames.js";

/**
 * Direct-answer publication gate — stage 1, shadow mode only
 * (EXTERNAL_CONSULT_STALE_ADOPTION_2026-11-17, adoptions 1 and 2).
 *
 * The grounded-research path verifies every claim against retrieved
 * sources before publication, but the direct-answer path historically
 * published the model's parametric memory unguarded. The fatal cases
 * of the 2026-11-17 fixed-100 measurements all came from that gap:
 * D-15 (a stale statutory capacity asserted as current), C-01 (a stale
 * age condition for the 10-year passport), and I-04 (a wholly
 * fabricated statute, complete with an invented enforcement date).
 *
 * This module is the deterministic detector for the output-side gate:
 * it scans a finished direct answer for claim shapes that require
 * external evidence (statute names and enforcement dates, statutory
 * capacities, age conditions, amounts/fees, position/status holders)
 * and checks every statute-name candidate against the bundled e-Gov
 * list of current Japanese statutes (see japaneseLawNames.ts). A
 * candidate the strict check cannot confirm gets one extended match
 * (PR-G2): if the full official name — which may contain hiragana the
 * candidate pattern cannot span — is written out contiguously in the
 * text ending at the candidate, the candidate counts as verified. The
 * extension only ever resolves the Q-12 fragmentation over-defence; it
 * creates no candidates and never makes a verified name unverified.
 *
 * Shadow-mode contract (this stage):
 * - The detector NEVER alters the answer. Callers log the summary and
 *   deliver the text exactly as produced.
 * - Logs carry claim kinds and counts only — never answer text, never
 *   the matched surface, never user input. Hit spans (index/length)
 *   exist for tests and fixture measurement, not for logging.
 * - A statute name missing from the list is recorded as "unverified",
 *   never as "nonexistent": the list covers 憲法・法律 only, and a
 *   name can also be a cabinet/ministerial instrument checked by its
 *   base statute, an alias the table does not know yet, or a genuinely
 *   fabricated name. Deciding between those is the enforcement stage's
 *   job, informed by the false-positive rates measured here.
 * - Detection is pure, synchronous, allocation-bounded regex work: no
 *   model call, no I/O, no cost. Callers still wrap it so a detector
 *   failure skips detection and never delays or breaks the answer.
 *
 * Stage 2 (N-5b, N2_N5_IMPLEMENTATION_DESIGN_2026-11-17 §2.7 use A):
 * `applyOriginPublicationGate` connects the summary to the N-1 ladder
 * when ORIGIN_PUBLICATION_GATE_MODE=enforce. The mode defaults to
 * shadow, so production behaviour is unchanged until the owner enables
 * enforcement separately. In enforce mode, an answer carrying an
 * evidence-required claim — an unverified statute name, an enforcement
 * date, a statutory capacity, an age condition, or a position/status
 * assertion — is not published: it lands on the ladder's tier-T4 hold
 * (outcome ABSTAIN, reason "high-risk-insufficient-sources") with the
 * app-generated hold text. amount-fee is carved out of enforcement
 * (the N-3 carve-out): the shadow fixtures showed its hits concentrate
 * on correct calculation answers, and amount correctness is the
 * deterministic re-computation layer's job, not this gate's. The
 * escalation half of use A (re-dispatching the request into the
 * research path when search budget remains) is deliberately not wired
 * here: no deterministic budget signal exists at the direct path's
 * final stage (the monthly cap is only observable inside the grounding
 * pipeline), and input-side escalation is N-5c's stage-1 connection.
 * The T4 hold is the conservative landing the design names for the
 * no-budget case, applied uniformly.
 *
 * PR-G3-b (GATE_SLIP_COUNTERMEASURE_DESIGN_2026-11-19): the amount-fee
 * carve-out above also let bare assertions of institutional prices
 * through — the expansion set's P-18/P-19 fatals asserted a stale
 * 70-yen postcard rate five times. The detector therefore also
 * classifies an "official-price" subclass: an amount-fee hit whose own
 * sentence names a price domain (postage, fares, institutional fees…)
 * in an answer carrying no arithmetic trace. Calculation answers are
 * the shape the N-3 carve-out protects, and they are recognised by
 * their traces (an equals sign, a computation or tax/discount word, a
 * stated result total) — a bare fee assertion has none. Like every
 * other class here, the subclass cannot judge whether the figure is
 * correct (a correct 85-yen assertion is classified exactly like the
 * stale 70-yen one); correctness is the research path's job, reached
 * through the input-side escalation (PR-G3-a). The subclass is
 * governed by its own sub-switch, ORIGIN_PUBLICATION_GATE_PRICE_MODE
 * (default shadow): it is logged with the other counts but fires only
 * when that switch is set to enforce, so the false-positive surface
 * can be measured in production shadow logs and on the dedicated
 * price fixture set before any answer is held for it.
 *
 * PR-G4 (same design): law-enforcement fired unconditionally, so a
 * direct answer naming a REAL statute together with its (long-past)
 * enforcement date was held even when the statute name itself verified
 * — the second half of the Q-12 over-defence (G2 resolved the name
 * fragmentation; a draft of the form 「…は2015年5月26日に施行」 still
 * fired on the date alone). The detector therefore also evaluates an
 * accompaniment condition for every law-enforcement hit: the hit's
 * asserted date lies strictly in the past, at least one statute name
 * in the answer verified, and no unverified statute-name candidate
 * exists anywhere in the answer. A hit meeting all three is
 * "suppressible". The fabricated-statute prototype I-04 keeps firing
 * under the condition because its name is unverified, and future or
 * scheduled enforcement, date-only assertions with no verified name,
 * and answers mixing in an unverified name all keep firing too. The
 * accepted residual risk, recorded in the design for the coordinator
 * to judge: a WRONG past enforcement date asserted for a real statute
 * (the Q-15 shape, in a wording the patterns reach) also becomes
 * suppressible — the correctness of a date is not deterministically
 * checkable, exactly like the correctness of a price in PR-G3. The
 * condition is governed by its own sub-switch,
 * ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE (default shadow): the
 * suppressible counts and the would-be suppression are logged with the
 * other fields, but the firing behaviour changes only when that
 * switch is set to enforce.
 */

export type OriginPublicationClaimKind =
  | "law-name"
  | "law-enforcement"
  | "statutory-capacity"
  | "age-condition"
  | "amount-fee"
  | "official-price"
  | "position-status";

export interface OriginPublicationClaimHit {
  kind: OriginPublicationClaimKind;
  /** Character offset of the matched span in the scanned text. */
  index: number;
  /** Length of the matched span. The matched text itself is never stored. */
  length: number;
}

export interface OriginPublicationLawCheck {
  /** Statute-name candidates found (after non-law exclusions). */
  candidateCount: number;
  /** Candidates confirmed against the bundled list (directly or by alias). */
  verifiedCount: number;
  /** Candidates the list could not confirm. NOT a nonexistence verdict. */
  unverifiedCount: number;
}

export interface OriginPublicationLawEnforcementCheck {
  /** law-enforcement hits whose asserted date lies strictly in the
   * past (a year-only assertion counts only when its year is over; a
   * year-month assertion only when its month is over). */
  pastDateCount: number;
  /** Hits meeting the full PR-G4 accompaniment condition: past date,
   * at least one verified statute name in the answer, and no
   * unverified statute-name candidate anywhere in the answer. */
  suppressibleCount: number;
}

export interface OriginPublicationGateSummary {
  hits: readonly OriginPublicationClaimHit[];
  counts: Readonly<Record<OriginPublicationClaimKind, number>>;
  totalCount: number;
  lawCheck: OriginPublicationLawCheck;
  lawEnforcement: OriginPublicationLawEnforcementCheck;
}

/** Answers are far below this; the cap only bounds pathological inputs. */
const MAX_SCAN_CHARS = 200_000;

interface Span {
  index: number;
  length: number;
}

function collectSpans(text: string, pattern: RegExp): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    spans.push({ index: match.index, length: match[0].length });
  }
  return spans;
}

/** Sort spans and merge overlapping or touching ones, so a claim matched
 * by two patterns of the same kind is counted once. */
function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.index - b.index || a.length - b.length);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.index <= last.index + last.length) {
      const end = Math.max(last.index + last.length, span.index + span.length);
      last.length = end - last.index;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Statute names
// ---------------------------------------------------------------------------

/** Lookup normalisation: NFKC (full/half width), whitespace removed. */
function normalizeLawName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, "");
}

const LAW_NAME_SET: ReadonlySet<string> = new Set(JAPANESE_LAW_NAMES.map(normalizeLawName));

/**
 * Well-known short names （通称・略称） mapped to their official statute
 * name. Every target is an entry of the bundled e-Gov list (verified by
 * the module tests). The table is deliberately small: an unknown alias
 * lands in "unverified", which shadow mode measures, instead of being
 * guessed at.
 */
const LAW_NAME_ALIASES: Readonly<Record<string, string>> = {
  "憲法": "日本国憲法",
  "労基法": "労働基準法",
  "基準法": "労働基準法",
  "労契法": "労働契約法",
  "公選法": "公職選挙法",
  "選挙法": "公職選挙法",
  "独禁法": "私的独占の禁止及び公正取引の確保に関する法律",
  "均等法": "雇用の分野における男女の均等な機会及び待遇の確保等に関する法律",
  "個人情報保護法": "個人情報の保護に関する法律",
  "資金決済法": "資金決済に関する法律",
  "外為法": "外国為替及び外国貿易法",
  "金商法": "金融商品取引法",
  "景表法": "不当景品類及び不当表示防止法",
  "特商法": "特定商取引に関する法律",
  "入管法": "出入国管理及び難民認定法",
  "マイナンバー法": "行政手続における特定の個人を識別するための番号の利用等に関する法律",
  "プロバイダ責任制限法": "特定電気通信による情報の流通によって発生する権利侵害等への対処に関する法律",
  "労働者派遣法": "労働者派遣事業の適正な運営の確保及び派遣労働者の保護等に関する法律",
  "パートタイム労働法": "短時間労働者及び有期雇用労働者の雇用管理の改善等に関する法律",
};

/**
 * Strings ending in 法 that are not statute names: grammar/method words
 * （文法・方法・調理法…), generic legal concepts （国際法・特別法…), and
 * referential forms （同法・本法）. Matched exactly or as a suffix, so
 * 「英文法」 and 「理学療法」 are excluded while 「労働基準法」 is not
 * (it ends in 準法, not in any listed suffix).
 */
const NON_LAW_EXACT: ReadonlySet<string> = new Set([
  "合法", "違法", "不法", "適法", "公法", "私法", "国際法", "国内法",
  "慣習法", "成文法", "不文法", "自然法", "実定法", "判例法", "特別法",
  "一般法", "基本法", "旧法", "新法", "現行法", "同法", "本法", "当該法",
  "関係法", "文法", "用法", "技法", "作法", "調理法", "製法", "奏法",
  "書法", "画法", "語法", "解法", "読法", "記法", "兵法", "戦法", "魔法",
  // Field-of-law names, not statutes: an answer invoking 「労働法では…」
  // references a field, not a named statute. 「司法」 is the front half of
  // 司法書士／司法試験， never a statute on its own （司法書士法 is unaffected).
  "労働法", "税法", "環境法", "行政法", "民事法", "刑事法", "経済法", "社会法",
  "対処法", "司法",
]);
const NON_LAW_SUFFIXES: readonly string[] = ["方法", "文法", "療法", "工法", "対処法"];

function isNonLawCandidate(candidate: string): boolean {
  if (NON_LAW_EXACT.has(candidate)) return true;
  return NON_LAW_SUFFIXES.some((suffix) => candidate.endsWith(suffix));
}

function lookupLawName(candidate: string): boolean {
  const normalized = normalizeLawName(candidate);
  if (LAW_NAME_SET.has(normalized)) return true;
  const aliasTarget = LAW_NAME_ALIASES[candidate] ?? LAW_NAME_ALIASES[normalized];
  return aliasTarget !== undefined && LAW_NAME_SET.has(normalizeLawName(aliasTarget));
}

function isVerifiedLawName(candidate: string): boolean {
  if (lookupLawName(candidate)) return true;
  // Temporal variants of a real statute （旧民法・改正民法・旧商法）: strip
  // one era/revision prefix and retry, so a correct reference to the
  // pre-amendment statute is not misread as an unverified name.
  const stripped = /^(?:旧|新|改正)(.+)$/.exec(candidate);
  return stripped !== null && lookupLawName(stripped[1]);
}

/** Normalised list entries in list form, for the extended match below. */
const LAW_NAME_LIST_NORMALIZED: readonly string[] = [...LAW_NAME_SET];

/** How far left of an unverified candidate the extended match may look. */
const LAW_NAME_EXTENSION_MAX_CHARS = 40;

/** Characters that end the leftward extension window: sentence/clause
 * boundaries and line starts, per the G2 design. */
const LAW_NAME_EXTENSION_BOUNDARIES: ReadonlySet<string> = new Set(["。", "、", "「", "\n"]);

/** A character that continues a kanji/katakana compound. When the
 * character immediately before a matched list name is one of these, the
 * name is embedded as the tail of a longer (possibly fabricated) name
 * and must not verify the candidate. */
const LAW_NAME_EMBEDDING_CHAR = /[一-龠ァ-ヶ々ヶ]/;

/**
 * Extended match (PR-G2, GATE_SLIP_COUNTERMEASURE_DESIGN_2026-11-19):
 * the candidate pattern above deliberately excludes hiragana, so an
 * official name that contains hiragana (「空家等対策の推進に関する
 * 特別措置法」) reaches the check only as its kanji tail fragment
 * (「特別措置法」) and reads as unverified even though the full name is
 * on the list — the Q-12 over-defence. When (and only when) the strict
 * check fails, extend left from the candidate's start, up to the
 * nearest sentence boundary (。・、・「・line start) or 40 characters,
 * and treat the candidate as verified if a list entry appears in that
 * window as a contiguous substring ending exactly at the candidate's
 * end — i.e. the candidate is the tail fragment of a full official
 * name written out in the text. The extension is used for verification
 * only: it creates no new candidate and can only move a candidate from
 * unverified to verified, never the other way.
 *
 * Boundary condition against fabricated names: if the character
 * immediately before the matched list name continues a kanji/katakana
 * compound, the name is embedded as the tail of a longer name
 * (「新空家等対策の推進に関する特別措置法」) and does NOT verify.
 */
function isVerifiedLawNameByExtension(
  text: string,
  candidateIndex: number,
  candidateEnd: number,
): boolean {
  let windowStart = Math.max(0, candidateIndex - LAW_NAME_EXTENSION_MAX_CHARS);
  for (let i = candidateIndex - 1; i >= windowStart; i -= 1) {
    if (LAW_NAME_EXTENSION_BOUNDARIES.has(text[i])) {
      windowStart = i + 1;
      break;
    }
  }
  const windowNormalized = normalizeLawName(text.slice(windowStart, candidateEnd));
  for (const name of LAW_NAME_LIST_NORMALIZED) {
    if (name.length > windowNormalized.length) continue;
    if (!windowNormalized.endsWith(name)) continue;
    const matchStart = windowNormalized.length - name.length;
    const preceding =
      matchStart > 0
        ? windowNormalized[matchStart - 1]
        : windowStart > 0
          ? text[windowStart - 1]
          : "";
    if (preceding !== "" && LAW_NAME_EMBEDDING_CHAR.test(preceding)) continue;
    return true;
  }
  return false;
}

/**
 * Candidate statute names: a run of kanji/katakana (plus ・, 々, ヶ, ー)
 * ending in 法， at least 2 characters in total — the quantifier is
 * {1,31} before the final 法 so the two-character statutes （民法・刑法・
 * 商法・憲法） match. Hiragana is deliberately excluded from the run:
 * statute names are kanji-built, and letting hiragana in made the run
 * swallow prose (「…の対処法」「…や法」) — the dominant false-candidate
 * source in the 2026-11-17 fixture measurement. As a side effect,
 * particles break the run at the right boundary, so
 * 「年の公職選挙法」 yields 公職選挙法 directly. 「〇〇法施行令／施行規則」
 * needs no special handling — the run naturally ends at the base
 * statute's 法.
 */
const LAW_NAME_CANDIDATE_PATTERN = /[一-龠ァ-ヶー・々ヶ]{1,31}法/g;

interface LawScan {
  hits: OriginPublicationClaimHit[];
  lawCheck: OriginPublicationLawCheck;
}

function scanLawNames(text: string): LawScan {
  const hits: OriginPublicationClaimHit[] = [];
  let verifiedCount = 0;
  let unverifiedCount = 0;
  for (const match of text.matchAll(LAW_NAME_CANDIDATE_PATTERN)) {
    if (match.index === undefined) continue;
    let candidate = match[0];
    let index = match.index;
    // A candidate immediately followed by 律 is the front half of a
    // longer word — typically a law-firm name (「浅野総合法律事務所」) —
    // not a standalone statute reference.
    if (text[index + candidate.length] === "律") continue;
    // Corporate names (「弁護士法人…」) are not statutes.
    if (candidate.includes("法人")) continue;
    // A ・ inside the run is a list separator far more often than part
    // of a statute name (「時効期間・改正民法」): keep the last segment.
    const separator = candidate.lastIndexOf("・");
    if (separator >= 0 && candidate.length - separator - 1 >= 2) {
      index += separator + 1;
      candidate = candidate.slice(separator + 1);
    }
    if (candidate.length < 2) continue;
    // Pure-katakana candidates are method/brand words (「ポモドーロ法」),
    // never statutes — unless the alias table knows them (「マイナンバー法」).
    const body = candidate.slice(0, -1);
    if (!/[一-龠]/.test(body) && LAW_NAME_ALIASES[candidate] === undefined) continue;
    if (isNonLawCandidate(candidate)) continue;
    hits.push({ kind: "law-name", index, length: candidate.length });
    if (
      isVerifiedLawName(candidate) ||
      isVerifiedLawNameByExtension(text, index, index + candidate.length)
    ) {
      verifiedCount += 1;
    } else {
      unverifiedCount += 1;
    }
  }
  return {
    hits,
    lawCheck: { candidateCount: hits.length, verifiedCount, unverifiedCount },
  };
}

// ---------------------------------------------------------------------------
// Claim-shape patterns (all bounded, single-pass, no nested quantifiers)
// ---------------------------------------------------------------------------

/** Enforcement-date assertions: a full or year-only date tied to 施行. */
const LAW_ENFORCEMENT_PATTERNS: readonly RegExp[] = [
  /\d{4}年\d{1,2}月\d{1,2}日(?:から|に)?施行/g,
  /施行(?:日)?(?:は|が)?\d{4}年\d{1,2}月\d{1,2}日/g,
  /\d{4}年(?:\d{1,2}月)?(?:に)?施行/g,
];

/** The date inside a law-enforcement span: every pattern above opens
 * with (or contains) a \d{4}年 date, so the first such date in the
 * span is the asserted enforcement date. */
const LAW_ENFORCEMENT_DATE_PATTERN = /(\d{4})年(?:(\d{1,2})月)?(?:(\d{1,2})日)?/;

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** "Today" as a civil date in Asia/Tokyo: the statutes, the asserted
 * dates and the readers are Japanese, so the past/future boundary is
 * the Japanese calendar day, not the server's UTC day. */
function tokyoCivilDate(nowMs: number): CivilDate {
  const jst = new Date(nowMs + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  };
}

/**
 * Whether the enforcement date asserted in a law-enforcement span lies
 * strictly in the past. Precision is honoured conservatively: a
 * year-only assertion is past only once its year is over, and a
 * year-month assertion only once its month is over — an assertion
 * that could still point at a future day (「2026年に施行」 said in
 * 2026, 「2026年11月に施行」 said that November) is NOT past and
 * keeps firing, as do today's date and every future date.
 */
function isPastEnforcementDate(spanText: string, today: CivilDate): boolean {
  const match = LAW_ENFORCEMENT_DATE_PATTERN.exec(spanText);
  if (!match) return false;
  const year = Number(match[1]);
  if (year !== today.year) return year < today.year;
  if (match[2] === undefined) return false;
  const month = Number(match[2]);
  if (month !== today.month) return month < today.month;
  if (match[3] === undefined) return false;
  return Number(match[3]) < today.day;
}

/**
 * Statutory-capacity assertions: a headcount tied to a capacity keyword
 * （定数・定員・議席…) or to a legislative body （衆議院・参議院・議会…).
 * The institution anchor is what catches D-15's lead sentence
 * (「衆議院は465名、参議院は245名です」), which names no 定数 keyword.
 * The 人 unit and the bare 議員 keyword close the P-02 wording gap
 * (「参議院の議員は242人です」), which neither pattern reached before:
 * the anchor pattern had no 人 unit and the keyword pattern required
 * 議員数. The gate stops unverified assertions regardless of whether
 * the figure happens to be correct.
 */
const STATUTORY_CAPACITY_PATTERNS: readonly RegExp[] = [
  /(?:定数|定員|議席数|議員数|議員|委員数)[^\n。]{0,16}?\d[\d,]*\s*(?:名|人|議席)/g,
  /(?:衆議院|参議院|国会|都議会|県議会|市議会|町議会|村議会|区議会|議会|委員会)[^\n。]{0,20}?\d[\d,]*\s*(?:名|人|議席)/g,
];

/** Age-condition assertions: 満N歳, N歳以上／未満／以下, N歳から. */
const AGE_CONDITION_PATTERNS: readonly RegExp[] = [
  /満\s*\d{1,3}\s*歳/g,
  /\d{1,3}\s*歳以上/g,
  /\d{1,3}\s*歳未満/g,
  /\d{1,3}\s*歳以下/g,
  /\d{1,3}\s*歳から/g,
];

/** Amount/fee assertions: yen-denominated amounts and major foreign units. */
const AMOUNT_FEE_PATTERNS: readonly RegExp[] = [
  /\d[\d,]*\s*(?:億円|万円|千円|円)/g,
  /\d[\d,]*\s*(?:ドル|ユーロ|ポンド)/g,
  /[$€£]\s*\d[\d,]*/g,
];

/** Position/status assertions: a role title used as a statement subject,
 * or an explicit current-holder reference. Deliberately narrow — this
 * kind is the least deterministic of the set, and shadow mode exists to
 * measure exactly that. */
const POSITION_STATUS_PATTERNS: readonly RegExp[] = [
  /(?:内閣総理大臣|総理大臣|首相|大統領|知事|市長|区長|町長|村長|社長|会長|代表取締役|大臣|長官|事務総長|委員長|議長|総裁|党首)(?:は|が)/g,
  /現在の(?:内閣総理大臣|総理大臣|首相|大統領|知事|社長|会長)/g,
  /現職の[^\n、。]{0,12}?(?:首相|大統領|知事|社長|会長|大臣)/g,
];

const KIND_PATTERNS: readonly (readonly [OriginPublicationClaimKind, readonly RegExp[]])[] = [
  ["law-enforcement", LAW_ENFORCEMENT_PATTERNS],
  ["statutory-capacity", STATUTORY_CAPACITY_PATTERNS],
  ["age-condition", AGE_CONDITION_PATTERNS],
  ["amount-fee", AMOUNT_FEE_PATTERNS],
  ["position-status", POSITION_STATUS_PATTERNS],
];

// ---------------------------------------------------------------------------
// Official-price subclass (PR-G3-b)
// ---------------------------------------------------------------------------

/**
 * Price-domain keywords: institutional prices set outside the
 * conversation (postage, fares, administrative fees). Deliberately
 * narrower than 価格／料金 in general — a commercial price the user
 * supplied or a shop's price is not an institutional fact of this
 * shape, and the generic words appear throughout calculation answers.
 */
const OFFICIAL_PRICE_DOMAIN_KEYWORDS: readonly string[] = [
  "切手", "郵便", "はがき", "送料", "運賃", "手数料",
  "入場料", "受験料", "交付手数料", "通行料", "駐車料金",
];

/**
 * Arithmetic traces, checked over the whole answer: the marks a
 * calculation answer leaves — an equals sign or division sign, a
 * computation / tax / discount word, or a result total stated as such
 * （合計は・元利合計は…). The design's relaxation: if any trace exists
 * anywhere in the answer, the answer is treated as a calculation (its
 * conclusion sentence may state the result without a trace of its
 * own) and the subclass stays silent. Two measured exclusions:
 * - The dimension notation × (「3.5 cm × 4.5 cm」) is NOT a trace —
 *   counting it would miss P-19 run1, whose only "operator" is a size.
 * - A bare 合計 directly followed by an amount in a DIFFERENT sentence
 *   (「複数枚の切手で合計70円にしてください」 — an instruction to make
 *   the stamps add up to the fee) is not a result total and not a
 *   trace; a 合計 inside the hit's own sentence IS treated as one
 *   (「送料800円の商品を2つ買うと、合計1,600円です」 is a calculation).
 */
const OFFICIAL_PRICE_ARITHMETIC_TRACE_PATTERN =
  /[=＝÷]|計算|税込|税抜|割引|値引き|合計は|合計金額|元利合計/;

/**
 * Computation words checked inside the hit's own sentence only: a
 * sentence that itself adds figures up (合計・合わせ・足すと) is doing
 * arithmetic with supplied values, whatever the rest of the answer
 * looks like. Kept sentence-local so that P-18 run1's separate
 * payment instruction (「複数枚の切手で合計70円にしてください」) does
 * not mask the fee assertion in its first sentence.
 */
const OFFICIAL_PRICE_SENTENCE_COMPUTATION_PATTERN = /合計|合わせ|足すと/;

const SENTENCE_BOUNDARY_CHARS: readonly string[] = ["。", "！", "？", "?", "\n"];

/** The sentence (or line) containing the character at `index`. */
function sentenceSlice(text: string, index: number): string {
  let start = 0;
  for (const ch of SENTENCE_BOUNDARY_CHARS) {
    const at = text.lastIndexOf(ch, Math.max(0, index - 1));
    if (at + 1 > start) start = at + 1;
  }
  let end = text.length;
  for (const ch of SENTENCE_BOUNDARY_CHARS) {
    const at = text.indexOf(ch, index);
    if (at !== -1 && at < end) end = at;
  }
  return text.slice(start, end);
}

/**
 * The official-price subclass of the amount-fee hits: an amount whose
 * own sentence names a price domain, in an answer with no arithmetic
 * trace. Returns the qualifying amount spans (spans only, as with
 * every other kind).
 */
function detectOfficialPriceSpans(text: string, amountSpans: readonly Span[]): Span[] {
  if (amountSpans.length === 0) return [];
  if (OFFICIAL_PRICE_ARITHMETIC_TRACE_PATTERN.test(text)) return [];
  return amountSpans.filter((span) => {
    const sentence = sentenceSlice(text, span.index);
    if (OFFICIAL_PRICE_SENTENCE_COMPUTATION_PATTERN.test(sentence)) return false;
    return OFFICIAL_PRICE_DOMAIN_KEYWORDS.some((keyword) => sentence.includes(keyword));
  });
}

/**
 * Scan a finished direct answer for evidence-required claim shapes and
 * check its statute-name candidates against the bundled law list.
 * Pure and deterministic; returns spans and counts only, never text.
 * `nowMs` exists so the PR-G4 past-date evaluation can be pinned in
 * fixtures and offline measurement; production callers omit it.
 */
export function detectOriginPublicationClaims(
  text: string,
  options?: { nowMs?: number },
): OriginPublicationGateSummary {
  const scanned = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  const lawScan = scanLawNames(scanned);
  const hits: OriginPublicationClaimHit[] = [...lawScan.hits];
  const counts: Record<OriginPublicationClaimKind, number> = {
    "law-name": lawScan.hits.length,
    "law-enforcement": 0,
    "statutory-capacity": 0,
    "age-condition": 0,
    "amount-fee": 0,
    "official-price": 0,
    "position-status": 0,
  };
  let amountFeeSpans: Span[] = [];
  let lawEnforcementSpans: Span[] = [];
  for (const [kind, patterns] of KIND_PATTERNS) {
    const spans = mergeSpans(patterns.flatMap((pattern) => collectSpans(scanned, pattern)));
    counts[kind] = spans.length;
    if (kind === "amount-fee") amountFeeSpans = spans;
    if (kind === "law-enforcement") lawEnforcementSpans = spans;
    for (const span of spans) hits.push({ kind, index: span.index, length: span.length });
  }
  const officialPriceSpans = detectOfficialPriceSpans(scanned, amountFeeSpans);
  counts["official-price"] = officialPriceSpans.length;
  for (const span of officialPriceSpans) hits.push({ kind: "official-price", index: span.index, length: span.length });
  hits.sort((a, b) => a.index - b.index);
  // PR-G4 accompaniment evaluation: a law-enforcement hit is
  // suppressible when its own asserted date is past and the answer's
  // statute names are clean — at least one verified, none unverified.
  const today = tokyoCivilDate(options?.nowMs ?? Date.now());
  const accompanimentHolds =
    lawScan.lawCheck.verifiedCount > 0 && lawScan.lawCheck.unverifiedCount === 0;
  let pastDateCount = 0;
  let suppressibleCount = 0;
  for (const span of lawEnforcementSpans) {
    const spanText = scanned.slice(span.index, span.index + span.length);
    if (!isPastEnforcementDate(spanText, today)) continue;
    pastDateCount += 1;
    if (accompanimentHolds) suppressibleCount += 1;
  }
  return {
    hits,
    counts,
    totalCount: hits.length,
    lawCheck: lawScan.lawCheck,
    lawEnforcement: { pastDateCount, suppressibleCount },
  };
}

/** Flat scalar log fields for a gate summary (kinds and counts only —
 * never answer text), shared by the shadow logger and the stage-2
 * gate so both modes report the same measurement surface. */
function publicationGateLogFields(summary: OriginPublicationGateSummary): Record<string, unknown> {
  return {
    publicationGateLawNameCount: summary.counts["law-name"],
    publicationGateLawEnforcementCount: summary.counts["law-enforcement"],
    publicationGateStatutoryCapacityCount: summary.counts["statutory-capacity"],
    publicationGateAgeConditionCount: summary.counts["age-condition"],
    publicationGateAmountFeeCount: summary.counts["amount-fee"],
    publicationGateOfficialPriceCount: summary.counts["official-price"],
    publicationGatePositionStatusCount: summary.counts["position-status"],
    publicationGateTotalCount: summary.totalCount,
    lawNameCandidateCount: summary.lawCheck.candidateCount,
    lawNameVerifiedCount: summary.lawCheck.verifiedCount,
    lawNameUnverifiedCount: summary.lawCheck.unverifiedCount,
    publicationGateLawEnforcementPastDateCount: summary.lawEnforcement.pastDateCount,
    publicationGateLawEnforcementSuppressibleCount: summary.lawEnforcement.suppressibleCount,
  };
}

/**
 * Shadow-mode hook for the direct-answer paths, mirroring the numeric
 * audit gate's shadow logger: run the detector, log kinds and counts
 * only (flat scalar fields, so they survive serialized log output), and
 * return the summary. Never throws and never touches the answer — on a
 * detector failure it logs the failure (error name only) and returns
 * null so the caller delivers the answer exactly as produced.
 */
export function logOriginPublicationGateShadow(input: {
  requestId: string;
  answerText: string;
  logger?: (message: string, fields: Record<string, unknown>) => void;
}): OriginPublicationGateSummary | null {
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const summary = detectOriginPublicationClaims(input.answerText);
    logger("[origin-chat] publication gate (shadow)", {
      requestId: input.requestId,
      ...publicationGateLogFields(summary),
    });
    return summary;
  } catch (error) {
    logger("[origin-chat] publication gate (shadow) failed", {
      requestId: input.requestId,
      gateError: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stage 2: enforcement connection (N-5b). Selected by
// ORIGIN_PUBLICATION_GATE_MODE (default shadow), mirroring the numeric
// audit gate's mode switch. See the file header for the contract.
// ---------------------------------------------------------------------------

export type OriginPublicationGateMode = "shadow" | "enforce";

export function resolveOriginPublicationGateMode(
  env: NodeJS.ProcessEnv | undefined,
): OriginPublicationGateMode {
  return env?.ORIGIN_PUBLICATION_GATE_MODE === "enforce" ? "enforce" : "shadow";
}

/**
 * The official-price subclass's own sub-switch (PR-G3-b):
 * ORIGIN_PUBLICATION_GATE_PRICE_MODE, default shadow. The subclass is
 * new, and the existing measurement sets contain no correct
 * official-price direct answer to measure its true-positive cost
 * against, so it starts in shadow (detected and logged, never held)
 * even while the main gate enforces. "off" silences the subclass's
 * firing path entirely (detection and its count still run, like every
 * other kind); "enforce" lets it hold an answer like the other firing
 * kinds — a step to take only after the shadow distribution and the
 * price fixture set have been reviewed.
 */
export type OriginPublicationGatePriceMode = "off" | "shadow" | "enforce";

export function resolveOriginPublicationGatePriceMode(
  env: NodeJS.ProcessEnv | undefined,
): OriginPublicationGatePriceMode {
  const value = env?.ORIGIN_PUBLICATION_GATE_PRICE_MODE;
  if (value === "enforce") return "enforce";
  if (value === "off") return "off";
  return "shadow";
}

/**
 * The law-enforcement accompaniment condition's own sub-switch
 * (PR-G4): ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE, default
 * shadow. The condition REMOVES a firing kind, so it starts in shadow
 * (the suppressible counts and the would-be suppression are logged,
 * the firing behaviour is unchanged) even while the main gate
 * enforces; "off" silences the condition's log fields and its firing
 * path entirely (detection and the counts still run, like every other
 * kind); "enforce" lets the condition drop law-enforcement from the
 * firing kinds when every hit is suppressible — a step to take only
 * after the shadow distribution and the law-enforcement fixture set
 * have been reviewed, because a wrong past enforcement date for a
 * real statute is suppressible by construction (see the file header).
 */
export type OriginPublicationGateLawEnforcementMode = "off" | "shadow" | "enforce";

export function resolveOriginPublicationGateLawEnforcementMode(
  env: NodeJS.ProcessEnv | undefined,
): OriginPublicationGateLawEnforcementMode {
  const value = env?.ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE;
  if (value === "enforce") return "enforce";
  if (value === "off") return "off";
  return "shadow";
}

/**
 * Whether the PR-G4 accompaniment condition suppresses the
 * law-enforcement kind for this summary: at least one hit, and every
 * hit suppressible. A single non-suppressible hit (future or
 * imprecise date, or an answer whose statute names are not clean)
 * keeps the whole kind firing.
 */
export function publicationGateLawEnforcementSuppressed(
  summary: OriginPublicationGateSummary,
): boolean {
  return (
    summary.counts["law-enforcement"] > 0 &&
    summary.lawEnforcement.suppressibleCount === summary.counts["law-enforcement"]
  );
}

/**
 * The claim kinds whose presence in a finished direct answer blocks
 * publication in enforce mode, in a fixed order:
 * - law-name fires only through an UNVERIFIED candidate. A verified
 *   name never fires, and an unverified one is treated as "could not
 *   be confirmed", never as "does not exist" — the hold text claims
 *   nothing about the name itself.
 * - law-enforcement, statutory-capacity, age-condition, and
 *   position-status fire on any hit: these shapes assert a concrete
 *   institutional fact that the direct path cannot back with a source.
 * - amount-fee NEVER fires (the N-3 carve-out recorded in the file
 *   header): its shadow hits concentrate on correct calculation
 *   answers, and amount correctness belongs to deterministic
 *   re-computation, not to this gate.
 * - official-price is NOT decided here either: the subclass carved
 *   out of amount-fee (PR-G3-b) fires only under its own sub-switch
 *   (ORIGIN_PUBLICATION_GATE_PRICE_MODE=enforce, default shadow),
 *   applied by applyOriginPublicationGate on top of this list.
 * - law-enforcement IS listed here (it fires unconditionally today),
 *   but applyOriginPublicationGate may remove it again under the
 *   PR-G4 accompaniment condition's own sub-switch
 *   (ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE=enforce, default
 *   shadow) when every hit is suppressible.
 */
export function publicationGateFiringKinds(
  summary: OriginPublicationGateSummary,
): OriginPublicationClaimKind[] {
  const kinds: OriginPublicationClaimKind[] = [];
  if (summary.lawCheck.unverifiedCount > 0) kinds.push("law-name");
  if (summary.counts["law-enforcement"] > 0) kinds.push("law-enforcement");
  if (summary.counts["statutory-capacity"] > 0) kinds.push("statutory-capacity");
  if (summary.counts["age-condition"] > 0) kinds.push("age-condition");
  if (summary.counts["position-status"] > 0) kinds.push("position-status");
  return kinds;
}

export interface OriginPublicationGateOutcome {
  mode: OriginPublicationGateMode;
  /** The text to deliver: the input unchanged in shadow mode and
   * whenever nothing fires; the tier-T4 hold text when held. */
  answerText: string;
  /** Whether enforcement replaced the answer with the tier-T4 hold. */
  held: boolean;
  summary: OriginPublicationGateSummary | null;
  /** Evidence-required kinds that fired (amount-fee excluded). */
  firingKinds: readonly OriginPublicationClaimKind[];
  /** The N-1 ladder landing when held (tier T4, outcome ABSTAIN,
   * reason "high-risk-insufficient-sources"); null otherwise. The
   * landing vocabulary is metadata and logs only — it never appears
   * in the delivered text. */
  landing: OriginResearchLanding | null;
}

/**
 * Router-facing gate for both modes. Shadow mode reproduces the
 * stage-1 behaviour exactly (detect + log, text untouched). Enforce
 * mode additionally lands a firing answer on the tier-T4 hold: the
 * delivered text is the app-generated hold (the ladder's abstain body
 * for "high-risk-insufficient-sources", with the no-search lead — the
 * direct path performed no search, so the text must not claim one).
 * The gate is isolated in a try/catch: any detector or logger failure
 * delivers the original text, exactly as in shadow mode.
 */
export function applyOriginPublicationGate(input: {
  requestId: string;
  answerText: string;
  query: string;
  language: "ja" | "en";
  env?: NodeJS.ProcessEnv;
  /** Pins the PR-G4 past-date evaluation in tests and offline
   * measurement; production callers omit it. */
  nowMs?: number;
  logger?: (message: string, fields: Record<string, unknown>) => void;
}): OriginPublicationGateOutcome {
  const mode = resolveOriginPublicationGateMode(input.env);
  const unchanged: OriginPublicationGateOutcome = {
    mode,
    answerText: input.answerText,
    held: false,
    summary: null,
    firingKinds: [],
    landing: null,
  };
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const summary = detectOriginPublicationClaims(input.answerText, { nowMs: input.nowMs });
    const lawEnforcementMode = resolveOriginPublicationGateLawEnforcementMode(input.env);
    const lawEnforcementSuppressed = publicationGateLawEnforcementSuppressed(summary);
    const lawEnforcementLogFields =
      lawEnforcementMode === "off"
        ? { publicationGateLawEnforcementMode: lawEnforcementMode }
        : {
            publicationGateLawEnforcementMode: lawEnforcementMode,
            publicationGateLawEnforcementSuppressed: lawEnforcementSuppressed,
          };
    if (mode === "shadow") {
      logger("[origin-chat] publication gate (shadow)", {
        requestId: input.requestId,
        ...publicationGateLogFields(summary),
        ...lawEnforcementLogFields,
      });
      return { ...unchanged, summary };
    }
    const baseFiringKinds = publicationGateFiringKinds(summary);
    const priceMode = resolveOriginPublicationGatePriceMode(input.env);
    const withoutSuppressedLawEnforcement =
      lawEnforcementMode === "enforce" && lawEnforcementSuppressed
        ? baseFiringKinds.filter((kind) => kind !== "law-enforcement")
        : baseFiringKinds;
    const firingKinds: OriginPublicationClaimKind[] =
      priceMode === "enforce" && summary.counts["official-price"] > 0
        ? [...withoutSuppressedLawEnforcement, "official-price"]
        : withoutSuppressedLawEnforcement;
    const held = firingKinds.length > 0;
    const landing = held ? researchLandingForAbstain("high-risk-insufficient-sources") : null;
    logger("[origin-chat] publication gate (enforce)", {
      requestId: input.requestId,
      ...publicationGateLogFields(summary),
      ...lawEnforcementLogFields,
      publicationGateMode: mode,
      publicationGatePriceMode: priceMode,
      publicationGateHeld: held,
      publicationGateFiringKinds: firingKinds,
      ...(landing
        ? {
            researchTier: landing.tier,
            researchOutcome: landing.outcome,
            researchAbstainReason: landing.abstainReason,
          }
        : {}),
    });
    if (!held) return { ...unchanged, summary, firingKinds };
    return {
      mode,
      answerText: buildGroundedResearchAbstainAnswer({
        query: input.query,
        language: input.language,
        reason: "high-risk-insufficient-sources",
        searched: false,
      }),
      held: true,
      summary,
      firingKinds,
      landing,
    };
  } catch (error) {
    try {
      logger(`[origin-chat] publication gate (${mode}) failed`, {
        requestId: input.requestId,
        gateError: error instanceof Error ? error.name : "UnknownError",
      });
    } catch {
      // The gate never throws: even a failing logger must not break
      // or delay the answer it was asked to check.
    }
    return unchanged;
  }
}
