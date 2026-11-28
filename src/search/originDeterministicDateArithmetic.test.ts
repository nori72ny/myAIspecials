import { describe, expect, it } from "vitest";
import {
  buildOriginDeterministicDateArithmeticAnswer,
  parseOriginDeterministicDateArithmeticQuestion,
} from "./originDeterministicDateArithmetic";
import { classifyOriginSearchQuestion } from "./originSearchClassifier";
import {
  requiresOriginCurrentInformation,
  requiresOriginGroundedResearch,
} from "../legacy/originChatResponsePolicy";

// Fixed clock: 2026-11-28 (Sat) JST.
const NOW = Date.parse("2026-11-28T03:00:00.000Z");

describe("deterministic date arithmetic parsing", () => {
  it("parses the production-observed absolute-date offset question", () => {
    const parsed = parseOriginDeterministicDateArithmeticQuestion("2026年11月28日の45日後は何日ですか？");
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("offset");
    if (parsed?.kind === "offset") {
      expect(parsed.base).toEqual({ type: "absolute", date: { year: 2026, month: 11, day: 28 } });
      expect(parsed.offset).toEqual({ amount: 45, unit: "day", direction: 1 });
    }
  });

  it("parses era-year, relative-base and bare offsets", () => {
    const baseOf = (question: string) => {
      const parsed = parseOriginDeterministicDateArithmeticQuestion(question);
      return parsed?.kind === "offset" ? parsed.base : undefined;
    };
    expect(baseOf("令和8年11月28日の45日後は何日ですか？"))
      .toEqual({ type: "absolute", date: { year: 2026, month: 11, day: 28 } });
    expect(baseOf("今日から45日後は何日ですか？"))
      .toEqual({ type: "relative", dayOffset: 0, word: "今日" });
    expect(baseOf("明日から3日後は何日？"))
      .toEqual({ type: "relative", dayOffset: 1, word: "明日" });
    expect(baseOf("45日後は何日ですか？"))
      .toEqual({ type: "today" });
    expect(parseOriginDeterministicDateArithmeticQuestion("今日から2週間後は何日ですか？"))
      .toMatchObject({ kind: "offset", offset: { amount: 2, unit: "week", direction: 1 } });
    expect(parseOriginDeterministicDateArithmeticQuestion("2026年11月28日の10日前は何日ですか？"))
      .toMatchObject({ kind: "offset", offset: { amount: 10, unit: "day", direction: -1 } });
    expect(parseOriginDeterministicDateArithmeticQuestion("3か月後は何日ですか？"))
      .toMatchObject({ kind: "offset", offset: { amount: 3, unit: "month", direction: 1 } });
    expect(parseOriginDeterministicDateArithmeticQuestion("What date is 45 days after November 28, 2026?"))
      .toMatchObject({ kind: "offset", offset: { amount: 45, unit: "day", direction: 1 }, language: "en" });
    expect(parseOriginDeterministicDateArithmeticQuestion("What date is 45 days from today?"))
      .toMatchObject({ kind: "offset", offset: { amount: 45, unit: "day", direction: 1 }, language: "en" });
  });

  it("parses spans and remaining-days questions", () => {
    expect(parseOriginDeterministicDateArithmeticQuestion("2026年11月28日から2026年12月25日まで何日ありますか？"))
      .toMatchObject({ kind: "difference" });
    expect(parseOriginDeterministicDateArithmeticQuestion("2026年12月25日まであと何日ですか？"))
      .toMatchObject({ kind: "difference" });
    expect(parseOriginDeterministicDateArithmeticQuestion("How many days are there between November 28, 2026 and December 25, 2026?"))
      .toMatchObject({ kind: "difference", language: "en" });
    expect(parseOriginDeterministicDateArithmeticQuestion("How many days until December 25, 2026?"))
      .toMatchObject({ kind: "difference", language: "en" });
  });

  it("does not capture fact questions, how-to requests or embedded calculations", () => {
    for (const question of [
      // Weekday of a stated date: the sibling date module's shape.
      "2026年11月28日は何曜日ですか？",
      // Anniversary / fact questions need external facts.
      "2026年11月28日は何の日ですか？",
      "東京オリンピックの開会式から閉会式まで何日間ありましたか？",
      // An event date that is itself an external fact.
      "クリスマスまであと何日ですか？",
      "次の満月まであと何日ですか？",
      // How-to / advice requests that merely contain an offset.
      "45日後に提出する書類の書き方を教えてください",
      "3日後に迫った試験の勉強法を教えて",
      "明日から使えるダイエット法を教えて",
      // A date arithmetic step inside a larger request.
      "今日から45日後の日付を入れた年賀状の文面を作って",
      "2026年11月28日の45日後を計算して、その日の天気も教えて",
      // Ranges the parser does not promise.
      "45日後までにやるべきことを教えて",
      "今日から45日後までの予定を立てて",
    ]) {
      expect(parseOriginDeterministicDateArithmeticQuestion(question), question).toBeNull();
    }
  });
});

