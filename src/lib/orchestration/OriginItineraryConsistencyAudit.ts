import { detectOriginBusinessPlanningKind } from "./OriginBusinessPlanning.js";

// Deterministic consistency audit for itinerary / day-trip planning
// answers — stage 0: detection only (module + classifier + fixed cases),
// routers not yet connected, so production behaviour is unchanged.
//
// Design canon: WEEKLY_INSPECTION_P2_DESIGN_2026-11-24.md. The weekly
// production inspection of 2026-11-23 (Q3) found a personal day-trip
// answer that stated a fabricated transfer time ("about 30 minutes" for
// a leg that really takes 90+), left a 90-minute gap unexplained,
// inserted a detour that contradicted the request, and promised an
// "early-morning entry" while starting at 09:00. Every existing
// deterministic gate missed it: the numeric audit gate only fires for
// the seven business planning kinds (a personal trip detects no
// profile), and no gate owns clock-time arithmetic or transfer claims.
//
// This checker therefore does NOT try to verify a stated duration
// against the real world — no free, card-less, zero-retention routing
// source covers Japanese rail (design §4), so the true value is
// unobtainable. It checks only what arithmetic inside the answer
// itself can prove:
// - T-1/T-2: time ranges that run backwards or overlap;
// - T-3: a stated transfer duration that cannot fit the scheduled gap,
//   or two different durations stated for the same transfer;
// - T-6: a hard clock constraint in the request (return-by deadline,
//   return-anchored departure) contradicted by the itinerary's own
//   final end time;
// and it records, without judging truth:
// - T-5: the mere existence of an ungrounded duration / distance claim
//   in a movement context (the direct route has no sources by
//   definition, so any such claim is ungrounded);
// - T-4/T-7/T-8: shadow-only signals (unexplained gaps, constraint /
//   detour coexistence, "early" claims vs the first start time) whose
//   defect-hood is context-dependent. These stay record-only even if a
//   later stage enforces the others (ORIGIN_ITINERARY_AUDIT_SHADOW_ONLY_CODES).
//
// The discipline mirrors the numeric audit gate: pure functions,
// violation codes, check counters, and details that carry numbers and
// fixed vocabulary only — never excerpts of the answer and never place
// names — so shadow logs hold no personal information. Parsing is
// line-based (table rows / bullet lines); the only cross-line
// structure is the document order of the parsed activities themselves.
//
// Stage plan (design §6): stage 0 = this module, switch default off,
// no router connection. Stage 1 connects both routers in shadow mode;
// stage 2 (enforce) annotates only — it never rewrites figures, never
// suppresses an answer and never regenerates — and needs the design's
// promotion bars plus the owner's explicit approval. The mode resolver
// below exists so the switch's name and default are fixed now; nothing
// reads it until the stage-1 connection lands.

export type OriginItineraryAuditViolationCode =
  | "ITIN_TIME_RANGE_INVERSION"
  | "ITIN_TIME_OVERLAP"
  | "ITIN_TRANSFER_INFEASIBLE"
  | "ITIN_UNEXPLAINED_GAP"
  | "ITIN_UNGROUNDED_DURATION"
  | "ITIN_UNGROUNDED_DISTANCE"
  | "ITIN_REQUEST_CONSTRAINT_TIME"
  | "ITIN_CONSTRAINT_DETOUR_CANDIDATE"
  | "ITIN_EARLY_CLAIM_MISMATCH";

export interface OriginItineraryAuditViolation {
  code: OriginItineraryAuditViolationCode;
  detail: Readonly<Record<string, string | number>>;
}

export interface OriginItineraryAuditChecks {
  rangesParsed: number;
  legsFormed: number;
  durationClaims: number;
  distanceClaims: number;
  gapsChecked: number;
  constraintsParsed: number;
}

export interface OriginItineraryAuditResult {
  applicable: boolean;
  violations: readonly OriginItineraryAuditViolation[];
  checks: OriginItineraryAuditChecks;
}

/** Codes that are record-only by construction (design §3.1 / §6): even
 * an enforce stage must never annotate on these. */
