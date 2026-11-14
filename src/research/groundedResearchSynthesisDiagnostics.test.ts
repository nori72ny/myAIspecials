import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  adoptGroundedResearchSynthesis,
  diagnoseGroundedResearchSynthesisUnits,
  type GroundedResearchSynthesisAdoption,
} from "./groundedResearchSynthesisV12";

/**
 * Permanent fixtures for the synthesis unit diagnostics (counts only).
 *
 * Production measurement after the salvage shipped (2026-11-14) showed
 * discards where the salvage removed its maximum of three units and still
 * aborted with UNCITED_FACTUAL_UNIT, but the logs could not distinguish
 * "many uncited body sentences" from "source-list lines counted as units".
 * These fixtures pin the exact counts the discard / abort logs now record,
 * using the same sources and cited lines as the salvage fixtures.
 */

function source(partial: Partial<OriginResearchSource> & Pick<OriginResearchSource, "title" | "url" | "excerpt">): OriginResearchSource {
  return {
    sourceType: "web-search",
    domain: new URL(partial.url).hostname,
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "unclassified",
    ...partial,
  };
}

const priceSources: OriginResearchSource[] = [
  source({ title: "料金資料1", url: "https://example.com/one", excerpt: "料金は100円と記載されています。" }),
  source({ title: "料金資料2", url: "https://example.org/two", excerpt: "別資料では料金は120円と記載されています。" }),
];

const pmSources: OriginResearchSource[] = [
  source({
    title: "内閣総理大臣 高市 早苗（たかいち さなえ）｜高市内閣 閣僚等名簿｜首相官邸ホームページ",
    url: "https://www.kantei.go.jp/",
    excerpt: "内閣総理大臣 高市 早苗（たかいち さなえ）。",
    sourceAuthority: "official-domain-match",
  }),
  source({
    title: "内閣総理大臣 - Wikipedia",
    url: "https://ja.wikipedia.org/wiki/%E5%86%85%E9%96%A3%E7%B7%8F%E7%90%86%E5%A4%A7%E8%87%A3",
    excerpt: "内閣総理大臣は日本の行政の長である。",
    sourceAuthority: "secondary-reference",
  }),
];

const CITED_PRICE_LINE = "料金は100円です。[S1](https://example.com/one) [S2](https://example.org/two)";
const CITED_PRICE_LINE_2 = "別資料では料金は120円と記載されています。[S2](https://example.org/two)";
const CITED_PM_LINE = "首相官邸の閣僚名簿では、内閣総理大臣として高市早苗の名が掲載されています。[S1](https://www.kantei.go.jp/)";
const CITED_PM_LINE_2 = "内閣総理大臣は日本の行政の長です。[S2](https://ja.wikipedia.org/wiki/%E5%86%85%E9%96%A3%E7%B7%8F%E7%90%86%E5%A4%A7%E8%87%A3)";

function expectRejected(result: GroundedResearchSynthesisAdoption) {
  if (result.adopted === true) {
    throw new Error("expected rejection, got adoption");
  }
  return result;
}

