import { describe, expect, it } from "vitest";
import {
  applyOriginBusinessPlanningAuditGate,
  auditOriginBusinessPlanningAnswer,
  resolveOriginBusinessPlanningAuditMode,
  type OriginBusinessPlanningAuditViolationCode,
} from "./OriginBusinessPlanningAudit.js";
import {
  resolveOriginBusinessPlanning,
  type OriginBusinessPlanningKind,
  type OriginBusinessPlanningProfile,
} from "./OriginBusinessPlanning.js";
import { ORIGIN_BUSINESS_PLANNING_MEASURED_ANSWERS } from "./OriginBusinessPlanningAudit.fixtures.js";

// Stage 2 (enforcement) of the numeric audit gate: deterministic
// formula fixes verified by re-audit, disclosure notes for what cannot
// be fixed safely, and the two detectors added for the round-3
// residual defects (mixed currencies, past deadlines) plus the ratio
// tolerance that lets the formula check see a mislabelled percent.

const NOW = new Date("2026-11-16T12:00:00+09:00");
const ENFORCE_ENV = { ORIGIN_BUSINESS_PLANNING_AUDIT_MODE: "enforce" } as NodeJS.ProcessEnv;

function syntheticProfile(kind: OriginBusinessPlanningKind): OriginBusinessPlanningProfile {
  return { kind, figures: {}, backcast: null };
}

function codesOf(result: ReturnType<typeof auditOriginBusinessPlanningAnswer>): OriginBusinessPlanningAuditViolationCode[] {
  return result.violations.map((violation) => violation.code);
}

function gate(profile: OriginBusinessPlanningProfile, answerText: string, env: NodeJS.ProcessEnv = ENFORCE_ENV) {
  return applyOriginBusinessPlanningAuditGate({
    requestId: "req-enforce-test",
    profile,
    answerText,
    env,
    now: NOW,
    logger: () => {},
  });
}

function round3Fixture(id: string) {
  const fixture = ORIGIN_BUSINESS_PLANNING_MEASURED_ANSWERS.find((entry) => entry.round === "round3" && entry.id === id);
  if (!fixture) throw new Error(`round3 fixture ${id} missing`);
  const profile = resolveOriginBusinessPlanning(fixture.prompt);
  if (!profile) throw new Error(`profile for round3/${id} not resolved`);
  return { fixture, profile };
}

