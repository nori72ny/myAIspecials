/**
 * Date / weekday deterministic verification for direct chat answers.
 *
 * Background (fixed-100 measurement, round 4, 2026-11-17): one of the
 * four fatal answers was H-07 — asked "2026年11月7日の45日後は何月何日で
 * 何曜日ですか", the model answered "2026年12月23日（火曜日）". The true
 * result is 2026年12月22日・火曜日， and 12月23日 is in fact a Wednesday,
 * so the answer was wrong twice over and internally inconsistent. Date
 * arithmetic is exactly the kind of claim that must not be left to the
 * model's mental math: both halves of it are mechanically checkable.
 *
 * What this module verifies, deterministically (no model call, no I/O):
 * (a) Every "date + weekday" pair asserted in the answer text: the
 *     weekday must equal the actual weekday of the stated date.
 * (b) When the question states a base date and an N-days-later /
 *     N-days-before offset, and the answer asserts a result date, the
 *     asserted date must equal the recomputed base ± N days.
 *
 * Placement decision: this is an independent module, not a claim class
 * of the publication gate. The publication gate's contract is to
 * detect evidence-required claim *shapes* and never to rewrite text —
 * it stores spans only and never sees the question. This verifier
 * needs the question (for (b)), needs the actual date values, and in
 * enforce mode produces corrections. It is therefore wired at the same
 * connection points as the publication gate (after the assertion gate
 * and the numeric audit gate in the non-streaming router; as a
 * buffered gate plus the log-only hook in the streaming router), the
 * same way the numeric audit gate is a separate module wired beside it.
 *
 * Mode: ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE=shadow|enforce, default
 * shadow (mirrors ORIGIN_BUSINESS_PLANNING_AUDIT_MODE). Shadow mode
 * only logs counts and never alters the answer. Enforcement is a
 * separate owner-approved activation step.
 *
 * Correction policy (enforce mode) — the most conservative option that
 * cannot break a correct answer:
 * - (a) Only the weekday token is rewritten, to the actual weekday of
 *   the date as stated. The weekday is a pure function of the stated
 *   date, so this can only remove an internal inconsistency.
 * - (b) The asserted result date (every mention of that same value, in
 *   its own full/short surface form) is replaced by the recomputed
 *   date, and a weekday attached to a replaced mention is set to the
 *   recomputed date's weekday. The recomputation is a pure function
 *   of the question's stated base and offset.
 * - Anything ambiguous is passed through untouched: a date whose year
 *   cannot be determined, a relative question whose asserted result
 *   cannot be identified uniquely, an invalid calendar date, a
 *   notation variant the parser does not recognise. Detection that
 *   cannot be acted on safely is still counted in shadow logs.
 * - Corrections are applied only when the corrected text re-verifies
 *   clean (the same re-audit discipline as the numeric audit gate's
 *   formula fixes); otherwise the original text is delivered.
 * - Weekday correction requires the year to be explicit in the date
 *   itself or uniquely inferable from the surrounding text. A short
 *   date (M月D日) whose year only the current date could supply is
 *   detected and counted, but never rewritten: the intended year is
 *   not knowable from the text alone.
 *
 * Calendar math is pure civil-date arithmetic (days-from-civil), so
 * results never depend on the process timezone. "Today" for the
 * 今日/明日/昨日 base forms and for current-year inference is the
 * Asia/Tokyo calendar date of the supplied `now`.
 *
 * Logs carry counts and fixed codes only — never answer text, never
 * question text, never the matched surface. The verifier never throws
 * to its caller: on an internal failure the gate logs the error name
 * and delivers the answer exactly as produced.
 */

/** Answers are far below this; the cap only bounds pathological inputs. */
const MAX_SCAN_CHARS = 200_000;

export type OriginDateWeekdayVerificationMode = "shadow" | "enforce";

export function resolveOriginDateWeekdayVerificationMode(
  env: NodeJS.ProcessEnv | undefined,
): OriginDateWeekdayVerificationMode {
  return env?.ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE === "enforce" ? "enforce" : "shadow";
}

