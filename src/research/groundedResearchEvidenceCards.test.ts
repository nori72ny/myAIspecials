import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import { buildGroundedResearchSynthesisPrompt } from "./groundedResearchSynthesisV12";
import { buildGroundedResearchEvidenceCards } from "./groundedResearchEvidenceCards";

function makeSource(overrides: Partial<OriginResearchSource> = {}): OriginResearchSource {
  return {
    title: "参議院の定数について",
    url: "https://www.sangiin.go.jp/example",
    excerpt: "参議院は国会を構成する両院の一つです。選挙区と比例代表の仕組みがあります。参議院の定数は248人です。議員の任期は6年です。",
    sourceType: "web-search",
    domain: "www.sangiin.go.jp",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-17T00:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "official-domain-match",
    revisionTimestamp: "2026-09-24T08:00:00.000Z",
    ...overrides,
  };
}

describe("groundedResearchEvidenceCards (N-2a)", () => {
  it("builds one card per source, in order, with E ids aligned to the S order", () => {
    const sources = [
      makeSource(),
      makeSource({ title: "別の資料", url: "https://example.org/two", domain: "example.org", rank: 2 }),
      makeSource({ title: "三つ目の資料", url: "https://example.net/three", domain: "example.net", rank: 3 }),
    ];
    const { cards } = buildGroundedResearchEvidenceCards("参議院の定数は何人ですか？", sources);
    expect(cards.map((card) => card.evidenceId)).toEqual(["E1", "E2", "E3"]);
    expect(cards.map((card) => card.sourceIndex)).toEqual([0, 1, 2]);
    expect(cards.map((card) => card.title)).toEqual(["参議院の定数について", "別の資料", "三つ目の資料"]);
    expect(cards[0].url).toBe("https://www.sangiin.go.jp/example");
    expect(cards[0].domain).toBe("www.sangiin.go.jp");
  });

  it("derives the domain from the URL when absent, and falls back to unknown", () => {
    const derived = buildGroundedResearchEvidenceCards("質問", [
      makeSource({ domain: undefined, url: "https://example.org/some/path" }),
    ]).cards[0];
    expect(derived.domain).toBe("example.org");
    const unknown = buildGroundedResearchEvidenceCards("質問", [
      makeSource({ domain: undefined, url: "not a url" }),
    ]).cards[0];
    expect(unknown.domain).toBe("unknown");
  });

  it("keeps the excerpt identical to the synthesis packet's excerpt for the same source", () => {
    const longExcerpt = Array.from(
      { length: 30 },
      (_, i) => `資料${i + 1}には料金は100円と記載されています。`,
    ).join("");
    const source = makeSource({ excerpt: longExcerpt });
    const prompt = buildGroundedResearchSynthesisPrompt("現在の料金を比較してください", [source], [], "ja");
    const excerptJson = prompt.match(/excerpt_json: ("(?:[^"\\]|\\.)*")/);
    expect(excerptJson).not.toBeNull();
    const { cards } = buildGroundedResearchEvidenceCards("現在の料金を比較してください", [source]);
    expect(cards[0].excerpt).toBe(JSON.parse(excerptJson![1]));
    expect(cards[0].excerpt.length).toBeLessThanOrEqual(600);
  });

  it("selects the answer-bearing claim sentences verbatim, in original order, at most two", () => {
    const { cards } = buildGroundedResearchEvidenceCards("参議院の定数は何人ですか？", [makeSource()]);
    const card = cards[0];
    expect(card.claimSentences).toEqual([
      "参議院は国会を構成する両院の一つです。",
      "参議院の定数は248人です。",
    ]);
    for (const sentence of card.claimSentences) {
      expect(card.excerpt).toContain(sentence);
    }
  });

  it("lets question-vocabulary overlap outweigh the head-position bonus", () => {
    const source = makeSource({
      excerpt:
        "窓口は平日の午前9時から開いています。持ち物は事前に確認してください。受付は混雑することがあります。パスポートの申請には写真が必要です。",
    });
    const { cards } = buildGroundedResearchEvidenceCards("パスポートの申請に必要なものは？", [source]);
    expect(cards[0].claimSentences).toContain("パスポートの申請には写真が必要です。");
    expect(cards[0].claimSentences).toHaveLength(2);
    // Original order is preserved in the output.
    expect(cards[0].claimSentences[0]).toBe("窓口は平日の午前9時から開いています。");
  });

  it("returns the single sentence of a punctuation-less excerpt as the claim sentence", () => {
    const { cards } = buildGroundedResearchEvidenceCards("料金は？", [makeSource({ excerpt: "料金は100円" })]);
    expect(cards[0].claimSentences).toEqual(["料金は100円"]);
  });

  it("returns no claim sentences for an empty excerpt", () => {
    const { cards } = buildGroundedResearchEvidenceCards("質問", [makeSource({ excerpt: "" })]);
    expect(cards[0].excerpt).toBe("");
    expect(cards[0].claimSentences).toEqual([]);
  });

  it("never fabricates section hints, applicability signals, or support upgrades", () => {
    const { cards } = buildGroundedResearchEvidenceCards("参議院の定数は何人ですか？", [makeSource()]);
    expect(cards[0].sectionHint).toBe("");
    expect(cards[0].applicability).toEqual({ periodSignals: [], transitionalSignalTerms: [] });
    expect(cards[0].supportState).toBe("in-source");
  });

  it("carries the packet date forms for publication and retrieval dates", () => {
    const { cards } = buildGroundedResearchEvidenceCards("質問", [makeSource()]);
    expect(cards[0].publishedDateForms).toEqual(["2026-09-24", "2026年9月24日"]);
    expect(cards[0].retrievedDateForms).toEqual(["2026-11-17", "2026年11月17日"]);
    const undated = buildGroundedResearchEvidenceCards("質問", [
      makeSource({ revisionTimestamp: undefined }),
    ]).cards[0];
    expect(undated.publishedDateForms).toEqual([]);
  });

  it("reports term coverage per card and lists uncovered terms", () => {
    const sources = [
      makeSource(),
      makeSource({
        title: "別の資料",
        url: "https://example.org/two",
        domain: "example.org",
        excerpt: "全く関係のない内容です。天気の話だけが書かれています。",
      }),
    ];
    const { coverage } = buildGroundedResearchEvidenceCards("参議院の定数は何人ですか？", sources);
    const sangiin = coverage.entries.find((entry) => entry.kind === "term" && entry.term === "参議院");
    expect(sangiin?.coveredByEvidenceIds).toEqual(["E1"]);
    const numericDemand = coverage.entries.find(
      (entry) => entry.kind === "numeric-demand" && entry.term === "何人",
    );
    expect(numericDemand?.coveredByEvidenceIds).toEqual(["E1"]);

    const uncovered = buildGroundedResearchEvidenceCards("パスポートの更新について教えて", sources).coverage;
    expect(uncovered.uncoveredTerms).toContain("パスポート");
  });

  it("covers a date demand only when a card carries a date expression", () => {
    const dated = makeSource({ excerpt: "この制度は2026年4月1日から施行されます。対象は住民全員です。" });
    const { coverage } = buildGroundedResearchEvidenceCards("その制度はいつから施行されますか？", [dated]);
    const entry = coverage.entries.find((e) => e.kind === "date-demand" && e.term === "いつ");
    expect(entry?.coveredByEvidenceIds).toEqual(["E1"]);

    const undated = makeSource({ excerpt: "この制度は来春から施行されます。対象は住民全員です。" });
    const missing = buildGroundedResearchEvidenceCards("その制度はいつから施行されますか？", [undated]).coverage;
    const missingEntry = missing.entries.find((e) => e.kind === "date-demand" && e.term === "いつ");
    expect(missingEntry?.coveredByEvidenceIds).toEqual([]);
    expect(missing.uncoveredTerms).toContain("いつ");
  });

  it("leaves a numeric demand uncovered when no card carries any number", () => {
    const source = makeSource({ excerpt: "料金は窓口で確認してください。受付で案内します。" });
    const { coverage } = buildGroundedResearchEvidenceCards("料金はいくらですか？", [source]);
    const entry = coverage.entries.find((e) => e.kind === "numeric-demand" && e.term === "いくら");
    expect(entry?.coveredByEvidenceIds).toEqual([]);
    expect(coverage.uncoveredTerms).toContain("いくら");
  });

  it("is deterministic and does not mutate its inputs", () => {
    const sources = [makeSource(), makeSource({ title: "別の資料", rank: 2 })];
    const snapshot = JSON.stringify(sources);
    const first = buildGroundedResearchEvidenceCards("参議院の定数は何人ですか？", sources);
    const second = buildGroundedResearchEvidenceCards("参議院の定数は何人ですか？", sources);
    expect(second).toEqual(first);
    expect(JSON.stringify(sources)).toBe(snapshot);
  });

  it("handles an empty source column", () => {
    const result = buildGroundedResearchEvidenceCards("参議院の定数は何人ですか？", []);
    expect(result.cards).toEqual([]);
    // Terms and demands are still reported, all uncovered.
    expect(result.coverage.entries.length).toBeGreaterThan(0);
    expect(result.coverage.entries.every((entry) => entry.coveredByEvidenceIds.length === 0)).toBe(true);
  });
});
