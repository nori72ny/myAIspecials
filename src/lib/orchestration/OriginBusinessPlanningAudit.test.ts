import { describe, expect, it } from "vitest";
import {
  auditOriginBusinessPlanningAnswer,
  logOriginBusinessPlanningAuditShadow,
  type OriginBusinessPlanningAuditViolationCode,
} from "./OriginBusinessPlanningAudit.js";
import {
  resolveOriginBusinessPlanning,
  type OriginBusinessPlanningKind,
  type OriginBusinessPlanningProfile,
} from "./OriginBusinessPlanning.js";
import { ORIGIN_BUSINESS_PLANNING_MEASURED_ANSWERS } from "./OriginBusinessPlanningAudit.fixtures.js";

const NUMERIC_CODES: readonly OriginBusinessPlanningAuditViolationCode[] = [
  "FORMULA_RESULT_MISMATCH",
  "TOTAL_SUM_MISMATCH",
  "BREAKDOWN_SUM_MISMATCH",
  "FUNNEL_RATE_MISMATCH",
  "POPULATION_SHARE_MISMATCH",
];

function codesOf(result: ReturnType<typeof auditOriginBusinessPlanningAnswer>): OriginBusinessPlanningAuditViolationCode[] {
  return result.violations.map((violation) => violation.code);
}

function numericCodesOf(result: ReturnType<typeof auditOriginBusinessPlanningAnswer>): OriginBusinessPlanningAuditViolationCode[] {
  return codesOf(result).filter((code) => NUMERIC_CODES.includes(code));
}

function auditFixture(round: "round1" | "round2", id: string) {
  const fixture = ORIGIN_BUSINESS_PLANNING_MEASURED_ANSWERS.find((entry) => entry.round === round && entry.id === id);
  if (!fixture) throw new Error(`fixture ${round}/${id} missing`);
  const profile = resolveOriginBusinessPlanning(fixture.prompt);
  if (!profile) throw new Error(`profile for ${round}/${id} not resolved`);
  expect(profile.kind).toBe(fixture.expectedKind as OriginBusinessPlanningKind);
  return auditOriginBusinessPlanningAnswer(profile, fixture.answerText);
}

function syntheticProfile(kind: OriginBusinessPlanningKind): OriginBusinessPlanningProfile {
  return { kind, figures: {}, backcast: null };
}

const PREMISE_CODES: readonly OriginBusinessPlanningAuditViolationCode[] = [
  "PREMISE_FORMULA_MISMATCH",
  "PREMISE_INPUT_FACT_MISMATCH",
  "PREMISE_ESTIMATE_GOAL_MISMATCH",
];

function premiseCodesOf(result: ReturnType<typeof auditOriginBusinessPlanningAnswer>): OriginBusinessPlanningAuditViolationCode[] {
  return codesOf(result).filter((code) => PREMISE_CODES.includes(code));
}

function auditRound5(id: string, withRequestText = true) {
  const fixture = ORIGIN_BUSINESS_PLANNING_MEASURED_ANSWERS.find((entry) => entry.round === "round5" && entry.id === id);
  if (!fixture) throw new Error(`fixture round5/${id} missing`);
  const profile = resolveOriginBusinessPlanning(fixture.prompt);
  if (!profile) throw new Error(`profile for round5/${id} not resolved`);
  expect(profile.kind).toBe(fixture.expectedKind as OriginBusinessPlanningKind);
  return auditOriginBusinessPlanningAnswer(
    profile,
    fixture.answerText,
    withRequestText ? { requestText: fixture.prompt } : undefined,
  );
}

