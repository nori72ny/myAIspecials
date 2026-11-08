import { describe, expect, it } from "vitest";
import {
  RECOVERY_ESTIMATE_CLOCK_THRESHOLD_SECONDS,
  recoveryEstimateSentence,
  retryAfterSecondsOrNull,
} from "./recoveryEstimate";

// Local-time anchors keep the same-day / tomorrow branches deterministic
// regardless of the timezone the test runner uses.
const at = (hour: number, minute = 0) => new Date(2026, 10, 9, hour, minute, 0).getTime();

describe("retryAfterSecondsOrNull", () => {
  it("accepts positive numbers and numeric strings", () => {
    expect(retryAfterSecondsOrNull(120)).toBe(120);
    expect(retryAfterSecondsOrNull("120")).toBe(120);
    expect(retryAfterSecondsOrNull(0.5)).toBe(0.5);
  });

  it("rejects missing, non-numeric, and non-positive values", () => {
    expect(retryAfterSecondsOrNull(undefined)).toBeNull();
    expect(retryAfterSecondsOrNull(null)).toBeNull();
    expect(retryAfterSecondsOrNull("")).toBeNull();
    expect(retryAfterSecondsOrNull("soon")).toBeNull();
    expect(retryAfterSecondsOrNull(0)).toBeNull();
    expect(retryAfterSecondsOrNull(-30)).toBeNull();
    expect(retryAfterSecondsOrNull(Number.NaN)).toBeNull();
    expect(retryAfterSecondsOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(retryAfterSecondsOrNull(true)).toBeNull();
    expect(retryAfterSecondsOrNull({ seconds: 120 })).toBeNull();
  });
});

describe("recoveryEstimateSentence", () => {
  it("returns null when no trustworthy wait time is available", () => {
    expect(recoveryEstimateSentence(undefined, at(10), "ja")).toBeNull();
    expect(recoveryEstimateSentence(null, at(10), "ja")).toBeNull();
    expect(recoveryEstimateSentence(0, at(10), "ja")).toBeNull();
    expect(recoveryEstimateSentence(-1, at(10), "en")).toBeNull();
    expect(recoveryEstimateSentence("later", at(10), "ja")).toBeNull();
  });

  it("phrases short waits as a duration in Japanese", () => {
    expect(recoveryEstimateSentence(45, at(10), "ja")).toBe("回復の目安は約45秒後です。");
    expect(recoveryEstimateSentence(45.2, at(10), "ja")).toBe("回復の目安は約46秒後です。");
  });

  it("phrases short waits as a duration in English", () => {
    expect(recoveryEstimateSentence(45, at(10), "en")).toBe("Recovery is expected in about 45 seconds.");
  });

  it("phrases long waits as a same-day clock time", () => {
    // 10:00 + 1 hour -> 11:00 the same day.
    expect(recoveryEstimateSentence(3600, at(10), "ja")).toBe("回復の目安は11時00分頃です。");
    expect(recoveryEstimateSentence(3600, at(10), "en")).toBe("Recovery is expected around 11:00 AM.");
  });

  it("switches to clock time exactly at the threshold", () => {
    const justBelow = recoveryEstimateSentence(RECOVERY_ESTIMATE_CLOCK_THRESHOLD_SECONDS - 1, at(10), "ja");
    expect(justBelow).toBe(`回復の目安は約${RECOVERY_ESTIMATE_CLOCK_THRESHOLD_SECONDS - 1}秒後です。`);
    // 10:00 + 120 seconds -> 10:02 the same day.
    expect(recoveryEstimateSentence(RECOVERY_ESTIMATE_CLOCK_THRESHOLD_SECONDS, at(10), "ja"))
      .toBe("回復の目安は10時02分頃です。");
  });

  it("names tomorrow when the wait crosses midnight", () => {
    // 23:30 + 1 hour -> 00:30 the next day.
    expect(recoveryEstimateSentence(3600, at(23, 30), "ja")).toBe("回復の目安は明日0時30分頃です。");
    expect(recoveryEstimateSentence(3600, at(23, 30), "en")).toBe("Recovery is expected around 12:30 AM tomorrow.");
  });

  it("includes the date when recovery is further out than tomorrow", () => {
    // 2026-11-09 10:00 + 3 days -> 2026-11-12 10:00.
    expect(recoveryEstimateSentence(3 * 24 * 3600, at(10), "ja")).toBe("回復の目安は11月12日10時00分頃です。");
    expect(recoveryEstimateSentence(3 * 24 * 3600, at(10), "en")).toBe("Recovery is expected around 10:00 AM on 11/12.");
  });
});
