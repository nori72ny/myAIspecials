/**
 * The edition (対象期間 / reference period) of an official
 * statistics release — follow-up measure 2 (ANSWER_FOLLOWUP_
 * DIAGNOSIS_2026-11-26).
 *
 * Round 8's F group failed in a shape no earlier layer could even
 * name: every layer judged a statistics page's currency by the
 * PAGE's date (provider publishedAt, or a date stated in its text),
 * while a publication's currency is its EDITION — the reference
 * period the release reports. A page published last week can carry
 * a years-old edition (the 令和3年7月分 job-ratio release the
 * 2026-11-26 post-deploy check ranked first), and the freshest
 * page can be a stale edition re-posted. Nobody read the edition,
 * so nobody could prefer the newest one or notice the pool held
 * only old ones.
 *
 * This module is the single reader of editions:
 *
 *  - parse: the edition as the source itself states it in its
 *    title (令和○年○月分 / 20○○年○月分 monthly forms, the
 *    Statistics Bureau's dual-calendar 20○○年（令和○年）○月分
 *    composite, the composite 令和7年12月分及び令和7年分 shape, quarterly
 *    ○年○-○月期 forms, and the population estimate's
 *    ○月1日現在 reference date). Nothing is inferred from the
 *    page's publication date — an edition exists only where the
 *    title states one.
 *  - expected: the newest edition that must exist by the clock,
 *    computed from the topic's own publication schedule (a lag
 *    the publisher's calendar guarantees, never a guessed
 *    freshness window). It is a LOWER bound: the pool is stale
 *    only when its newest adopted official edition is older than
 *    the edition that certainly exists.
 *  - annotation: the reader-facing period label for a source —
 *    the edition when the title states one, else the source's
 *    own date (round-8 measure E, expanded by this measure).
 *
 * Deterministic throughout: no model, no network, the only clock
 * is the caller's.
 */
import {
  originAddDaysToCivilDate,
  originJstCivilDate,
  type OriginDateValue,
} from "../lib/orchestration/OriginDateWeekdayVerification.js";

export interface OriginOfficialEdition {
  /** Gregorian year of the reference period. */
  year: number;
  /** 1-12: the reference month; for a quarter, its final month. */
  month: number;
  /** 1-4, present when the edition is a quarter. */
  quarter?: number;
  /**
   * The edition as written in the source (post-NFKC), e.g.
   * 令和8年9月分 / 2026年9月分 / 2026年7-9月期 /
   * 令和8年11月1日現在. Used verbatim in annotations and query
   * terms — never reformatted into a shape the source did not use.
   */
  label: string;
  /** Comparable key: year * 100 + month (a quarter sorts by its final month). */
  sortKey: number;
}

/** 令和N年 → Gregorian year (令和元年 = 2019). */
function warekiYear(token: string): number {
  return 2018 + (token === "元" ? 1 : Number(token));
}

function monthlyEdition(year: number, month: number, label: string): OriginOfficialEdition | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month, label, sortKey: year * 100 + month };
}

/**
 * The edition a source's title states, or null when the title
 * states none. Patterns run in a fixed priority (monthly before
 * quarterly) so the reading is deterministic; the composite
 * 令和7年12月分及び令和7年分 title resolves to its monthly part,
 * which is the current edition the release reports.
 */