describe("measured production answers (fixtures from the 2026-11-16 rounds)", () => {
  it("audits every measured answer under its expected kind", () => {
    for (const fixture of ORIGIN_BUSINESS_PLANNING_MEASURED_ANSWERS) {
      const profile = resolveOriginBusinessPlanning(fixture.prompt);
      expect(profile?.kind, `${fixture.round}/${fixture.id}`).toBe(fixture.expectedKind);
      const result = auditOriginBusinessPlanningAnswer(profile as OriginBusinessPlanningProfile, fixture.answerText);
      expect(result.kind).toBe(fixture.expectedKind);
    }
  });

  it("round 2 BP-3: detects the population-share digit slip (30,000 x 55% = 16,500, answer says 1,650)", () => {
    const result = auditFixture("round2", "BP-3");
    const violation = result.violations.find((v) => v.code === "POPULATION_SHARE_MISMATCH");
    expect(violation).toBeDefined();
    expect(violation?.detail.base).toBe(30000);
    expect(violation?.detail.statedDerived).toBe(1650);
  });

  it("round 2 BP-7: detects the channel breakdown sum (3,000 + 600 + 360 = 3,960 != required 3,000)", () => {
    const result = auditFixture("round2", "BP-7");
    const violation = result.violations.find((v) => v.code === "BREAKDOWN_SUM_MISMATCH");
    expect(violation).toBeDefined();
    expect(violation?.detail.stage).toBe("リード");
    expect(violation?.detail.computedSum).toBe(3960);
    expect(violation?.detail.statedTotal).toBe(3000);
  });

  it("round 2 BP-7: the backcast itself stays clean (no formula or funnel violation)", () => {
    const result = auditFixture("round2", "BP-7");
    expect(codesOf(result)).not.toContain("FORMULA_RESULT_MISMATCH");
    expect(codesOf(result)).not.toContain("FUNNEL_RATE_MISMATCH");
    expect(result.checks.formulas).toBe(3);
    expect(result.checks.funnelRates).toBe(2);
  });

  it("round 2 BP-6: detects the funnel inconsistency (2,000 leads x 5% = 100, answer plans 500 orders)", () => {
    const result = auditFixture("round2", "BP-6");
    const violation = result.violations.find((v) => v.code === "FUNNEL_RATE_MISMATCH");
    expect(violation).toBeDefined();
    expect(violation?.detail.stageFrom).toBe("リード");
    expect(violation?.detail.stageTo).toBe("受注");
    expect(violation?.detail.computedOutput).toBe(100);
    expect(violation?.detail.statedOutput).toBe(500);
  });

  it("round 1 BP-1: detects the inverted division presented as a rate (180 / 10 stated as about 17%)", () => {
    const result = auditFixture("round1", "BP-1");
    const violation = result.violations.find((v) => v.code === "FORMULA_RESULT_MISMATCH");
    expect(violation).toBeDefined();
    expect(violation?.detail.computed).toBe(18);
    expect(violation?.detail.stated).toBe(0.17);
    // The same answer never labels an assumption although the kind
    // requires the 仮置き part.
    expect(codesOf(result)).toContain("ASSUMPTION_LABELLING_MISSING");
  });

  it("round 1 BP-2: detects the market-size formula mismatch (the stated formula computes 3,240億円, the answer says 540億円)", () => {
    const result = auditFixture("round1", "BP-2");
    const violation = result.violations.find((v) => v.code === "FORMULA_RESULT_MISMATCH");
    expect(violation).toBeDefined();
    expect(violation?.detail.computed).toBe(324000000000);
    expect(violation?.detail.stated).toBe(54000000000);
  });

  it("round 1 BP-7: the correct backcast produces no numeric violation at all", () => {
    const result = auditFixture("round1", "BP-7");
    expect(numericCodesOf(result)).toEqual([]);
    expect(result.checks.formulas).toBeGreaterThanOrEqual(5);
  });

  it("round 1 and 2 BP-5: the budget breakdowns that do add up stay clean", () => {
    expect(codesOf(auditFixture("round1", "BP-5"))).not.toContain("TOTAL_SUM_MISMATCH");
    expect(codesOf(auditFixture("round2", "BP-5"))).not.toContain("TOTAL_SUM_MISMATCH");
    expect(numericCodesOf(auditFixture("round1", "BP-5"))).toEqual([]);
    expect(numericCodesOf(auditFixture("round2", "BP-5"))).toEqual([]);
  });

  it("round 2 BP-1, BP-2 and BP-4: no numeric violation is invented for answers whose stated arithmetic is consistent or absent", () => {
    expect(numericCodesOf(auditFixture("round2", "BP-1"))).toEqual([]);
    expect(numericCodesOf(auditFixture("round2", "BP-2"))).toEqual([]);
    expect(numericCodesOf(auditFixture("round2", "BP-4"))).toEqual([]);
    expect(numericCodesOf(auditFixture("round1", "BP-4"))).toEqual([]);
  });

  it("round 2 BP-7: required parts that are substantively absent are reported missing, labelled assumptions are not", () => {
    const result = auditFixture("round2", "BP-7");
    const missingParts = result.violations
      .filter((v) => v.code === "REQUIRED_PART_MISSING")
      .map((v) => v.detail.part);
    expect(missingParts).toContain("対象");
    expect(missingParts).toContain("提供価値");
    expect(missingParts).toContain("リスクと代替案");
    expect(missingParts).toContain("次の一手");
    expect(missingParts).not.toContain("数値の逆算");
    expect(codesOf(result)).not.toContain("ASSUMPTION_LABELLING_MISSING");
  });

  it("round 2 execution-plan answers: no answer assigns an owner in assignment form", () => {
    for (const id of ["BP-1", "BP-2", "BP-5", "BP-6", "BP-7"]) {
      expect(codesOf(auditFixture("round2", id)), `round2/${id}`).toContain("OWNER_MISSING");
    }
  });

  it("round 2 BP-2 and BP-5: no deadline form appears either", () => {
    expect(codesOf(auditFixture("round2", "BP-2"))).toContain("DEADLINE_MISSING");
    expect(codesOf(auditFixture("round2", "BP-5"))).toContain("DEADLINE_MISSING");
  });
});

