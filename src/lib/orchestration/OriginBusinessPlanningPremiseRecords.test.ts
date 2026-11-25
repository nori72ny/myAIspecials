import { describe, expect, it } from "vitest";
import {
  checkOriginPremiseRecords,
  logOriginBusinessPlanningPremiseRecordsShadow,
  parseOriginPremiseRecords,
  type OriginPremiseRecordsViolationCode,
} from "./OriginBusinessPlanningPremiseRecords.js";
import type { OriginBusinessPlanningProfile } from "./OriginBusinessPlanning.js";

const HEADER = "| 指標 | 値 | 単位 | 対象期間 | 種別 | 根拠 |\n|------|----|------|----------|------|------|";

function codesOf(result: ReturnType<typeof checkOriginPremiseRecords>): OriginPremiseRecordsViolationCode[] {
  return result.violations.map((violation) => violation.code);
}

describe("premise record parsing", () => {
  it("reads the fixed-format table into records with kinds, values, formula and source split", () => {
    const records = parseOriginPremiseRecords(
      [
        HEADER,
        "| 受注目標 | 10 | 件 | 2027年Q1 | 入力事実 | ユーザー指定 |",
        "| 平均単価 | 800,000 | 円 | 2027年Q1 | 入力事実 | ユーザー指定 |",
        "| 受注目標売上 | 8,000,000 | 円 | 2027年Q1 | 計算結果 | 受注目標 × 平均単価 |",
        "| 市場規模 | 2.9 | 億円 | 2027年 | 推定 | 類似市場から類推 |",
        "| 想定シェア | 5 | % | 2027年 | 仮置き（仮定） | - |",
        "| 受注単価 | 30 | 万円 | 2027年Q1 | ゴール | 事業計画 |",
        "| 販売地域 | - | - | - | 未確定 | 対象地域が未定 |",
      ].join("\n"),
    );
    expect(records).toHaveLength(7);
    expect(records[0]).toMatchObject({ name: "受注目標", kind: "input", value: 10, dimension: "count", source: "ユーザー指定" });
    expect(records[1]).toMatchObject({ name: "平均単価", kind: "input", value: 800000, dimension: "yen" });
    expect(records[2]).toMatchObject({ name: "受注目標売上", kind: "formula", value: 8000000, formula: "受注目標 × 平均単価", source: "" });
    expect(records[3]).toMatchObject({ name: "市場規模", kind: "estimate", dimension: "yen" });
    expect(records[3]?.value).toBeCloseTo(290000000);
    expect(records[4]).toMatchObject({ name: "想定シェア", kind: "assumption", value: 0.05, dimension: "ratio" });
    expect(records[5]).toMatchObject({ name: "受注単価", kind: "goal", value: 300000 });
    expect(records[6]).toMatchObject({ name: "販売地域", kind: "undetermined", value: null });
  });

  it("ignores tables that are not premise tables and answers without one", () => {
    expect(parseOriginPremiseRecords("| 施策 | 回数 |\n|------|------|\n| 広告 | 3 |")).toEqual([]);
    expect(parseOriginPremiseRecords("前提表のない回答です。")).toEqual([]);
    const result = checkOriginPremiseRecords({ answerText: "前提表のない回答です。" });
    expect(result.checks.records).toBe(0);
    expect(result.violations).toEqual([]);
  });
});