export const ORIGIN_ITINERARY_AUDIT_SHADOW_ONLY_CODES: ReadonlySet<OriginItineraryAuditViolationCode> =
  new Set([
    "ITIN_UNEXPLAINED_GAP",
    "ITIN_CONSTRAINT_DETOUR_CANDIDATE",
    "ITIN_EARLY_CLAIM_MISMATCH",
  ]);

/** T-4 gap threshold (design §3.1; initial value, to be re-judged from
 * shadow measurements — design §11-1). */
export const ORIGIN_ITINERARY_GAP_THRESHOLD_MINUTES = 90;

/** T-8: an "early morning" claim contradicts a first start at or after
 * this time (09:00). The threshold is judgement-dependent, which is one
 * reason T-8 is shadow-only. */
export const ORIGIN_ITINERARY_EARLY_CLAIM_THRESHOLD_MINUTES = 9 * 60;

export type OriginItineraryAuditMode = "off" | "shadow" | "enforce";

/** The switch is exact-match with code default "off" (design §5.1): an
 * unregistered or unrecognised value behaves exactly like today. */
export function resolveOriginItineraryAuditMode(
  env: NodeJS.ProcessEnv | undefined,
): OriginItineraryAuditMode {
  const value = env?.ORIGIN_ITINERARY_AUDIT_MODE;
  return value === "shadow" || value === "enforce" ? value : "off";
}

// ---------------------------------------------------------------------------
// Text normalisation and clock parsing. Targeted (not full NFKC):
// full-width digits and colons fold to half-width, and the range
// separators are handled by the patterns themselves.
// ---------------------------------------------------------------------------

function normalizeItineraryText(text: string): string {
  return text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/　/g, " ");
}

const RANGE_RE =
  /(\d{1,2}):(\d{2})\s*[~〜～\-–—]\s*(\d{1,2}):(\d{2})|(\d{1,2})時(?!間)(?:(\d{1,2})分)?\s*[~〜～\-–—]\s*(\d{1,2})時(?!間)(?:(\d{1,2})分)?/g;
const SINGLE_CLOCK_RE = /(\d{1,2}):(\d{2})|(\d{1,2})時(?!間)(?:(\d{1,2})分)?/g;

