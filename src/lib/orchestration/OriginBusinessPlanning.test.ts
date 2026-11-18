import { describe, expect, it } from "vitest";
import {
  ORIGIN_BUSINESS_PLANNING_REQUIRED_PARTS,
  buildOriginBusinessPlanningInstruction,
  buildOriginGroqBusinessPlanningInstruction,
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

  it("detects business-noun plan requests as marketing-plan (2026-11-18 coverage gap)", () => {
    // The 2026-11-17 production check that detected null on every route:
    // a business noun compounded with a plan noun carries no marketing
    // vocabulary, yet the request is an execution plan.
    expect(detectOriginBusinessPlanningKind("小さな焼き菓子店の開業に向けた3ヶ月の運営計画を作って")).toBe("marketing-plan");
    expect(detectOriginBusinessPlanningKind("事業計画を作ってください")).toBe("marketing-plan");
    expect(detectOriginBusinessPlanningKind("来年の経営計画を策定したい")).toBe("marketing-plan");
    expect(detectOriginBusinessPlanningKind("開業計画を立てたい")).toBe("marketing-plan");
    expect(detectOriginBusinessPlanningKind("店舗の売上計画を考えて")).toBe("marketing-plan");
    expect(detectOriginBusinessPlanningKind("開業の計画を練りたい")).toBe("marketing-plan");
    // Business noun tied to a plan verb across a short clause.
    expect(detectOriginBusinessPlanningKind("事業を始める計画を立てて")).toBe("marketing-plan");
  });

  it("does not fire the business-plan coverage for everyday plans, bare nouns, or derived nouns", () => {
    // A bare plan noun without a business noun is personal planning.
    expect(detectOriginBusinessPlanningKind("旅行の計画を立てて")).toBeNull();
    expect(detectOriginBusinessPlanningKind("勉強計画を立てて")).toBeNull();
    expect(detectOriginBusinessPlanningKind("ダイエット計画を考えたい")).toBeNull();
    expect(detectOriginBusinessPlanningKind("計画を立てて")).toBeNull();
    // A bare business noun without a plan is not a planning request.
    expect(detectOriginBusinessPlanningKind("開業したいと思っている")).toBeNull();
    expect(detectOriginBusinessPlanningKind("お店の売上が下がった。どうすればいい？")).toBeNull();
    // Definition questions stay knowledge questions, and 事業計画性 is a
    // derived noun, not a plan compound.
    expect(detectOriginBusinessPlanningKind("事業計画とは何ですか？")).toBeNull();
    expect(detectOriginBusinessPlanningKind("事業計画性のない文章を直して")).toBeNull();
  });

  it("keeps the specific kinds ahead of the business-plan coverage", () => {
    expect(detectOriginBusinessPlanningKind("キャンペーンの計画を立てて")).toBe("campaign-plan");
    expect(detectOriginBusinessPlanningKind("マーケティング計画を作って")).toBe("marketing-plan");
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

describe("OriginBusinessPlanning instruction hardening", () => {
  const instructionFor = (prompt: string) => buildOriginBusinessPlanningInstruction(resolveOriginBusinessPlanning(prompt)!);
  const checklistLine = (instruction: string) => instruction.split("\n").find((line) => line.includes("Required parts for this kind"))!;

  it("injects every brief's mustInclude parts into that brief's checklist line", () => {
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS) {
      const line = checklistLine(instructionFor(brief.prompt));
      expect(line, brief.id).toBeDefined();
      for (const part of brief.mustInclude) {
        expect(line, `${brief.id} checklist must contain ${part}`).toContain(part);
      }
    }
  });

  it("keeps the per-kind required parts equal to the briefs' mustInclude union (no drift)", () => {
    const kindsWithBriefs = [...new Set(ORIGIN_BUSINESS_PLANNING_BRIEFS.map((b) => b.expectedKind))];
    for (const kind of kindsWithBriefs) {
      const union = new Set(ORIGIN_BUSINESS_PLANNING_BRIEFS.filter((b) => b.expectedKind === kind).flatMap((b) => b.mustInclude));
      expect(new Set(ORIGIN_BUSINESS_PLANNING_REQUIRED_PARTS[kind]), kind).toEqual(union);
    }
    // marketing-plan has no brief; it takes the full standard structure.
    const planLine = checklistLine(instructionFor("来期のマーケティング戦略を考えたい"));
    for (const part of ORIGIN_BUSINESS_PLANNING_REQUIRED_PARTS["marketing-plan"]) {
      expect(planLine).toContain(part);
    }
  });

  it("does not force parts the kind does not require", () => {
    const outline = checklistLine(instructionFor(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === "BP-2")!.prompt));
    for (const part of ["市場・競合の見立て", "施策とチャネル", "数値の逆算", "KPIと計測方法", "仮置き"]) {
      expect(outline, `proposal-outline checklist must not require ${part}`).not.toContain(part);
    }
    const funnel = checklistLine(instructionFor(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === "BP-4")!.prompt));
    for (const part of ["提供価値", "市場・競合の見立て", "数値の逆算"]) {
      expect(funnel, `funnel-design checklist must not require ${part}`).not.toContain(part);
    }
    const market = checklistLine(instructionFor(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === "BP-3")!.prompt));
    for (const part of ["施策とチャネル", "数値の逆算", "KPIと計測方法", "仮置き"]) {
      expect(market, `market-competition checklist must not require ${part}`).not.toContain(part);
    }
  });

  it("adds the concrete number-sanity rules to every brief's instruction", () => {
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS) {
      const instruction = instructionFor(brief.prompt);
      expect(instruction, brief.id).toContain("Number sanity");
      // Rate direction: result ÷ input, never the inverse (BP-1 defect).
      expect(instruction, brief.id).toContain("成約率 = 受注数 ÷ 商談数");
      expect(instruction, brief.id).toContain("never the inverse");
      // Formula and result must agree (BP-2 market-size / forecast defects).
      expect(instruction, brief.id).toContain("must equal the value that formula produces");
      expect(instruction, brief.id).toContain("対象数 × 比率 × 単価 × 期間");
      // No unsourced statistic dressed as fact (BP-2 / BP-4 defects).
      expect(instruction, brief.id).toContain("「業界平均」「調査によると」「統計によると」");
      expect(instruction, brief.id).toContain("may appear only labelled 「仮置き（仮定）」");
      // Summary and body must not contradict each other (BP-2 defect).
      expect(instruction, brief.id).toContain("same value everywhere it appears");
    }
  });

  it("requires an owner and a deadline for execution-plan kinds only", () => {
    const withDeadline = ["BP-1", "BP-2", "BP-5", "BP-6", "BP-7"];
    const withoutDeadline = ["BP-3", "BP-4"];
    for (const id of withDeadline) {
      const instruction = instructionFor(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === id)!.prompt);
      expect(instruction, id).toContain("Ownership and deadlines");
      expect(instruction, id).toContain("担当");
      expect(instruction, id).toContain("期限");
      expect(instruction, id).toContain("「2週間以内」「初月末まで」");
    }
    for (const id of withoutDeadline) {
      const instruction = instructionFor(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === id)!.prompt);
      expect(instruction, id).not.toContain("Ownership and deadlines");
    }
  });

  it("keeps non-planning instructions byte-identical to the no-prompt policy", () => {
    const withPrompt = resolveOriginAnswerQualityPolicy({ intent: intent(), taskType: "implementation", independentReviewRequired: false, promptText: "このバグを直して" });
    const noPrompt = resolveOriginAnswerQualityPolicy({ intent: intent(), taskType: "implementation", independentReviewRequired: false });
    expect(originAnswerQualityInstruction(withPrompt)).toBe(originAnswerQualityInstruction(noPrompt));
    for (const marker of ["Required parts for this kind", "Number sanity", "Ownership and deadlines"]) {
      expect(originAnswerQualityInstruction(withPrompt)).not.toContain(marker);
    }
  });
});

