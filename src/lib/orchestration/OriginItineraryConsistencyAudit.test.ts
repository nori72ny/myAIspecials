import { describe, expect, it } from "vitest";

import {
  ORIGIN_ITINERARY_AUDIT_SHADOW_ONLY_CODES,
  auditOriginItineraryConsistency,
  originItineraryAuditMayApply,
  resolveOriginItineraryAuditMode,
  type OriginItineraryAuditViolationCode,
} from "./OriginItineraryConsistencyAudit.js";

// Fixed cases for the itinerary consistency audit (design:
// WEEKLY_INSPECTION_P2_DESIGN_2026-11-24.md §7.2). Offline bars:
// - T-1 / T-2 / T-3 / T-6 fire on every case built for them;
// - no detector fires on any normal case;
// - T-5 fires on the Q3 reconstruction;
// - the classifier never fires for business-planning or non-itinerary
//   answers.

const DAY_TRIP_REQUEST = "週末に家族で楽しめる東京近郊の日帰りプランを考えて";

function codes(requestText: string, answerText: string): OriginItineraryAuditViolationCode[] {
  return auditOriginItineraryConsistency({ requestText, answerText }).violations.map(
    (violation) => violation.code,
  );
}

describe("classifier (design §3.0)", () => {
  it("applies to an itinerary request with two or more time ranges", () => {
    expect(originItineraryAuditMayApply(DAY_TRIP_REQUEST, "09:00–10:00 A\n11:00–12:00 B")).toBe(
      true,
    );
  });

  it("applies with one time range plus one movement claim", () => {
    expect(
      originItineraryAuditMayApply(DAY_TRIP_REQUEST, "09:00–10:00 A\n電車で約30分"),
    ).toBe(true);
  });

  it("does not apply with a single range and no movement claim", () => {
    expect(originItineraryAuditMayApply(DAY_TRIP_REQUEST, "09:00–10:00 A")).toBe(false);
  });

  it("does not apply when the request carries no itinerary vocabulary or time spec", () => {
    expect(
      originItineraryAuditMayApply(
        "鶏肉の煮込み料理のレシピを教えて",
        "09:00–10:00 下ごしらえ\n11:00–12:00 仕上げ",
      ),
    ).toBe(false);
  });

  it("does not apply to a business planning answer (the numeric audit gate owns it)", () => {
    const request = "新商品の販促キャンペーンを考えてください";
    const answer = "10:00–11:00 キックオフ\n11:30–12:30 レビュー";
    expect(originItineraryAuditMayApply(request, answer)).toBe(false);
    expect(auditOriginItineraryConsistency({ requestText: request, answerText: answer }).applicable).toBe(
      false,
    );
  });

  it("does not apply to a non-itinerary answer that merely contains durations", () => {
    const answer = "下ごしらえをして、弱火で約20分煮込みます。さらに10分蒸らします。";
    expect(originItineraryAuditMayApply("鶏肉の煮込み料理のレシピを教えて", answer)).toBe(false);
  });
});

