/**
 * Deterministic date questions — follow-up measure 1
 * (ANSWER_FOLLOWUP_DIAGNOSIS_2026-11-26).
 *
 * 「今日は何曜日ですか？」 was refused in production twice
 * (2026-11-25 and the 2026-11-26 post-deploy check): the
 * classifier has no class for "the answer is a function of the
 * clock", so the bare 今日 fell into the freshness-marker rule,
 * the fresh_general gate wiped the undated calendar pages, and
 * the ladder landed on the no-fresh-sources abstention. The
 * question needs no source at all — its answer is computed from
 * the calendar — yet no layer owned computing it: the injected
 * current-date instruction names the year/month/day but not the
 * weekday, and the research path never reaches generation anyway.
 *
 * This module owns it. The parser is WHOLE-QUESTION strict: only
 * the enumerated shapes parse (a relative day's weekday or date,
 * and the weekday of a fully specified date). Anything that
 * merely CONTAINS a day word — 今日のニュース, 今日の天気,
 * 今日は何日までにやるべき？ — does not parse and keeps its
 * research / weather route; the both-direction discipline is
 * pinned by tests. The answer is built with the civil-date
 * arithmetic of OriginDateWeekdayVerification (the same
 * arithmetic that verifies model-stated weekdays), from the
 * server clock in Asia/Tokyo. No search, no model, no freshness
 * gate.
 */
import {
  originAddDaysToCivilDate,
  originIsValidCivilDate,
  originJstCivilDate,
  originWeekdayOfCivilDate,
  type OriginDateValue,
} from "../lib/orchestration/OriginDateWeekdayVerification.js";

export type OriginDeterministicDateQuestion =
  | {
      kind: "weekday" | "date";
      language: "ja" | "en";
      target: { type: "relative"; dayOffset: number; word: string };
    }
  | {
      kind: "weekday";
      language: "ja" | "en";
      target: { type: "absolute"; date: OriginDateValue };
    };

const JA_RELATIVE_DAYS: ReadonlyArray<{ word: string; offset: number }> = [
  { word: "明後日", offset: 2 },
  { word: "一昨日", offset: -2 },
  { word: "今日", offset: 0 },
  { word: "明日", offset: 1 },
  { word: "昨日", offset: -1 },
];

const EN_RELATIVE_DAYS: Readonly<Record<string, number>> = {
  today: 0,
  tomorrow: 1,
  yesterday: -1,
};

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

/** Sentence-final punctuation stripped before shape matching (manual loop, no regex on user input). */
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set(["。", ".", "？", "?", "！", "!"]);
const EN_MONTH_PATTERN = Object.keys(EN_MONTH_INDEX).join("|");

function warekiToGregorianYear(token: string): number {
  return 2018 + (token === "元" ? 1 : Number(token));
}

function validDate(year: number, month: number, day: number): OriginDateValue | null {
  const date = { year, month, day };
  return originIsValidCivilDate(date) ? date : null;
}

/**
 * Parse a whole question into a deterministic date question, or
 * null when the question is anything else. The shapes are the
 * diagnosis report's enumeration — extending them is a deliberate
 * act (each new shape must keep the both-direction tests green),
 * not a parser relaxation.
 */
export function parseOriginDeterministicDateQuestion(
  message: string,
): OriginDeterministicDateQuestion | null {
  const normalized = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  let coreEnd = normalized.length;
  while (coreEnd > 0 && TRAILING_PUNCTUATION.has(normalized[coreEnd - 1] as string)) coreEnd -= 1;
  const core = normalized.slice(0, coreEnd).trim();
  if (!core) return null;

  for (const { word, offset } of JA_RELATIVE_DAYS) {
    if (new RegExp(`^${word}は?何曜日${JA_TRAILING}$`).test(core)) {
      return { kind: "weekday", language: "ja", target: { type: "relative", dayOffset: offset, word } };
    }
    if (new RegExp(`^${word}は?(?:何月何日|何日)${JA_TRAILING}$`).test(core)) {
      return { kind: "date", language: "ja", target: { type: "relative", dayOffset: offset, word } };
    }
  }

  const absoluteSeireki = core.match(new RegExp(`^(\\d{4})年(\\d{1,2})月(\\d{1,2})日は?何曜日${JA_TRAILING}$`));
  if (absoluteSeireki) {
    const date = validDate(Number(absoluteSeireki[1]), Number(absoluteSeireki[2]), Number(absoluteSeireki[3]));
    return date ? { kind: "weekday", language: "ja", target: { type: "absolute", date } } : null;
  }
  const absoluteWareki = core.match(new RegExp(`^令和(元|\\d{1,2})年(\\d{1,2})月(\\d{1,2})日は?何曜日${JA_TRAILING}$`));
  if (absoluteWareki) {
    const date = validDate(warekiToGregorianYear(absoluteWareki[1]), Number(absoluteWareki[2]), Number(absoluteWareki[3]));
    return date ? { kind: "weekday", language: "ja", target: { type: "absolute", date } } : null;
  }

  const lower = core.toLowerCase();
  const enRelativeWeekday = lower.match(/^(?:what day of the week is|what day is) (?:it )?(today|tomorrow|yesterday)$/);
  if (enRelativeWeekday) {
    const word = enRelativeWeekday[1];
    return { kind: "weekday", language: "en", target: { type: "relative", dayOffset: EN_RELATIVE_DAYS[word], word } };
  }
  const enRelativeDate = lower.match(/^what (?:date|day) is (?:it )?(today|tomorrow|yesterday)$/);
  if (enRelativeDate) {
    const word = enRelativeDate[1];
    return { kind: "date", language: "en", target: { type: "relative", dayOffset: EN_RELATIVE_DAYS[word], word } };
  }
  const enAbsolute = lower.match(new RegExp(
    `^(?:what day of the week is|what day is) (${EN_MONTH_PATTERN}) (\\d{1,2})(?:st|nd|rd|th)?, (\\d{4})$`,
  ));
  if (enAbsolute) {
    const date = validDate(Number(enAbsolute[3]), EN_MONTH_INDEX[enAbsolute[1]], Number(enAbsolute[2]));
    return date ? { kind: "weekday", language: "en", target: { type: "absolute", date } } : null;
  }
  return null;
}

/**
 * The deterministic answer, computed from the server clock
 * (Asia/Tokyo) — the same clock the injected current-date
 * instruction uses, so the two can never disagree about "today".
 */
export function buildOriginDeterministicDateAnswer(
  question: OriginDeterministicDateQuestion,
  nowMs: number,
): string {
  if (question.target.type === "absolute") {
    const { date } = question.target;
    const weekday = originWeekdayOfCivilDate(date);
    return question.language === "en"
      ? `${EN_MONTH_NAMES[date.month - 1]} ${date.day}, ${date.year} is a ${EN_WEEKDAY_NAMES[weekday]}.`
      : `${date.year}年${date.month}月${date.day}日は${JA_WEEKDAY_CHARS[weekday]}曜日です。`;
  }
  const target = originAddDaysToCivilDate(originJstCivilDate(nowMs), question.target.dayOffset);
  const weekday = originWeekdayOfCivilDate(target);
  if (question.language === "en") {
    const word = question.target.word[0].toUpperCase() + question.target.word.slice(1);
    return `${word} is ${EN_WEEKDAY_NAMES[weekday]}, ${EN_MONTH_NAMES[target.month - 1]} ${target.day}, ${target.year}.`;
  }
  return `${question.target.word}は${target.year}年${target.month}月${target.day}日（${JA_WEEKDAY_CHARS[weekday]}曜日）です。`;
}
