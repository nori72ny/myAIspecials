import { describe, expect, it, vi } from "vitest";
import {
  applyOriginDateWeekdayVerificationGate,
  logOriginDateWeekdayVerificationShadow,
  originDateWeekdayVerificationMayApply,
  resolveOriginDateWeekdayVerificationMode,
  verifyOriginDateWeekdays,
} from "./OriginDateWeekdayVerification";

// Deterministic date/weekday verification. All expected weekdays below
// were checked against a reference calendar:
//   2000-01-01 Sat, 2020-01-01 Wed, 2020-01-31 Fri, 2020-02-01 Sat,
//   2024-02-29 Thu, 2026-11-07 Sat, 2026-11-30 Mon, 2026-12-01 Tue,
//   2026-12-22 Tue, 2026-12-23 Wed, 2026-12-25 Fri,
//   2026-02-19 Thu, 2026-03-01 Sun.

// The real H-07 case from the fixed-100 round-4 measurement
// (records-remeasurement-2026-11-17-r2): question and answer verbatim.
const H07_QUESTION = "2026年11月7日の45日後は、何月何日で何曜日ですか？";
const H07_ANSWER =
  "2026年12月23日（火曜日）が45日後です。  \n\n**ポイント**  \n- 2026年11月7日から23日で11月30日まで。  \n- 残り22日で12月23日になる。  \n- 2026年11月7日は土曜日。45日後は3日後 → 火曜日。";
const H07_CORRECTED =
  "2026年12月22日（火曜日）が45日後です。  \n\n**ポイント**  \n- 2026年11月7日から23日で11月30日まで。  \n- 残り22日で12月22日になる。  \n- 2026年11月7日は土曜日。45日後は3日後 → 火曜日。";

describe("mode resolution", () => {
  it("defaults to shadow and only accepts the exact enforce value", () => {
    expect(resolveOriginDateWeekdayVerificationMode(undefined)).toBe("shadow");
    expect(resolveOriginDateWeekdayVerificationMode({})).toBe("shadow");
    expect(resolveOriginDateWeekdayVerificationMode({ ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE: "enforce" })).toBe("enforce");
    expect(resolveOriginDateWeekdayVerificationMode({ ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE: "ENFORCE" })).toBe("shadow");
    expect(resolveOriginDateWeekdayVerificationMode({ ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE: "true" })).toBe("shadow");
  });
});