function clockMinutes(hours: string, minutes: string | undefined): number | null {
  const h = Number(hours);
  const m = minutes === undefined ? 0 : Number(minutes);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

interface ParsedRange {
  start: number;
  end: number;
  lineIndex: number;
  spanStart: number;
  spanEnd: number;
}

interface ParsedClaim {
  kind: "duration" | "distance";
  /** Minutes for durations, kilometres for distances. */
  value: number;
  lineIndex: number;
  /** The answer itself marks this claim as unconfirmed (未確認 etc.):
   * extracted and counted, but never an ungrounded assertion. */
  unconfirmed: boolean;
}

interface ParsedItinerary {
  ranges: ParsedRange[];
  claims: ParsedClaim[];
  lines: string[];
}

const MOVEMENT_WORDS = [
  "移動",
  "電車",
  "バス",
  "徒歩",
  "タクシー",
  "新幹線",
  "在来線",
  "特急",
  "船",
  "フェリー",
  "飛行機",
  "車で",
  "ドライブ",
  "高速",
  "乗車",
  "乗り換え",
  "乗換",
  "所要",
] as const;

const MEAL_WORDS = [
  "食事",
  "昼食",
  "夕食",
  "朝食",
  "ランチ",
  "ディナー",
  "ご飯",
  "ごはん",
  "レストラン",
  "カフェ",
] as const;

/** A duration / distance stated together with one of these markers is
 * presented as unconfirmed, not asserted — it is extracted (and counted)
 * but never recorded as an ungrounded claim (design §7.2 normal case). */
const UNCONFIRMED_MARKERS = ["未確認", "未検証", "要確認"] as const;

function lineHasAny(line: string, words: readonly string[]): boolean {
  return words.some((word) => line.includes(word));
}

const DURATION_HOURS_RE = /(\d+(?:\.\d+)?)\s*時間(?:\s*(\d+)\s*分)?/g;
const DURATION_MINUTES_RE = /(\d+)\s*分/g;
const DISTANCE_RE = /(\d+(?:\.\d+)?)\s*(?:km|キロメートル|キロ(?!グラム|カロリー))/gi;

function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function parseItinerary(answerText: string): ParsedItinerary {
  const lines = normalizeItineraryText(answerText).split("\n");
  const ranges: ParsedRange[] = [];
  const claims: ParsedClaim[] = [];

  lines.forEach((line, lineIndex) => {
    const clockSpans: Array<{ start: number; end: number }> = [];

    RANGE_RE.lastIndex = 0;
    let rangeMatch: RegExpExecArray | null;
    while ((rangeMatch = RANGE_RE.exec(line)) !== null) {
      const start =
        rangeMatch[1] !== undefined
          ? clockMinutes(rangeMatch[1], rangeMatch[2])
          : clockMinutes(rangeMatch[5], rangeMatch[6]);
      const end =
        rangeMatch[1] !== undefined
          ? clockMinutes(rangeMatch[3], rangeMatch[4])
          : clockMinutes(rangeMatch[7], rangeMatch[8]);
      clockSpans.push({ start: rangeMatch.index, end: rangeMatch.index + rangeMatch[0].length });
      if (start !== null && end !== null) {
        ranges.push({
          start,
          end,
          lineIndex,
          spanStart: rangeMatch.index,
          spanEnd: rangeMatch.index + rangeMatch[0].length,
        });
      }
    }

    SINGLE_CLOCK_RE.lastIndex = 0;
    let clockMatch: RegExpExecArray | null;
    while ((clockMatch = SINGLE_CLOCK_RE.exec(line)) !== null) {
      clockSpans.push({ start: clockMatch.index, end: clockMatch.index + clockMatch[0].length });
    }

    // Duration / distance expressions on this line. Clock spans are
    // masked out first (the "30分" of "10時30分" is a clock reading,
    // not a duration), and the minutes part of an "N時間M分" form is
    // consumed by the hours form, never double-counted.
    const rawDurations: Array<{ value: number; start: number; end: number }> = [];
    const hourSpans: Array<{ start: number; end: number }> = [];
    DURATION_HOURS_RE.lastIndex = 0;
    let hoursMatch: RegExpExecArray | null;
    while ((hoursMatch = DURATION_HOURS_RE.exec(line)) !== null) {
      const hours = Number(hoursMatch[1]);
      const extraMinutes = hoursMatch[2] === undefined ? 0 : Number(hoursMatch[2]);
      if (Number.isFinite(hours) && hours > 0) {
        rawDurations.push({
          value: Math.round(hours * 60) + extraMinutes,
          start: hoursMatch.index,
          end: hoursMatch.index + hoursMatch[0].length,
        });
        hourSpans.push({ start: hoursMatch.index, end: hoursMatch.index + hoursMatch[0].length });
      }
    }
    DURATION_MINUTES_RE.lastIndex = 0;
    let minutesMatch: RegExpExecArray | null;
    while ((minutesMatch = DURATION_MINUTES_RE.exec(line)) !== null) {
      const start = minutesMatch.index;
      const end = start + minutesMatch[0].length;
      if (clockSpans.some((span) => spansOverlap(start, end, span.start, span.end))) continue;
      if (hourSpans.some((span) => spansOverlap(start, end, span.start, span.end))) continue;
      const value = Number(minutesMatch[1]);
      if (Number.isFinite(value) && value > 0) rawDurations.push({ value, start, end });
    }
    const rawDistances: Array<{ value: number; start: number; end: number }> = [];
    DISTANCE_RE.lastIndex = 0;
    let distanceMatch: RegExpExecArray | null;
    while ((distanceMatch = DISTANCE_RE.exec(line)) !== null) {
      const value = Number(distanceMatch[1]);
      if (Number.isFinite(value) && value > 0) {
        rawDistances.push({
          value,
          start: distanceMatch.index,
          end: distanceMatch.index + distanceMatch[0].length,
        });
      }
    }

    if (rawDurations.length === 0 && rawDistances.length === 0) return;

    // Movement context (design §3 T-5): the line names a means of
    // travel, or the line is an interstitial transfer description —
    // it sits strictly between the first and last activity lines and
    // carries no time range of its own.
    const hasRangeOnLine = ranges.some((range) => range.lineIndex === lineIndex);
    const firstRangeLine = ranges.length > 0 ? ranges[0].lineIndex : -1;
    const inMovementContext =
      lineHasAny(line, MOVEMENT_WORDS) ||
      (!hasRangeOnLine && firstRangeLine >= 0 && lineIndex > firstRangeLine);
    if (!inMovementContext) return;

    const unconfirmed = lineHasAny(line, UNCONFIRMED_MARKERS);
    for (const duration of rawDurations) {
      claims.push({ kind: "duration", value: duration.value, lineIndex, unconfirmed });
    }
    for (const distance of rawDistances) {
      claims.push({ kind: "distance", value: distance.value, lineIndex, unconfirmed });
    }
  });

  return { ranges, claims, lines };
}

// ---------------------------------------------------------------------------
// Classifier (design §3.0). The checker runs only on itinerary-shaped
// exchanges: the request asks for a trip / outing plan (fixed vocabulary)
// or pins a clock time, and the answer carries at least two time ranges
// — or one time range plus at least one movement claim. Answers whose
// request detects a business planning profile belong to the numeric
// audit gate and are excluded; research-route answers never reach the
// connection point (stage 1) and are out of scope by construction.
// ---------------------------------------------------------------------------

const ITINERARY_REQUEST_WORDS = [
  "プラン",
  "日帰り",
  "旅行",
  "観光",
  "旅程",
  "行程",
  "モデルコース",
  "お出かけ",
  "ドライブコース",
  "周遊",
] as const;

const REQUEST_TIME_SPEC_RE = /\d{1,2}\s*時|\d{1,2}:\d{2}/;

function classifierApplies(requestText: string, parsed: ParsedItinerary): boolean {
  if (detectOriginBusinessPlanningKind(requestText) !== null) return false;
  const request = normalizeItineraryText(requestText);
  const requestSide =
    lineHasAny(request, ITINERARY_REQUEST_WORDS) || REQUEST_TIME_SPEC_RE.test(request);
  if (!requestSide) return false;
  if (parsed.ranges.length >= 2) return true;
  return parsed.ranges.length === 1 && parsed.claims.length >= 1;
}

export function originItineraryAuditMayApply(requestText: string, answerText: string): boolean {
  return classifierApplies(requestText, parseItinerary(answerText));
}

// ---------------------------------------------------------------------------
// Request constraints (T-6). Only constraints whose arithmetic reading
// is unambiguous are parsed — the design's rule is that a constraint
// which cannot be parsed never fires:
// - "○時までに帰宅／帰る／戻る／着く": the itinerary's final end must
//   not pass the deadline;
// - a departure time ("○時発") counts only when the same clause marks
//   it as the way back (帰り／帰路／復路), again against the final end.
//   An unanchored "○時発" is just as likely to be the outbound train,
//   and a "○時集合" meeting time has no deterministic reading against
//   the final end (a mid-day meeting makes earlier activities
//   legitimate), so neither is parsed in stage 0.
// ---------------------------------------------------------------------------

interface RequestConstraint {
  kind: "return-by" | "return-departure";
  minutes: number;
}

const RETURN_BY_RE =
  /(午前|午後)?\s*(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分)?)\s*までに\s*(?:帰宅|帰還|帰る|戻る|着く|到着)/g;