export function parseOriginOfficialEdition(text: string): OriginOfficialEdition | null {
  if (!text) return null;
  const normalized = text.normalize("NFKC");

  // Composite notation (round-3 measure 3-3,
  // ANSWER_STATISTICS_ROUND3_DIAGNOSIS_2026-11-26): the Statistics
  // Bureau names an edition with BOTH calendars —
  // 労働力調査（基本集計）2026年（令和8年）9月分結果 — and the plain
  // patterns below both break on the parenthesised era, so the
  // bureau's editions were unreadable and every edition-based
  // judgement (stale-edition retry, packet bonus, selection
  // recency) silently skipped this publisher. The composite forms
  // run first so they win over any plain form elsewhere in a title.
  // The Gregorian year is the reading (it is the sort key's basis);
  // the era in parentheses is the same year in the other calendar.
  const monthlyCompositeSeireki = normalized.match(
    /(20\d{2})年[（(]令和(元|\d{1,2})年[）)](\d{1,2})月分/,
  );
  if (monthlyCompositeSeireki) {
    return monthlyEdition(
      Number(monthlyCompositeSeireki[1]),
      Number(monthlyCompositeSeireki[3]),
      monthlyCompositeSeireki[0],
    );
  }
  const monthlyCompositeWareki = normalized.match(
    /[（(]令和(元|\d{1,2})年[）)](\d{1,2})月分/,
  );
  if (monthlyCompositeWareki) {
    return monthlyEdition(
      warekiYear(monthlyCompositeWareki[1]),
      Number(monthlyCompositeWareki[2]),
      monthlyCompositeWareki[0],
    );
  }
  const monthlyWareki = normalized.match(/令和(元|\d{1,2})年(\d{1,2})月分/);
  if (monthlyWareki) {
    return monthlyEdition(warekiYear(monthlyWareki[1]), Number(monthlyWareki[2]), monthlyWareki[0]);
  }
  const monthlySeireki = normalized.match(/(20\d{2})年(\d{1,2})月分/);
  if (monthlySeireki) {
    return monthlyEdition(Number(monthlySeireki[1]), Number(monthlySeireki[2]), monthlySeireki[0]);
  }
  // The population estimate names its reference date instead of a
  // 月分: 人口推計（令和8年11月1日現在）. The stated date IS the
  // edition — the month the estimate refers to.
  const referenceWareki = normalized.match(/令和(元|\d{1,2})年(\d{1,2})月1日現在/);
  if (referenceWareki) {
    return monthlyEdition(warekiYear(referenceWareki[1]), Number(referenceWareki[2]), referenceWareki[0]);
  }
  const referenceSeireki = normalized.match(/(20\d{2})年(\d{1,2})月1日現在/);
  if (referenceSeireki) {
    return monthlyEdition(Number(referenceSeireki[1]), Number(referenceSeireki[2]), referenceSeireki[0]);
  }
  const quarterlyWareki = normalized.match(/令和(元|\d{1,2})年(\d{1,2})[-~〜～](\d{1,2})月期/);
  if (quarterlyWareki) {
    return quarterlyEdition(warekiYear(quarterlyWareki[1]), Number(quarterlyWareki[2]), Number(quarterlyWareki[3]), quarterlyWareki[0]);
  }
  const quarterlySeireki = normalized.match(/(20\d{2})年(\d{1,2})[-~〜～](\d{1,2})月期/);
  if (quarterlySeireki) {
    return quarterlyEdition(Number(quarterlySeireki[1]), Number(quarterlySeireki[2]), Number(quarterlySeireki[3]), quarterlySeireki[0]);
  }
  return null;
}

function quarterlyEdition(
  year: number,
  startMonth: number,
  endMonth: number,
  label: string,
): OriginOfficialEdition | null {
  if (![1, 4, 7, 10].includes(startMonth) || endMonth !== startMonth + 2) return null;
  const quarter = (startMonth - 1) / 3 + 1;
  return { year, month: endMonth, quarter, label, sortKey: year * 100 + endMonth };
}

/**
 * A topic's publication schedule, stated as the lag by which an
 * edition is CERTAINLY public. Monthly statistics publish the
 * previous month's edition around the end of the following month
 * （有効求人倍率： 9月分 on 10月30日； 労働力調査： 9月分 on
 * 10月31日）, so two months behind the current month is the
 * edition that exists on every day of every month. The GDP first
 * preliminary lands about 45 days after the quarter ends
 * (2026年7-9月期 1次速報： 11月16日）. These are the publishers'
 * own calendars, recorded per topic in the routing map — not
 * freshness guesses.
 */
export interface OriginOfficialEditionSchedule {
  cycle: "monthly" | "quarterly";
  /** Monthly: months behind the current month that are certainly published. */
  lagMonths?: number;
  /** Quarterly: days after the quarter's final day by which the release is public. */
  lagDaysAfterPeriodEnd?: number;
}

function warekiLabel(year: number): string {
  const era = year - 2018;
  return era === 1 ? "令和元年" : `令和${era}年`;
}

/**
 * The newest edition that must exist at `nowMs` under the topic's
 * schedule — the lower bound the stale-edition judgement compares
 * against. Null when the schedule cannot date one (no schedule, or
 * an out-of-range lag).
 */
export function expectedLatestOriginOfficialEdition(
  schedule: OriginOfficialEditionSchedule,
  nowMs: number,
): OriginOfficialEdition | null {
  const today = originJstCivilDate(nowMs);
  if (schedule.cycle === "monthly") {
    const lag = schedule.lagMonths ?? 0;
    if (!Number.isInteger(lag) || lag < 0 || lag > 24) return null;
    const total = today.year * 12 + (today.month - 1) - lag;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    return { year, month, label: `${warekiLabel(year)}${month}月分`, sortKey: year * 100 + month };
  }
  const lagDays = schedule.lagDaysAfterPeriodEnd ?? 0;
  if (!Number.isInteger(lagDays) || lagDays < 0 || lagDays > 370) return null;
  // Walk back from the current quarter to the first whose final
  // day + lag is not in the future.
  let cursor: OriginDateValue = today;
  for (let step = 0; step < 8; step += 1) {
    const quarterStartMonth = Math.floor((cursor.month - 1) / 3) * 3 + 1;
    // The quarter's final day: the day before the next quarter starts.
    const nextQuarterStart: OriginDateValue = quarterStartMonth === 10
      ? { year: cursor.year + 1, month: 1, day: 1 }
      : { year: cursor.year, month: quarterStartMonth + 3, day: 1 };
    const finalDay = originAddDaysToCivilDate(nextQuarterStart, -1);
    const availableFrom = originAddDaysToCivilDate(finalDay, lagDays);
    if (compareCivil(availableFrom, today) <= 0) {
      const startMonth = quarterStartMonth;
      const endMonth = quarterStartMonth + 2;
      return {
        year: cursor.year,
        month: endMonth,
        quarter: (startMonth - 1) / 3 + 1,
        label: `${cursor.year}年${startMonth}-${endMonth}月期`,
        sortKey: cursor.year * 100 + endMonth,
      };
    }
    cursor = originAddDaysToCivilDate(
      { year: cursor.year, month: quarterStartMonth, day: 1 },
      -1,
    );
  }
  return null;
}