describe("check 1: formula vs value", () => {
  it("BP-6 shape: a digit slip in a backcast chain (500 / 0.30 stated as 167) is flagged", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 商談数 | 500 | 件 | 2027年Q1 | 仮置き（仮定） | 目標設定 |",
        "| SQL必要数 | 167 | 件 | 2027年Q1 | 計算結果 | 商談数 ÷ SQL→商談 コンバージョン率 |",
        "| SQL→商談 コンバージョン率 | 30 | % | 2027年Q1 | 仮置き（仮定） | - |",
      ].join("\n"),
    });
    const violations = result.violations.filter((violation) => violation.code === "RECORD_FORMULA_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.computed).toBeCloseTo(1666.6667, 3);
    expect(violations[0]?.detail.stated).toBe(167);
    expect(result.checks.formulasChecked).toBe(1);
  });

  it("BP-2 shape: a literal formula contradicting its own value (3,400 / 0.02 stated as 30,000) is flagged", () => {
    const result = checkOriginPremiseRecords({
      answerText: [HEADER, "| リーチ必要数 | 30,000 | 件 | 2027年Q1 | 計算結果 | 3,400 ÷ 0.02 |"].join("\n"),
    });
    const violations = result.violations.filter((violation) => violation.code === "RECORD_FORMULA_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.computed).toBe(170000);
    expect(violations[0]?.detail.stated).toBe(30000);
  });

  it("remeasurement S-2 shape: a percentage stated as 1.2% where the figures give about 6.2% is flagged; 6.2% passes", () => {
    const table = (ratio: string) =>
      [
        HEADER,
        "| 初期開発費 | 1,800 | 万円 | 2026年 | 入力事実 | 素材 |",
        "| 3年目売上 | 2.9 | 億円 | 2028年 | 入力事実 | 素材 |",
        `| 初期開発費の対売上比 | ${ratio} | % | 2028年 | 計算結果 | 初期開発費 ÷ 3年目売上 |`,
      ].join("\n");
    const wrong = checkOriginPremiseRecords({ answerText: table("1.2") });
    expect(codesOf(wrong)).toEqual(["RECORD_FORMULA_MISMATCH"]);
    expect(wrong.checks.formulasChecked).toBe(1);
    const right = checkOriginPremiseRecords({ answerText: table("6.2") });
    expect(right.violations).toEqual([]);
    expect(right.checks.formulasChecked).toBe(1);
  });

  it("an annotation that contradicts the referenced row is not trusted: the row's own value governs (BP-1 shape)", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 受注目標 | 10 | 件 | 2026-12〜2027-02 | 入力事実 | - |",
        "| 平均単価 | 800,000 | 円 | 2026-12〜2027-02 | 入力事実 | - |",
        "| 受注目標売上 | 8,000,000 | 円 | 2026-12〜2027-02 | 計算結果 | 受注目標 × 平均単価 |",
        "| 商談必要数 | 20 | 件 | 2026-12〜2027-02 | 計算結果 | 受注目標 ÷ 商談→受注 コンバージョン率 (0.5) |",
        "| 商談→受注 コンバージョン率 | 5 | % | 2026-12〜2027-02 | 仮置き（仮定） | - |",
      ].join("\n"),
    });
    // The rate row states 5% while the annotation says (0.5): the
    // annotation is skipped, the referenced row's own value (0.05)
    // governs, so 10 / 0.05 = 200 contradicts the stated 20 and the
    // checker must say so rather than trust the annotation.
    expect(codesOf(result)).toEqual(["RECORD_FORMULA_MISMATCH"]);
  });

  it("annotations that agree with the referenced row evaluate cleanly", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 受注目標 | 10 | 件 | 2027年Q1 | 入力事実 | - |",
        "| 商談必要数 | 20 | 件 | 2027年Q1 | 計算結果 | 受注目標 ÷ 商談→受注 コンバージョン率 (0.5) |",
        "| 商談→受注 コンバージョン率 | 50 | % | 2027年Q1 | 仮置き（仮定） | - |",
      ].join("\n"),
    });
    expect(result.violations).toEqual([]);
    expect(result.checks.formulasChecked).toBe(1);
  });

  it("a formula row whose basis is prose is counted unevaluable, never guessed", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 目標売上 | 1,000 | 万円 | 2027年Q1 | 計算結果 | 同業SaaSの一般的規模から |",
        "| 参照不能 | 5 | 件 | 2027年Q1 | 計算結果 | 存在しない行 × 2 |",
      ].join("\n"),
    });
    expect(result.checks.formulasChecked).toBe(0);
    expect(result.checks.formulasUnevaluable).toBe(2);
    expect(result.violations).toEqual([]);
  });

  it("a worked form after an equals sign is evaluated when the named form cannot be", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 目標売上 | 300 | 万円 | 2027年Q1 | 計算結果 | 受注件数 × 受注単価 = 10×30 |",
      ].join("\n"),
    });
    expect(result.checks.formulasChecked).toBe(1);
    expect(result.violations).toEqual([]);
  });
});