describe("mode resolution", () => {
  it("defaults to shadow and only the exact value enforce enables enforcement", () => {
    expect(resolveOriginBusinessPlanningAuditMode(undefined)).toBe("shadow");
    expect(resolveOriginBusinessPlanningAuditMode({})).toBe("shadow");
    expect(resolveOriginBusinessPlanningAuditMode({ ORIGIN_BUSINESS_PLANNING_AUDIT_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginBusinessPlanningAuditMode({ ORIGIN_BUSINESS_PLANNING_AUDIT_MODE: "ENFORCE" })).toBe("shadow");
    expect(resolveOriginBusinessPlanningAuditMode({ ORIGIN_BUSINESS_PLANNING_AUDIT_MODE: "enforce" })).toBe("enforce");
  });
});

describe("detectors added for the round-3 residual defects", () => {
  it("flags a percent that disagrees with its own division (round 3 BP-5 shape)", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("promotion-ideas"),
      "- リード → MQL 20%（1,500 ÷ 3,000）",
    );
    const violation = result.violations.find((v) => v.code === "FORMULA_RESULT_MISMATCH");
    expect(violation?.detail.computed).toBe(0.5);
    expect(violation?.detail.stated).toBe(0.2);
  });

  it("keeps honestly rounded percents clean (1/6 stated as 17%, 750/1,500 stated as 50%)", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("promotion-ideas"),
      "- 成約率 17%（1 ÷ 6）\n- MQL → SQL 50%（750 ÷ 1,500）",
    );
    expect(codesOf(result)).not.toContain("FORMULA_RESULT_MISMATCH");
    expect(result.checks.formulas).toBe(2);
  });

  it("flags a deadline date that is already past, in both date formats", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      "施策Aの期限：2024年11月30日\n施策Bは 2025-02-28 までに実施",
      { now: NOW },
    );
    const past = result.violations.filter((v) => v.code === "DEADLINE_PAST");
    expect(past).toHaveLength(2);
    expect(past[0].detail).toEqual({ year: 2024, month: 11, day: 30 });
    expect(past[1].detail).toEqual({ year: 2025, month: 2, day: 28 });
  });

  it("does not flag future deadlines, today's deadline, or past dates without deadline context", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      [
        "施策Aの期限：2026年12月1日",
        "施策Bの期限：2026年11月16日",
        "2024年11月30日に実施した前回施策の結果を踏まえる",
      ].join("\n"),
      { now: NOW },
    );
    expect(codesOf(result)).not.toContain("DEADLINE_PAST");
    expect(result.checks.deadlineDates).toBe(2);
  });

  it("never runs the past-deadline check without a supplied date", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      "施策Aの期限：2024年11月30日",
    );
    expect(codesOf(result)).not.toContain("DEADLINE_PAST");
    expect(result.checks.deadlineDates).toBe(0);
  });

  it("flags a yen goal backed out in dollars with no conversion basis (round 3 BP-4 shape)", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("funnel-design"),
      "目標は月間ARR 100万円です。\n- 受注200件 × 月額$500 = $100,000（ARR）",
    );
    const violation = result.violations.find((v) => v.code === "MIXED_CURRENCY");
    expect(violation).toBeDefined();
    expect(violation?.detail.dollarAmounts).toBe(2);
  });

  it("does not flag mixed currencies when a conversion is stated, or when dollars are only a price mention", () => {
    const withConversion = auditOriginBusinessPlanningAnswer(
      syntheticProfile("funnel-design"),
      "目標は月間ARR 100万円です。1ドル=150円で換算します。\n- 受注200件 × 月額$500 = $100,000",
    );
    expect(codesOf(withConversion)).not.toContain("MIXED_CURRENCY");
    const priceMention = auditOriginBusinessPlanningAnswer(
      syntheticProfile("funnel-design"),
      "予算は月10万円です。分析ツールは月額$50で契約します。",
    );
    expect(codesOf(priceMention)).not.toContain("MIXED_CURRENCY");
  });

  it("counts a markdown-bold owner assignment as an assignment (round 3 shape)", () => {
    const result = auditOriginBusinessPlanningAnswer(
      syntheticProfile("campaign-plan"),
      "- **担当**：マーケティング部長\n- **期限**：2週間以内",
    );
    expect(codesOf(result)).not.toContain("OWNER_MISSING");
    expect(codesOf(result)).not.toContain("DEADLINE_MISSING");
  });
});