describe("(a) date + weekday pair verification", () => {
  it("accepts correct pairs in bracket, single-char, and は forms", () => {
    for (const text of [
      "2026年12月22日（火曜日）です。",
      "2026年12月22日（火）です。",
      "2026年12月22日（火曜）です。",
      "2026年11月7日は土曜日です。",
      "2000年1月1日（土曜日）から数えます。",
      "2024年2月29日（木曜日）が閏日です。",
    ]) {
      const result = verifyOriginDateWeekdays({ answerText: text });
      expect(result.summary.pairCount, text).toBe(1);
      expect(result.summary.weekdayMismatchCount, text).toBe(0);
      expect(result.correctedText, text).toBeNull();
    }
  });

  it("corrects only the weekday token when the stated date is kept", () => {
    const result = verifyOriginDateWeekdays({ answerText: "2026年12月23日（火曜日）です。" });
    expect(result.summary.pairCount).toBe(1);
    expect(result.summary.weekdayMismatchCount).toBe(1);
    expect(result.correctedText).toBe("2026年12月23日（水曜日）です。");
    expect(result.summary.fixableCount).toBe(1);
  });

  it("preserves the token shape when correcting (single char / 曜 form)", () => {
    expect(verifyOriginDateWeekdays({ answerText: "2026年12月22日（水）です。" }).correctedText)
      .toBe("2026年12月22日（火）です。");
    expect(verifyOriginDateWeekdays({ answerText: "2026年12月22日（水曜）です。" }).correctedText)
      .toBe("2026年12月22日（火曜）です。");
    expect(verifyOriginDateWeekdays({ answerText: "2026年11月7日は日曜日です。" }).correctedText)
      .toBe("2026年11月7日は土曜日です。");
  });

  it("detects mismatches written with full-width digits and corrects the weekday in place", () => {
    const result = verifyOriginDateWeekdays({ answerText: "２０２６年１２月２３日（火曜日）です。" });
    expect(result.summary.weekdayMismatchCount).toBe(1);
    expect(result.correctedText).toBe("２０２６年１２月２３日（水曜日）です。");
  });

  it("verifies a short date against the single year used by the surrounding text", () => {
    const answer = "今年のクリスマスは2026年12月25日（金曜日）です。12月25日（木曜日）ではありません。";
    const result = verifyOriginDateWeekdays({ answerText: answer });
    expect(result.summary.pairCount).toBe(2);
    expect(result.summary.weekdayMismatchCount).toBe(1);
    expect(result.correctedText).toBe(
      "今年のクリスマスは2026年12月25日（金曜日）です。12月25日（金曜日）ではありません。",
    );
  });

  it("counts a current-year short-date mismatch but never rewrites it", () => {
    // No year anywhere in the text: 2026-12-25 (the current year of
    // `now`) is a Friday, so （木曜日） is a detected mismatch — but
    // the intended year is not knowable from the text, so no fix.
    const result = verifyOriginDateWeekdays({
      answerText: "12月25日（木曜日）です。",
      now: new Date("2026-11-18T00:00:00Z"),
    });
    expect(result.summary.pairCount).toBe(1);
    expect(result.summary.weekdayMismatchCount).toBe(1);
    expect(result.correctedText).toBeNull();
  });

  it("passes a short date through when two different years appear in the text", () => {
    const result = verifyOriginDateWeekdays({
      answerText: "2025年12月25日と2026年12月25日があります。12月25日（木曜日）です。",
    });
    expect(result.summary.pairCount).toBe(0);
    expect(result.correctedText).toBeNull();
  });

  it("does not treat an invalid calendar date as a mention", () => {
    const result = verifyOriginDateWeekdays({ answerText: "2026年2月30日（月曜日）です。" });
    expect(result.summary.pairCount).toBe(0);
    expect(result.correctedText).toBeNull();
  });

  it("does not attach a bare weekday char that starts another word", () => {
    // 2026-12-01 is a Tuesday; if 日用品's 日 were read as Sunday the
    // pair would mismatch. The bare char is unbracketed, so no pair.
    const result = verifyOriginDateWeekdays({ answerText: "2026年12月1日は日用品を買う日です。" });
    expect(result.summary.pairCount).toBe(0);
    expect(result.correctedText).toBeNull();
  });

  it("does not attach a weekday that heads its own clause", () => {
    // "、木曜日は休館日です" states a rule about Thursdays; it is not
    // an appositive weekday for 12月25日 (a Friday in 2026).
    const result = verifyOriginDateWeekdays({
      answerText: "締切は2026年12月25日、木曜日は休館日です。",
    });
    expect(result.summary.pairCount).toBe(0);
    expect(result.correctedText).toBeNull();
  });
});