describe("round 5 measured answers: premise-table checks (production 95552823)", () => {
  it("BP-2: the reach row's own basis formula (3,400 / 0.02 = 170,000) contradicts its value (30,000)", () => {
    const result = auditRound5("BP-2");
    const violations = result.violations.filter((v) => v.code === "PREMISE_FORMULA_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.computed).toBe(170000);
    expect(violations[0]?.detail.stated).toBe(30000);
    // The rest of the chain (34 / 68 / 340 / 3,400) recomputes cleanly.
    expect(premiseCodesOf(result)).toEqual(["PREMISE_FORMULA_MISMATCH"]);
  });

  it("BP-6: the SQL row drops a digit (500 / 0.30 = 1,667, the table says 167) and the chain below it stays consistent", () => {
    const result = auditRound5("BP-6");
    const violations = result.violations.filter((v) => v.code === "PREMISE_FORMULA_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.computed).toBeCloseTo(1666.6667, 3);
    expect(violations[0]?.detail.stated).toBe(167);
    expect(result.checks.premiseFormulas).toBe(6);
  });

  it("BP-3: the revenue goal (3,000万円) exceeds the table's own market-size estimate (200万円); its stated formula itself agrees", () => {
    const result = auditRound5("BP-3");
    const violations = result.violations.filter((v) => v.code === "PREMISE_ESTIMATE_GOAL_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.marketEstimate).toBe(2000000);
    expect(violations[0]?.detail.goalAmount).toBe(30000000);
    expect(premiseCodesOf(result)).toEqual(["PREMISE_ESTIMATE_GOAL_MISMATCH"]);
  });

  it("BP-5: the budget input fact restates the brief's 月10万円 as 100万円 (10x), in the degraded space-separated table", () => {
    const result = auditRound5("BP-5");
    const violations = result.violations.filter((v) => v.code === "PREMISE_INPUT_FACT_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.stated).toBe(1000000);
    expect(violations[0]?.detail.briefValue).toBe(100000);
    expect(violations[0]?.detail.factor).toBe(10);
    // The store count (5) does restate the brief, and the one stated
    // formula (200 x (1+20/100) = 240) recomputes cleanly.
    expect(result.checks.premiseInputFacts).toBe(2);
    expect(premiseCodesOf(result)).toEqual(["PREMISE_INPUT_FACT_MISMATCH"]);
  });

  it("BP-5 without the request text: the input-fact pass is skipped, not guessed", () => {
    const result = auditRound5("BP-5", false);
    expect(result.checks.premiseInputFacts).toBe(0);
    expect(premiseCodesOf(result)).toEqual([]);
  });

  it("BP-1: a fully consistent premise table produces no premise violation", () => {
    const result = auditRound5("BP-1");
    expect(premiseCodesOf(result)).toEqual([]);
    expect(result.checks.premiseFormulas).toBe(6);
    expect(result.checks.premiseInputFacts).toBe(2);
  });

  it("BP-4: the parenthesised worked examples do not double-count as operands", () => {
    const result = auditRound5("BP-4");
    expect(premiseCodesOf(result)).toEqual([]);
    expect(result.checks.premiseFormulas).toBe(5);
  });

  it("BP-7: input facts restated in different units (6,000万円 as 60,000,000円) match the brief, and every stated formula agrees", () => {
    const result = auditRound5("BP-7");
    expect(premiseCodesOf(result)).toEqual([]);
    expect(result.checks.premiseFormulas).toBe(4);
    expect(result.checks.premiseInputFacts).toBe(3);
  });
});

describe("premise-table checks on synthetic answers", () => {
  const TABLE_HEADER = "| 指標 | 値 | 単位 | 対象期間 | 種別 | 根拠 |\n|------|----|------|----------|------|------|";

  it("flags a named-operand formula whose value cell disagrees", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("marketing-spec"),
      [
        TABLE_HEADER,
        "| 受注目標 | 100 | 件 | 2027 Q1 | 仮置き（仮定） | 目標設定 |",
        "| 商談目標 | 500 | 件 | 2027 Q1 | 計算結果 | 受注目標 ÷ 0.20 |",
        "| SQL目標 | 167 | 件 | 2027 Q1 | 計算結果 | 商談目標 ÷ 0.30 |",
      ].join("\n"),
    );
    const violations = result.violations.filter((v) => v.code === "PREMISE_FORMULA_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.stated).toBe(167);
  });

  it("flags an input fact the request never stated (no digit-shift candidate)", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("promotion-ideas"),
      [TABLE_HEADER, "| 予算 | 30 | 万円 | 2026年11月 | 入力事実 | ユーザー情報 |"].join("\n"),
      { requestText: "カフェの販促案を考えて。予算は月10万円まで。" },
    );
    const violations = result.violations.filter((v) => v.code === "PREMISE_INPUT_FACT_MISMATCH");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail.stated).toBe(300000);
    expect(violations[0]?.detail.briefValue).toBeUndefined();
  });

  it("does not fire the estimate-goal check when the goal fits inside the estimated market", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("market-competition"),
      [
        TABLE_HEADER,
        "| 市場規模（推定） | 3,000 | 万円 | 2026年 | 推定 | 類似市場から類推 |",
        "| 目標売上 | 300 | 万円 | 2027年Q1 | 計算結果 | 受注件数 × 受注単価 = 10×30 |",
      ].join("\n"),
    );
    expect(premiseCodesOf(result)).toEqual([]);
    expect(result.checks.premiseEstimateGoals).toBe(1);
  });

  it("ignores tables that are not premise tables (no 指標/種別 header)", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      "| 施策 | 月額費用 |\n|---|---|\n| A | 2万円 |\n| B | 3万円 |",
    );
    expect(result.checks.premiseFormulas).toBe(0);
    expect(premiseCodesOf(result)).toEqual([]);
  });
});