describe("enforcement: deterministic formula fixes", () => {
  it("corrects a stated result that sits before its parenthesised formula", () => {
    const outcome = gate(syntheticProfile("campaign-plan"), "必要な商談数：60件（120件 ÷ 20%）");
    expect(outcome.fixedCount).toBe(1);
    expect(outcome.answerText).toContain("必要な商談数：600件（120件 ÷ 20%）");
    expect(outcome.answerText).toContain("数値の一部を、回答に記載された計算式に合わせて修正しました。");
    expect(outcome.remainingViolations.map((v) => v.code)).not.toContain("FORMULA_RESULT_MISMATCH");
  });

  it("corrects a mislabelled percent to the value its division computes", () => {
    const outcome = gate(syntheticProfile("promotion-ideas"), "- リード → MQL 20%（1,500 ÷ 3,000）");
    expect(outcome.fixedCount).toBe(1);
    expect(outcome.answerText).toContain("リード → MQL 50%（1,500 ÷ 3,000）");
  });

  it("corrects a yen result rendered in the stated unit's scale", () => {
    const outcome = gate(
      syntheticProfile("proposal-outline"),
      "市場規模は約540億円（1,200,000社 × 45% × 月額5万円 × 12か月）です。",
    );
    expect(outcome.fixedCount).toBe(1);
    expect(outcome.answerText).toContain("約3240億円");
  });

  it("corrects a result stated after an explicit equals sign", () => {
    const outcome = gate(syntheticProfile("campaign-plan"), "必要件数は 120 ÷ 0.20 = 60件です。");
    expect(outcome.fixedCount).toBe(1);
    expect(outcome.answerText).toContain("120 ÷ 0.20 = 600件");
  });

  it("never rewrites a result that sits in another table cell (the formula may be the wrong side)", () => {
    const outcome = gate(
      syntheticProfile("proposal-outline"),
      "| 項目 | 数値 | 根拠 |\n|---|---|---|\n| 潜在市場規模 | 約540億円 | 1,200,000社 × 45% × 月額5万円 × 12か月 |",
    );
    expect(outcome.fixedCount).toBe(0);
    expect(outcome.answerText).toContain("約540億円");
    expect(outcome.answerText).toContain("計算の記載と結果が一致していない数値があります");
    expect(outcome.notedCodes).toContain("FORMULA_RESULT_MISMATCH");
  });

  it("never rewrites a percent by a non-rate computed value (round 1 BP-1 shape)", () => {
    const outcome = gate(syntheticProfile("campaign-plan"), "成約率目標：≈17%（180件÷10件）");
    expect(outcome.fixedCount).toBe(0);
    expect(outcome.answerText).toContain("≈17%");
    expect(outcome.notedCodes).toContain("FORMULA_RESULT_MISMATCH");
  });

  it("discards every fix when a correction would create a new violation elsewhere", () => {
    // Before the fix the funnel is consistent (60 x 20% = 12); fixing
    // the formula's stated result to 600 would break it (600 x 20% =
    // 120 != 12), so the re-audit safety net must reject the fix and
    // disclose instead.
    const answer = [
      "必要な商談数：60件（120件 ÷ 20%）",
      "必要な成約件数：12件",
      "成約率：20%",
    ].join("\n");
    const outcome = gate(syntheticProfile("campaign-plan"), answer);
    expect(outcome.fixedCount).toBe(0);
    expect(outcome.answerText).toContain("必要な商談数：60件");
    expect(outcome.notedCodes).toContain("FORMULA_RESULT_MISMATCH");
  });

  it("keeps a fix when it also resolves the downstream check that depended on it", () => {
    const answer = [
      "必要な商談数：60件（120件 ÷ 20%）",
      "必要な成約件数：120件",
      "成約率：20%",
    ].join("\n");
    const outcome = gate(syntheticProfile("campaign-plan"), answer);
    expect(outcome.fixedCount).toBe(1);
    expect(outcome.answerText).toContain("必要な商談数：600件");
    expect(outcome.remainingViolations.map((v) => v.code)).not.toContain("FUNNEL_RATE_MISMATCH");
  });
});

