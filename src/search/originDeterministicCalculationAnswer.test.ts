import { describe, expect, it } from "vitest";
import { classifyOriginSearchQuestion } from "./originSearchClassifier";
import {
  buildOriginDeterministicCalculationAnswer,
  parseOriginDeterministicCalculationQuestion,
} from "./originDeterministicCalculationAnswer";

/**
 * Q9-01 fixed set (full audit round 3, 2026-11-28): the
 * deterministic calculation parser is whole-question strict, so
 * the set pins BOTH directions — every enumerated calculation
 * shape parses and computes exactly, and every factual /
 * research-shaped near-miss stays unparsed (its existing route
 * decides). Extending the shapes is a deliberate act: a new shape
 * joins this set first.
 */
function answerFor(message: string): string | null {
  const parsed = parseOriginDeterministicCalculationQuestion(message);
  return parsed ? buildOriginDeterministicCalculationAnswer(parsed) : null;
}

describe("parseOriginDeterministicCalculationQuestion — tax constructions", () => {
  it("answers the Q9-01 question: 200万円の消費税10%込みの金額は？", () => {
    expect(answerFor("200万円の消費税10%込みの金額は？"))
      .toBe("200万円の消費税10%込みの金額は、2,200,000円（220万円）です。");
  });

  it("answers the round-2 amount in the same shape: 150万円", () => {
    expect(answerFor("150万円の消費税10%込みの金額は？"))
      .toBe("150万円の消費税10%込みの金額は、1,650,000円（165万円）です。");
  });

  it("accepts the 税抜 prefix on the amount (the basis changes nothing)", () => {
    expect(answerFor("税抜200万円の消費税10%込みの金額は？"))
      .toBe("200万円の消費税10%込みの金額は、2,200,000円（220万円）です。");
  });

  it("accepts the 加えた forms", () => {
    expect(answerFor("200万円に消費税10%を加えた金額は？"))
      .toBe("200万円の消費税10%込みの金額は、2,200,000円（220万円）です。");
    expect(answerFor("200万円に10%の消費税を加えた金額は？"))
      .toBe("200万円の消費税10%込みの金額は、2,200,000円（220万円）です。");
  });

  it("handles composite magnitude amounts", () => {
    expect(answerFor("1億2000万円の消費税10%込みの金額は？"))
      .toBe("1億2000万円の消費税10%込みの金額は、132,000,000円（13,200万円）です。");
  });

  it("extracts the tax-exclusive amount from a tax-inclusive one (exact)", () => {
    expect(answerFor("税込220万円（消費税10%込み）の税抜金額は？"))
      .toBe("220万円（消費税10%込み）の税抜金額は、2,000,000円（200万円）です。");
  });

  it("extracts the tax-exclusive amount and names the whole-yen rounding", () => {
    expect(answerFor("消費税10%込みで200万円の商品の税抜価格は？"))
      .toBe("消費税10%込みの200万円の税抜金額は、1,818,182円です（円未満は四捨五入しました）。");
    expect(answerFor("200万円の消費税10%抜きの金額は？"))
      .toBe("200万円の消費税10%抜きの金額は、1,818,182円です（円未満は四捨五入しました）。");
  });

  it("extracts the tax portion of a tax-inclusive amount", () => {
    expect(answerFor("消費税10%込みで220万円のうち消費税額は？"))
      .toBe("消費税10%込みの220万円のうち消費税額は、200,000円（20万円）です。");
  });
});

describe("parseOriginDeterministicCalculationQuestion — percent constructions", () => {
  it("answers percent-of a yen amount (the round-7 fallback's shape, now at routing)", () => {
    expect(answerFor("9000万円の6.2%はいくらですか"))
      .toBe("9000万円の6.2%は、5,580,000円（558万円）です。");
  });

  it("answers the tax on an amount as percent-of", () => {
    expect(answerFor("200万円の消費税10%はいくらですか"))
      .toBe("200万円の消費税10%は、200,000円（20万円）です。");
  });

  it("answers percent-off", () => {
    expect(answerFor("200万円の10%引きの金額は？"))
      .toBe("200万円の10%引きは、1,800,000円（180万円）です。");
  });

  it("answers percent-of a count (the H-09 shape)", () => {
    expect(answerFor("40人の75%は何人ですか")).toBe("40人の75%は、30人です。");
    expect(answerFor("40人×75%")).toBe("40人の75%は、30人です。");
  });

  it("answers percent-of a measure", () => {
    expect(answerFor("2kgの25%は何kgですか")).toBe("2kgの25%は、0.5kgです。");
  });
});