export interface OriginDateWeekdayVerificationSummary {
  /** Date+weekday pairs that could be checked (year resolvable, valid date). */
  pairCount: number;
  /** Pairs whose stated weekday differs from the date's actual weekday. */
  weekdayMismatchCount: number;
  /** A base date + offset expectation could be derived from the question. */
  relativeChecked: boolean;
  /** The asserted result date differs from the recomputed date. */
  relativeMismatch: boolean;
  /** An expectation was derived but the asserted result is not identifiable. */
  relativeAmbiguous: boolean;
  /** Spans the verifier can correct deterministically (re-verified). */
  fixableCount: number;
  /** Spans actually rewritten in the delivered text (enforce mode only). */
  correctedCount: number;
  /** Enforcement produced a correction that failed re-verification and was reverted. */
  correctionReverted: boolean;
}

export interface OriginDateWeekdayVerificationOutcome {
  mode: OriginDateWeekdayVerificationMode;
  answerText: string;
  summary: OriginDateWeekdayVerificationSummary | null;
}

// ---------------------------------------------------------------------------
// Civil-date arithmetic (timezone-independent)
// ---------------------------------------------------------------------------

const WEEKDAY_CHARS: readonly string[] = ["日", "月", "火", "水", "木", "金", "土"];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isValidDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Howard Hinnant's days-from-civil: days since 1970-01-01. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of daysFromCivil. */
function civilFromDays(z: number): { year: number; month: number; day: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: month <= 2 ? y + 1 : y, month, day };
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday (4). */
function weekdayOf(year: number, month: number, day: number): number {
  return (((daysFromCivil(year, month, day) + 4) % 7) + 7) % 7;
}

interface DateValue {
  year: number;
  month: number;
  day: number;
}

function addDays(value: DateValue, offset: number): DateValue {
  return civilFromDays(daysFromCivil(value.year, value.month, value.day) + offset);
}

function sameDate(a: DateValue, b: DateValue): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function dateKey(value: DateValue): string {
  return `${value.year}-${value.month}-${value.day}`;
}