describe("normal cases: no detector fires", () => {
  it("a tight but feasible itinerary", () => {
    const answer = [
      "09:00–10:30 東京ディズニーランド",
      "10:30–12:00 昼食とショッピング",
      "12:00–13:00 休憩",
      "13:00–15:00 舞浜散策",
    ].join("\n");
    const result = auditOriginItineraryConsistency({ requestText: DAY_TRIP_REQUEST, answerText: answer });
    expect(result.applicable).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("a long gap explained by a transfer and a meal in between", () => {
    const answer = [
      "09:00–10:30 水族館",
      "電車で移動し、途中の駅前で昼食をとります",
      "12:30–14:00 公園",
    ].join("\n");
    expect(codes(DAY_TRIP_REQUEST, answer)).toEqual([]);
  });

  it("a duration stated as unconfirmed is extracted but never an ungrounded claim", () => {
    const answer = [
      "09:00–10:30 美術館",
      "移動は電車で、所要時間は未確認です（約40分程度と聞いていますが未確認）",
      "12:00–13:30 公園",
    ].join("\n");
    const result = auditOriginItineraryConsistency({ requestText: DAY_TRIP_REQUEST, answerText: answer });
    expect(result.violations).toEqual([]);
    expect(result.checks.durationClaims).toBe(1);
  });

  it("an itinerary with no duration or distance claims at all", () => {
    const answer = [
      "09:00–10:00 清水寺",
      "10:15–11:30 祇園散策",
      "11:30–12:30 昼食",
      "13:00–15:00 嵐山",
    ].join("\n");
    const result = auditOriginItineraryConsistency({
      requestText: "京都の日帰り観光プランをお願いします",
      answerText: answer,
    });
    expect(result.applicable).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.checks).toMatchObject({ rangesParsed: 4, legsFormed: 3, durationClaims: 0 });
  });

  it("a feasible stated duration that fits its gap raises no T-3 (T-5 still records it)", () => {
    const answer = ["09:00–10:00 A", "電車で約30分", "10:30–11:30 B"].join("\n");
    const found = codes(DAY_TRIP_REQUEST, answer);
    expect(found).not.toContain("ITIN_TRANSFER_INFEASIBLE");
    expect(found).toContain("ITIN_UNGROUNDED_DURATION");
  });

  it("a return-by constraint the itinerary honours raises no T-6", () => {
    const request = "17時までに帰宅したい。家族で楽しめる日帰りプランを考えて";
    const answer = ["09:00–12:00 A", "13:00–16:30 B"].join("\n");
    expect(codes(request, answer)).not.toContain("ITIN_REQUEST_CONSTRAINT_TIME");
  });
});

describe("defect cases: each detector fires on its own shape", () => {
  it("T-1: a time range that runs backwards", () => {
    const answer = ["09:00–10:00 A", "電車で移動します", "14:00–13:00 B"].join("\n");
    expect(codes(DAY_TRIP_REQUEST, answer)).toEqual(["ITIN_TIME_RANGE_INVERSION"]);
  });

  it("T-2: consecutive activities that overlap", () => {
    const answer = ["09:00–11:00 A", "10:30–12:00 B"].join("\n");
    expect(codes(DAY_TRIP_REQUEST, answer)).toEqual(["ITIN_TIME_OVERLAP"]);
  });

  it("T-3: a stated duration that cannot fit the scheduled gap", () => {
    const answer = ["09:00–10:30 A", "電車で約45分", "10:45–12:00 B"].join("\n");
    const found = codes(DAY_TRIP_REQUEST, answer);
    expect(found).toContain("ITIN_TRANSFER_INFEASIBLE");
    expect(found).not.toContain("ITIN_UNEXPLAINED_GAP");
  });

  it("T-3: two different durations stated for the same transfer", () => {
    const answer = ["09:00–10:00 A", "電車で約20分、バスなら約35分", "11:00–12:00 B"].join("\n");
    const result = auditOriginItineraryConsistency({ requestText: DAY_TRIP_REQUEST, answerText: answer });
    const t3 = result.violations.find((v) => v.code === "ITIN_TRANSFER_INFEASIBLE");
    expect(t3).toBeDefined();
    expect(t3?.detail).toMatchObject({ statedMinutesA: 20, statedMinutesB: 35 });
  });

  it("T-4: a long gap with nothing in between", () => {
    const answer = ["09:00–10:30 A", "14:00–16:00 B"].join("\n");
    expect(codes(DAY_TRIP_REQUEST, answer)).toEqual(["ITIN_UNEXPLAINED_GAP"]);
  });

  it("T-5: an ungrounded duration claim", () => {
    const answer = ["09:00–10:00 A", "電車で約30分", "10:30–11:30 B"].join("\n");
    expect(codes(DAY_TRIP_REQUEST, answer)).toEqual(["ITIN_UNGROUNDED_DURATION"]);
  });

  it("T-5: an ungrounded distance claim", () => {
    const answer = ["09:00–10:00 A", "車で約25km", "10:30–11:30 B"].join("\n");
    const result = auditOriginItineraryConsistency({ requestText: DAY_TRIP_REQUEST, answerText: answer });
    expect(result.violations.map((v) => v.code)).toEqual(["ITIN_UNGROUNDED_DISTANCE"]);
    expect(result.violations[0].detail).toEqual({ statedKilometers: 25 });
  });

  it("T-6: the itinerary ends after the request's return-by deadline", () => {
    const request = "17時までに帰宅したい。家族で楽しめる日帰りプランを考えて";
    const answer = ["09:00–12:00 A", "13:00–18:30 B"].join("\n");
    const result = auditOriginItineraryConsistency({ requestText: request, answerText: answer });
    expect(result.violations.map((v) => v.code)).toEqual(["ITIN_REQUEST_CONSTRAINT_TIME"]);
    expect(result.violations[0].detail).toMatchObject({
      constraintKind: "return-by",
      constraintMinutes: 17 * 60,
      finalEndMinutes: 18 * 60 + 30,
    });
    expect(result.checks.constraintsParsed).toBe(1);
  });

  it("T-6: an unanchored departure time is not parsed as a constraint", () => {
    const request = "9時発の電車で出かける日帰りプランを考えて";
    const answer = ["10:00–12:00 A", "13:00–18:30 B"].join("\n");
    const result = auditOriginItineraryConsistency({ requestText: request, answerText: answer });
    expect(result.checks.constraintsParsed).toBe(0);
    expect(result.violations.map((v) => v.code)).not.toContain("ITIN_REQUEST_CONSTRAINT_TIME");
  });

  it("T-7: a no-detour request with a stopover on the way back", () => {
    const request = "帰りは寄り道しないで、まっすぐ帰る日帰りプランにして";
    const answer = ["09:00–12:00 A", "13:00–15:00 B", "帰路は途中で温泉に立ち寄ります"].join("\n");
    expect(codes(request, answer)).toEqual(["ITIN_CONSTRAINT_DETOUR_CANDIDATE"]);
  });

  it("T-8: an early-morning claim with a 09:00 start", () => {
    const answer = ["早朝入場で混雑を避けます", "09:00–10:30 A", "11:00–12:00 B"].join("\n");
    expect(codes(DAY_TRIP_REQUEST, answer)).toEqual(["ITIN_EARLY_CLAIM_MISMATCH"]);
  });
});

describe("Q3 reconstruction fixture", () => {
  // SYNTHETIC reconstruction, not the original answer: the 2026-11-23
  // inspection did not retain the answer's full text. This fixture is
  // rebuilt only from the facts the inspection record states
  // (09:00–10:30 Disneyland / 14:00–16:00 Hakkeijima / "about 30
  // minutes by train" / the unexplained 10:30–12:00 gap / the Hakone-
  // Yumoto stopover on the way back / the "early-morning entry" claim),
  // as design §7.2 prescribes. Nothing beyond those facts is invented.
  const request = "週末に家族で楽しめる東京近郊の日帰りプランを考えて。帰りは直帰または温泉で";
  const answer = [
    "早朝入場で混雑を避ける1日プランです",
    "09:00–10:30 東京ディズニーランド",
    "14:00–16:00 八景島シーパラダイス（電車で約30分）",
    "18:30–20:00 帰路（途中で箱根湯本の温泉に立ち寄り）",
  ].join("\n");

  it("captures the ungrounded duration, the unexplained gap, the detour candidate and the early-claim mismatch", () => {
    const found = codes(request, answer);
    expect(found).toContain("ITIN_UNGROUNDED_DURATION");
    expect(found).toContain("ITIN_UNEXPLAINED_GAP");
    expect(found).toContain("ITIN_CONSTRAINT_DETOUR_CANDIDATE");
    expect(found).toContain("ITIN_EARLY_CLAIM_MISMATCH");
  });

  it("raises no arithmetic violation the record does not support", () => {
    const found = codes(request, answer);
    expect(found).not.toContain("ITIN_TIME_RANGE_INVERSION");
    expect(found).not.toContain("ITIN_TIME_OVERLAP");
    // The stated 30 minutes fits the scheduled gap arithmetically; the
    // defect is that the claim is ungrounded, not that it is infeasible.
    expect(found).not.toContain("ITIN_TRANSFER_INFEASIBLE");
    expect(found).not.toContain("ITIN_REQUEST_CONSTRAINT_TIME");
  });

  it("violation details carry numbers and fixed codes only — never place names", () => {
    const result = auditOriginItineraryConsistency({ requestText: request, answerText: answer });
    const serialized = JSON.stringify(result.violations);
    expect(serialized).not.toContain("ディズニーランド");
    expect(serialized).not.toContain("八景島");
    expect(serialized).not.toContain("箱根湯本");
  });
});

describe("composite case", () => {
  it("T-5 and T-4 fire together on one answer", () => {
    const answer = ["09:00–10:00 A", "13:00–14:00 B（電車で約50分）"].join("\n");
    expect(codes(DAY_TRIP_REQUEST, answer).sort()).toEqual(
      ["ITIN_UNEXPLAINED_GAP", "ITIN_UNGROUNDED_DURATION"].sort(),
    );
  });
});

describe("parsing shapes", () => {
  it("reads full-width digits, full-width colons and Japanese hour ranges", () => {
    const answer = ["９：００–１０：３０ A", "14時〜16時 B"].join("\n");
    const result = auditOriginItineraryConsistency({ requestText: DAY_TRIP_REQUEST, answerText: answer });
    expect(result.checks.rangesParsed).toBe(2);
    expect(result.violations.map((v) => v.code)).toContain("ITIN_UNEXPLAINED_GAP");
  });

  it("does not read the minutes of a clock time as a duration claim", () => {
    const answer = ["10時30分に集合して出発", "11:00–12:00 A", "13:00–14:00 B"].join("\n");
    const result = auditOriginItineraryConsistency({ requestText: DAY_TRIP_REQUEST, answerText: answer });
    expect(result.checks.durationClaims).toBe(0);
  });

  it("counts hours-and-minutes durations once, in minutes", () => {
    const answer = ["09:00–10:00 A", "電車で1時間30分", "12:00–13:00 B"].join("\n");
    const result = auditOriginItineraryConsistency({ requestText: DAY_TRIP_REQUEST, answerText: answer });
    expect(result.checks.durationClaims).toBe(1);
    expect(result.violations.map((v) => v.code)).toContain("ITIN_UNGROUNDED_DURATION");
    const t5 = result.violations.find((v) => v.code === "ITIN_UNGROUNDED_DURATION");
    expect(t5?.detail).toEqual({ statedMinutes: 90 });
  });
});

describe("shadow-only set and mode switch (design §5.1 / §6)", () => {
  it("keeps T-4, T-7 and T-8 record-only by construction", () => {
    expect(ORIGIN_ITINERARY_AUDIT_SHADOW_ONLY_CODES.has("ITIN_UNEXPLAINED_GAP")).toBe(true);
    expect(ORIGIN_ITINERARY_AUDIT_SHADOW_ONLY_CODES.has("ITIN_CONSTRAINT_DETOUR_CANDIDATE")).toBe(
      true,
    );
    expect(ORIGIN_ITINERARY_AUDIT_SHADOW_ONLY_CODES.has("ITIN_EARLY_CLAIM_MISMATCH")).toBe(true);
    expect(ORIGIN_ITINERARY_AUDIT_SHADOW_ONLY_CODES.has("ITIN_TIME_RANGE_INVERSION")).toBe(false);
  });

  it("defaults to off and accepts only the exact shadow / enforce values", () => {
    expect(resolveOriginItineraryAuditMode(undefined)).toBe("off");
    expect(resolveOriginItineraryAuditMode({})).toBe("off");
    expect(resolveOriginItineraryAuditMode({ ORIGIN_ITINERARY_AUDIT_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginItineraryAuditMode({ ORIGIN_ITINERARY_AUDIT_MODE: "enforce" })).toBe("enforce");
    expect(resolveOriginItineraryAuditMode({ ORIGIN_ITINERARY_AUDIT_MODE: "SHADOW" })).toBe("off");
    expect(resolveOriginItineraryAuditMode({ ORIGIN_ITINERARY_AUDIT_MODE: "on" })).toBe("off");
  });
});
