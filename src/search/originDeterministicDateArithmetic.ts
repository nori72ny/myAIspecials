/**
 * Deterministic date ARITHMETIC questions — the shape family the
 * deterministic date route (follow-up measure 1,
 * ANSWER_FOLLOWUP_DIAGNOSIS_2026-11-26) did not own.
 *
 * The sibling module (originDeterministicDateAnswer) enumerates only
 * "a relative day's weekday or date" and "the weekday of a fully
 * specified date". A question that asks for date arithmetic —
 * 「2026年11月28日の45日後は何日ですか？」, 「今日から45日後は？」,
 * 「2026年12月25日まであと何日ですか？」 — supplies every input in
 * the question itself (plus, for the relative shapes, the server
 * clock), so its answer is a pure function and needs no source. Yet
 * no layer owned computing it: the phrasing fell either to the model
 * (whose calendar arithmetic is unreliable) or — when the wording
 * carried a freshness marker such as 今日 — into fresh_general,
 * whose promotion sent it down the grounded path, where a retrieval
 * failure landed it on the tier-T4 abstention (production-observed
 * 2026-11-28, independent re-scoring: "45 days after 2026-11-28"
 * refused with "出典を取得できませんでした"). Same category error
 * as the original weekday defect, one shape family over.
 *
 * This module owns it, as a SEPARATE module with its own integration
 * points so it composes with (never edits) the sibling date module
 * and the deterministic calculation route. The parser is
 * WHOLE-QUESTION strict: only the enumerated shapes parse. A
 * question that merely CONTAINS a date or an offset — 「45日後に
 * 提出する書類の書き方を教えてください」, 「2026年11月28日は
 * 何の日ですか？」 (an anniversary is an external fact, not
 * arithmetic), 「クリスマスまであと何日？」 (the named date is not
 * in the question) — does not parse and keeps its existing route.
 * The both-direction discipline is pinned by tests.
 *
 * Arithmetic uses the same civil-date primitives as the sibling
 * module (OriginDateWeekdayVerification); month offsets clamp the
 * day to the target month's last day (Jan 31 + 1 month = Feb 28/29),
 * the standard civil convention. No search, no model, no freshness
 * gate.
 */
import {
  originAddDaysToCivilDate,
  originIsValidCivilDate,
  originJstCivilDate,
  originWeekdayOfCivilDate,
  type OriginDateValue,
} from "../lib/orchestration/OriginDateWeekdayVerification.js";

export type OriginDateArithmeticBase =
  | { type: "absolute"; date: OriginDateValue }
  | { type: "relative"; dayOffset: number; word: string }
  | { type: "today" };

export type OriginDeterministicDateArithmeticQuestion =
  | {
      kind: "offset";
      language: "ja" | "en";
      base: OriginDateArithmeticBase;
      offset: { unit: "day" | "week" | "month"; amount: number; direction: 1 | -1 };
    }
  | {
      kind: "difference";
      language: "ja" | "en";
      from: OriginDateArithmeticBase;
      to: OriginDateArithmeticBase;
    };

const JA_RELATIVE_DAYS: ReadonlyArray<{ word: string; offset: number }> = [
  { word: "明後日", offset: 2 },
  { word: "一昨日", offset: -2 },
  { word: "今日", offset: 0 },
  { word: "明日", offset: 1 },
  { word: "昨日", offset: -1 },
];

const EN_MONTH_INDEX: Readonly<Record<string, number>> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const EN_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const EN_WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const JA_WEEKDAY_CHARS = ["日", "月", "火", "水", "木", "金", "土"];

const JA_TRAILING = "(?:ですか|です|でしょう|かな|だ|なの|の)?";
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set(["。", ".", "？", "?", "！", "!"]);
const EN_MONTH_PATTERN = Object.keys(EN_MONTH_INDEX).join("|");

/** Offset bounds: beyond a century of days the shape is not a plausible calendar question. */
const MAX_DAY_OFFSET = 36_500;
const MAX_WEEK_OFFSET = 5_200;
const MAX_MONTH_OFFSET = 1_200;

const JA_DATE_PATTERN =
  "(?:(\\d{4})年(\\d{1,2})月(\\d{1,2})日|令和(元|\\d{1,2})年(\\d{1,2})月(\\d{1,2})日)";
const JA_ASK_PATTERN = "(?:何月何日|何日|何曜日)";
const JA_UNIT_PATTERN = "(\\d{1,5})(日|週間|か月|ヶ月|月|年)(後|前)";

function warekiToGregorianYear(token: string): number {
  return 2018 + (token === "元" ? 1 : Number(token));
}