const RETURN_DEPARTURE_RE =
  /(?:帰り|帰路|復路)[^。！？\n]{0,16}?(午前|午後)?\s*(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分)?)\s*発/g;

function constraintClockMinutes(
  meridiem: string | undefined,
  hours: string,
  colonMinutes: string | undefined,
  jiMinutes: string | undefined,
): number | null {
  let h = Number(hours);
  const m = colonMinutes !== undefined ? Number(colonMinutes) : jiMinutes === undefined ? 0 : Number(jiMinutes);
  if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59) return null;
  if (meridiem === "午後") {
    if (h >= 1 && h < 12) h += 12;
  } else if (meridiem === "午前") {
    if (h === 12) h = 0;
  }
  if (h < 0 || h > 23) return null;
  return h * 60 + m;
}

function parseRequestConstraints(requestText: string): RequestConstraint[] {
  const request = normalizeItineraryText(requestText);
  const constraints: RequestConstraint[] = [];
  const seen = new Set<string>();
  const collect = (
    re: RegExp,
    kind: RequestConstraint["kind"],
  ): void => {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(request)) !== null) {
      const minutes = constraintClockMinutes(match[1], match[2], match[3], match[4]);
      if (minutes === null) continue;
      const key = `${kind}:${minutes}`;
      if (seen.has(key)) continue;
      seen.add(key);
      constraints.push({ kind, minutes });
    }
  };
  collect(RETURN_BY_RE, "return-by");
  collect(RETURN_DEPARTURE_RE, "return-departure");
  return constraints;
}