/** The Asia/Tokyo calendar date of `now` (JST is UTC+9, no DST). */
function jstDateValue(now: Date): DateValue {
  const shifted = new Date(now.getTime() + 9 * 3_600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// ---------------------------------------------------------------------------
// Mention scanning
// ---------------------------------------------------------------------------

/**
 * Length-preserving normalisation (full-width digits map one character
 * to one character), so spans computed on the result are valid spans
 * of the original text.
 */
function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

interface WeekdayAttachment {
  index: number;
  length: number;
  weekday: number;
  /** Token shape: 3 = 「火曜日」, 2 = 「火曜」, 1 = 「火」. */
  tokenLength: number;
}

interface DateMention {
  index: number;
  length: number;
  full: boolean;
  /** Resolved year; null when no year could be determined. */
  year: number | null;
  /**
   * Whether the year is safe to act on: explicit in the date itself,
   * or the single year used by the surrounding text. A year supplied
   * only by the current date is detection-grade, not correction-grade.
   */
  yearActionable: boolean;
  month: number;
  day: number;
  monthPadded: boolean;
  dayPadded: boolean;
  weekday: WeekdayAttachment | null;
}

const FULL_DATE_PATTERN = /(\d{4})年(\d{1,2})月(\d{1,2})日/g;
const SHORT_DATE_PATTERN = /(\d{1,2})月(\d{1,2})日/g;

/** Characters allowed between a date and its weekday token. */
const WEEKDAY_GAP_CHARS: ReadonlySet<string> = new Set([" ", "　", "\t", "（", "(", "、", "・", "は", "が"]);

/**
 * Find a weekday token asserted for the date ending at `end`. The
 * token must start within a short separator run after the date. A bare
 * single character （火） counts only inside brackets — unbracketed,
 * a lone 日/月 after a date is as likely to start another word
 * （日用品・月が…) as to name a weekday; the 曜/曜日 forms are
 * unambiguous and always count.
 */
function scanWeekdayAttachment(text: string, end: number): WeekdayAttachment | null {
  let cursor = end;
  let gap = 0;
  let bracketed = false;
  while (cursor < text.length && gap < 3 && WEEKDAY_GAP_CHARS.has(text[cursor])) {
    if (text[cursor] === "（" || text[cursor] === "(") bracketed = true;
    cursor += 1;
    gap += 1;
  }
  if (cursor >= text.length) return null;
  const weekday = WEEKDAY_CHARS.indexOf(text[cursor]);
  if (weekday < 0) return null;
  let tokenLength = 1;
  if (text.startsWith("曜日", cursor + 1)) tokenLength = 3;
  else if (text[cursor + 1] === "曜") tokenLength = 2;
  if (tokenLength === 1 && !bracketed) return null;
  // An unbracketed weekday immediately followed by は/が is the
  // subject of its own clause ("…、木曜日は休館日です" — Thursdays are
  // closed), not an appositive weekday for the date. Bracketed forms
  // ("（木曜日）は…") are unmistakably appositive and always count.
  if (!bracketed && (text[cursor + tokenLength] === "は" || text[cursor + tokenLength] === "が")) {
    return null;
  }
  return { index: cursor, length: tokenLength, weekday, tokenLength };
}

function scanDateMentions(text: string): DateMention[] {
  const mentions: DateMention[] = [];
  const fullSpans: { index: number; length: number }[] = [];
  for (const match of text.matchAll(FULL_DATE_PATTERN)) {
    if (match.index === undefined) continue;
    // Not the tail of a longer digit run (e.g. a 5-digit "year").
    if (match.index > 0 && /\d/.test(text[match.index - 1])) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    // An invalid calendar date (2026年2月30日) is not a date mention
    // this verifier can act on; it passes through untouched.
    if (!isValidDate(year, month, day)) continue;
    fullSpans.push({ index: match.index, length: match[0].length });
    mentions.push({
      index: match.index,
      length: match[0].length,
      full: true,
      year,
      yearActionable: true,
      month,
      day,
      monthPadded: match[2].startsWith("0"),
      dayPadded: match[3].startsWith("0"),
      weekday: scanWeekdayAttachment(text, match.index + match[0].length),
    });
  }
  for (const match of text.matchAll(SHORT_DATE_PATTERN)) {
    if (match.index === undefined) continue;
    if (match.index > 0 && /\d/.test(text[match.index - 1])) continue;
    // The M月D日 tail of a full date is the same mention, not another.
    if (fullSpans.some((span) => match.index >= span.index && match.index < span.index + span.length)) continue;
    const month = Number(match[1]);
    const day = Number(match[2]);
    // February gets its leap-year maximum here; the resolved year
    // decides validity for the specific year during verification.
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(2024, month)) continue;
    mentions.push({
      index: match.index,
      length: match[0].length,
      full: false,
      year: null,
      yearActionable: false,
      month,
      day,
      monthPadded: match[1].startsWith("0"),
      dayPadded: match[2].startsWith("0"),
      weekday: scanWeekdayAttachment(text, match.index + match[0].length),
    });
  }
  mentions.sort((a, b) => a.index - b.index);
  return mentions;
}

/**
 * Resolve short-date years for one text's mentions. The candidate
 * years are the explicit years used by the answer and the question:
 * exactly one distinct year makes every short date that year
 * (correction-grade). No year anywhere falls back to the current year
 * (detection-grade only). Two or more distinct years leave short
 * dates unresolved — the verifier passes them through.
 */
function resolveMentionYears(
  mentions: DateMention[],
  contextMentions: readonly DateMention[],
  now: Date,
): void {
  const years = new Set<number>();
  for (const mention of [...mentions, ...contextMentions]) {
    if (mention.full && mention.year !== null) years.add(mention.year);
  }
  if (years.size === 1) {
    const [year] = years;
    for (const mention of mentions) {
      if (!mention.full) {
        mention.year = year;
        mention.yearActionable = true;
      }
    }
  } else if (years.size === 0) {
    const year = jstDateValue(now).year;
    for (const mention of mentions) {
      if (!mention.full) mention.year = year;
    }
  }
}

function mentionValue(mention: DateMention): DateValue | null {
  if (mention.year === null) return null;
  if (!isValidDate(mention.year, mention.month, mention.day)) return null;
  return { year: mention.year, month: mention.month, day: mention.day };
}

// ---------------------------------------------------------------------------
// (b) Relative-date expectation from the question
// ---------------------------------------------------------------------------

const OFFSET_PATTERN = /(\d{1,4})日(後|前)/g;
const DAY_WORDS: readonly (readonly [string, number])[] = [
  ["今日", 0],
  ["明日", 1],
  ["昨日", -1],
];

interface RelativeExpectation {
  base: DateValue;
  expected: DateValue;
}

function deriveRelativeExpectation(
  questionText: string,
  questionMentions: readonly DateMention[],
  now: Date,
): RelativeExpectation | null {
  let base: DateValue | null = null;
  let searchFrom = 0;
  const distinctDates = new Map<string, { value: DateValue; end: number }>();
  for (const mention of questionMentions) {
    const value = mentionValue(mention);
    if (value === null) continue;
    if (!distinctDates.has(dateKey(value))) {
      distinctDates.set(dateKey(value), { value, end: mention.index + mention.length });
    }
  }
  if (distinctDates.size === 1) {
    const [only] = distinctDates.values();
    base = only.value;
    searchFrom = only.end;
  } else if (distinctDates.size === 0) {
    // No explicit date: 今日/明日/昨日 can still serve as the base.
    const found = DAY_WORDS.filter(([word]) => questionText.includes(word));
    if (found.length === 1) {
      base = addDays(jstDateValue(now), found[0][1]);
      searchFrom = 0;
    }
  }
  if (base === null) return null;
  const offsets = new Map<string, number>();
  for (const match of questionText.matchAll(OFFSET_PATTERN)) {
    if (match.index === undefined || match.index < searchFrom) continue;
    const amount = Number(match[1]);
    if (amount <= 0) continue;
    offsets.set(`${amount}:${match[2]}`, match[2] === "後" ? amount : -amount);
  }
  if (offsets.size !== 1) return null;
  const [offset] = offsets.values();
  return { base, expected: addDays(base, offset) };
}

/**
 * Identify the answer's asserted result date for a relative question.
 * Candidates are the non-base mentions carrying a weekday (the shape
 * of a final answer to a "何月何日で何曜日ですか" question); if none,
 * the non-base mentions of the first sentence. Anything other than
 * exactly one distinct value is ambiguous and passes through.
 */
function identifyAssertedResult(
  answerText: string,
  answerMentions: readonly DateMention[],
  base: DateValue,
): DateValue | null {
  const nonBase: { mention: DateMention; value: DateValue }[] = [];
  for (const mention of answerMentions) {
    const value = mentionValue(mention);
    if (value === null || sameDate(value, base)) continue;
    nonBase.push({ mention, value });
  }
  const distinctOf = (items: readonly { value: DateValue }[]): DateValue | null => {
    const distinct = new Map<string, DateValue>();
    for (const item of items) distinct.set(dateKey(item.value), item.value);
    return distinct.size === 1 ? [...distinct.values()][0] : null;
  };
  const withWeekday = distinctOf(nonBase.filter((item) => item.mention.weekday !== null));
  if (withWeekday !== null) return withWeekday;
  if (nonBase.some((item) => item.mention.weekday !== null)) return null;
  const terminators = [answerText.indexOf("。"), answerText.indexOf("\n")].filter((i) => i >= 0);
  const firstSentenceEnd = terminators.length > 0 ? Math.min(...terminators) : answerText.length;
  return distinctOf(nonBase.filter((item) => item.mention.index < firstSentenceEnd));
}

// ---------------------------------------------------------------------------
// Verification core
// ---------------------------------------------------------------------------

interface SpanFix {
  index: number;
  length: number;
  replacement: string;
}

interface VerificationAnalysis {
  summary: OriginDateWeekdayVerificationSummary;
  fixes: SpanFix[];
}

function renderWeekday(weekday: number, tokenLength: number): string {
  const char = WEEKDAY_CHARS[weekday];
  if (tokenLength === 3) return `${char}曜日`;
  if (tokenLength === 2) return `${char}曜`;
  return char;
}

function renderDate(value: DateValue, mention: DateMention): string {
  const month = mention.monthPadded ? String(value.month).padStart(2, "0") : String(value.month);
  const day = mention.dayPadded ? String(value.day).padStart(2, "0") : String(value.day);
  return mention.full ? `${value.year}年${month}月${day}日` : `${month}月${day}日`;
}

function analyze(input: {
  answerText: string;
  questionText: string;
  now: Date;
}): VerificationAnalysis {
  const answerText = input.answerText.slice(0, MAX_SCAN_CHARS);
  const questionText = input.questionText.slice(0, MAX_SCAN_CHARS);
  const normalizedAnswer = normalizeDigits(answerText);
  const normalizedQuestion = normalizeDigits(questionText);
  const answerMentions = scanDateMentions(normalizedAnswer);
  const questionMentions = scanDateMentions(normalizedQuestion);
  resolveMentionYears(answerMentions, questionMentions, input.now);
  resolveMentionYears(questionMentions, [], input.now);

  const summary: OriginDateWeekdayVerificationSummary = {
    pairCount: 0,
    weekdayMismatchCount: 0,
    relativeChecked: false,
    relativeMismatch: false,
    relativeAmbiguous: false,
    fixableCount: 0,
    correctedCount: 0,
    correctionReverted: false,
  };
  const fixes: SpanFix[] = [];
  const replacedMentions = new Set<DateMention>();

  // (b) first: a replaced result mention's weekday belongs to the
  // recomputed date, so (a) must not also "fix" it against the stated
  // (wrong) date below.
  const expectation = deriveRelativeExpectation(normalizedQuestion, questionMentions, input.now);
  if (expectation !== null) {
    summary.relativeChecked = true;
    const asserted = identifyAssertedResult(normalizedAnswer, answerMentions, expectation.base);
    if (asserted === null) {
      summary.relativeAmbiguous = true;
    } else if (!sameDate(asserted, expectation.expected)) {
      summary.relativeMismatch = true;
      const expectedWeekday = weekdayOf(expectation.expected.year, expectation.expected.month, expectation.expected.day);
      for (const mention of answerMentions) {
        const value = mentionValue(mention);
        if (value === null || !sameDate(value, asserted)) continue;
        replacedMentions.add(mention);
        fixes.push({
          index: mention.index,
          length: mention.length,
          replacement: renderDate(expectation.expected, mention),
        });
        if (mention.weekday !== null) {
          const replacement = renderWeekday(expectedWeekday, mention.weekday.tokenLength);
          if (normalizedAnswer.slice(mention.weekday.index, mention.weekday.index + mention.weekday.length) !== replacement) {
            fixes.push({ index: mention.weekday.index, length: mention.weekday.length, replacement });
          }
        }
      }
    }
  }

  // (a) every asserted date+weekday pair in the answer.
  for (const mention of answerMentions) {
    if (mention.weekday === null) continue;
    const value = mentionValue(mention);
    if (value === null) continue;
    summary.pairCount += 1;
    const actual = weekdayOf(value.year, value.month, value.day);
    if (actual === mention.weekday.weekday) continue;
    summary.weekdayMismatchCount += 1;
    if (replacedMentions.has(mention)) continue;
    if (!mention.yearActionable) continue;
    fixes.push({
      index: mention.weekday.index,
      length: mention.weekday.length,
      replacement: renderWeekday(actual, mention.weekday.tokenLength),
    });
  }

  return { summary, fixes };
}

/** Apply disjoint span fixes; returns null if any two fixes overlap. */
function applyFixes(text: string, fixes: readonly SpanFix[]): string | null {
  const sorted = [...fixes].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].index < sorted[i - 1].index + sorted[i - 1].length) return null;
  }
  let result = text;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const fix = sorted[i];
    result = result.slice(0, fix.index) + fix.replacement + result.slice(fix.index + fix.length);
  }
  return result;
}