describe("detector behaviour on synthetic answers", () => {
  it("accepts a correct parenthesised backcast formula", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      "必要な成約件数：120件（6,000万円 ÷ 50万円）\n必要な商談数：600件（120件 ÷ 20%）",
    );
    expect(codesOf(result)).not.toContain("FORMULA_RESULT_MISMATCH");
    expect(result.checks.formulas).toBe(2);
  });

  it("flags a formula whose stated result is a digit slip", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      "必要な商談数：60件（120件 ÷ 20%）",
    );
    const violation = result.violations.find((v) => v.code === "FORMULA_RESULT_MISMATCH");
    expect(violation?.detail.computed).toBe(600);
    expect(violation?.detail.stated).toBe(60);
  });

  it("flags a table whose 合計 row disagrees with its rows", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("promotion-ideas"),
      "| 施策 | 月額費用 |\n|---|---|\n| A | 2万円 |\n| B | 3万円 |\n| 合計 | 6万円 |",
    );
    const violation = result.violations.find((v) => v.code === "TOTAL_SUM_MISMATCH");
    expect(violation?.detail.computedSum).toBe(50000);
    expect(violation?.detail.statedTotal).toBe(60000);
  });

  it("does not treat an aspirational rate as the plan's operating rate", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      [
        "必要な成約件数：120件",
        "必要な商談数：600件",
        "必要なリード数：3,000件",
        "商談の質向上のため、成約率を25%に引き上げる余地を検討します。",
      ].join("\n"),
    );
    expect(codesOf(result)).not.toContain("FUNNEL_RATE_MISMATCH");
  });

  it("accepts owner and deadline in assignment form for execution-plan kinds", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      "施策A（担当：マーケティング担当、期限：2週間以内）",
    );
    expect(codesOf(result)).not.toContain("OWNER_MISSING");
    expect(codesOf(result)).not.toContain("DEADLINE_MISSING");
  });

  it("does not count a general mention of 担当者 as an assigned owner", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      "担当者のフォローアップを3回以上実施します。",
    );
    expect(codesOf(result)).toContain("OWNER_MISSING");
  });

  it("never fires the funnel check when a stage count is missing", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      "成約率は17%を目指します。必要なリード数は180件です。",
    );
    expect(codesOf(result)).not.toContain("FUNNEL_RATE_MISMATCH");
  });
});

describe("shadow-mode logging hook", () => {
  it("does nothing without a planning profile", () => {
    const calls: unknown[] = [];
    const result = logOriginBusinessPlanningAuditShadow({
      requestId: "req-1",
      profile: null,
      answerText: "ただの回答です。",
      logger: (message, fields) => calls.push([message, fields]),
    });
    expect(result).toBeNull();
    expect(calls).toEqual([]);
  });

  it("logs codes and counts only — never the answer text", () => {
    const calls: [string, Record<string, unknown>][] = [];
    const marker = "秘密の企画メモXYZ";
    const result = logOriginBusinessPlanningAuditShadow({
      requestId: "req-2",
      profile: syntheticProfile("campaign-plan"),
      answerText: `${marker}\n必要な商談数：60件（120件 ÷ 20%）`,
      logger: (message, fields) => calls.push([message, fields]),
    });
    expect(result?.violations.some((v) => v.code === "FORMULA_RESULT_MISMATCH")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("business planning audit (shadow)");
    expect(JSON.stringify(calls[0][1])).not.toContain(marker);
    expect(calls[0][1].violationCodes).toContain("FORMULA_RESULT_MISMATCH");
  });
});