describe("enforcement: disclosure notes for what cannot be fixed", () => {
  it("notes an unfixable total instead of passing it through silently", () => {
    const outcome = gate(
      syntheticProfile("promotion-ideas"),
      "| 施策 | 月額費用 |\n|---|---|\n| A | 2万円 |\n| B | 3万円 |\n| 合計 | 6万円 |",
    );
    expect(outcome.fixedCount).toBe(0);
    expect(outcome.answerText).toContain("| 合計 | 6万円 |");
    expect(outcome.answerText).toContain("計算の記載と結果が一致していない数値があります");
    expect(outcome.notedCodes).toContain("TOTAL_SUM_MISMATCH");
  });

  it("names the missing required parts in the note", () => {
    const outcome = gate(syntheticProfile("campaign-plan"), "目的とゴールだけを書いた短い回答です。");
    expect(outcome.answerText).toContain("の項目が含まれていません。");
    expect(outcome.answerText).toContain("「対象」");
    expect(outcome.notedCodes).toContain("REQUIRED_PART_MISSING");
  });

  it("notes past deadlines with the earliest dates, and mixed currencies", () => {
    const past = gate(syntheticProfile("campaign-plan"), "施策Aの期限：2024年11月30日\n担当：営業部長");
    expect(past.answerText).toContain("期限として、すでに過ぎた日付（2024年11月30日）が含まれています。");
    expect(past.notedCodes).toContain("DEADLINE_PAST");
    const mixed = gate(
      syntheticProfile("funnel-design"),
      "目標は月間ARR 100万円です。\n- 受注200件 × 月額$500 = $100,000（ARR）",
    );
    expect(mixed.answerText).toContain("円とドルの金額が混ざっています");
    expect(mixed.notedCodes).toContain("MIXED_CURRENCY");
  });

  it("leaves a fully clean answer byte-identical in enforce mode", () => {
    const answer = [
      "## 目的とゴール",
      "受注10件を目指す。",
      "## 対象",
      "中小企業。",
      "## 提供価値",
      "工数削減。",
      "## 市場・競合の見立て",
      "市場は拡大傾向。",
      "## 施策とチャネル",
      "Web広告を中心にする。",
      "## 数値の逆算",
      "必要な成約件数：120件（6,000万円 ÷ 50万円）。転換率は仮置き（仮定）。",
      "## KPIと計測方法",
      "成約数を週次で計測する。",
      "## リスクと代替案",
      "競合参入には価格で対抗する。",
      "## 次の一手",
      "まず対象リストを作る。",
      "担当：営業部長",
      "期限：2週間以内",
    ].join("\n");
    const outcome = gate(syntheticProfile("campaign-plan"), answer);
    expect(outcome.fixedCount).toBe(0);
    expect(outcome.notedCodes).toEqual([]);
    expect(outcome.remainingViolations).toEqual([]);
    expect(outcome.answerText).toBe(answer);
  });

  it("does nothing without a planning profile, in either mode", () => {
    const outcome = applyOriginBusinessPlanningAuditGate({
      requestId: "req-none",
      profile: null,
      answerText: "必要な商談数：60件（120件 ÷ 20%）",
      env: ENFORCE_ENV,
      now: NOW,
      logger: () => {},
    });
    expect(outcome.answerText).toBe("必要な商談数：60件（120件 ÷ 20%）");
    expect(outcome.result).toBeNull();
  });
});

describe("shadow mode through the gate", () => {
  it("logs the stage-1 shadow line and never alters the text, even with violations", () => {
    const calls: [string, Record<string, unknown>][] = [];
    const answer = "必要な商談数：60件（120件 ÷ 20%）";
    const outcome = applyOriginBusinessPlanningAuditGate({
      requestId: "req-shadow",
      profile: syntheticProfile("campaign-plan"),
      answerText: answer,
      env: {},
      now: NOW,
      logger: (message, fields) => calls.push([message, fields]),
    });
    expect(outcome.mode).toBe("shadow");
    expect(outcome.answerText).toBe(answer);
    expect(outcome.fixedCount).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("business planning audit (shadow)");
    expect(calls[0][1].violationCodes).toContain("FORMULA_RESULT_MISMATCH");
  });

  it("logs the enforce line with fix and note counts in enforce mode", () => {
    const calls: [string, Record<string, unknown>][] = [];
    applyOriginBusinessPlanningAuditGate({
      requestId: "req-enforce-log",
      profile: syntheticProfile("campaign-plan"),
      answerText: "必要な商談数：60件（120件 ÷ 20%）",
      env: ENFORCE_ENV,
      now: NOW,
      logger: (message, fields) => calls.push([message, fields]),
    });
    const enforceCall = calls.find(([message]) => message.includes("(enforce)"));
    expect(enforceCall).toBeDefined();
    expect(enforceCall?.[1].fixedCount).toBe(1);
    expect(JSON.stringify(enforceCall?.[1])).not.toContain("必要な商談数");
  });
});

