import { describe, expect, it } from "vitest";
import { tryDeterministicCalculationFallback } from "./groundedDeterministicCalculation.js";

/**
 * Round 7, measure C-2 (ANSWER_ROUND7_DIAGNOSIS_2026-11-27 §5.2):
 * the deterministic calculation fallback — the safety net behind
 * C-1's routing exemptions. When a supplied-value arithmetic
 * question still lands in grounded research and source retrieval
 * fails, the answer is computed from the question's own numbers
 * instead of refused (Q6-01's production failure: 9000万円の6.2%
 * refused twice over unfetchable sources).
 */
describe("tryDeterministicCalculationFallback", () => {
  it("computes the Q6-01 shape: amount × percentage", () => {
    const result = tryDeterministicCalculationFallback(
      "9000万円の6.2%はいくらですか？",
      "ja",
    );
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("percent-of");
    expect(result!.amountYen).toBe(90_000_000);
    expect(result!.ratePercent).toBe(6.2);
    expect(result!.resultYen).toBe(5_580_000);
    expect(result!.text).toContain("5,580,000円（558万円）");
  });

  it("computes a plain-yen percentage and a 割 proportion", () => {
    const plain = tryDeterministicCalculationFallback(
      "12,800円の15%はいくらですか？",
      "ja",
    );
    expect(plain!.resultYen).toBe(1920);
    expect(plain!.text).toContain("1,920円");
    const wari = tryDeterministicCalculationFallback(
      "100万円の3割はいくらですか？",
      "ja",
    );
    expect(wari!.ratePercent).toBe(30);
    expect(wari!.resultYen).toBe(300_000);
    expect(wari!.text).toContain("300,000円（30万円）");
  });

  it("computes discounts (%引き and 割引) as the remainder", () => {
    const percentOff = tryDeterministicCalculationFallback(
      "9000万円の10%引きはいくらですか？",
      "ja",
    );
    expect(percentOff!.kind).toBe("percent-off");
    expect(percentOff!.resultYen).toBe(81_000_000);
    expect(percentOff!.text).toContain("81,000,000円（8100万円）");
    const wariOff = tryDeterministicCalculationFallback(
      "100万円の3割引は何円ですか？",
      "ja",
    );
    expect(wariOff!.kind).toBe("percent-off");
    expect(wariOff!.resultYen).toBe(700_000);
  });

  it("parses compound magnitude amounts (1億2000万円)", () => {
    const result = tryDeterministicCalculationFallback(
      "1億2000万円の10%はいくらですか？",
      "ja",
    );
    expect(result!.amountYen).toBe(120_000_000);
    expect(result!.resultYen).toBe(12_000_000);
  });

  it("answers in English when the route language is English", () => {
    const result = tryDeterministicCalculationFallback(
      "9000万円の6.2%はいくらですか？",
      "en",
    );
    expect(result!.text).toContain("5,580,000 yen");
  });

  it("does not parse shapes that are not the supplied-value construction", () => {
    // No amount: a rate question.
    expect(
      tryDeterministicCalculationFallback("消費税率は何%ですか？", "ja"),
    ).toBeNull();
    // No percentage: a price question.
    expect(
      tryDeterministicCalculationFallback("9000万円の家はいくらですか？", "ja"),
    ).toBeNull();
    // No result-seeking cue at all.
    expect(
      tryDeterministicCalculationFallback("9000万円の6.2%という数字", "ja"),
    ).toBeNull();
    // Unrelated text.
    expect(
      tryDeterministicCalculationFallback("明日の天気を教えてください", "ja"),
    ).toBeNull();
  });
});
