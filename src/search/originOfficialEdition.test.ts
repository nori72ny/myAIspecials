import { describe, expect, it } from "vitest";
import {
  expectedLatestOriginOfficialEdition,
  originOfficialEditionQueryTerms,
  originSourcePeriodAnnotation,
  parseOriginOfficialEdition,
} from "./originOfficialEdition.js";
import {
  assessOfficialMaterialInsufficiency,
  buildOfficialRetryQueryText,
  buildOfficialSourceQueryText,
  planOriginOfficialSourceQueries,
  type OfficialMaterialSourceShape,
} from "./originOfficialSourceRouting.js";

// The round-8 verification day: Thursday 2026-11-26, midday JST.
const NOW = Date.parse("2026-11-26T03:00:00.000Z");

describe("parseOriginOfficialEdition", () => {
  it("reads monthly editions in both notations", () => {
    expect(parseOriginOfficialEdition("一般職業紹介状況（令和8年9月分）を公表しました 厚生労働省"))
      .toMatchObject({ year: 2026, month: 9, label: "令和8年9月分", sortKey: 202609 });
    expect(parseOriginOfficialEdition("労働力調査（基本集計）2026年9月分 結果の概要 総務省統計局"))
      .toMatchObject({ year: 2026, month: 9, label: "2026年9月分", sortKey: 202609 });
  });

  it("resolves the composite 令和7年12月分及び令和7年分 title to its monthly part", () => {
    expect(parseOriginOfficialEdition("一般職業紹介状況（令和7年12月分及び令和7年分）"))
      .toMatchObject({ year: 2025, month: 12, sortKey: 202512 });
  });

  it("reads quarterly editions", () => {
    expect(parseOriginOfficialEdition("四半期別GDP速報（2026年7-9月期）1次速報値"))
      .toMatchObject({ year: 2026, month: 9, quarter: 3, sortKey: 202609 });
    expect(parseOriginOfficialEdition("令和8年7-9月期 GDP速報"))
      .toMatchObject({ year: 2026, month: 9, quarter: 3 });
  });

  it("reads the population estimate's reference date as its edition", () => {
    expect(parseOriginOfficialEdition("人口推計（令和8年11月1日現在）"))
      .toMatchObject({ year: 2026, month: 11, sortKey: 202611 });
    expect(parseOriginOfficialEdition("人口推計 -2026年11月1日現在-"))
      .toMatchObject({ year: 2026, month: 11, sortKey: 202611 });
  });

  it("returns null when the title states no edition", () => {
    expect(parseOriginOfficialEdition("内閣総理大臣のプロフィール")).toBeNull();
    // An annual edition alone is not a monthly currency signal.
    expect(parseOriginOfficialEdition("一般職業紹介状況 令和7年分 結果")).toBeNull();
    expect(parseOriginOfficialEdition("")).toBeNull();
  });
});

describe("expectedLatestOriginOfficialEdition — from the publisher's schedule, clock fixed", () => {
  it("monthly, lag 2: at 2026-11-26 the edition that must exist is 2026年9月分", () => {
    const expected = expectedLatestOriginOfficialEdition({ cycle: "monthly", lagMonths: 2 }, NOW);
    expect(expected).toMatchObject({ year: 2026, month: 9, label: "令和8年9月分", sortKey: 202609 });
  });

  it("monthly, lag 2: the bound holds on the 1st of a month too (2026-12-01 → 2026年10月分)", () => {
    const dec1 = Date.parse("2026-11-30T15:00:00.000Z"); // 2026-12-01 00:00 JST
    expect(expectedLatestOriginOfficialEdition({ cycle: "monthly", lagMonths: 2 }, dec1))
      .toMatchObject({ year: 2026, month: 10, sortKey: 202610 });
  });

  it("quarterly, 45 days: at 2026-11-26 the Q3 preliminary (published Nov 16) must exist", () => {
    const expected = expectedLatestOriginOfficialEdition(
      { cycle: "quarterly", lagDaysAfterPeriodEnd: 45 }, NOW,
    );
    expect(expected).toMatchObject({ year: 2026, month: 9, quarter: 3, label: "2026年7-9月期" });
  });

  it("quarterly, 45 days: on 2026-11-10 the Q3 preliminary does not exist yet — Q2 is the bound", () => {
    const nov10 = Date.parse("2026-11-10T03:00:00.000Z");
    expect(expectedLatestOriginOfficialEdition(
      { cycle: "quarterly", lagDaysAfterPeriodEnd: 45 }, nov10,
    )).toMatchObject({ year: 2026, month: 6, quarter: 2, label: "2026年4-6月期" });
  });

  it("query terms name the edition in both notations", () => {
    const monthly = expectedLatestOriginOfficialEdition({ cycle: "monthly", lagMonths: 2 }, NOW);
    expect(monthly && originOfficialEditionQueryTerms(monthly)).toEqual(["令和8年9月分", "2026年9月分"]);
    const quarterly = expectedLatestOriginOfficialEdition(
      { cycle: "quarterly", lagDaysAfterPeriodEnd: 45 }, NOW,
    );
    expect(quarterly && originOfficialEditionQueryTerms(quarterly))
      .toEqual(["2026年7-9月期", "令和8年7-9月期"]);
  });
});