function validDate(year: number, month: number, day: number): OriginDateValue | null {
  const date = { year, month, day };
  return originIsValidCivilDate(date) ? date : null;
}

/** Extract the absolute date from a JA_DATE_PATTERN match (groups 1-3 seireki, 4-6 wareki). */
function jaDateFromMatch(match: RegExpMatchArray, offset: number): OriginDateValue | null {
  if (match[offset] !== undefined) {
    return validDate(Number(match[offset]), Number(match[offset + 1]), Number(match[offset + 2]));
  }
  if (match[offset + 3] !== undefined) {
    return validDate(
      warekiToGregorianYear(match[offset + 3]),
      Number(match[offset + 4]),
      Number(match[offset + 5]),
    );
  }
  return null;
}

function jaUnitOffset(
  amountToken: string,
  unitToken: string,
  directionToken: string,
): { unit: "day" | "week" | "month"; amount: number; direction: 1 | -1 } | null {
  const amount = Number(amountToken);
  if (!Number.isInteger(amount) || amount < 1) return null;
  const direction: 1 | -1 = directionToken === "後" ? 1 : -1;
  if (unitToken === "日") {
    return amount <= MAX_DAY_OFFSET ? { unit: "day", amount, direction } : null;
  }
  if (unitToken === "週間") {
    return amount <= MAX_WEEK_OFFSET ? { unit: "week", amount, direction } : null;
  }
  // か月 / ヶ月 / 月, and 年 as twelve months.
  const months = unitToken === "年" ? amount * 12 : amount;
  return months <= MAX_MONTH_OFFSET ? { unit: "month", amount: months, direction } : null;
}

function parseJa(message: string): OriginDeterministicDateArithmeticQuestion | null {
  const core = message;

  // Offset from an absolute date: 「2026年11月28日の45日後は何日ですか？」
  const absoluteOffset = core.match(
    new RegExp(`^${JA_DATE_PATTERN}の${JA_UNIT_PATTERN}は?${JA_ASK_PATTERN}${JA_TRAILING}$`),
  );
  if (absoluteOffset) {
    const date = jaDateFromMatch(absoluteOffset, 1);
    const offset = jaUnitOffset(absoluteOffset[7], absoluteOffset[8], absoluteOffset[9]);
    if (!date || !offset) return null;
    return { kind: "offset", language: "ja", base: { type: "absolute", date }, offset };
  }

  // Offset from a relative day word: 「今日から45日後は何日ですか？」
  for (const { word, offset } of JA_RELATIVE_DAYS) {
    const relativeOffset = core.match(
      new RegExp(`^${word}から${JA_UNIT_PATTERN}は?${JA_ASK_PATTERN}${JA_TRAILING}$`),
    );
    if (relativeOffset) {
      const parsed = jaUnitOffset(relativeOffset[1], relativeOffset[2], relativeOffset[3]);
      if (!parsed) return null;
      return {
        kind: "offset",
        language: "ja",
        base: { type: "relative", dayOffset: offset, word },
        offset: parsed,
      };
    }
  }

  // Bare offset (base is today): 「45日後は何日ですか？」
  const bareOffset = core.match(
    new RegExp(`^${JA_UNIT_PATTERN}は?${JA_ASK_PATTERN}${JA_TRAILING}$`),
  );
  if (bareOffset) {
    const offset = jaUnitOffset(bareOffset[1], bareOffset[2], bareOffset[3]);
    if (!offset) return null;
    return { kind: "offset", language: "ja", base: { type: "today" }, offset };
  }

  // Difference between two absolute dates:
  // 「2026年11月28日から2026年12月25日までは何日ですか？」
  const spanDifference = core.match(
    new RegExp(
      `^${JA_DATE_PATTERN}から${JA_DATE_PATTERN}まで(?:は)?(?:あと)?(?:何日|何日間)(?:ありますか|あります|ですか|か)?${JA_TRAILING}$`,
    ),
  );
  if (spanDifference) {
    const from = jaDateFromMatch(spanDifference, 1);
    const to = jaDateFromMatch(spanDifference, 7);
    if (!from || !to) return null;
    return {
      kind: "difference",
      language: "ja",
      from: { type: "absolute", date: from },
      to: { type: "absolute", date: to },
    };
  }

  // Difference between two absolute dates, comparison form:
  // 「2026年11月28日と2026年12月25日では何日違いますか？」
  const compareDifference = core.match(
    new RegExp(
      `^${JA_DATE_PATTERN}と${JA_DATE_PATTERN}(?:は|では)(?:何日|何日間)(?:違い|差が)(?:ありますか|あります|ますか|ます)?${JA_TRAILING}$`,
    ),
  );
  if (compareDifference) {
    const from = jaDateFromMatch(compareDifference, 1);
    const to = jaDateFromMatch(compareDifference, 7);
    if (!from || !to) return null;
    return {
      kind: "difference",
      language: "ja",
      from: { type: "absolute", date: from },
      to: { type: "absolute", date: to },
    };
  }

  // Days until an absolute date, from a relative day word or today:
  // 「今日から2026年12月25日まであと何日ですか？」/「2026年12月25日まであと何日ですか？」
  for (const { word, offset } of JA_RELATIVE_DAYS) {
    const until = core.match(
      new RegExp(`^${word}から${JA_DATE_PATTERN}まで(?:は)?(?:あと)?(?:何日|何日間)(?:ありますか|あります|ですか|か)?${JA_TRAILING}$`),
    );
    if (until) {
      const to = jaDateFromMatch(until, 1);
      if (!to) return null;
      return {
        kind: "difference",
        language: "ja",
        from: { type: "relative", dayOffset: offset, word },
        to: { type: "absolute", date: to },
      };
    }
  }
  const untilBare = core.match(
    new RegExp(`^${JA_DATE_PATTERN}まで(?:は)?あと(?:何日|何日間)(?:ですか|か)?${JA_TRAILING}$`),
  );
  if (untilBare) {
    const to = jaDateFromMatch(untilBare, 1);
    if (!to) return null;
    return {
      kind: "difference",
      language: "ja",
      from: { type: "today" },
      to: { type: "absolute", date: to },
    };
  }
  return null;
}