describe("OriginBusinessPlanning route-3 compact instruction", () => {
  // Round-2 adjudication (2026-11-16): route 3 served all seven briefs and
  // carried none of the mandatory playbook, so mustInclude failed on every
  // brief and owner/deadline appeared in none. The compact builder must
  // carry the same mandatory core as the full instruction, compressed.
  const compactFor = (prompt: string) => buildOriginGroqBusinessPlanningInstruction(resolveOriginBusinessPlanning(prompt)!);

  it("carries every required part of the brief's kind, in the canon's order", () => {
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS) {
      const compact = compactFor(brief.prompt);
      const kind = resolveOriginBusinessPlanning(brief.prompt)!.kind;
      const sections = ORIGIN_BUSINESS_PLANNING_REQUIRED_PARTS[kind].filter((part) => part !== "仮置き");
      let lastIndex = -1;
      for (const part of sections) {
        const index = compact.indexOf(part);
        expect(index, `${brief.id} compact must contain ${part}`).toBeGreaterThan(lastIndex);
        lastIndex = index;
      }
      for (const part of brief.mustInclude) {
        expect(compact, `${brief.id} compact must contain mustInclude ${part}`).toContain(part);
      }
    }
  });

  it("carries the number discipline: shown arithmetic, rate direction, formula integrity, no unsourced figures", () => {
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS) {
      const compact = compactFor(brief.prompt);
      expect(compact, brief.id).toContain("仮置き（仮定）");
      expect(compact, brief.id).toContain("result ÷ input");
      expect(compact, brief.id).toContain("must equal that formula's result");
      expect(compact, brief.id).toContain("same value in the summary, tables, and body");
      expect(compact, brief.id).toContain("Never state an unsourced market size, competitor fact, or statistic as fact");
    }
  });

  it("requires an owner and a deadline for execution-plan kinds only (same split as the full instruction)", () => {
    for (const id of ["BP-1", "BP-2", "BP-5", "BP-6", "BP-7"]) {
      const compact = compactFor(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === id)!.prompt);
      expect(compact, id).toContain("Ownership and deadlines");
      expect(compact, id).toContain("担当");
      expect(compact, id).toContain("期限");
    }
    for (const id of ["BP-3", "BP-4"]) {
      const compact = compactFor(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === id)!.prompt);
      expect(compact, id).not.toContain("Ownership and deadlines");
    }
  });

  it("carries the deterministic backcast with the exact computed counts", () => {
    const compact = compactFor(ORIGIN_BUSINESS_PLANNING_BRIEFS.find((b) => b.id === "BP-7")!.prompt);
    expect(compact).toContain("System-computed backcast");
    expect(compact).toContain("do not recompute");
    expect(compact).toContain("受注 120件");
    expect(compact).toContain("商談 600件");
    expect(compact).toContain("from 600 to 1,200");
    expect(compact).toContain("User-supplied figures");
    expect(compact).toContain("60,000,000円");
  });

  it("stays compact: at most 2,400 characters for every fixed brief (the full instruction is 4,400+)", () => {
    // Pin history: 1,700 until 2026-11-18, when the compressed premise
    // table (287 characters), the current-date line (88), and the
    // compact calendar anchor (255) were added on the measured basis of
    // BUSINESS_ANCHOR_DIAGNOSIS_2026-11-18 — route 3 had served 14/14
    // measured briefs without them (premise table 0/7, BP-2 shipped ten
    // past dates). The largest brief (BP-7) now measures 2,301
    // characters; the pin sits just above that, with headroom only for
    // the anchor's date-dependent length variation.
    for (const brief of ORIGIN_BUSINESS_PLANNING_BRIEFS) {
      const compact = compactFor(brief.prompt);
      expect(compact.length, brief.id).toBeLessThanOrEqual(2_400);
      expect(compact.length, brief.id).toBeLessThan(buildOriginBusinessPlanningInstruction(resolveOriginBusinessPlanning(brief.prompt)!).length / 2);
    }
  });
});

