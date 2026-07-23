import { describe, expect, it } from "vitest";
import { extractExplicitOriginClaimCitations } from "./OriginClaimCitation";

describe("extractExplicitOriginClaimCitations", () => {
  it("links only an explicitly marked statement to its public HTTPS source", () => {
    expect(extractExplicitOriginClaimCitations(
      "公式資料では無料枠があります。〔出典: [料金資料](https://docs.example.com/pricing)〕",
    )).toEqual([{
      label: "料金資料",
      sourceUrl: "https://docs.example.com/pricing",
      claim: "公式資料では無料枠があります。",
      claimBinding: "explicit-inline-citation",
      evidenceLevel: "provided",
      checks: {
        safeUrl: "passed",
        content: "not-run",
        freshness: "not-run",
        claimSupport: "not-run",
      },
    }]);
  });

  it("supports Japanese full-width and English citation markers", () => {
    const result = extractExplicitOriginClaimCitations([
      "日本語の主張です。〔出典： [日本語資料](https://ja.example.com/source)〕",
      "This is an English claim. 〔Source: [English source](https://en.example.com/source)〕",
    ].join("\n"));

    expect(result.map((item) => item.claim)).toEqual([
      "日本語の主張です。",
      "This is an English claim.",
    ]);
  });

  it("removes a Markdown list prefix without rewriting the claim meaning", () => {
    expect(extractExplicitOriginClaimCitations(
      "- 対象機能は準備中です。〔出典: [仕様](https://docs.example.com/status)〕",
    )[0]?.claim).toBe("対象機能は準備中です。");
  });

  it.each([
    "〔出典: [資料](https://docs.example.com/source)〕",
    "主張です。 [資料](https://docs.example.com/source)",
    "主張です。〔出典: [資料](https://docs.example.com/source)〕 追加文",
    "主張です。〔出典: [資料](https://127.0.0.1/source)〕",
    "主張です。〔出典: [資料](https://docs.example.com/source?api_key=synthetic)〕",
    "Authorization: Bearer synthetic_claim_secret_123456〔出典: [資料](https://docs.example.com/source)〕",
  ])("does not infer a claim from invalid or non-explicit text: %s", (content) => {
    expect(extractExplicitOriginClaimCitations(content)).toEqual([]);
  });

  it("keeps separate claims for the same source and removes exact duplicates", () => {
    const first = "主張Aです。〔出典: [資料](https://docs.example.com/source)〕";
    const second = "主張Bです。〔出典: [資料](https://docs.example.com/source)〕";
    const result = extractExplicitOriginClaimCitations([first, first, second].join("\n"));

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.claim)).toEqual(["主張Aです。", "主張Bです。"]);
  });

  it("caps explicit mappings without scanning an unbounded result set", () => {
    const content = Array.from(
      { length: 20 },
      (_, index) => `主張${index}です。〔出典: [資料${index}](https://docs.example.com/${index})〕`,
    ).join("\n");

    expect(extractExplicitOriginClaimCitations(content)).toHaveLength(10);
  });
});