describe("diagnoseGroundedResearchSynthesisUnits", () => {
  it("returns all zeros for an empty synthesis", () => {
    expect(diagnoseGroundedResearchSynthesisUnits("")).toEqual({
      totalFactualUnits: 0,
      citedUnits: 0,
      uncitedUnits: 0,
      uncitedUnitsWithUrlLike: 0,
    });
  });

  it("counts cited and uncited body units", () => {
    const text = [
      CITED_PRICE_LINE,
      CITED_PRICE_LINE_2,
      "この料金は大変お得です。",
      "申し込みは簡単です。",
    ].join("\n");
    expect(diagnoseGroundedResearchSynthesisUnits(text)).toEqual({
      totalFactualUnits: 4,
      citedUnits: 2,
      uncitedUnits: 2,
      uncitedUnitsWithUrlLike: 0,
    });
  });

  it("flags source-list-like uncited lines (domain in parentheses, bare URL line)", () => {
    const text = [
      CITED_PM_LINE,
      CITED_PM_LINE_2,
      "## 出典",
      "- 首相官邸ホームページ（www.kantei.go.jp）",
      "- https://ja.wikipedia.org/wiki/%E5%86%85%E9%96%A3%E7%B7%8F%E7%90%86%E5%A4%A7%E8%87%A3",
    ].join("\n");
    // The heading is not a unit. Both list lines are factual units to the
    // validator (no citation token), and both carry URL-like content.
    expect(diagnoseGroundedResearchSynthesisUnits(text)).toEqual({
      totalFactualUnits: 4,
      citedUnits: 2,
      uncitedUnits: 2,
      uncitedUnitsWithUrlLike: 2,
    });
  });

  it("flags a domain mentioned inside an uncited body sentence", () => {
    const text = [
      CITED_PRICE_LINE,
      "詳しくはexample-store.jpで確認できます。",
      CITED_PRICE_LINE_2,
    ].join("\n");
    expect(diagnoseGroundedResearchSynthesisUnits(text)).toEqual({
      totalFactualUnits: 3,
      citedUnits: 2,
      uncitedUnits: 1,
      uncitedUnitsWithUrlLike: 1,
    });
  });

  it("counts markdown table rows as uncited units (header, separator, data)", () => {
    const text = [
      CITED_PRICE_LINE,
      CITED_PRICE_LINE_2,
      "| プラン | 月額 |",
      "| --- | --- |",
      "| 基本プラン | 100円 |",
    ].join("\n");
    expect(diagnoseGroundedResearchSynthesisUnits(text)).toEqual({
      totalFactualUnits: 5,
      citedUnits: 2,
      uncitedUnits: 3,
      uncitedUnitsWithUrlLike: 0,
    });
  });

  it("agrees with the salvage: diagnostics count what adoption removes, and the adopted text has none left", () => {
    const input = [
      "現在の内閣総理大臣は高市早苗です。",
      CITED_PM_LINE,
      CITED_PM_LINE_2,
    ].join("\n");
    expect(diagnoseGroundedResearchSynthesisUnits(input)).toEqual({
      totalFactualUnits: 3,
      citedUnits: 2,
      uncitedUnits: 1,
      uncitedUnitsWithUrlLike: 0,
    });
    const result = adoptGroundedResearchSynthesis(input, pmSources);
    if (result.adopted === false) throw new Error("expected adoption");
    expect(result.removedUnits).toBe(1);
    expect(diagnoseGroundedResearchSynthesisUnits(result.text)).toEqual({
      totalFactualUnits: 2,
      citedUnits: 2,
      uncitedUnits: 0,
      uncitedUnitsWithUrlLike: 0,
    });
  });
});

describe("salvage abort remainingUncitedUnits", () => {
  it("reports the uncited units left when removals hit the cap (production shape: 5 uncited, 3 removed, 2 remain)", () => {
    const input = [
      CITED_PRICE_LINE,
      "この料金は大変お得です。",
      "申し込みは簡単です。",
      CITED_PRICE_LINE_2,
      "解約はいつでも可能です。",
      "サポート体制も充実しています。",
      "利用者の評判も良好です。",
    ].join("\n");
    expect(diagnoseGroundedResearchSynthesisUnits(input)).toEqual({
      totalFactualUnits: 7,
      citedUnits: 2,
      uncitedUnits: 5,
      uncitedUnitsWithUrlLike: 0,
    });
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.failureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(result.salvageAttempted).toBe(true);
    expect(result.salvageRemovedUnits).toBe(3);
    expect(result.salvageAbortCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(result.remainingUncitedUnits).toBe(2);
  });

  it("reports table rows as remaining when the salvage aborts on a table unit", () => {
    const input = [
      CITED_PRICE_LINE,
      "この料金は大変お得です。",
      "| プラン | 月額 |",
      "| --- | --- |",
      "| 基本プラン | 100円 |",
    ].join("\n");
    expect(diagnoseGroundedResearchSynthesisUnits(input)).toEqual({
      totalFactualUnits: 5,
      citedUnits: 1,
      uncitedUnits: 4,
      uncitedUnitsWithUrlLike: 0,
    });
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.failureCode).toBe("UNCITED_FACTUAL_UNIT");
    // Only the prose unit is removable; the three table rows stay behind.
    expect(result.salvageRemovedUnits).toBe(1);
    expect(result.salvageAbortCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(result.remainingUncitedUnits).toBe(3);
  });

  it("is absent when the salvage was never attempted (non-UNCITED first failure)", () => {
    const input = [
      CITED_PRICE_LINE,
      "料金は999円です。[S1](https://example.com/one) [S2](https://example.org/two)",
    ].join("\n");
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.failureCode).toBe("UNSUPPORTED_NUMERIC_TOKEN");
    expect(result.salvageAttempted).toBe(false);
    expect(result.remainingUncitedUnits).toBeUndefined();
  });
});