describe("(b) relative-date recomputation", () => {
  it("H-07 fixture: detects the wrong result date and corrects every mention of it", () => {
    const result = verifyOriginDateWeekdays({ answerText: H07_ANSWER, questionText: H07_QUESTION });
    expect(result.summary.relativeChecked).toBe(true);
    expect(result.summary.relativeMismatch).toBe(true);
    expect(result.summary.relativeAmbiguous).toBe(false);
    // Pairs: （火曜日）on the asserted result and は土曜日 on the base
    // restatement. Only the first mismatches its stated date.
    expect(result.summary.pairCount).toBe(2);
    expect(result.summary.weekdayMismatchCount).toBe(1);
    expect(result.correctedText).toBe(H07_CORRECTED);
    expect(result.summary.fixableCount).toBe(2);
    expect(result.summary.correctionReverted).toBe(false);
  });

  it("accepts the correct H-07 answer unchanged", () => {
    const answer = "2026年12月22日（火曜日）が45日後です。";
    const result = verifyOriginDateWeekdays({ answerText: answer, questionText: H07_QUESTION });
    expect(result.summary.relativeChecked).toBe(true);
    expect(result.summary.relativeMismatch).toBe(false);
    expect(result.correctedText).toBeNull();
  });

  it("recomputes N-days-before questions and replaces the asserted date and its weekday", () => {
    const question = "2026年3月1日の10日前は、何月何日で何曜日ですか？";
    const wrong = verifyOriginDateWeekdays({ answerText: "2026年2月20日（木曜日）です。", questionText: question });
    expect(wrong.summary.relativeMismatch).toBe(true);
    expect(wrong.correctedText).toBe("2026年2月19日（木曜日）です。");
    const right = verifyOriginDateWeekdays({ answerText: "2026年2月19日（木曜日）です。", questionText: question });
    expect(right.summary.relativeMismatch).toBe(false);
    expect(right.correctedText).toBeNull();
  });

  it("preserves zero-padding when replacing a date", () => {
    const question = "2026年3月1日の10日前は、何月何日で何曜日ですか？";
    const result = verifyOriginDateWeekdays({ answerText: "2026年02月20日（木曜日）です。", questionText: question });
    expect(result.correctedText).toBe("2026年02月19日（木曜日）です。");
  });

  it("replaces a weekday that was consistent with the wrong date", () => {
    // 2020-02-01 really is a Saturday, so (a) alone sees no problem;
    // only the recomputation catches that the result itself is wrong.
    const question = "2020年1月1日の30日後は何月何日で何曜日ですか？";
    const result = verifyOriginDateWeekdays({ answerText: "2020年2月1日（土曜日）です。", questionText: question });
    expect(result.summary.weekdayMismatchCount).toBe(0);
    expect(result.summary.relativeMismatch).toBe(true);
    expect(result.correctedText).toBe("2020年1月31日（金曜日）です。");
  });

  it("identifies the asserted result from the first sentence when no weekday is attached", () => {
    const question = "今日の3日後は何月何日ですか？";
    const now = new Date("2026-11-18T00:00:00Z"); // 2026-11-18 09:00 JST
    const result = verifyOriginDateWeekdays({ answerText: "2026年11月22日です。", questionText: question, now });
    expect(result.summary.relativeChecked).toBe(true);
    expect(result.summary.relativeMismatch).toBe(true);
    expect(result.correctedText).toBe("2026年11月21日です。");
  });

  it("passes through when the asserted result cannot be identified uniquely", () => {
    const answer = "候補は2026年12月22日（火曜日）と2026年12月23日（水曜日）のどちらかです。";
    const result = verifyOriginDateWeekdays({ answerText: answer, questionText: H07_QUESTION });
    expect(result.summary.relativeChecked).toBe(true);
    expect(result.summary.relativeAmbiguous).toBe(true);
    expect(result.summary.relativeMismatch).toBe(false);
    expect(result.correctedText).toBeNull();
  });

  it("passes through when the answer asserts no result date", () => {
    const result = verifyOriginDateWeekdays({
      answerText: "2026年11月7日から数えて計算します。",
      questionText: H07_QUESTION,
    });
    expect(result.summary.relativeChecked).toBe(true);
    expect(result.summary.relativeAmbiguous).toBe(true);
    expect(result.correctedText).toBeNull();
  });

  it("derives no expectation when the question carries two different offsets", () => {
    const result = verifyOriginDateWeekdays({
      answerText: "2026年12月22日（火曜日）です。",
      questionText: "2026年11月7日の45日後と10日前はそれぞれ何日ですか？",
    });
    expect(result.summary.relativeChecked).toBe(false);
    expect(result.correctedText).toBeNull();
  });

  it("derives no expectation when the question carries two different base dates", () => {
    const result = verifyOriginDateWeekdays({
      answerText: "2026年12月22日（火曜日）です。",
      questionText: "2026年11月7日と2026年11月8日の45日後は？",
    });
    expect(result.summary.relativeChecked).toBe(false);
  });
});