function parseEn(message: string): OriginDeterministicDateArithmeticQuestion | null {
  const lower = message.toLowerCase();

  const offsetFromDate = lower.match(
    new RegExp(
      `^what (?:date|day) is (\\d{1,5}) days? (after|before) (${EN_MONTH_PATTERN}) (\\d{1,2})(?:st|nd|rd|th)?, (\\d{4})$`,
    ),
  );
  if (offsetFromDate) {
    const amount = Number(offsetFromDate[1]);
    const date = validDate(
      Number(offsetFromDate[5]),
      EN_MONTH_INDEX[offsetFromDate[3]],
      Number(offsetFromDate[4]),
    );
    if (!date || amount < 1 || amount > MAX_DAY_OFFSET) return null;
    return {
      kind: "offset",
      language: "en",
      base: { type: "absolute", date },
      offset: { unit: "day", amount, direction: offsetFromDate[2] === "after" ? 1 : -1 },
    };
  }

  const offsetFromToday = lower.match(
    /^what (?:date|day) is (\d{1,5}) days? (after|before|from) today$/,
  );
  if (offsetFromToday) {
    const amount = Number(offsetFromToday[1]);
    if (amount < 1 || amount > MAX_DAY_OFFSET) return null;
    return {
      kind: "offset",
      language: "en",
      base: { type: "today" },
      offset: { unit: "day", amount, direction: offsetFromToday[2] === "before" ? -1 : 1 },
    };
  }

  const between = lower.match(
    new RegExp(
      `^how many days (?:are there )?between (${EN_MONTH_PATTERN}) (\\d{1,2})(?:st|nd|rd|th)?, (\\d{4}) and (${EN_MONTH_PATTERN}) (\\d{1,2})(?:st|nd|rd|th)?, (\\d{4})$`,
    ),
  );
  if (between) {
    const from = validDate(Number(between[3]), EN_MONTH_INDEX[between[1]], Number(between[2]));
    const to = validDate(Number(between[6]), EN_MONTH_INDEX[between[4]], Number(between[5]));
    if (!from || !to) return null;
    return {
      kind: "difference",
      language: "en",
      from: { type: "absolute", date: from },
      to: { type: "absolute", date: to },
    };
  }

  const until = lower.match(
    new RegExp(`^how many days until (${EN_MONTH_PATTERN}) (\\d{1,2})(?:st|nd|rd|th)?, (\\d{4})$`),
  );
  if (until) {
    const to = validDate(Number(until[3]), EN_MONTH_INDEX[until[1]], Number(until[2]));
    if (!to) return null;
    return {
      kind: "difference",
      language: "en",
      from: { type: "today" },
      to: { type: "absolute", date: to },
    };
  }
  return null;
}

/**
 * Parse a whole question into a deterministic date-arithmetic
 * question, or null when the question is anything else. Extending
 * the shape set is a deliberate act (each new shape must keep the
 * both-direction tests green), not a parser relaxation.
 */
