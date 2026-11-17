// Calendar anchor for business-planning answers.
//
// External-consult adoption (EXTERNAL_CONSULT_BUSINESS_ADOPTION_2026-11-17,
// item 1): the measured planning answers repeatedly shipped past-dated
// deadlines (BP-2 / BP-7) because the model had to do calendar arithmetic
// in its head — month lengths, year crossings, "next month" — while also
// writing the plan, and its training-era date bias pulled dates backwards.
// The fix is to take the arithmetic away from the model: the system
// precomputes the reference dates deterministically (JST) and injects them
// at the end of the planning instruction, so every date in the answer can
// be copied from the anchor instead of computed. The role rules beside the
// table keep the three date kinds apart: future schedule/deadline dates
// must be on or after the base date; a user-supplied past date is flagged
// as past, never silently rolled forward; past results and comparison
// dates are legitimate and stay as they are.
//
// Everything here is pure and deterministic: all functions take the
// current time as an argument, and JST is a fixed UTC+9 offset (Japan has
// no daylight saving), so tests can pin exact outputs.

export interface OriginBusinessCalendarMonth {
  /** 1 = next month, 2 = the month after, 3 = three months ahead. */
  offset: number;
  year: number;
  /** 1-12. */
  month: number;
  /** First day of the month, YYYY-MM-DD. */
  start: string;
  /** Last day of the month, YYYY-MM-DD. */
  end: string;
}

export interface OriginBusinessCalendarAnchor {
  /** Base date (today in JST), YYYY-MM-DD. */
  baseDate: string;
  /** Base date in Japanese long form, e.g. 2026年11月17日. */
  baseDateJa: string;
  /** Weekday of the base date, one kanji (日月火水木金土). */
  weekdayJa: string;
  /** Monday of the base date's week (weeks start on Monday), YYYY-MM-DD. */
  weekStart: string;
  /** Sunday of the base date's week, YYYY-MM-DD. */
  weekEnd: string;
  /** Last day of the base month, YYYY-MM-DD. */
  endOfCurrentMonth: string;
  /** The next three months, offsets 1-3. */
  followingMonths: readonly OriginBusinessCalendarMonth[];
  /** The calendar quarter after the base date's quarter. */
  nextQuarter: {
    year: number;
    /** 1-4. */
    quarter: number;
    startYear: number;
    startMonth: number;
    endYear: number;
    endMonth: number;
  };
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Last day of the given month (month is 1-12), leap years included. */
function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the following month is this month's last day; Date.UTC
  // normalizes the month overflow across year boundaries for us.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthRange(year: number, month: number): { start: string; end: string } {
  return { start: formatIso(year, month, 1), end: formatIso(year, month, lastDayOfMonth(year, month)) };
}

/** Adds whole months to a (year, month) pair, normalizing year crossings. */
function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + offset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function computeOriginBusinessCalendarAnchor(now: Date): OriginBusinessCalendarAnchor {
  // Shift into the JST frame and read the fields as UTC: with a fixed
  // +9h offset this yields exactly the JST calendar date and weekday.
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const weekday = jst.getUTCDay(); // 0 = Sunday

  // Monday-start week containing the base date.
  const daysSinceMonday = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday));
  const sunday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday + 6));
  const weekStart = formatIso(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
  const weekEnd = formatIso(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate());

  const followingMonths: OriginBusinessCalendarMonth[] = [1, 2, 3].map((offset) => {
    const target = addMonths(year, month, offset);
    const range = monthRange(target.year, target.month);
    return { offset, year: target.year, month: target.month, start: range.start, end: range.end };
  });

  // The calendar quarter after the current one (Q1 = Jan-Mar, ...).
  const currentQuarter = Math.floor((month - 1) / 3) + 1;
  const nextQuarterYear = currentQuarter === 4 ? year + 1 : year;
  const nextQuarter = currentQuarter === 4 ? 1 : currentQuarter + 1;
  const quarterStartMonth = (nextQuarter - 1) * 3 + 1;

  return {
    baseDate: formatIso(year, month, day),
    baseDateJa: `${year}年${month}月${day}日`,
    weekdayJa: WEEKDAY_JA[weekday],
    weekStart,
    weekEnd,
    endOfCurrentMonth: formatIso(year, month, lastDayOfMonth(year, month)),
    followingMonths,
    nextQuarter: {
      year: nextQuarterYear,
      quarter: nextQuarter,
      startYear: nextQuarterYear,
      startMonth: quarterStartMonth,
      endYear: nextQuarterYear,
      endMonth: quarterStartMonth + 2,
    },
  };
}

function monthLabelJa(target: { year: number; month: number }): string {
  return `${target.year}年${target.month}月`;
}

function monthLineJa(label: string, target: OriginBusinessCalendarMonth): string {
  return `- ${label}：${monthLabelJa(target)}（${target.start}〜${target.end}）`;
}

/**
 * The anchor block appended at the end of the business-planning
 * instruction: the precomputed date table (copy source for the model)
 * followed by the date-role rules. Written in Japanese because it is data
 * for a Japanese answer, matching the consult responses' anchor example.
 */
