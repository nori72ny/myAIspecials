import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  adoptGroundedResearchSynthesis,
  buildGroundedResearchSynthesisInstruction,
  validateGroundedResearchSynthesis,
  type GroundedResearchSynthesisAdoption,
} from "./groundedResearchSynthesisV12";

/**
 * Permanent fixtures for the UNCITED_FACTUAL_UNIT salvage
 * (SYNTHESIS_SALVAGE_DESIGN_2026-11-14 §6, cases S1–S16) and for the
 * coverage instruction structure (§5 option 1). The validator itself is
 * unchanged; every salvaged text below is adopted only because the
 * unchanged validator accepts it after line deletions.
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
const CITED_PRICE_LINE_3 = "料金は100円と120円の2種類です。[S1](https://example.com/one) [S2](https://example.org/two)";

function expectAdopted(result: GroundedResearchSynthesisAdoption) {
  if (result.adopted === false) {
    throw new Error(`expected adoption, got failure ${result.failureCode}`);
  }
  return result;
}

function expectRejected(result: GroundedResearchSynthesisAdoption) {
  if (result.adopted === true) {
    throw new Error("expected rejection, got adoption");
  }
  return result;
}

describe("adoptGroundedResearchSynthesis (synthesis salvage)", () => {
  it("passes a first-pass-valid synthesis through untouched (no salvage)", () => {
    const text = [CITED_PRICE_LINE, CITED_PRICE_LINE_2].join("\n");
    const result = expectAdopted(adoptGroundedResearchSynthesis(text, priceSources));
    expect(result.salvaged).toBe(false);
    expect(result.removedUnits).toBe(0);
    expect(result.text).toBe(text);
    expect(result.usedSourceIds).toEqual(["S1", "S2"]);
  });

  it("S1: salvages the production pattern A — only the lead unit is uncited (repro case 1)", () => {
    const input = [
      "現在の内閣総理大臣は高市早苗です。",
      "首相官邸の閣僚名簿では、内閣総理大臣として高市早苗の名が掲載されています。[S1](https://www.kantei.go.jp/)",
      "内閣総理大臣は日本の行政の長です。[S2](https://ja.wikipedia.org/wiki/%E5%86%85%E9%96%A3%E7%B7%8F%E7%90%86%E5%A4%A7%E8%87%A3)",
    ].join("\n");
    expect(validateGroundedResearchSynthesis(input, pmSources)).toEqual(
      expect.objectContaining({ ok: false, code: "UNCITED_FACTUAL_UNIT" }),
    );
    const result = expectAdopted(adoptGroundedResearchSynthesis(input, pmSources));
    expect(result.salvaged).toBe(true);
    expect(result.removedUnits).toBe(1);
    expect(result.usedSourceIds).toEqual(["S1", "S2"]);
    // Byte-exact: the salvaged text is the input minus the one uncited line.
    expect(result.text).toBe(input.split("\n").slice(1).join("\n"));
  });

  it("S2: salvages a single uncited unit in the middle", () => {
    const input = [CITED_PRICE_LINE, "この料金は大変お得です。", CITED_PRICE_LINE_2].join("\n");
    const result = expectAdopted(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.salvaged).toBe(true);
    expect(result.removedUnits).toBe(1);
    expect(result.text).toBe([CITED_PRICE_LINE, CITED_PRICE_LINE_2].join("\n"));
  });

  it("S3: salvages two and three uncited units within the limits", () => {
    const two = [
      CITED_PRICE_LINE,
      "この料金は大変お得です。",
      CITED_PRICE_LINE_2,
      "申し込みは簡単です。",
      CITED_PRICE_LINE_3,
    ].join("\n");
    const resultTwo = expectAdopted(adoptGroundedResearchSynthesis(two, priceSources));
    expect(resultTwo.removedUnits).toBe(2);
    expect(resultTwo.text).toBe([CITED_PRICE_LINE, CITED_PRICE_LINE_2, CITED_PRICE_LINE_3].join("\n"));

    const three = [
      CITED_PRICE_LINE,
      "この料金は大変お得です。",
      CITED_PRICE_LINE_2,
      "申し込みは簡単です。",
      CITED_PRICE_LINE_3,
      "解約はいつでも可能です。",
      "詳細は資料をご確認ください。[S1](https://example.com/one)",
    ].join("\n");
    const resultThree = expectAdopted(adoptGroundedResearchSynthesis(three, priceSources));
    expect(resultThree.removedUnits).toBe(3);
    expect(resultThree.text).toBe(
      [CITED_PRICE_LINE, CITED_PRICE_LINE_2, CITED_PRICE_LINE_3, "詳細は資料をご確認ください。[S1](https://example.com/one)"].join("\n"),
    );
  });

  it("S4: aborts when uncited units exceed MAX_REMOVE, keeping the first failure code", () => {
    const input = [
      CITED_PRICE_LINE,
      "この料金は大変お得です。",
      CITED_PRICE_LINE_2,
      "申し込みは簡単です。",
      CITED_PRICE_LINE_3,
      "解約はいつでも可能です。",
      "サポートも充実しています。",
    ].join("\n");
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.failureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(result.salvageAttempted).toBe(true);
    expect(result.salvageRemovedUnits).toBe(3);
    expect(result.salvageAbortCode).toBe("UNCITED_FACTUAL_UNIT");
  });

  it("S4 (ratio cap): aborts when removals would exceed half of all units, below MAX_REMOVE", () => {
    const input = [
      CITED_PRICE_LINE,
      "この料金は大変お得です。",
      "申し込みは簡単です。",
      "解約はいつでも可能です。",
    ].join("\n");
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.failureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(result.salvageAttempted).toBe(true);
    // 4 units total: two removals are exactly half; the third would exceed it.
    expect(result.salvageRemovedUnits).toBe(2);
  });

  it("S5: an all-uncited text never reaches salvage (coverage fails first) and is rejected", () => {
    // Validator order (§1.1): source coverage is checked before the unit
    // loop, so a text citing nothing is INSUFFICIENT_SOURCE_COVERAGE and
    // the salvage — defined for UNCITED_FACTUAL_UNIT only — is not attempted.
    const input = ["料金は100円です。", "この料金は大変お得です。", "申し込みは簡単です。"].join("\n");
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.failureCode).toBe("INSUFFICIENT_SOURCE_COVERAGE");
    expect(result.salvageAttempted).toBe(false);
    expect(result.salvageRemovedUnits).toBe(0);
  });

  it("S5 (companion): salvage cannot empty the text — the half cap stops removal", () => {
    const input = [
      "この料金は大変お得です。",
      "申し込みは簡単です。",
      CITED_PRICE_LINE,
    ].join("\n");
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.failureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(result.salvageAttempted).toBe(true);
    expect(result.salvageRemovedUnits).toBe(1);
  });

  it("S6: aborts when removing the uncited unit unmasks an unsupported numeric token (repro case 6)", () => {
    const input = [
      CITED_PRICE_LINE,
      "この料金は大変お得です。",
      "合計は999円になります。[S1](https://example.com/one)",
    ].join("\n");
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    // The recorded failure code stays the FIRST validation code (§3.7);
    // the code that stopped the salvage is reported separately.
    expect(result.failureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(result.salvageAttempted).toBe(true);
    expect(result.salvageRemovedUnits).toBe(1);
    expect(result.salvageAbortCode).toBe("UNSUPPORTED_NUMERIC_TOKEN");
  });

  it("S7: removes the orphaned heading of a section emptied by a removal", () => {
    const kept = [
      "## 根拠",
      "首相官邸の閣僚名簿では、内閣総理大臣として高市早苗の名が掲載されています。[S1](https://www.kantei.go.jp/)",
      "内閣総理大臣は日本の行政の長です。[S2](https://ja.wikipedia.org/wiki/%E5%86%85%E9%96%A3%E7%B7%8F%E7%90%86%E5%A4%A7%E8%87%A3)",
    ];
    const input = ["## 結論", "現在の内閣総理大臣は高市早苗です。", ...kept].join("\n");
    const result = expectAdopted(adoptGroundedResearchSynthesis(input, pmSources));
    expect(result.salvaged).toBe(true);
    expect(result.removedUnits).toBe(1);
    expect(result.text).toBe(kept.join("\n"));
    expect(result.text).not.toContain("## 結論");
  });

  it("S8: never removes a unit inside a markdown table block (repro case 9)", () => {
    const input = [
      CITED_PRICE_LINE,
      "",
      "| 項目 | 料金 |",
      "| --- | --- |",
      "| 基本 | 100円 [S1](https://example.com/one) |",
    ].join("\n");
    expect(validateGroundedResearchSynthesis(input, priceSources)).toEqual(
      expect.objectContaining({ ok: false, code: "UNCITED_FACTUAL_UNIT" }),
    );
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.failureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(result.salvageAttempted).toBe(true);
    expect(result.salvageRemovedUnits).toBe(0);
  });

  it("S9: aborts when a surviving unit back-references the removed content", () => {
    const input = [
      "基本料金は100円です。[S1](https://example.com/one) [S2](https://example.org/two)",
      "この割引条件は期間限定です。",
      "割引条件は上記のとおりです。[S1](https://example.com/one)",
    ].join("\n");
    const result = expectRejected(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.failureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(result.salvageAttempted).toBe(true);
    expect(result.salvageRemovedUnits).toBe(1);
    expect(result.salvageAbortCode).toBe("UNCITED_FACTUAL_UNIT");
  });

  it("S10: never attempts salvage for UNKNOWN_CITATION or MISMATCHED_CITATION_URL", () => {
    const unknown = expectRejected(adoptGroundedResearchSynthesis(
      "料金は100円です。[S1](https://example.com/one) [S9](https://example.net/fake)",
      priceSources,
    ));
    expect(unknown.failureCode).toBe("UNKNOWN_CITATION");
    expect(unknown.salvageAttempted).toBe(false);

    const mismatched = expectRejected(adoptGroundedResearchSynthesis(
      "料金情報を確認しました。[S1](https://example.org/two) [S2](https://example.org/two)",
      priceSources,
    ));
    expect(mismatched.failureCode).toBe("MISMATCHED_CITATION_URL");
    expect(mismatched.salvageAttempted).toBe(false);
  });

  it("S11: never attempts salvage for INSUFFICIENT_SOURCE_COVERAGE (repro case 4)", () => {
    const pixelSources: OriginResearchSource[] = [
      source({ title: "Google Pixel 10 価格", url: "https://store.example.jp/pixel10", excerpt: "Google Pixel 10 の価格は 128,800円 です。" }),
      source({ title: "Pixel 10 発売日", url: "https://news.example.jp/pixel10", excerpt: "Pixel 10 は2025年8月28日に発売されました。" }),
      source({ title: "Pixel 10 レビュー", url: "https://review.example.jp/pixel10", excerpt: "Pixel 10 のカメラ性能をレビューします。" }),
      source({ title: "Pixel 10 スペック", url: "https://spec.example.jp/pixel10", excerpt: "Pixel 10 は Tensor チップを搭載します。" }),
      source({ title: "Pixel 10 キャンペーン", url: "https://campaign.example.jp/pixel10", excerpt: "Pixel 10 の発売記念キャンペーンを実施中です。" }),
    ];
    const result = expectRejected(adoptGroundedResearchSynthesis(
      "Google Pixel 10 の価格は128,800円です。[S1](https://store.example.jp/pixel10)",
      pixelSources,
    ));
    expect(result.failureCode).toBe("INSUFFICIENT_SOURCE_COVERAGE");
    expect(result.salvageAttempted).toBe(false);
  });

  it("S12: byte preservation — the salvaged text differs from the input only by deleted lines", () => {
    const input = [
      "## 結論",
      "",
      CITED_PRICE_LINE,
      "",
      "- 1つ目の資料は100円としています。[S1](https://example.com/one)",
      "- 補足の説明文です。",
      "1. 2つ目の資料は120円としています。[S2](https://example.org/two)",
      "2. もう1つの補足文です。",
    ].join("\n");
    const result = expectAdopted(adoptGroundedResearchSynthesis(input, priceSources));
    expect(result.removedUnits).toBe(2);
    const expected = input
      .split("\n")
      .filter((line) => line !== "- 補足の説明文です。" && line !== "2. もう1つの補足文です。")
      .join("\n");
    expect(result.text).toBe(expected);
  });

  it("S13: salvage coexists with a full source list; the cited set is unchanged by removal", () => {
    const threeSources: OriginResearchSource[] = [
      ...priceSources,
      source({ title: "参考資料3", url: "https://example.net/three", excerpt: "参考価格は555円です。" }),
    ];
    const sourceList = [
      "出典",
      "- example.com [S1](https://example.com/one)",
      "- example.org [S2](https://example.org/two)",
      "- example.net [S3](https://example.net/three)",
    ];
    const input = [
      "この料金は大変お得です。",
      "料金は100円と120円で資料により異なります。[S1](https://example.com/one) [S2](https://example.org/two)",
      "",
      ...sourceList,
    ].join("\n");
    const result = expectAdopted(adoptGroundedResearchSynthesis(input, threeSources));
    expect(result.removedUnits).toBe(1);
    expect(result.usedSourceIds).toEqual(["S1", "S2", "S3"]);
    for (const line of sourceList) expect(result.text).toContain(line);
    expect(result.text).not.toContain("この料金は大変お得です。");
  });

  it("migrated repro case 10: a non-exempt source-list label line is removable", () => {
    const input = [
      "現在の内閣総理大臣は高市早苗です。[S1](https://www.kantei.go.jp/) [S2](https://ja.wikipedia.org/wiki/%E5%86%85%E9%96%A3%E7%B7%8F%E7%90%86%E5%A4%A7%E8%87%A3)",
      "",
      "出典一覧：",
      "- 首相官邸ホームページ [S1](https://www.kantei.go.jp/)",
    ].join("\n");
    const result = expectAdopted(adoptGroundedResearchSynthesis(input, pmSources));
    expect(result.removedUnits).toBe(1);
    expect(result.text).not.toContain("出典一覧：");
    expect(result.text).toContain("- 首相官邸ホームページ [S1](https://www.kantei.go.jp/)");
  });

  it("S16: English fixtures behave identically (S1 and S6 patterns, exempt labels)", () => {
    const enSources: OriginResearchSource[] = [
      source({ title: "Official cabinet list", url: "https://example.com/one", excerpt: "The official cabinet list names Sanae Takaichi as prime minister." }),
      source({ title: "Prime minister reference", url: "https://example.org/two", excerpt: "The prime minister is the head of the executive branch." }),
    ];
    const enAnswer = [
      "The current prime minister is Sanae Takaichi.",
      "The official cabinet list names Sanae Takaichi as prime minister. [S1](https://example.com/one)",
      "The prime minister is the head of the executive branch. [S2](https://example.org/two)",
      "",
      "Sources",
      "- example.com [S1](https://example.com/one)",
      "- example.org [S2](https://example.org/two)",
    ].join("\n");
    const salvaged = expectAdopted(adoptGroundedResearchSynthesis(enAnswer, enSources));
    expect(salvaged.removedUnits).toBe(1);
    expect(salvaged.text).not.toContain("The current prime minister is Sanae Takaichi.");
    // The exempt "Sources" label line and the cited list lines survive.
    expect(salvaged.text).toContain("Sources");
    expect(salvaged.text).toContain("- example.org [S2](https://example.org/two)");

    const enPriceSources: OriginResearchSource[] = [
      source({ title: "Fee source one", url: "https://example.com/one", excerpt: "The fee is 100 yen." }),
      source({ title: "Fee source two", url: "https://example.org/two", excerpt: "Another source lists the fee as 120 yen." }),
    ];
    const enMasked = [
      "The fee is 100 yen. [S1](https://example.com/one) [S2](https://example.org/two)",
      "This fee is a great deal.",
      "The total comes to 999 yen. [S1](https://example.com/one)",
    ].join("\n");
    const aborted = expectRejected(adoptGroundedResearchSynthesis(enMasked, enPriceSources));
    expect(aborted.failureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(aborted.salvageAttempted).toBe(true);
    expect(aborted.salvageRemovedUnits).toBe(1);
    expect(aborted.salvageAbortCode).toBe("UNSUPPORTED_NUMERIC_TOKEN");
  });
});

describe("synthesis instruction structure (§5 option 1: coverage by construction)", () => {
  it("requires the source list to enumerate every packet source with its citation token", () => {
    const ja = buildGroundedResearchSynthesisInstruction("ja");
    expect(ja).toContain("パケット内の全出典を1行に1出典ずつ漏れなく列挙");
    expect(ja).toContain("本文で引用しなかった出典も");
    const en = buildGroundedResearchSynthesisInstruction("en");
    expect(en).toContain("enumerates every source in the evidence packet");
    expect(en).toContain("including sources you did not cite in the body");
  });

  it("prescribes the conclusion / evidence / source-list section structure with per-section citation duties", () => {
    const ja = buildGroundedResearchSynthesisInstruction("ja");
    expect(ja).toContain("回答は3つの節で構成");
    expect(ja).toContain("結論と根拠の節では、事実を述べるすべての行に引用を付けてください");
    const en = buildGroundedResearchSynthesisInstruction("en");
    expect(en).toContain("three sections");
    expect(en).toContain("Every factual line in the conclusion and evidence sections must carry its citation(s)");
  });
});