export interface OriginDateWeekdayVerification {
  summary: OriginDateWeekdayVerificationSummary;
  /** Corrected text when fixes apply and re-verify clean; otherwise null. */
  correctedText: string | null;
}

/**
 * Pure verification core: detect (a) and (b), compute the conservative
 * corrections, and confirm them by re-verifying the corrected text.
 * A correction whose result still shows an actionable mismatch is
 * discarded (correctionReverted) so enforcement can never deliver a
 * half-fixed answer.
 */
export function verifyOriginDateWeekdays(input: {
  answerText: string;
  questionText?: string;
  now?: Date;
}): OriginDateWeekdayVerification {
  const now = input.now ?? new Date();
  const questionText = input.questionText ?? "";
  const first = analyze({ answerText: input.answerText, questionText, now });
  const summary = { ...first.summary };
  if (first.fixes.length === 0) return { summary, correctedText: null };
  summary.fixableCount = first.fixes.length;
  const corrected = applyFixes(input.answerText, first.fixes);
  if (corrected === null) {
    summary.correctionReverted = true;
    return { summary, correctedText: null };
  }
  const second = analyze({ answerText: corrected, questionText, now });
  // Fixes are exactly the actionable remainder: a mismatch on a
  // correction-grade mention always yields a fix, and a relative
  // mismatch always yields fixes. Detection-grade mismatches (a short
  // date whose year only the current date supplies) yield none, so
  // they never block a correction they are not part of.
  const actionableRemaining = second.summary.relativeMismatch || second.fixes.length > 0;
  if (actionableRemaining) {
    summary.correctionReverted = true;
    return { summary, correctedText: null };
  }
  return { summary, correctedText: corrected };
}