describe("deterministic date arithmetic answers", () => {
  const answer = (question: string) => {
    const parsed = parseOriginDeterministicDateArithmeticQuestion(question);
    if (!parsed) throw new Error(`not parsed: ${question}`);
    return buildOriginDeterministicDateArithmeticAnswer(parsed, NOW);
  };

  it("answers the production-observed question exactly", () => {
    expect(answer("2026年11月28日の45日後は何日ですか？"))
      .toBe("2026年11月28日の45日後は2027年1月12日（火曜日）です。");
  });

  it("answers relative and bare offsets from the server clock", () => {
    expect(answer("今日から45日後は何日ですか？"))
      .toBe("今日から45日後は2027年1月12日（火曜日）です。");
    expect(answer("45日後は何日ですか？"))
      .toBe("今日から45日後は2027年1月12日（火曜日）です。");
    expect(answer("明日から3日後は何日？"))
      .toBe("明日から3日後は2026年12月2日（水曜日）です。");
    expect(answer("今日から2週間後は何日ですか？"))
      .toBe("今日から2週間後は2026年12月12日（土曜日）です。");
    expect(answer("2026年11月28日の10日前は何日ですか？"))
      .toBe("2026年11月28日の10日前は2026年11月18日（水曜日）です。");
  });

  it("clamps month offsets to the target month's last day", () => {
    expect(answer("2026年1月31日の1か月後は何日ですか？"))
      .toBe("2026年1月31日の1か月後は2026年2月28日（土曜日）です。");
    expect(answer("3か月後は何日ですか？"))
      .toBe("今日から3か月後は2027年2月28日（日曜日）です。");
  });

  it("answers spans in both directions and remaining days", () => {
    expect(answer("2026年11月28日から2026年12月25日まで何日ありますか？"))
      .toBe("2026年11月28日から2026年12月25日までは27日です。");
    expect(answer("2026年12月25日から2026年11月28日まで何日ありますか？"))
      .toBe("2026年11月28日は2026年12月25日より27日前です。");
    expect(answer("2026年12月25日まであと何日ですか？"))
      .toBe("今日から2026年12月25日まではあと27日です。");
    expect(answer("2026年11月20日まであと何日ですか？"))
      .toBe("2026年11月20日は今日より8日前で、すでに過ぎています。");
  });

  it("answers English shapes in English", () => {
    expect(answer("What date is 45 days after November 28, 2026?"))
      .toBe("45 days after November 28, 2026 is Tuesday, January 12, 2027.");
    expect(answer("How many days are there between November 28, 2026 and December 25, 2026?"))
      .toBe("There are 27 days from November 28, 2026 to December 25, 2026.");
    expect(answer("How many days until December 25, 2026?"))
      .toBe("There are 27 days from today until December 25, 2026.");
  });
});

describe("routing classification for date arithmetic", () => {
  it("classifies every parsed shape as the deterministic date-arithmetic route", () => {
    for (const question of [
      "2026年11月28日の45日後は何日ですか？",
      "今日から45日後は何日ですか？",
      "45日後は何日ですか？",
      "2026年12月25日まであと何日ですか？",
      "What date is 45 days after November 28, 2026?",
    ]) {
      const classified = classifyOriginSearchQuestion(question);
      expect(classified.type, question).toBe("no_search");
      expect(classified.rule, question).toBe("deterministic-date-arithmetic");
      expect(requiresOriginCurrentInformation(question), question).toBe(false);
      expect(requiresOriginGroundedResearch(question), question).toBe(false);
    }
  });

  it("leaves non-arithmetic date questions on their previous routes", () => {
    // The sibling weekday shape keeps its own deterministic route.
    expect(classifyOriginSearchQuestion("2026年11月28日は何曜日ですか？").rule).toBe("deterministic-date");
    // Fact questions about a date are not exempted by the new guard.
    expect(parseOriginDeterministicDateArithmeticQuestion("2026年11月28日は何の日ですか？")).toBeNull();
  });
});