// ---------------------------------------------------------------------------
// Detectors. Violations are emitted in detector order T-1..T-8 and, per
// detector, in document order, so results are stable for tests and logs.
// ---------------------------------------------------------------------------

const DETOUR_REQUEST_WORDS = [
  "直帰",
  "寄り道しない",
  "寄り道はしない",
  "寄り道なし",
  "まっすぐ帰る",
  "どこにも寄らない",
  "直接帰る",
] as const;

const RETURN_CONTEXT_WORDS = ["帰路", "帰り", "帰宅", "帰る", "戻る"] as const;
const STOPOVER_WORDS = ["途中で", "立ち寄", "寄って", "寄り道", "経由"] as const;
const EARLY_CLAIM_WORDS = ["早朝", "朝一", "朝イチ", "開園直後", "開場直後"] as const;

export function auditOriginItineraryConsistency(input: {
  requestText: string;
  answerText: string;
  now?: Date;
}): OriginItineraryAuditResult {
  const parsed = parseItinerary(input.answerText);
  const constraints = parseRequestConstraints(input.requestText);
  const checks: OriginItineraryAuditChecks = {
    rangesParsed: parsed.ranges.length,
    legsFormed: Math.max(0, parsed.ranges.length - 1),
    durationClaims: parsed.claims.filter((claim) => claim.kind === "duration").length,
    distanceClaims: parsed.claims.filter((claim) => claim.kind === "distance").length,
    gapsChecked: Math.max(0, parsed.ranges.length - 1),
    constraintsParsed: constraints.length,
  };

  if (!classifierApplies(input.requestText, parsed)) {
    return { applicable: false, violations: [], checks };
  }

  const violations: OriginItineraryAuditViolation[] = [];
  const { ranges, claims, lines } = parsed;

  // T-1: a range whose end does not come after its start (day-trip
  // premise: nothing runs past midnight into the next day).
  for (const range of ranges) {
    if (range.end <= range.start) {
      violations.push({
        code: "ITIN_TIME_RANGE_INVERSION",
        detail: { startMinutes: range.start, endMinutes: range.end },
      });
    }
  }

  // Legs between consecutive activities, with the claims that belong to
  // each leg. A claim belongs to exactly one leg: the leg ending at the
  // first activity on its line or later; a claim on the first
  // activity's own line belongs to the leg starting there; a claim
  // after the last activity belongs to no leg (the return leg has no
  // scheduled arrival to check against) but still counts for T-5.
  const legDurations: number[][] = ranges.map(() => []);
  for (const claim of claims) {
    if (claim.kind !== "duration") continue;
    let target = -1;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges[i].lineIndex >= claim.lineIndex) {
        target = i;
        break;
      }
    }
    if (target === 0 && ranges.length > 1) target = 1;
    if (target > 0) legDurations[target].push(claim.value);
  }

  // T-2 / T-3 / T-4 share the leg walk.
  for (let i = 1; i < ranges.length; i++) {
    const previous = ranges[i - 1];
    const next = ranges[i];
    const gap = next.start - previous.end;

    // T-2: consecutive activities overlap.
    if (previous.end > next.start) {
      violations.push({
        code: "ITIN_TIME_OVERLAP",
        detail: {
          previousEndMinutes: previous.end,
          nextStartMinutes: next.start,
          overlapMinutes: previous.end - next.start,
        },
      });
    }

    // T-3: a stated duration that cannot fit the scheduled gap, or two
    // different durations stated for the same transfer. Skipped when
    // the ranges already overlap (T-2 owns that breakage).
    const durations = legDurations[i];
    if (gap >= 0 && durations.length > 0) {
      const distinct = [...new Set(durations)];
      if (distinct.length >= 2) {
        violations.push({
          code: "ITIN_TRANSFER_INFEASIBLE",
          detail: {
            statedMinutesA: distinct[0],
            statedMinutesB: distinct[1],
            gapMinutes: gap,
          },
        });
      } else if (distinct[0] > gap) {
        violations.push({
          code: "ITIN_TRANSFER_INFEASIBLE",
          detail: { statedMinutes: distinct[0], gapMinutes: gap },
        });
      }
    }

    // T-4 (shadow-only): a gap at or over the threshold that no line
    // between the two activities fills with a transfer or meal
    // description. Only the lines strictly between count: a duration
    // parenthetical on an activity's own line ("…（電車で約30分）")
    // states how long the transfer takes — T-3 / T-5 territory — and
    // does not narrate what happens inside a much longer interval, so
    // counting it as filling the gap would make the Q3 shape (a stated
    // 30 minutes inside a 210-minute gap) undetectable.
    if (gap >= ORIGIN_ITINERARY_GAP_THRESHOLD_MINUTES) {
      let filled = false;
      for (
        let lineIndex = previous.lineIndex + 1;
        lineIndex < next.lineIndex && !filled;
        lineIndex++
      ) {
        const line = lines[lineIndex] ?? "";
        if (lineHasAny(line, MOVEMENT_WORDS) || lineHasAny(line, MEAL_WORDS)) filled = true;
      }
      if (!filled) {
        violations.push({
          code: "ITIN_UNEXPLAINED_GAP",
          detail: {
            gapMinutes: gap,
            thresholdMinutes: ORIGIN_ITINERARY_GAP_THRESHOLD_MINUTES,
          },
        });
      }
    }
  }

  // T-5: ungrounded duration / distance claims. Extraction only — the
  // truth of a claim is never judged (design §3.1). Claims the answer
  // itself marks as unconfirmed are not assertions and never fire.
  claims.forEach((claim) => {
    if (claim.unconfirmed) return;
    if (claim.kind === "duration") {
      violations.push({
        code: "ITIN_UNGROUNDED_DURATION",
        detail: { statedMinutes: claim.value },
      });
    } else {
      violations.push({
        code: "ITIN_UNGROUNDED_DISTANCE",
        detail: { statedKilometers: claim.value },
      });
    }
  });

  // T-6: hard request constraints vs the itinerary's own final end.
  if (ranges.length > 0) {
    const finalEnd = ranges[ranges.length - 1].end;
    for (const constraint of constraints) {
      if (finalEnd > constraint.minutes) {
        violations.push({
          code: "ITIN_REQUEST_CONSTRAINT_TIME",
          detail: {
            constraintKind: constraint.kind,
            constraintMinutes: constraint.minutes,
            finalEndMinutes: finalEnd,
          },
        });
      }
    }
  }

  // T-7 (shadow-only): a no-detour constraint in the request coexisting
  // with a stopover description on the way back. Coexistence is all
  // that is deterministic — whether it is a real contradiction is a
  // semantic judgement left to other layers.
  if (lineHasAny(normalizeItineraryText(input.requestText), DETOUR_REQUEST_WORDS)) {
    const hasDetour = lines.some(
      (line) => lineHasAny(line, RETURN_CONTEXT_WORDS) && lineHasAny(line, STOPOVER_WORDS),
    );
    if (hasDetour) {
      violations.push({
        code: "ITIN_CONSTRAINT_DETOUR_CANDIDATE",
        detail: { marker: "return-stopover" },
      });
    }
  }

  // T-8 (shadow-only): an "early" claim contradicted by the first
  // activity's own start time.
  if (ranges.length > 0 && ranges[0].start >= ORIGIN_ITINERARY_EARLY_CLAIM_THRESHOLD_MINUTES) {
    if (lines.some((line) => lineHasAny(line, EARLY_CLAIM_WORDS))) {
      violations.push({
        code: "ITIN_EARLY_CLAIM_MISMATCH",
        detail: {
          firstStartMinutes: ranges[0].start,
          thresholdMinutes: ORIGIN_ITINERARY_EARLY_CLAIM_THRESHOLD_MINUTES,
        },
      });
    }
  }

  return { applicable: true, violations, checks };
}