describe("answers without date claims stay untouched", () => {
  it("returns no detections and no correction for a plain answer", () => {
    const result = verifyOriginDateWeekdays({ answerText: "富士山の高さは3,776mです。" });
    expect(result.summary.pairCount).toBe(0);
    expect(result.summary.weekdayMismatchCount).toBe(0);
    expect(result.summary.relativeChecked).toBe(false);
    expect(result.correctedText).toBeNull();
  });
});

describe("gate application", () => {
  it("shadow mode (default) logs counts and never alters the answer", () => {
    const logger = vi.fn();
    const outcome = applyOriginDateWeekdayVerificationGate({
      requestId: "req-1",
      answerText: H07_ANSWER,
      requestText: H07_QUESTION,
      env: {},
      logger,
    });
    expect(outcome.mode).toBe("shadow");
    expect(outcome.answerText).toBe(H07_ANSWER);
    expect(outcome.summary?.relativeMismatch).toBe(true);
    const [message, fields] = logger.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("date weekday verification (shadow)");
    expect(fields.dateVerificationRelativeMismatchCount).toBe(1);
    expect(fields.dateVerificationFixableCount).toBe(2);
    expect(fields.dateVerificationCorrectedCount).toBe(0);
    // Logs never carry answer or question text.
    expect(JSON.stringify(fields)).not.toContain("12月23日");
    expect(JSON.stringify(fields)).not.toContain("45日後");
  });

  it("enforce mode delivers the verified correction", () => {
    const logger = vi.fn();
    const outcome = applyOriginDateWeekdayVerificationGate({
      requestId: "req-2",
      answerText: H07_ANSWER,
      requestText: H07_QUESTION,
      env: { ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE: "enforce" },
      logger,
    });
    expect(outcome.mode).toBe("enforce");
    expect(outcome.answerText).toBe(H07_CORRECTED);
    const [message, fields] = logger.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("date weekday verification (enforce)");
    expect(fields.dateVerificationCorrectedCount).toBe(2);
  });

  it("enforce mode leaves a correct answer byte-identical", () => {
    const answer = "2026年12月22日（火曜日）が45日後です。";
    const outcome = applyOriginDateWeekdayVerificationGate({
      requestId: "req-3",
      answerText: answer,
      requestText: H07_QUESTION,
      env: { ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE: "enforce" },
      logger: vi.fn(),
    });
    expect(outcome.answerText).toBe(answer);
  });

  it("shadow hook returns the summary and logs counts only", () => {
    const logger = vi.fn();
    const summary = logOriginDateWeekdayVerificationShadow({
      requestId: "req-4",
      answerText: H07_ANSWER,
      questionText: H07_QUESTION,
      logger,
    });
    expect(summary?.weekdayMismatchCount).toBe(1);
    const [, fields] = logger.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.stringify(fields)).not.toContain("12月23日");
  });
});

describe("streaming arming heuristic", () => {
  it("arms for date-bearing questions only", () => {
    expect(originDateWeekdayVerificationMayApply(H07_QUESTION)).toBe(true);
    expect(originDateWeekdayVerificationMayApply("今日は何曜日ですか？")).toBe(true);
    expect(originDateWeekdayVerificationMayApply("来週の月曜日は何日ですか？")).toBe(true);
    expect(originDateWeekdayVerificationMayApply("美味しいラーメン屋を教えてください。")).toBe(false);
    expect(originDateWeekdayVerificationMayApply("クリスマスの日付を教えてください。")).toBe(false);
  });
});
