import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  buildGroundedResearchEvidencePacket,
  extractPacketQuestionKeys,
  splitRecoverySentences,
} from "./groundedResearchEvidencePacket";

function source(partial: Partial<OriginResearchSource>): OriginResearchSource {
  return {
    title: "資料",
    url: "https://example.com/source",
    excerpt: "",
    sourceType: "web-search",
    domain: "example.com",
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
    ...partial,
  };
}

describe("splitRecoverySentences", () => {
  it("keeps a decimal intact instead of cutting it into fragments", () => {
    // Round 5, F-03: the shared splitter cut "1.0%" into "1." and
    // "0%…", so the 1.25% fact could never be quoted whole.
    expect(
      splitRecoverySentences(
        "2026年6月に政策金利を1.0％に引き上げた。2026年9月に政策金利を1.00％から1.25％へ引き上げた。",
      ),
    ).toEqual([
      "2026年6月に政策金利を1.0％に引き上げた。",
      "2026年9月に政策金利を1.00％から1.25％へ引き上げた。",
    ]);
  });

  it("does not split at the periods inside a URL", () => {
    expect(
      splitRecoverySentences(
        "詳細はhttps://example.org/a.b/cを見てください。次です。",
      ),
    ).toEqual(["詳細はhttps://example.org/a.b/cを見てください。", "次です。"]);
  });

  it("protects a period inside Japanese quotation marks", () => {
    expect(
      splitRecoverySentences("「金利は1.5％です」と述べた。次です。"),
    ).toEqual(["「金利は1.5％です」と述べた。", "次です。"]);
  });

  it("keeps a version token intact and still splits at the Japanese full stop", () => {
    expect(splitRecoverySentences("最新版はv1.2.3です。旧版はv1.1です。")).toEqual([
      "最新版はv1.2.3です。",
      "旧版はv1.1です。",
    ]);
  });

  it("keeps a heading line as its own candidate sentence", () => {
    expect(splitRecoverySentences("政策金利の推移\n2026年9月に1.25％へ引き上げた。")).toEqual([
      "政策金利の推移",
      "2026年9月に1.25％へ引き上げた。",
    ]);
  });
});

describe("buildGroundedResearchEvidencePacket", () => {
  it("selects the sentence where the question keys meet, not a passing mention", () => {
    // F-01 shape: the title names the office-holder, but only a body
    // sentence states the current office; the packet must rank that
    // sentence above the title and above passing mentions.
    const packet = buildGroundedResearchEvidencePacket(
      [
        source({
          title: "内閣総理大臣 高市 早苗 - 首相官邸ホームページ",
          url: "https://www.kantei.go.jp/jp/104/actions/index.html",
          domain: "kantei.go.jp",
          excerpt:
            "首相官邸の公式ページです。内閣総理大臣の一覧はこちらです。現在の内閣総理大臣は高市早苗です。",
        }),
      ],
      "現在の日本の内閣総理大臣は誰ですか？",
    );
    const texts = packet.sentences.map((sentence) => sentence.text);
    expect(texts).toContain("現在の内閣総理大臣は高市早苗です。");
    // The answering sentence outranks the title by score (the packet
    // itself is returned in original order, title first).
    const byText = new Map(packet.sentences.map((sentence) => [sentence.text, sentence.score]));
    expect(byText.get("現在の内閣総理大臣は高市早苗です。")).toBeGreaterThan(
      byText.get("内閣総理大臣 高市 早苗 - 首相官邸ホームページ") ?? 0,
    );
  });

  it("returns at most eight sentences in original order", () => {
    const excerpt = Array.from(
      { length: 12 },
      (_, index) => `参議院の定数は${240 + index}人です。`,
    ).join("");
    const packet = buildGroundedResearchEvidencePacket(
      [source({ title: "参議院について", excerpt })],
      "参議院の定数は何人ですか？",
    );
    expect(packet.sentences).toHaveLength(8);
    const texts = packet.sentences.map((sentence) => sentence.text);
    expect(texts).toEqual([
      "参議院の定数は240人です。",
      "参議院の定数は241人です。",
      "参議院の定数は242人です。",
      "参議院の定数は243人です。",
      "参議院の定数は244人です。",
      "参議院の定数は245人です。",
      "参議院の定数は246人です。",
      "参議院の定数は247人です。",
    ]);
  });

  it("returns an empty packet when no sentence carries a key, a digit, or a term", () => {
    const packet = buildGroundedResearchEvidencePacket(
      [source({ title: "案内", excerpt: "このページでは各種手続きの案内を掲載しています。" })],
      "参議院の定数は何人ですか？",
    );
    expect(packet.sentences).toEqual([]);
  });

  it("deduplicates the same sentence across sources, keeping the first", () => {
    const packet = buildGroundedResearchEvidencePacket(
      [
        source({
          title: "資料A",
          url: "https://example.com/a",
          domain: "example.com",
          excerpt: "参議院の定数は248人です。",
        }),
        source({
          title: "資料B",
          url: "https://example.org/b",
          domain: "example.org",
          excerpt: "参議院の定数は248人です。",
        }),
      ],
      "参議院の定数は何人ですか？",
    );
    expect(packet.sentences).toHaveLength(1);
    expect(packet.sentences[0].sourceIndex).toBe(0);
  });

  it("is deterministic", () => {
    const sources = [
      source({
        title: "政策金利",
        excerpt: "2026年6月に政策金利を1.0％に引き上げた。2026年9月に政策金利を1.00％から1.25％へ引き上げた。",
      }),
    ];
    const question = "現在の日本の政策金利は何％ですか？";
    expect(buildGroundedResearchEvidencePacket(sources, question)).toEqual(
      buildGroundedResearchEvidencePacket(sources, question),
    );
  });
});

describe("extractPacketQuestionKeys", () => {
  it("keeps number-with-unit keys identical to the old combined pattern", () => {
    const texts = extractPacketQuestionKeys("10mmのネジと1.5 kgの荷物、1,000円の部品").map(
      (key) => key.text,
    );
    // "m" wins over "mm" in the original alternation order, so the
    // key is "10m", not "10mm".
    expect(texts).toContain("10m");
    expect(texts).not.toContain("10mm");
    expect(texts).toContain("1.5 kg");
    expect(texts).toContain("1,000円");
  });

  it("does not hang on a long digit run with no unit after it", () => {
    // The old combined number+unit regex backtracked over the whole
    // digit run here (CodeQL polynomial ReDoS); the literal-suffix
    // lookup must return at once with only the bare number key.
    const zeros = "0".repeat(5000);
    const keys = extractPacketQuestionKeys(`${zeros}ですか？`);
    expect(keys).toEqual([{ text: zeros, weight: 2 }]);
  });
});