describe("plan + query text — edition targeting (measure 2a)", () => {
  it("the F-05 plan at 2026-11-26 carries the expected 令和8年9月分 edition", () => {
    const plan = planOriginOfficialSourceQueries(
      "最新の有効求人倍率を教えてください。いつの分ですか？", NOW,
    );
    expect(plan?.queries[0]?.topic).toBe("employment-and-pension");
    expect(plan?.queries[0]?.expectedEdition).toMatchObject({ year: 2026, month: 9, sortKey: 202609 });
    expect(plan?.queries[0]?.editionTerms).toEqual(["令和8年9月分", "2026年9月分"]);
  });

  it("without a clock the plan carries no edition (unchanged legacy shape)", () => {
    const plan = planOriginOfficialSourceQueries("最新の有効求人倍率を教えてください。いつの分ですか？");
    expect(plan?.queries[0]?.expectedEdition).toBeUndefined();
    expect(plan?.queries[0]?.editionTerms).toBeUndefined();
  });

  it("the official query text appends the edition terms after the release name", () => {
    expect(buildOfficialSourceQueryText(
      "最新の有効求人倍率 いつの分", "一般職業紹介状況", ["令和8年9月分", "2026年9月分"],
    )).toBe("最新の有効求人倍率 いつの分 一般職業紹介状況 令和8年9月分 2026年9月分");
  });

  it("the stale-edition retry text names the release and the edition; other retries stay bare", () => {
    expect(buildOfficialRetryQueryText("一般職業紹介状況", ["令和8年9月分", "2026年9月分"]))
      .toBe("一般職業紹介状況 令和8年9月分 2026年9月分");
    expect(buildOfficialRetryQueryText("一般職業紹介状況")).toBe("一般職業紹介状況");
  });
});

describe("assessOfficialMaterialInsufficiency — stale-edition (measure 2c)", () => {
  const expected = expectedLatestOriginOfficialEdition({ cycle: "monthly", lagMonths: 2 }, NOW);
  const official = (title: string, excerpt: string): OfficialMaterialSourceShape => ({
    title,
    url: "https://www.mhlw.go.jp/stf/newdata/example.html",
    excerpt,
    domain: "mhlw.go.jp",
    authorityTier: "official",
  });

  it("a value from an old edition only is insufficient: stale-edition", () => {
    // The production F-05 shape: the newest adopted MHLW page was a
    // stale edition (in production, editions as old as 令和3年7月分
    // and 令和7年12月分 ranked first on successive probes).
    const assessment = assessOfficialMaterialInsufficiency([
      official("一般職業紹介状況（令和7年12月分）を公表しました", "全国の有効求人倍率は1.18倍でした。"),
    ], { expectedEdition: expected });
    expect(assessment.sufficient).toBe(false);
    expect(assessment.reason).toBe("stale-edition");
    expect(assessment.nationalOfficialValueCount).toBe(1);
  });

  it("a value from the expected edition is sufficient", () => {
    const assessment = assessOfficialMaterialInsufficiency([
      official("一般職業紹介状況（令和8年9月分）を公表しました", "全国の有効求人倍率は1.19倍でした。"),
    ], { expectedEdition: expected });
    expect(assessment.sufficient).toBe(true);
  });

  it("a value from a NEWER edition than the bound is sufficient (the bound is a floor)", () => {
    const assessment = assessOfficialMaterialInsufficiency([
      official("一般職業紹介状況（令和8年10月分）を公表しました", "全国の有効求人倍率は1.19倍でした。"),
    ], { expectedEdition: expected });
    expect(assessment.sufficient).toBe(true);
  });

  it("no stale judgement when no adopted official source states an edition", () => {
    const assessment = assessOfficialMaterialInsufficiency([
      official("一般職業紹介状況を公表しました", "全国の有効求人倍率は1.19倍でした。"),
    ], { expectedEdition: expected });
    expect(assessment.sufficient).toBe(true);
  });

  it("no stale judgement without an expected edition (pre-measure behaviour)", () => {
    const assessment = assessOfficialMaterialInsufficiency([
      official("一般職業紹介状況（令和7年12月分）を公表しました", "全国の有効求人倍率は1.18倍でした。"),
    ]);
    expect(assessment.sufficient).toBe(true);
  });

  it("the earlier shapes keep precedence: no values at all is no-numeric-span, not stale-edition", () => {
    const assessment = assessOfficialMaterialInsufficiency([
      official("一般職業紹介状況（令和7年12月分）を公表しました", "公表資料の一覧ページです。"),
    ], { expectedEdition: expected });
    expect(assessment.reason).toBe("no-numeric-span");
  });
});

describe("originSourcePeriodAnnotation — measure E material expansion", () => {
  it("an official statistics page is annotated by its EDITION, not its page date", () => {
    expect(originSourcePeriodAnnotation(
      { title: "一般職業紹介状況（令和8年9月分）を公表しました", revisionTimestamp: "2026-10-30" },
      "ja",
    )).toBe("（対象：令和8年9月分）");
  });

  it("a source with no edition keeps the measure-E date annotation", () => {
    expect(originSourcePeriodAnnotation(
      { title: "新型スマートフォン Vega X1 発表", revisionTimestamp: "2026-09-15T00:00:00.000Z" },
      "ja",
    )).toBe("（出典の日付：2026年9月15日）");
    expect(originSourcePeriodAnnotation(
      { title: "Vega X1 launch", revisionTimestamp: "2026-09-15" }, "en",
    )).toBe("(source date: 2026-09-15)");
  });

  it("English edition annotation", () => {
    expect(originSourcePeriodAnnotation(
      { title: "一般職業紹介状況（令和8年9月分）" }, "en",
    )).toBe("(reference period: September 2026)");
  });

  it("a source stating neither gets no annotation", () => {
    expect(originSourcePeriodAnnotation({ title: "日付のないページ" }, "ja")).toBe("");
  });
});