describe("check 2: input facts, verbatim", () => {
  it("BP-5 shape: the brief's 月10万円 restated as 100万円 is flagged with factor 10", () => {
    const result = checkOriginPremiseRecords({
      answerText: [HEADER, "| 月予算 | 100 | 万円 | 2026年11月 | 入力事実 | ユーザー情報 |"].join("\n"),
      sourceTexts: ["カフェの販促案を考えて。予算は月10万円まで。"],
    });
    const violations = result.violations.filter((violation) => violation.code === "RECORD_INPUT_FACT_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.stated).toBe(1000000);
    expect(violations[0]?.detail.sourceValue).toBe(100000);
    expect(violations[0]?.detail.factor).toBe(10);
  });

  it("remeasurement S-4 shape: a 9,000万円 goal restated as 9,000千円 is flagged with factor 0.1", () => {
    const result = checkOriginPremiseRecords({
      answerText: [HEADER, "| 目標売上 | 9,000 | 千円 | 2026年11月 | 入力事実 | 月次報告 |"].join("\n"),
      sourceTexts: ["今月の売上目標は9,000万円です。"],
    });
    const violations = result.violations.filter((violation) => violation.code === "RECORD_INPUT_FACT_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.factor).toBe(0.1);
  });

  it("unit conversion alone is not a restatement: 2.9億円 in the source matches 290,000,000円 and 6,000万円 matches 60,000,000円", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 市場規模 | 290,000,000 | 円 | 2027年 | 入力事実 | 素材 |",
        "| 初期費用 | 6,000 | 万円 | 2027年 | 入力事実 | 素材 |",
      ].join("\n"),
      sourceTexts: ["対象市場の規模は2.9億円、初期費用は60,000,000円です。"],
    });
    expect(result.violations).toEqual([]);
    expect(result.checks.inputFactsChecked).toBe(2);
  });

  it("an input fact the source never stated is flagged without a source figure", () => {
    const result = checkOriginPremiseRecords({
      answerText: [HEADER, "| 予算 | 30 | 万円 | 2026年11月 | 入力事実 | ユーザー情報 |"].join("\n"),
      sourceTexts: ["カフェの販促案を考えて。予算は月10万円まで。"],
    });
    const violations = result.violations.filter((violation) => violation.code === "RECORD_INPUT_FACT_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.sourceValue).toBeUndefined();
  });

  it("verbatim means verbatim: a 1% restatement the scan gate's band would pass is flagged here", () => {
    const result = checkOriginPremiseRecords({
      answerText: [HEADER, "| 月予算 | 10.1 | 万円 | 2026年11月 | 入力事実 | ユーザー情報 |"].join("\n"),
      sourceTexts: ["予算は月10万円まで。"],
    });
    expect(codesOf(result)).toEqual(["RECORD_INPUT_FACT_MISMATCH"]);
  });

  it("materials text is a figure source alongside the request text", () => {
    const result = checkOriginPremiseRecords({
      answerText: [HEADER, "| 既存店舗数 | 3,000 | 店 | 2026年 | 入力事実 | 素材 |"].join("\n"),
      sourceTexts: ["提案資料を作ってください。", "対象は既存の3,000店です。"],
    });
    expect(result.violations).toEqual([]);
    expect(result.checks.inputFactsChecked).toBe(1);
  });

  it("without source texts the input-fact check is skipped, not guessed", () => {
    const result = checkOriginPremiseRecords({
      answerText: [HEADER, "| 予算 | 30 | 万円 | 2026年11月 | 入力事実 | ユーザー情報 |"].join("\n"),
    });
    expect(result.checks.inputFactsChecked).toBe(0);
    expect(result.violations).toEqual([]);
  });
});

describe("check 3: estimate vs goal", () => {
  it("BP-3 shape: a 3,000万円 goal over a 200万円 market estimate is flagged", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 市場規模 | 200 | 万円 | 2027年 | 推定 | 類似市場から推定 |",
        "| 目標売上 | 3,000 | 万円 | 2027年 | 仮置き（仮定） | 事業計画上の目標 |",
      ].join("\n"),
    });
    const violations = result.violations.filter((violation) => violation.code === "RECORD_ESTIMATE_GOAL_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.marketEstimate).toBe(2000000);
    expect(violations[0]?.detail.goalAmount).toBe(30000000);
    expect(result.checks.estimateGoalPairs).toBe(1);
  });

  it("an explicit share premise makes the same goal consistent", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 市場規模 | 200 | 万円 | 2027年 | 推定 | 類似市場から推定 |",
        "| 想定シェア | 15 | % | 2027年 | 仮置き（仮定） | 参入計画 |",
        "| 目標売上 | 3,000 | 万円 | 2027年 | 仮置き（仮定） | 市場規模 × 想定シェアを上回る計画 |",
      ].join("\n"),
    });
    expect(result.violations.filter((violation) => violation.code === "RECORD_ESTIMATE_GOAL_MISMATCH")).toEqual([]);
    expect(result.checks.estimateGoalPairs).toBe(1);
  });

  it("a goal inside the estimated market passes", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 市場規模 | 3,000 | 万円 | 2027年 | 推定 | 類似市場から推定 |",
        "| 目標売上 | 300 | 万円 | 2027年 | ゴール | 事業計画 |",
      ].join("\n"),
    });
    expect(result.violations).toEqual([]);
    expect(result.checks.estimateGoalPairs).toBe(1);
  });
});