export function parseOriginDeterministicDateArithmeticQuestion(
  message: string,
): OriginDeterministicDateArithmeticQuestion | null {
  const normalized = (message ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  let coreEnd = normalized.length;
  while (coreEnd > 0 && TRAILING_PUNCTUATION.has(normalized[coreEnd - 1] as string)) coreEnd -= 1;
  const core = normalized.slice(0, coreEnd).trim();
  if (!core) return null;
  return parseJa(core) ?? parseEn(core);
}

/** Days from civil date (Howard Hinnant's algorithm) — the difference primitive. */
function daysFromCivil(date: OriginDateValue): number {
  const year = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const monthPrime = (date.month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + date.day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return lengths[month - 1];
}

/** Month offset with the day clamped to the target month's last day. */
function addMonthsClamped(date: OriginDateValue, months: number): OriginDateValue {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(date.day, daysInMonth(year, month));
  return { year, month, day };
}

function resolveBase(base: OriginDateArithmeticBase, nowMs: number): OriginDateValue {
  if (base.type === "absolute") return base.date;
  const today = originJstCivilDate(nowMs);
  if (base.type === "today") return today;
  return originAddDaysToCivilDate(today, base.dayOffset);
}

function formatJaDate(date: OriginDateValue): string {
  return `${date.year}年${date.month}月${date.day}日`;
}

function formatEnDate(date: OriginDateValue): string {
  return `${EN_MONTH_NAMES[date.month - 1]} ${date.day}, ${date.year}`;
}

/**
 * The deterministic answer, computed from the server clock
 * (Asia/Tokyo) for the relative shapes — the same clock the sibling
 * date route and the injected current-date instruction use.
 */
export function buildOriginDeterministicDateArithmeticAnswer(
  question: OriginDeterministicDateArithmeticQuestion,
  nowMs: number,
): string {
  if (question.kind === "offset") {
    const baseDate = resolveBase(question.base, nowMs);
    const { unit, amount, direction } = question.offset;
    const target =
      unit === "month"
        ? addMonthsClamped(baseDate, amount * direction)
        : originAddDaysToCivilDate(baseDate, (unit === "week" ? amount * 7 : amount) * direction);
    const weekday = originWeekdayOfCivilDate(target);
    if (question.language === "en") {
      const baseText =
        question.base.type === "absolute"
          ? formatEnDate(baseDate)
          : question.base.type === "relative"
            ? question.base.word
            : "today";
      const unitText = unit === "day" ? "days" : unit === "week" ? "weeks" : "months";
      return `${amount} ${unitText} ${direction === 1 ? "after" : "before"} ${baseText} is ${EN_WEEKDAY_NAMES[weekday]}, ${formatEnDate(target)}.`;
    }
    const unitText = unit === "day" ? "日" : unit === "week" ? "週間" : "か月";
    const baseText =
      question.base.type === "absolute"
        ? `${formatJaDate(baseDate)}の`
        : question.base.type === "relative"
          ? `${question.base.word}から`
          : "今日から";
    return `${baseText}${amount}${unitText}${direction === 1 ? "後" : "前"}は${formatJaDate(target)}（${JA_WEEKDAY_CHARS[weekday]}曜日）です。`;
  }

  const fromDate = resolveBase(question.from, nowMs);
  const toDate = resolveBase(question.to, nowMs);
  const diff = daysFromCivil(toDate) - daysFromCivil(fromDate);
  if (question.language === "en") {
    if (question.from.type === "today") {
      return diff >= 0
        ? `There are ${diff} days from today until ${formatEnDate(toDate)}.`
        : `${formatEnDate(toDate)} was ${-diff} days ago and has already passed.`;
    }
    return diff >= 0
      ? `There are ${diff} days from ${formatEnDate(fromDate)} to ${formatEnDate(toDate)}.`
      : `${formatEnDate(toDate)} is ${-diff} days before ${formatEnDate(fromDate)}.`;
  }
  if (question.from.type === "today") {
    return diff >= 0
      ? `今日から${formatJaDate(toDate)}まではあと${diff}日です。`
      : `${formatJaDate(toDate)}は今日より${-diff}日前で、すでに過ぎています。`;
  }
  const fromText =
    question.from.type === "relative" ? question.from.word : formatJaDate(fromDate);
  return diff >= 0
    ? `${fromText}から${formatJaDate(toDate)}までは${diff}日です。`
    : `${formatJaDate(toDate)}は${fromText}より${-diff}日前です。`;
}