// ---------------------------------------------------------------------------
// Gate hook (router wiring)
// ---------------------------------------------------------------------------

type GateLogger = (message: string, fields: Record<string, unknown>) => void;

function emitSummaryLog(
  logger: GateLogger,
  message: string,
  requestId: string,
  mode: OriginDateWeekdayVerificationMode,
  summary: OriginDateWeekdayVerificationSummary,
): void {
  logger(message, {
    requestId,
    dateVerificationMode: mode,
    dateVerificationPairCount: summary.pairCount,
    dateVerificationWeekdayMismatchCount: summary.weekdayMismatchCount,
    dateVerificationRelativeChecked: summary.relativeChecked ? 1 : 0,
    dateVerificationRelativeMismatchCount: summary.relativeMismatch ? 1 : 0,
    dateVerificationRelativeAmbiguousCount: summary.relativeAmbiguous ? 1 : 0,
    dateVerificationFixableCount: summary.fixableCount,
    dateVerificationCorrectedCount: summary.correctedCount,
    dateVerificationCorrectionReverted: summary.correctionReverted ? 1 : 0,
  });
}

/**
 * The gate for the direct-answer paths, mirroring the numeric audit
 * gate's apply function. Shadow mode (default) logs the summary and
 * returns the answer untouched; enforce mode returns the verified
 * correction when one exists. Never throws.
 */
