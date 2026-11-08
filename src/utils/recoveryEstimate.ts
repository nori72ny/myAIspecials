/**
 * Recovery-estimate wording for free-AI rate-limit failures.
 *
 * The chat API already reports how long the provider asked us to wait:
 * `retryAfterSeconds`, taken from the provider's own Retry-After header.
 * This helper turns that single fact into one plain sentence that callers
 * append to the existing rate-limit message. It never invents a time:
 * when the value is missing, non-numeric, or not positive, it returns
 * null and the caller keeps the previous wording unchanged.
 */

export type RecoveryEstimateLanguage = "ja" | "en";

/**
 * Waits at or above this many seconds are presented as a clock time
 * ("回復の目安は9時00分頃です") instead of a raw second count, and are
 * too long for a ticking per-second countdown in the UI.
 */
export const RECOVERY_ESTIMATE_CLOCK_THRESHOLD_SECONDS = 120;

/**
 * Accepts only a plain number or numeric string that is finite and
 * positive. Anything else (undefined, null, booleans, objects, NaN,
 * zero, negatives) yields null so no estimate is shown.
 */
export function retryAfterSecondsOrNull(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * Formats the local clock time by hand ("9時05分" / "9:05 AM") instead of
 * via Intl, whose ja-JP hour/minute rendering differs between runtimes
 * (some produce "9:05"), so the wording stays identical everywhere.
 */
function formatClockTime(target: Date, language: RecoveryEstimateLanguage): string {
  const hour = target.getHours();
  const minute = String(target.getMinutes()).padStart(2, "0");
  if (language === "ja") return `${hour}時${minute}分`;
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}

function formatRecoveryWhen(target: Date, now: Date, language: RecoveryEstimateLanguage): string {
  const time = formatClockTime(target, language);
  if (isSameLocalDay(target, now)) {
    return language === "en" ? `around ${time}` : `${time}頃`;
  }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameLocalDay(target, tomorrow)) {
    return language === "en" ? `around ${time} tomorrow` : `明日${time}頃`;
  }
  if (language === "en") {
    return `around ${time} on ${target.getMonth() + 1}/${target.getDate()}`;
  }
  return `${target.getMonth() + 1}月${target.getDate()}日${time}頃`;
}

/**
 * Builds the recovery-estimate sentence for a rate-limit failure, or
 * null when no trustworthy wait time is available.
 *
 * Short waits (under the clock threshold) are phrased as a duration;
 * longer waits become the local clock time at which the wait ends,
 * computed as `nowMs + retryAfterSeconds` in the viewer's timezone.
 */
export function recoveryEstimateSentence(
  retryAfterSeconds: unknown,
  nowMs: number,
  language: RecoveryEstimateLanguage,
): string | null {
  const seconds = retryAfterSecondsOrNull(retryAfterSeconds);
  if (seconds === null || !Number.isFinite(nowMs)) return null;
  if (seconds < RECOVERY_ESTIMATE_CLOCK_THRESHOLD_SECONDS) {
    const rounded = Math.ceil(seconds);
    return language === "en"
      ? `Recovery is expected in about ${rounded} seconds.`
      : `回復の目安は約${rounded}秒後です。`;
  }
  const now = new Date(nowMs);
  const target = new Date(nowMs + seconds * 1000);
  const when = formatRecoveryWhen(target, now, language);
  return language === "en"
    ? `Recovery is expected ${when}.`
    : `回復の目安は${when}です。`;
}
