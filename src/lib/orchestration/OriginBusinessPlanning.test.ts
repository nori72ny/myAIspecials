import { describe, expect, it } from "vitest";
import {
  buildOriginBusinessPlanningInstruction,
  computeFunnelBackcast,
  detectOriginBusinessPlanningKind,
  parseBusinessPlanningFigures,
  resolveOriginBusinessPlanning,
} from "./OriginBusinessPlanning";
import { ORIGIN_BUSINESS_PLANNING_BRIEFS } from "./OriginBusinessPlanningBriefs";
import { originAnswerQualityInstruction, resolveOriginAnswerQualityPolicy } from "./OriginAnswerQualityPolicy";
import type { OriginRequestIntent } from "./OriginRequestIntent";

function intent(overrides: Partial<OriginRequestIntent> = {}): OriginRequestIntent {
  return { primaryTask: "documentation", interactionMode: "conversation", requiredCapabilities: [], requestedOutputs: [], suggestedOutputs: [], ...overrides };
}

describe("OriginBusinessPlanning detection", () => {
  it("detects every fixed brief as its expected kind", () => {
    expect(ORIGIN_BUSINESS_PLANNING_BRIEFS.length).toBeGreaterThanOrEqual(6);
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS) {
      expect(detectOriginBusinessPlanningKind(brief.prompt), brief.id).toBe(brief.expectedKind);
    }
  });

  it("does not fire for knowledge questions, coding, or everyday chat", () => {
    expect(detectOriginBusinessPlanningKind("マーケティングとは何ですか？")).toBeNull();
    expect(detectOriginBusinessPlanningKind("このTypeScriptのバグを直して。キャンペーンの文字列が崩れる")).toBeNull();
    expect(detectOriginBusinessPlanningKind("今日の天気は？")).toBeNull();
    expect(detectOriginBusinessPlanningKind("企画書の書き方を教えて")).toBe("proposal-outline");
    expect(detectOriginBusinessPlanningKind("来期のマーケティング戦略を考えたい")).toBe("marketing-plan");
    expect(detectOriginBusinessPlanningKind("競合分析をしてほしい")).toBe("market-competition");
  });

  it("prefers the specification kind over the generic plan kind", () => {
    expect(detectOriginBusinessPlanningKind("マーケティング計画の仕様書を作って")).toBe("marketing-spec");
  });
});

describe("OriginBusinessPlanning figure parsing", () => {
  it("parses labelled yen figures with units and full-width digits", () => {
    const figures = parseBusinessPlanningFigures("売上目標は６，０００万円、平均単価は50万円、成約率は20%です");
    expect(figures.goalRevenueYen).toBe(60_000_000);
    expect(figures.unitPriceYen).toBe(500_000);
    expect(figures.meetingToOrderRate).toBe(0.2);
  });

  it("parses an order goal and a 億円 revenue goal", () => {
    expect(parseBusinessPlanningFigures("目標は受注10件、平均単価80万円").goalOrders).toBe(10);
    expect(parseBusinessPlanningFigures("目標売上1.5億円を目指す").goalRevenueYen).toBe(150_000_000);
  });

  it("never treats a bare or differently-labelled number as a goal", () => {
    const figures = parseBusinessPlanningFigures("リード目標は300件で、参加者は50名、予算は10万円まで");
    expect(figures.goalOrders).toBeUndefined();
    expect(figures.goalRevenueYen).toBeUndefined();
    expect(figures.unitPriceYen).toBeUndefined();
  });

  it("rejects out-of-range rates", () => {
    expect(parseBusinessPlanningFigures("成約率は150%です").meetingToOrderRate).toBeUndefined();
    expect(parseBusinessPlanningFigures("商談化率25％").sqlToMeetingRate).toBe(0.25);
  });
});

describe("OriginBusinessPlanning deterministic backcast", () => {
  it("computes orders and meetings exactly for BP-7 figures (difference zero)", () => {
    const backcast = computeFunnelBackcast({ goalRevenueYen: 60_000_000, unitPriceYen: 500_000, meetingToOrderRate: 0.2 });
    expect(backcast?.stages).toEqual([
      { stage: "orders", count: 120 },
      { stage: "meetings", count: 600, derivedWithRate: 0.2 },
    ]);
    expect(backcast?.sensitivity).toEqual({ stage: "meetings", baseCount: 600, halvedRateCount: 1200 });
  });

  it("walks the full funnel when every rate is supplied and stops at the first missing rate", () => {
    const full = computeFunnelBackcast({ goalOrders: 10 }, { meetingToOrder: 0.25, sqlToMeeting: 0.5, mqlToSql: 0.5, leadToMql: 0.2, reachToLead: 0.1 });
    expect(full?.stages.map((s) => [s.stage, s.count])).toEqual([
      ["orders", 10], ["meetings", 40], ["sql", 80], ["mql", 160], ["leads", 800], ["reach", 8000],
    ]);
    const partial = computeFunnelBackcast({ goalOrders: 10 }, { meetingToOrder: 0.25 });
    expect(partial?.stages.map((s) => s.stage)).toEqual(["orders", "meetings"]);
  });

  it("rounds fractional people up at every stage and returns null without a derivable goal", () => {
    const backcast = computeFunnelBackcast({ goalRevenueYen: 1_000_000, unitPriceYen: 300_000 });
    expect(backcast?.stages).toEqual([{ stage: "orders", count: 4 }]);
    expect(computeFunnelBackcast({})).toBeNull();
    expect(computeFunnelBackcast({ goalRevenueYen: 1_000_000 })).toBeNull();
  });

  it("matches the brief-marked deterministic backcasts", () => {
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS.filter((b) => b.hasDeterministicBackcast)) {
      const profile = resolveOriginBusinessPlanning(brief.prompt);
      expect(profile?.backcast, brief.id).not.toBeNull();
    }
    const bp7 = resolveOriginBusinessPlanning(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === "BP-7")!.prompt);
    expect(bp7?.backcast?.stages.map((s) => s.count)).toEqual([120, 600]);
    const bp1 = resolveOriginBusinessPlanning(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === "BP-1")!.prompt);
    expect(bp1?.backcast?.stages).toEqual([{ stage: "orders", count: 10 }]);
  });
});