function compareCivil(a: OriginDateValue, b: OriginDateValue): number {
  return (a.year - b.year) || (a.month - b.month) || (a.day - b.day);
}

/**
 * The query terms that name an edition in both notations publishers
 * use （令和○年○月分 and 20○○年○月分； quarters as ○年○-○月期 in
 * both eras), so an edition-targeted search matches whichever form
 * the publication page carries.
 */
export function originOfficialEditionQueryTerms(edition: OriginOfficialEdition): string[] {
  if (edition.quarter !== undefined) {
    const startMonth = edition.month - 2;
    return [
      `${edition.year}年${startMonth}-${edition.month}月期`,
      `${warekiLabel(edition.year)}${startMonth}-${edition.month}月期`,
    ];
  }
  return [
    `${warekiLabel(edition.year)}${edition.month}月分`,
    `${edition.year}年${edition.month}月分`,
  ];
}

const EN_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The reader-facing period annotation for a source (round-8
 * measure E, expanded by follow-up measure 3): the EDITION the
 * source reports when its title states one — a statistics release
 * is current or stale by its edition, not by the day its page was
 * posted — and otherwise the source's own stated date, exactly the
 * pre-existing measure-E rule. The annotation sits outside any
 * quote, so quoted text stays verbatim. A source that states
 * neither gets no annotation: an unknown vintage is shown as
 * unknown, never dressed up with a guessed date.
 */
export function originSourcePeriodAnnotation(
  source: { title: string; revisionTimestamp?: string },
  language: "ja" | "en",
): string {
  const edition = parseOriginOfficialEdition(source.title);
  if (edition) {
    if (language === "en") {
      return edition.quarter !== undefined
        ? `(reference period: Q${edition.quarter} ${edition.year})`
        : `(reference period: ${EN_MONTH_NAMES[edition.month - 1]} ${edition.year})`;
    }
    return `（対象：${edition.label}）`;
  }
  const raw = source.revisionTimestamp;
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const [, year, month, day] = match;
  return language === "en"
    ? `(source date: ${year}-${month}-${day})`
    : `（出典の日付：${year}年${Number(month)}月${Number(day)}日）`;
}

/**
 * The unknown-vintage marker (certainty-display systematization,
 * REFERENCE_EVALUATION_MAXIMUM_2026-11-27 推奨2): the explicit
 * label a verbatim-quote landing attaches when a quoted VALUE's
 * source states neither an edition nor a date. Silence in the
 * annotation slot was the F-03 failure shape — an undated stale
 * value ("現在 1.00%") quoted bare reads as current, because
 * nothing distinguishes "vintage unknown" from "vintage current".
 * The marker invents no date and edits no quoted text; it makes
 * the absence itself visible at the point where the value is read.
 */
export function originUnknownPeriodAnnotation(language: "ja" | "en"): string {
  return language === "en" ? "(period not stated)" : "（時点不明）";
}

/**
 * Whether a statement itself names the period its value belongs
 * to, in a year-bearing form (2026年…, 令和8年…, 2026-11…): a
 * quote that dates its own value ("令和8年9月の有効求人倍率は…")
 * needs no external vintage label — the reader can place the
 * value from the sentence itself. A bare month ("8月の…") does
 * NOT count: without the year, the vintage stays ambiguous.
 */
export function originTextStatesPeriod(text: string): boolean {
  return /(?:\d{4}\s*年|令和\s*\d+\s*年|平成\s*\d+\s*年|\d{4}[-/]\d{1,2})/.test(text);
}

/**
 * The period annotation for a verbatim-quoted value: the source's
 * own annotation (originSourcePeriodAnnotation) when it can be
 * read; otherwise the unknown-vintage marker — but only when the
 * quote actually carries a value (the caller judges with the
 * packet's answer-bearing signal) and does not state its own
 * period. A value-free quote, or one that dates itself, keeps the
 * empty annotation exactly as before, so the marker never becomes
 * decoration on text that presents no value to misread.
 */
export function originQuotedValuePeriodAnnotation(
  source: { title: string; revisionTimestamp?: string },
  language: "ja" | "en",
  quoteText: string,
  valueBearing: boolean,
): string {
  const annotation = originSourcePeriodAnnotation(source, language);
  if (annotation) return annotation;
  if (!valueBearing) return "";
  if (originTextStatesPeriod(quoteText)) return "";
  return originUnknownPeriodAnnotation(language);
}