describe("round 3 measured answers under enforcement (now = 2026-11-16)", () => {
  it("BP-5: the mislabelled 20% becomes 50% and nothing else in the body changes", () => {
    const { fixture, profile } = round3Fixture("BP-5");
    const outcome = gate(profile, fixture.answerText);
    expect(outcome.fixedCount).toBe(1);
    expect(outcome.answerText).toContain("リード → MQL 50");
    expect(outcome.answerText).not.toContain("リード → MQL 20");
    expect(outcome.answerText).toContain("数値の一部を、回答に記載された計算式に合わせて修正しました。");
    expect(outcome.remainingViolations).toEqual([]);
  });

  it("BP-4: the mixed-currency backcast is disclosed, the body is untouched", () => {
    const { fixture, profile } = round3Fixture("BP-4");
    const outcome = gate(profile, fixture.answerText);
    expect(outcome.fixedCount).toBe(0);
    expect(outcome.answerText.startsWith(fixture.answerText)).toBe(true);
    expect(outcome.answerText).toContain("円とドルの金額が混ざっています");
    expect(outcome.notedCodes).toEqual(["MIXED_CURRENCY"]);
  });

  it("BP-2: all five past deadlines are disclosed and the bold owner assignment is not a false positive", () => {
    const { fixture, profile } = round3Fixture("BP-2");
    const audit = auditOriginBusinessPlanningAnswer(profile, fixture.answerText, { now: NOW });
    expect(audit.violations.filter((v) => v.code === "DEADLINE_PAST")).toHaveLength(5);
    expect(codesOf(audit)).not.toContain("OWNER_MISSING");
    const outcome = gate(profile, fixture.answerText);
    expect(outcome.fixedCount).toBe(0);
    expect(outcome.answerText).toContain("2024年11月30日");
    expect(outcome.notedCodes).toEqual(["DEADLINE_PAST"]);
  });
});

describe("monotonicity check is shadow-only by construction (detection 12, knowhow 案3)", () => {
  it("enforce mode: an answer whose only violation is MONOTONICITY_MISMATCH is delivered byte-identical, with no note and no fix", () => {
    const answer = [
      "## 前提表",
      "| 指標 | 値 | 単位 | 対象期間 | 種別 | 根拠 |",
      "|---|---|---|---|---|---|",
      "| 受注目標 | 100 | 件 | 2027 Q1 | 仮置き（仮定） | 目標設定 |",
      "| 商談目標 | 500 | 件 | 2027 Q1 | 計算結果 | 受注目標 ÷ 商談→受注転換率 |",
      "| SQL目標 | 167 | 件 | 2027 Q1 | 計算結果 | 商談目標をSQL→商談転換率で割り戻し |",
      "| 商談→受注転換率 | 20% | % | 2027 Q1 | 仮置き（仮定） | 過去実績 |",
      "| SQL→商談転換率 | 30% | % | 2027 Q1 | 仮置き（仮定） | 過去実績 |",
      "",
      "## 目的とゴール",
      "受注目標100件の達成を目的とします。",
      "",
      "## 対象",
      "見込み客を対象とします。",
      "",
      "## 提供価値",
      "短期間で商談を創出します。",
      "",
      "## 施策とチャネル",
      "Web広告を配信します。担当は田中、期限は2027年1月31日です。",
      "",
      "## 数値の逆算",
      "受注目標100件から逆算します。",
      "",
      "## KPIと計測方法",
      "SQL目標と商談目標を週次で計測します。",
      "",
      "## リスクと代替案",
      "転換率が下振れた場合は施策を追加します。",
      "",
      "## 次の一手",
      "まず前提表の数値を確定させます。担当は田中、期限は2027年1月31日です。",
    ].join("\n");
    const profile = syntheticProfile("campaign-plan");
    const audit = auditOriginBusinessPlanningAnswer(profile, answer, { now: NOW });
    expect(codesOf(audit)).toEqual(["MONOTONICITY_MISMATCH"]);
    const outcome = gate(profile, answer);
    expect(outcome.answerText).toBe(answer);
    expect(outcome.fixedCount).toBe(0);
    expect(outcome.notedCodes).toEqual([]);
    expect(outcome.remainingViolations.map((violation) => violation.code)).toEqual(["MONOTONICITY_MISMATCH"]);
  });
});