describe("OriginBusinessPlanning instruction", () => {
  it("carries the playbook structure, the number discipline, and the four beyond-request actions", () => {
    const profile = resolveOriginBusinessPlanning(ORIGIN_BUSINESS_PLANNING_BRIEFS[0].prompt)!;
    const instruction = buildOriginBusinessPlanningInstruction(profile);
    for (const part of ["目的とゴール", "対象", "提供価値", "市場・競合の見立て", "施策とチャネル", "数値の逆算", "KPIと計測方法", "リスクと代替案", "次の一手"]) {
      expect(instruction).toContain(part);
    }
    expect(instruction).toContain("仮置き（仮定）");
    expect(instruction).toContain("do not close it");
    expect(instruction).toContain("vanity metric");
    expect(instruction).toContain("ask at most one short question");
    expect(instruction).toContain("never write as if past data exists");
    expect(instruction).toContain("リーチ -> リード -> MQL -> SQL -> 商談 -> 受注");
  });

  it("injects the deterministic backcast with the exact computed counts", () => {
    const profile = resolveOriginBusinessPlanning(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === "BP-7")!.prompt)!;
    const instruction = buildOriginBusinessPlanningInstruction(profile);
    expect(instruction).toContain("Deterministic backcast computed by the system");
    expect(instruction).toContain("受注 120件");
    expect(instruction).toContain("商談 600件");
    expect(instruction).toContain("from 600 to 1,200");
    expect(instruction).toContain("User-supplied figures");
  });

  it("gives each kind its specific emphasis", () => {
    const byKind = new Map(ORIGIN_BUSINESS_PLANNING_BRIEFS.map((b) => [b.expectedKind, b.prompt]));
    expect(buildOriginBusinessPlanningInstruction(resolveOriginBusinessPlanning(byKind.get("marketing-spec")!)!)).toContain("UTM");
    expect(buildOriginBusinessPlanningInstruction(resolveOriginBusinessPlanning(byKind.get("market-competition")!)!)).toContain("positioning statement");
    expect(buildOriginBusinessPlanningInstruction(resolveOriginBusinessPlanning(byKind.get("proposal-outline")!)!)).toContain("who decides what and by when");
    expect(buildOriginBusinessPlanningInstruction(resolveOriginBusinessPlanning(byKind.get("promotion-ideas")!)!)).toContain("expected effect x certainty / effort");
    expect(buildOriginBusinessPlanningInstruction(resolveOriginBusinessPlanning(byKind.get("funnel-design")!)!)).toContain("entry and exit criteria");
    expect(buildOriginBusinessPlanningInstruction(resolveOriginBusinessPlanning(byKind.get("campaign-plan")!)!)).toContain("hard constraint");
  });
});

describe("OriginBusinessPlanning policy integration", () => {
  it("attaches the profile and appends the protocol only for planning/marketing prompts", () => {
    const policy = resolveOriginAnswerQualityPolicy({ intent: intent(), taskType: "documentation", independentReviewRequired: false, promptText: ORIGIN_BUSINESS_PLANNING_BRIEFS[0].prompt });
    expect(policy.businessPlanning?.kind).toBe("campaign-plan");
    const instruction = originAnswerQualityInstruction(policy);
    expect(instruction).toContain("Business planning & marketing protocol");
    expect(instruction).toContain("数値の逆算");
  });

  it("leaves every other answer's policy and instruction untouched", () => {
    const plain = resolveOriginAnswerQualityPolicy({ intent: intent(), taskType: "implementation", independentReviewRequired: false, promptText: "このバグを直して" });
    expect(plain.businessPlanning).toBeNull();
    expect(originAnswerQualityInstruction(plain)).not.toContain("Business planning & marketing protocol");
    const noPrompt = resolveOriginAnswerQualityPolicy({ intent: intent(), taskType: "implementation", independentReviewRequired: false });
    expect(noPrompt.businessPlanning).toBeNull();
  });
});