describe("check 4: unit / period consistency", () => {
  it("remeasurement S-2 shape: a monthly unit price times a store count stated as the annual total is flagged on both axes of failure", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 月額単価 | 9,800 | 円 | 2026年 | 入力事実 | 素材 |",
        "| 導入店舗数 | 3,000 | 店 | 2026年 | 入力事実 | 素材 |",
        "| 年間売上 | 294,000,000 | 円 | 2026年 | 計算結果 | 月額単価 × 導入店舗数 |",
      ].join("\n"),
    });
    expect(codesOf(result)).toContain("RECORD_FORMULA_MISMATCH");
    const period = result.violations.filter(
      (violation) => violation.code === "RECORD_UNIT_PERIOD_MISMATCH" && violation.detail.axis === "period",
    );
    expect(period).toHaveLength(1);
    expect(result.checks.unitPeriodRelations).toBe(1);
  });

  it("an explicit x12 conversion makes the monthly-to-annual computation consistent", () => {
    const result = checkOriginPremiseRecords({
      answerText: [
        HEADER,
        "| 月額単価 | 9,800 | 円 | 2026年 | 入力事実 | 素材 |",
        "| 導入店舗数 | 3,000 | 店 | 2026年 | 入力事実 | 素材 |",
        "| 年間売上 | 352,800,000 | 円 | 2026年 | 計算結果 | 月額単価 × 導入店舗数 × 12 |",
      ].join("\n"),
    });
    expect(result.violations).toEqual([]);
  });

  it("tax-included and tax-excluded figures mixed without a conversion constant are flagged; x1.1 states the conversion", () => {
    const table = (formula: string, value: string) =>
      [
        HEADER,
        "| 単価（税抜） | 1,000 | 円 | 2027年Q1 | 入力事実 | 素材 |",
        "| 数量 | 100 | 件 | 2027年Q1 | 入力事実 | 素材 |",
        `| 売上（税込） | ${value} | 円 | 2027年Q1 | 計算結果 | ${formula} |`,
      ].join("\n");
    const mixed = checkOriginPremiseRecords({ answerText: table("単価（税抜） × 数量", "100,000") });
    const tax = mixed.violations.filter(
      (violation) => violation.code === "RECORD_UNIT_PERIOD_MISMATCH" && violation.detail.axis === "tax",
    );
    expect(tax).toHaveLength(1);
    const converted = checkOriginPremiseRecords({ answerText: table("単価（税抜） × 数量 × 1.1", "110,000") });
    expect(converted.violations).toEqual([]);
  });
});

describe("shadow hook", () => {
  const profile: OriginBusinessPlanningProfile = { kind: "campaign-plan", figures: {}, backcast: null };

  it("logs counts and codes only — no answer text, no record names — and returns the result", () => {
    const lines: { message: string; fields: Record<string, unknown> }[] = [];
    const result = logOriginBusinessPlanningPremiseRecordsShadow({
      requestId: "req-1",
      profile,
      answerText: [
        HEADER,
        "| 商談数 | 500 | 件 | 2027年Q1 | 仮置き（仮定） | 目標設定 |",
        "| SQL必要数 | 167 | 件 | 2027年Q1 | 計算結果 | 商談数 ÷ SQL→商談 コンバージョン率 |",
        "| SQL→商談 コンバージョン率 | 30 | % | 2027年Q1 | 仮置き（仮定） | - |",
      ].join("\n"),
      requestText: "キャンペーン計画を作って",
      logger: (message, fields) => lines.push({ message, fields }),
    });
    expect(result?.violations).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toContain("premise records (shadow)");
    expect(lines[0]?.fields.violationCodes).toEqual(["RECORD_FORMULA_MISMATCH"]);
    const logged = JSON.stringify(lines[0]?.fields);
    expect(logged).not.toContain("SQL必要数");
    expect(logged).not.toContain("商談数");
  });

  it("returns null and logs nothing without a planning profile", () => {
    const lines: unknown[] = [];
    const result = logOriginBusinessPlanningPremiseRecordsShadow({
      requestId: "req-2",
      profile: null,
      answerText: HEADER,
      logger: (message, fields) => lines.push({ message, fields }),
    });
    expect(result).toBeNull();
    expect(lines).toEqual([]);
  });
});