export function formatOriginBusinessCalendarAnchor(anchor: OriginBusinessCalendarAnchor): string {
  const [nextMonth, twoMonthsAhead, threeMonthsAhead] = anchor.followingMonths;
  const quarter = anchor.nextQuarter;
  return [
    "カレンダー基準（システムが実行時に算出した確定値。日付はこの表の値を写して使うこと。自分で日付の計算をしないこと）：",
    `- 基準日：${anchor.baseDate}（${anchor.weekdayJa}）`,
    `- 今週：${anchor.weekStart}〜${anchor.weekEnd}（週は月曜始まり）`,
    `- 今月末：${anchor.endOfCurrentMonth}`,
    monthLineJa("来月", nextMonth),
    monthLineJa("2ヶ月後", twoMonthsAhead),
    monthLineJa("3ヶ月後", threeMonthsAhead),
    `- 次の四半期：${quarter.year}年Q${quarter.quarter}（${quarter.startYear}年${quarter.startMonth}月〜${quarter.endMonth}月）`,
    "日付の扱い（厳守）：",
    "- 施策・募集・キャンペーンの期間や期限など、将来の予定の日付は基準日以降にする。",
    "- ユーザーが指定した日付が基準日より過去の場合は、勝手に未来の日付へ置き換えず、その日付が過去である旨を明示する。",
    "- 過去の実績・比較対象の日付は、過去のものとしてそのまま使ってよい。",
    "- 「第1週」「◯月まで」などの表現を使う場合は、必ず対象の年月と実際の範囲を併記する（例：「2027年1月末まで（2027-01-31）」）。",
    "- 日付には必ず西暦4桁を付ける（例：2027年1月15日）。",
  ].join("\n");
}

/** Convenience builder: compute the anchor for `now` and format it. */
export function buildOriginBusinessCalendarAnchor(now: Date = new Date()): string {
  return formatOriginBusinessCalendarAnchor(computeOriginBusinessCalendarAnchor(now));
}

// ---------------------------------------------------------------------------
// Route-3 (Groq) compact forms.
//
// The full anchor above runs 525 characters — more than the route-3
// business addendum could carry under its former 1,700-character pin, so
// route 3 shipped without it, and route 3 is the route that actually
// answers planning requests (14/14 across the round-3 and round-4
// production measurements; BUSINESS_ANCHOR_DIAGNOSIS_2026-11-18). BP-2
// shipped ten past dates as future deadlines on that route. The compact
// form below carries the same computed values — base date, end of the
// current month, the next three months' ranges, the next quarter — in
// one line, and compresses the role rules to the two that produced the
// measured defects: schedule/deadline dates sit on or after the base
// date with 4-digit years, and a user-supplied past date is flagged as
// past, never silently moved. The week range is the one part dropped.
// ---------------------------------------------------------------------------

export function formatOriginBusinessCalendarAnchorCompact(anchor: OriginBusinessCalendarAnchor): string {
  const [nextMonth, twoMonthsAhead, threeMonthsAhead] = anchor.followingMonths;
  const quarter = anchor.nextQuarter;
  const monthSegment = (label: string, target: OriginBusinessCalendarMonth) =>
    `${label}：${monthLabelJa(target)}（${target.start}〜${target.end}）`;
  const segments = [
    `カレンダー基準（確定値。日付は写して使い、自分で計算しない）：基準日：${anchor.baseDate}（${anchor.weekdayJa}）`,
    `今月末：${anchor.endOfCurrentMonth}`,
    monthSegment("来月", nextMonth),
    monthSegment("2ヶ月後", twoMonthsAhead),
    monthSegment("3ヶ月後", threeMonthsAhead),
    // A calendar quarter never crosses a year, so the compact form can
    // name the months without repeating the year.
    `次の四半期：${quarter.year}年Q${quarter.quarter}（${quarter.startMonth}月〜${quarter.endMonth}月）`,
  ];
  return `${segments.join("／")}。予定・期限の日付は基準日以降とし、西暦4桁を付ける。ユーザーが指定した日付が過去の場合は、勝手に移さず過去である旨を明示する。`;
}

/** Convenience builder: compute the anchor for `now` and format it compactly. */
export function buildOriginBusinessCalendarAnchorCompact(now: Date = new Date()): string {
  return formatOriginBusinessCalendarAnchorCompact(computeOriginBusinessCalendarAnchor(now));
}

/**
 * Compact current-date instruction for the route-3 business addendum.
 *
 * The full current-date instruction (originCurrentDateInstruction) is
 * appended only to the routes 1-2 instruction, so on route 3 the model
 * was never told today's date at all — the second half of the BP-2 past-
 * date defect. This line carries the same discipline in one sentence —
 * judge 現在/最新 against this date, and state the as-of point of a
 * current value — and it is derived from the same anchor as the compact
 * calendar table beside it, so the two can never disagree.
 */
export function formatOriginBusinessCurrentDateInstruction(anchor: OriginBusinessCalendarAnchor): string {
  return `- 今日の日付（Asia/Tokyo）は${anchor.baseDateJa}です。「現在」「最新」はこの日付基準で判断し、現在の値には「（${anchor.baseDateJa}時点）」と時点を明示すること。`;
}