describe("OriginBusinessPlanning calendar anchor & premise table (external-consult adoption 2026-11-17)", () => {
  // Adoption items 1-2: the full instruction (routes 1-2) gains the
  // premise-table structure and, at its very end, the system-computed JST
  // calendar anchor. A fixed "now" (2026-11-17 12:00 JST, a Tuesday) pins
  // the exact anchor text. Since 2026-11-18 the route-3 compact form
  // carries both in compressed form as well (last two tests).
  const fixedNow = new Date("2026-11-17T03:00:00Z");
  const profile = resolveOriginBusinessPlanning(ORIGIN_BUSINESS_PLANNING_BRIEFS[0].prompt)!;
  const instruction = buildOriginBusinessPlanningInstruction(profile, fixedNow);

  it("opens the answer structure with the premise table: provenance classes, basis column, body reference-only", () => {
    expect(instruction).toContain("premise table first");
    expect(instruction).toContain("指標 / 値 / 単位 / 対象期間 / 種別 / 根拠");
    for (const provenance of ["入力事実", "仮置き（仮定）", "計算結果", "未確定"]) {
      expect(instruction).toContain(provenance);
    }
    // A rate's basis shows the division it comes from (numerator/denominator).
    expect(instruction).toContain("受注 120件 ÷ 商談 600件");
    expect(instruction).toContain("introduce no new number in the body");
    expect(instruction).toContain("never restate a figure with a different value");
    // The premise table precedes the body-shaping rules it constrains.
    expect(instruction.indexOf("premise table first")).toBeLessThan(instruction.indexOf("Funnel vocabulary is fixed"));
  });

  it("fixes the money unit to 円 or 万円 for the whole answer and bans 千円 amounts", () => {
    expect(instruction).toContain("円 or 万円, chosen once");
    expect(instruction).toContain("千円 amounts are never written");
    expect(instruction).toContain("50,000円");
  });

  it("ends the instruction with the calendar anchor computed for the execution date", () => {
    for (const expected of [
      "カレンダー基準",
      "- 基準日：2026-11-17（火）",
      "- 今月末：2026-11-30",
      "- 来月：2026年12月（2026-12-01〜2026-12-31）",
      "- 2ヶ月後：2027年1月（2027-01-01〜2027-01-31）",
      "- 次の四半期：2027年Q1（2027年1月〜3月）",
      "ユーザーが指定した日付が基準日より過去の場合は、勝手に未来の日付へ置き換えず",
    ]) {
      expect(instruction).toContain(expected);
    }
    // The anchor is the last block of the instruction (recency position).
    expect(instruction.trimEnd().endsWith("日付には必ず西暦4桁を付ける（例：2027年1月15日）。")).toBe(true);
  });

  it("reaches the assembled routes 1-2 instruction through the answer quality policy", () => {
    const policy = resolveOriginAnswerQualityPolicy({ intent: intent(), taskType: "documentation", independentReviewRequired: false, promptText: ORIGIN_BUSINESS_PLANNING_BRIEFS[0].prompt });
    const assembled = originAnswerQualityInstruction(policy);
    expect(assembled).toContain("premise table first");
    expect(assembled).toContain("カレンダー基準");
  });

  it("carries the premise table, the current date, and the calendar anchor on the route-3 compact form, compressed (2026-11-18)", () => {
    // Diagnosis (BUSINESS_ANCHOR_DIAGNOSIS_2026-11-18): route 3 served
    // 14/14 measured briefs, so the earlier exclusion — the addendum
    // budget was pinned at 1,700 characters and already full — meant the
    // premise table appeared in 0/7 answers and BP-2 shipped ten past
    // dates as future deadlines. The compact form now carries all three
    // blocks, compressed; the same fixed "now" pins their exact text.
    const compact = buildOriginGroqBusinessPlanningInstruction(profile, fixedNow);
    // Premise table: provenance classes, formula-bearing basis, unit rule.
    expect(compact).toContain("Premise table first");
    expect(compact).toContain("指標 / 値 / 単位 / 対象期間 / 種別 / 根拠");
    for (const provenance of ["入力事実", "仮置き（仮定）", "計算結果", "未確定"]) {
      expect(compact).toContain(provenance);
    }
    expect(compact).toContain("numerator ÷ denominator");
    expect(compact).toContain("The body uses only these figures, unchanged");
    expect(compact).toContain("never 千円");
    // Current date: route 3's model is told today, with the as-of rule.
    expect(compact).toContain("今日の日付（Asia/Tokyo）は2026年11月17日です");
    expect(compact).toContain("（2026年11月17日時点）");
    // Compact calendar anchor: the same computed values as the full
    // table, minus the week range, closed by the two date-role rules.
    expect(compact).toContain("カレンダー基準");
    expect(compact).toContain("基準日：2026-11-17（火）");
    expect(compact).toContain("今月末：2026-11-30");
    expect(compact).toContain("来月：2026年12月（2026-12-01〜2026-12-31）");
    expect(compact).toContain("2ヶ月後：2027年1月（2027-01-01〜2027-01-31）");
    expect(compact).toContain("3ヶ月後：2027年2月（2027-02-01〜2027-02-28）");
    expect(compact).toContain("次の四半期：2027年Q1（1月〜3月）");
    expect(compact).toContain("予定・期限の日付は基準日以降とし、西暦4桁を付ける");
    expect(compact).not.toContain("今週：");
    // The anchor closes the addendum (recency position, as on routes 1-2).
    expect(compact.trimEnd().endsWith("過去である旨を明示する。")).toBe(true);
  });

  it("keeps each compressed route-3 block inside its measured budget", () => {
    const compact = buildOriginGroqBusinessPlanningInstruction(profile, fixedNow);
    const premiseLine = compact.split("\n").find((line) => line.includes("Premise table first"))!;
    expect(premiseLine.length).toBeLessThanOrEqual(300);
    const dateLine = compact.split("\n").find((line) => line.includes("今日の日付"))!;
    expect(dateLine.length).toBeLessThanOrEqual(120);
    const anchorLine = compact.split("\n").find((line) => line.includes("カレンダー基準"))!;
    expect(anchorLine.length).toBeLessThanOrEqual(320);
  });
});
