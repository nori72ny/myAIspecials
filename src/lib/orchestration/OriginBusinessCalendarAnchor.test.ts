import { describe, expect, it } from "vitest";
import {
  buildOriginBusinessCalendarAnchor,
  computeOriginBusinessCalendarAnchor,
  formatOriginBusinessCalendarAnchor,
} from "./OriginBusinessCalendarAnchor";

// All inputs are UTC instants; the anchor is the JST calendar frame of
// that instant (JST = UTC+9, no daylight saving). 2026-11-17 is a Tuesday.
const JST_NOON = (isoDate: string) => new Date(`${isoDate}T03:00:00Z`);

describe("OriginBusinessCalendarAnchor computation", () => {
  it("computes the full anchor for 2026-11-17 (Tue), including the year crossing in the following months", () => {
    const anchor = computeOriginBusinessCalendarAnchor(JST_NOON("2026-11-17"));
    expect(anchor.baseDate).toBe("2026-11-17");
    expect(anchor.baseDateJa).toBe("2026年11月17日");
    expect(anchor.weekdayJa).toBe("火");
    expect(anchor.weekStart).toBe("2026-11-16");
    expect(anchor.weekEnd).toBe("2026-11-22");
    expect(anchor.endOfCurrentMonth).toBe("2026-11-30");
    expect(anchor.followingMonths).toEqual([
      { offset: 1, year: 2026, month: 12, start: "2026-12-01", end: "2026-12-31" },
      { offset: 2, year: 2027, month: 1, start: "2027-01-01", end: "2027-01-31" },
      { offset: 3, year: 2027, month: 2, start: "2027-02-01", end: "2027-02-28" },
    ]);
    expect(anchor.nextQuarter).toEqual({ year: 2027, quarter: 1, startYear: 2027, startMonth: 1, endYear: 2027, endMonth: 3 });
  });

  it("crosses the year for a December base date", () => {
    const anchor = computeOriginBusinessCalendarAnchor(JST_NOON("2026-12-15"));
    expect(anchor.baseDate).toBe("2026-12-15");
    expect(anchor.weekdayJa).toBe("火");
    expect(anchor.weekStart).toBe("2026-12-14");
    expect(anchor.weekEnd).toBe("2026-12-20");
    expect(anchor.endOfCurrentMonth).toBe("2026-12-31");
    expect(anchor.followingMonths.map((m) => `${m.year}-${m.month}`)).toEqual(["2027-1", "2027-2", "2027-3"]);
    expect(anchor.followingMonths[2].end).toBe("2027-03-31");
    expect(anchor.nextQuarter).toEqual({ year: 2027, quarter: 1, startYear: 2027, startMonth: 1, endYear: 2027, endMonth: 3 });
  });

  it("handles a month-end base date and a 30-day month three months ahead", () => {
    const anchor = computeOriginBusinessCalendarAnchor(JST_NOON("2026-01-31"));
    expect(anchor.endOfCurrentMonth).toBe("2026-01-31");
    expect(anchor.followingMonths[0]).toEqual({ offset: 1, year: 2026, month: 2, start: "2026-02-01", end: "2026-02-28" });
    expect(anchor.followingMonths[2].end).toBe("2026-04-30");
    expect(anchor.nextQuarter).toEqual({ year: 2026, quarter: 2, startYear: 2026, startMonth: 4, endYear: 2026, endMonth: 6 });
  });

  it("handles leap years: February 2028 has 29 days, and a leap-day base date works", () => {
    const january = computeOriginBusinessCalendarAnchor(JST_NOON("2028-01-15"));
    expect(january.followingMonths[0].end).toBe("2028-02-29");
    const leapDay = computeOriginBusinessCalendarAnchor(JST_NOON("2028-02-29"));
    expect(leapDay.baseDate).toBe("2028-02-29");
    expect(leapDay.endOfCurrentMonth).toBe("2028-02-29");
    expect(leapDay.followingMonths[0].start).toBe("2028-03-01");
  });

  it("anchors the Monday-start week identically from its Monday and its Sunday", () => {
    const monday = computeOriginBusinessCalendarAnchor(JST_NOON("2026-11-16"));
    expect(monday.weekdayJa).toBe("月");
    expect(monday.weekStart).toBe("2026-11-16");
    expect(monday.weekEnd).toBe("2026-11-22");
    const sunday = computeOriginBusinessCalendarAnchor(JST_NOON("2026-11-22"));
    expect(sunday.weekdayJa).toBe("日");
    expect(sunday.weekStart).toBe("2026-11-16");
    expect(sunday.weekEnd).toBe("2026-11-22");
  });

  it("gives the next calendar quarter for a mid-year base date", () => {
    const anchor = computeOriginBusinessCalendarAnchor(JST_NOON("2026-05-20"));
    expect(anchor.nextQuarter).toEqual({ year: 2026, quarter: 3, startYear: 2026, startMonth: 7, endYear: 2026, endMonth: 9 });
  });

  it("uses the JST frame: the base date flips at 15:00 UTC, not at UTC midnight", () => {
    expect(computeOriginBusinessCalendarAnchor(new Date("2026-11-16T14:59:00Z")).baseDate).toBe("2026-11-16");
    expect(computeOriginBusinessCalendarAnchor(new Date("2026-11-16T15:00:00Z")).baseDate).toBe("2026-11-17");
    expect(computeOriginBusinessCalendarAnchor(new Date("2026-11-16T15:30:00Z")).weekdayJa).toBe("火");
  });
});

describe("OriginBusinessCalendarAnchor formatting", () => {
  it("renders the copyable date table and the date-role rules for 2026-11-17", () => {
    const text = buildOriginBusinessCalendarAnchor(JST_NOON("2026-11-17"));
    for (const expected of [
      "カレンダー基準",
      "自分で日付の計算をしないこと",
      "- 基準日：2026-11-17（火）",
      "- 今週：2026-11-16〜2026-11-22（週は月曜始まり）",
      "- 今月末：2026-11-30",
      "- 来月：2026年12月（2026-12-01〜2026-12-31）",
      "- 2ヶ月後：2027年1月（2027-01-01〜2027-01-31）",
      "- 3ヶ月後：2027年2月（2027-02-01〜2027-02-28）",
      "- 次の四半期：2027年Q1（2027年1月〜3月）",
      "将来の予定の日付は基準日以降にする",
      "ユーザーが指定した日付が基準日より過去の場合は、勝手に未来の日付へ置き換えず、その日付が過去である旨を明示する",
      "過去の実績・比較対象の日付は、過去のものとしてそのまま使ってよい",
      "必ず対象の年月と実際の範囲を併記する",
      "日付には必ず西暦4桁を付ける",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("formats exactly what compute returns (no hidden re-derivation)", () => {
    const now = JST_NOON("2026-12-15");
    expect(buildOriginBusinessCalendarAnchor(now)).toBe(formatOriginBusinessCalendarAnchor(computeOriginBusinessCalendarAnchor(now)));
  });
});