export function applyOriginDateWeekdayVerificationGate(input: {
  requestId: string;
  answerText: string;
  requestText?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  logger?: GateLogger;
}): OriginDateWeekdayVerificationOutcome {
  const mode = resolveOriginDateWeekdayVerificationMode(input.env);
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const verification = verifyOriginDateWeekdays({
      answerText: input.answerText,
      questionText: input.requestText,
      now: input.now,
    });
    if (mode === "enforce" && verification.correctedText !== null) {
      const summary: OriginDateWeekdayVerificationSummary = {
        ...verification.summary,
        correctedCount: verification.summary.fixableCount,
      };
      emitSummaryLog(logger, "[origin-chat] date weekday verification (enforce)", input.requestId, mode, summary);
      return { mode, answerText: verification.correctedText, summary };
    }
    emitSummaryLog(
      logger,
      mode === "enforce"
        ? "[origin-chat] date weekday verification (enforce)"
        : "[origin-chat] date weekday verification (shadow)",
      input.requestId,
      mode,
      verification.summary,
    );
    return { mode, answerText: input.answerText, summary: verification.summary };
  } catch (error) {
    logger("[origin-chat] date weekday verification failed", {
      requestId: input.requestId,
      gateError: error instanceof Error ? error.name : "UnknownError",
    });
    return { mode, answerText: input.answerText, summary: null };
  }
}

/**
 * Log-only hook for paths that deliver text this gate did not process
 * (the streaming router's unbuffered delivery): run the detector, log
 * kinds and counts only, and return the summary. Never throws and
 * never touches the answer.
 */
export function logOriginDateWeekdayVerificationShadow(input: {
  requestId: string;
  answerText: string;
  questionText?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  logger?: GateLogger;
}): OriginDateWeekdayVerificationSummary | null {
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const verification = verifyOriginDateWeekdays({
      answerText: input.answerText,
      questionText: input.questionText,
      now: input.now,
    });
    emitSummaryLog(
      logger,
      "[origin-chat] date weekday verification (shadow)",
      input.requestId,
      resolveOriginDateWeekdayVerificationMode(input.env),
      verification.summary,
    );
    return verification.summary;
  } catch (error) {
    logger("[origin-chat] date weekday verification failed", {
      requestId: input.requestId,
      gateError: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

/**
 * Streaming arming heuristic for enforce mode: buffer the stream for
 * deterministic correction only when the question itself carries date
 * material (a date expression, an N日後/日前 offset, or a weekday
 * question). Other questions keep progressive streaming untouched;
 * their answers are still detection-logged by the shadow hook.
 */
export function originDateWeekdayVerificationMayApply(questionText: string): boolean {
  const question = normalizeDigits(questionText);
  return (
    /\d{4}年\d{1,2}月\d{1,2}日/.test(question) ||
    /\d{1,2}月\d{1,2}日/.test(question) ||
    /\d{1,4}日(?:後|前)/.test(question) ||
    /何曜日|何日|曜日/.test(question)
  );
}
