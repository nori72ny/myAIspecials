import { describe, expect, it } from "vitest";
import {
  buildOriginDeterministicDateAnswer,
  parseOriginDeterministicDateQuestion,
} from "./originDeterministicDateAnswer.js";

// The clock is fixed at the round-8 verification day: Thursday
// 2026-11-26, midday JST (2026-11-26T03:00:00Z).
const NOW = Date.parse("2026-11-26T03:00:00.000Z");

function answerFor(message: string, nowMs: number = NOW): string {
  const parsed = parseOriginDeterministicDateQuestion(message);
  if (!parsed) throw new Error(`expected a deterministic date question: ${message}`);
  return buildOriginDeterministicDateAnswer(parsed, nowMs);
}

describe("parseOriginDeterministicDateQuestion — the enumerated shapes parse", () => {
  it("relative weekday questions (今日・明日・明後日・昨日・一昨日）", () => {
    for (const [message, offset] of [
      ["今日は何曜日ですか？", 0],
      ["明日は何曜日ですか？", 1],
      ["明後日は何曜日ですか？", 2],
      ["昨日は何曜日ですか？", -1],
      ["一昨日は何曜日ですか？", -2],
      ["今日は何曜日", 0],
    ] as const) {
      const parsed = parseOriginDeterministicDateQuestion(message);
      expect(parsed?.kind, message).toBe("weekday");
      expect(parsed?.language, message).toBe("ja");
      if (parsed?.target.type === "relative") {
        expect(parsed.target.dayOffset, message).toBe(offset);
      } else {
        throw new Error(`expected a relative target: ${message}`);
      }
    }
  });

  it("relative date questions （何月何日 / 何日）", () => {
    for (const message of ["今日は何月何日ですか？", "明日は何日ですか？", "昨日は何月何日ですか？"]) {
      const parsed = parseOriginDeterministicDateQuestion(message);
      expect(parsed?.kind, message).toBe("date");
      expect(parsed?.target.type, message).toBe("relative");
    }
  });

  it("absolute-date weekday questions, Gregorian and 令和", () => {
    const gregorian = parseOriginDeterministicDateQuestion("2026年12月25日は何曜日ですか？");
    expect(gregorian?.target).toEqual({ type: "absolute", date: { year: 2026, month: 12, day: 25 } });
    const wareki = parseOriginDeterministicDateQuestion("令和8年12月25日は何曜日ですか？");
    expect(wareki?.target).toEqual({ type: "absolute", date: { year: 2026, month: 12, day: 25 } });
    const gannen = parseOriginDeterministicDateQuestion("令和元年5月1日は何曜日ですか？");
    expect(gannen?.target).toEqual({ type: "absolute", date: { year: 2019, month: 5, day: 1 } });
  });

  it("English shapes", () => {
    expect(parseOriginDeterministicDateQuestion("What day of the week is it today?")?.kind).toBe("weekday");
    expect(parseOriginDeterministicDateQuestion("What date is today?")?.kind).toBe("date");
    expect(parseOriginDeterministicDateQuestion("What day is December 25, 2026?")?.target)
      .toEqual({ type: "absolute", date: { year: 2026, month: 12, day: 25 } });
  });
});

describe("parseOriginDeterministicDateQuestion — both-direction discipline", () => {
  it("date-CONTAINING questions that need search or weather do NOT parse", () => {
    for (const message of [
      "今日のニュースを教えてください。",
      "今日の東京の天気は？",
      "今日は何日までにやるべきですか？",
      "今日の株価を教えてください。",
      "明日の会議の資料を作ってください。",
      "昨日の出来事について教えてください。",
      "今日は何曜日か教えてください。", // 教えて suffix is outside the enumerated shapes
    ]) {
      expect(parseOriginDeterministicDateQuestion(message), message).toBeNull();
    }
  });

  it("invalid absolute dates do not parse", () => {
    expect(parseOriginDeterministicDateQuestion("2026年2月30日は何曜日ですか？")).toBeNull();
    expect(parseOriginDeterministicDateQuestion("2026年13月1日は何曜日ですか？")).toBeNull();
  });

  it("non-date questions do not parse", () => {
    expect(parseOriginDeterministicDateQuestion("日本の首都はどこですか？")).toBeNull();
    expect(parseOriginDeterministicDateQuestion("")).toBeNull();
  });
});

describe("buildOriginDeterministicDateAnswer — §6 verification set, clock fixed", () => {
  it("今日は何曜日ですか？ → 木曜日 (2026-11-26)", () => {
    expect(answerFor("今日は何曜日ですか？")).toBe("今日は2026年11月26日（木曜日）です。");
  });

  it("明日は？ → 金曜日", () => {
    expect(answerFor("明日は何曜日ですか？")).toBe("明日は2026年11月27日（金曜日）です。");
  });

  it("今日は何月何日ですか？ → 2026年11月26日", () => {
    expect(answerFor("今日は何月何日ですか？")).toBe("今日は2026年11月26日（木曜日）です。");
  });

  it("2026年12月25日は何曜日？ → 金曜日", () => {
    expect(answerFor("2026年12月25日は何曜日ですか？")).toBe("2026年12月25日は金曜日です。");
  });

  it("昨日・一昨日・明後日 resolve against the same clock", () => {
    expect(answerFor("昨日は何曜日ですか？")).toBe("昨日は2026年11月25日（水曜日）です。");
    expect(answerFor("一昨日は何曜日ですか？")).toBe("一昨日は2026年11月24日（火曜日）です。");
    expect(answerFor("明後日は何曜日ですか？")).toBe("明後日は2026年11月28日（土曜日）です。");
  });

  it("the JST day boundary is the server's: 2026-11-26T16:00Z is already Nov 27 in Tokyo", () => {
    const utcEvening = Date.parse("2026-11-26T16:00:00.000Z");
    expect(answerFor("今日は何曜日ですか？", utcEvening)).toBe("今日は2026年11月27日（金曜日）です。");
  });

  it("English answers", () => {
    expect(answerFor("What day of the week is it today?")).toBe("Today is Thursday, November 26, 2026.");
    expect(answerFor("What day is December 25, 2026?")).toBe("December 25, 2026 is a Friday.");
  });
});