describe("parseOriginDeterministicCalculationQuestion — arithmetic", () => {
  it("answers a bare symbolic expression", () => {
    expect(answerFor("200 + 300")).toBe("200 + 300 = 500です。");
    expect(answerFor("15 × 4")).toBe("15 × 4 = 60です。");
  });

  it("answers symbolic yen arithmetic", () => {
    expect(answerFor("200円+300円は？")).toBe("200円 + 300円 = 500円です。");
    expect(answerFor("100 ÷ 4")).toBe("100 ÷ 4 = 25です。");
    expect(answerFor("10 ÷ 3")).toBe("10 ÷ 3 = 3.333333です。");
  });

  it("answers division by zero with a deterministic explanation, not a refusal", () => {
    expect(answerFor("10 ÷ 0は？")).toBe("0で割ることはできないため、計算できません。");
    expect(answerFor("9000円を0で割ると")).toBe("0で割ることはできないため、計算できません。");
  });

  it("answers the verbal forms", () => {
    expect(answerFor("500円と300円の合計は？")).toBe("500円 + 300円 = 800円です。");
    expect(answerFor("1000円から300円を引くといくらですか")).toBe("1,000円 - 300円 = 700円です。");
    expect(answerFor("9000円を3人で割ると1人いくらですか")).toBe("9,000円 ÷ 3 = 3,000円です。");
  });
});

describe("parseOriginDeterministicCalculationQuestion — unit conversion", () => {
  it("converts length", () => {
    expect(answerFor("100cmは何mですか")).toBe("100cmは、1mです。");
    expect(answerFor("5kmは何マイルですか")).toBe("5kmは、3.106856マイルです。");
  });

  it("converts weight via the 換算 form", () => {
    expect(answerFor("2kgをgに換算すると")).toBe("2kgは、2,000gです。");
  });

  it("converts temperature both ways", () => {
    expect(answerFor("摂氏25度は華氏何度ですか")).toBe("摂氏25度は、華氏77度です。");
    expect(answerFor("華氏77度は摂氏何度ですか")).toBe("華氏77度は、摂氏25度です。");
    expect(answerFor("25°Cは°Fで何度ですか")).toBe("25°Cは、77°Fです。");
  });
});

describe("parseOriginDeterministicCalculationQuestion — factual near-misses stay unparsed", () => {
  const negatives: readonly string[] = [
    // The rate itself is the question — an external fact, not an input.
    "消費税率の歴史は？",
    "最新の税率は何%ですか？",
    "消費税10%はいつからですか？",
    "消費税とは何ですか？",
    // The rate is missing: the total is not a function of the question alone.
    "200万円の消費税込みの金額は？",
    // The calculation is embedded in a larger request.
    "200万円の家を買うときの消費税10%込みの総額は？",
    "消費税10%込みで200万円の商品について教えてください",
    "200万円の消費税10%込みの金額は？根拠も教えてください",
    "100cmは何フィートですか？単位の歴史も教えてください",
    // A comparison of two rates is not one calculation.
    "3000円の消費税8%込みと10%込みの違いは？",
    // Currency conversion needs a live rate — the market route owns it.
    "1ドルは何円ですか？",
    // The date parser's territory.
    "今日は何曜日ですか？",
    // No calculation at all.
    "明日の天気を教えてください",
  ];
  for (const message of negatives) {
    it(`does not parse: ${message}`, () => {
      expect(parseOriginDeterministicCalculationQuestion(message)).toBeNull();
    });
  }

  it("keeps the classifier's verdicts for the near-misses unchanged", () => {
    expect(classifyOriginSearchQuestion("消費税率の歴史は？").type).toBe("stable");
    expect(classifyOriginSearchQuestion("1ドルは何円ですか？").type).toBe("market");
  });

  it("classifies the Q9-01 question as no_search via the new guard", () => {
    const classification = classifyOriginSearchQuestion("200万円の消費税10%込みの金額は？");
    expect(classification.type).toBe("no_search");
    expect(classification.rule).toBe("deterministic-calculation-answer");
  });
});
