import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  buildGroundedResearchEvidencePacket,
  extractPacketQuestionKeys,
  packetSentenceIsFileDescription,
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

  it("rejoins a heading label line with the key-less value line that follows it (measure B, ESRI shape)", () => {
    // ANSWER_SOURCES_ONLY_DIAGNOSIS_2026-11-26, failure 2: the ESRI
    // page puts the label and the value on separate lines. The label
    // carries the question keys but no value; the value line carries
    // the number but no key, so neither half was quotable alone and
    // the landing quoted the label with the value missing.
    const packet = buildGroundedResearchEvidencePacket(
      [
        source({
          title: "四半期別GDP速報",
          url: "https://www.esri.cao.go.jp/jp/sna/data/data_list/sokuhou/gaiyou/pdf/main_1.pdf",
          domain: "esri.cao.go.jp",
          authorityTier: "official",
          excerpt:
            "2026年7～9月期の実質ＧＤＰの成長率は\n前期比−0.0%（年率−0.1%）でした。名目ＧＤＰの成長率は0.4%でした。",
        }),
      ],
      "日本の最新の実質GDP成長率を教えてください",
    );
    const texts = packet.sentences.map((sentence) => sentence.text);
    expect(texts).toContain(
      "2026年7～9月期の実質ＧＤＰの成長率は前期比−0.0%（年率−0.1%）でした。",
    );
    // Neither half survives on its own.
    expect(texts).not.toContain("2026年7～9月期の実質ＧＤＰの成長率は");
    expect(texts).not.toContain("前期比−0.0%（年率−0.1%）でした。");
  });

  it("rejoins a label line ending in a comma after its particle (round-3 measure 2-4, ESRI summary shape)", () => {
    // ANSWER_STATISTICS_ROUND3_DIAGNOSIS_2026-11-26, failure 2(b):
    // ESRI's summary PDF writes the label with a comma —
    // "…の成長率は、" — and the measure-B ending test knew only the
    // bare particles, so label and value stayed separate candidates
    // and the value-only half then failed the reconstruction's key
    // gate. The rejoined candidate keeps the comma: it is the
    // publisher's verbatim sentence.
    const packet = buildGroundedResearchEvidencePacket(
      [
        source({
          title: "四半期別GDP速報",
          url: "https://www.esri.cao.go.jp/jp/sna/data/data_list/sokuhou/gaiyou/pdf/main_1.pdf",
          domain: "esri.cao.go.jp",
          authorityTier: "official",
          excerpt:
            "2026年7～9月期の実質ＧＤＰの成長率は、\n▲0.0％（年率▲0.1％）となった。また、名目ＧＤＰの成長率は、0.4％（年率1.6％）となった。",
        }),
      ],
      "日本の最新の実質GDP成長率を教えてください",
    );
    const texts = packet.sentences.map((sentence) => sentence.text);
    expect(texts).toContain(
      "2026年7～9月期の実質ＧＤＰの成長率は、▲0.0％（年率▲0.1％）となった。",
    );
    // Neither half survives on its own.
    expect(texts).not.toContain("2026年7～9月期の実質ＧＤＰの成長率は、");
    expect(texts).not.toContain("▲0.0％（年率▲0.1％）となった。");
  });

  it("does not rejoin when the following line carries a question key of its own (measure B)", () => {
    const packet = buildGroundedResearchEvidencePacket(
      [
        source({
          title: "四半期別GDP速報",
          excerpt: "実質ＧＤＰの成長率は\n実質ＧＤＰは前期比−0.0%でした。",
        }),
      ],
      "日本の最新の実質GDP成長率を教えてください",
    );
    const texts = packet.sentences.map((sentence) => sentence.text);
    expect(texts).not.toContain("実質ＧＤＰの成長率は実質ＧＤＰは前期比−0.0%でした。");
    expect(texts).toContain("実質ＧＤＰは前期比−0.0%でした。");
  });

  it("does not rejoin a label that does not end as a continuing fragment (measure B)", () => {
    const packet = buildGroundedResearchEvidencePacket(
      [
        source({
          title: "四半期別GDP速報",
          excerpt: "実質ＧＤＰの成長率について\n前期比−0.0%でした。",
        }),
      ],
      "日本の最新の実質GDP成長率を教えてください",
    );
    const texts = packet.sentences.map((sentence) => sentence.text);
    expect(texts).not.toContain("実質ＧＤＰの成長率について前期比−0.0%でした。");
  });

  it("ranks the current official value sentence above a stale secondary one (measure C)", () => {
    // The B3 shape at packet level: equal key overlap, but the
    // secondary sentence used to win on digit/term signals alone.
    // Authority (official tier) and recency (the pool's latest
    // stated edition) now rank the official current value first.
    const packet = buildGroundedResearchEvidencePacket(
      [
        source({
          title: "一般職業紹介状況（令和8年9月分）",
          url: "https://www.mhlw.go.jp/stf/newpage_76960.html",
          domain: "mhlw.go.jp",
          authorityTier: "official",
          excerpt: "令和8年9月の有効求人倍率は1.19倍で、前月と比べて0.01ポイント上昇しました。",
        }),
        source({
          title: "有効求人倍率、8月は1.18倍 横ばい",
          url: "https://www.nikkei.com/article/example",
          domain: "nikkei.com",
          authorityTier: "major-news",
          excerpt: "8月の有効求人倍率は1.18倍で、前月から横ばいでした。",
        }),
      ],
      "有効求人倍率の最新の値を教えてください",
    );
    const byText = new Map(packet.sentences.map((sentence) => [sentence.text, sentence.score]));
    const official = byText.get("令和8年9月の有効求人倍率は1.19倍で、前月と比べて0.01ポイント上昇しました。");
    const secondary = byText.get("8月の有効求人倍率は1.18倍で、前月から横ばいでした。");
    expect(official).toBeDefined();
    expect(secondary).toBeDefined();
    expect(official ?? 0).toBeGreaterThan(secondary ?? 0);
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

describe("regional sub-ranking (remeasure measure 3-1)", () => {
  // The F-06 re-measurement shape: the pool holds the Statistics
  // Bureau's national release and a prefectural labour bureau's
  // page whose fragment quotes the prefecture's own figure with
  // the question's exact key phrase. Before the wiring, the
  // regional page received the same official bonus and its value
  // sentence tied or beat the national one.
  const national = source({
    title: "労働力調査（基本集計）令和8年9月分",
    url: "https://www.stat.go.jp/data/roudou/sokuhou/tsuki/index.html",
    domain: "www.stat.go.jp",
    authorityTier: "official",
    excerpt: "完全失業率は2.4%でした。就業者数は6,700万人でした。",
  });
  const regional = source({
    title: "京都労働局 雇用情勢",
    url: "https://jsite.mhlw.go.jp/kyoto-roudoukyoku/jirei_toukei.html",
    domain: "jsite.mhlw.go.jp",
    authorityTier: "official",
    excerpt: "完全失業率は1.2%でした。就業者数は130万人でした。",
  });
  const question = "最新の完全失業率を教えてください";

  it("scores the national value sentence above the regional one when both are in the pool", () => {
    const packet = buildGroundedResearchEvidencePacket([regional, national], question);
    const byText = new Map(packet.sentences.map((sentence) => [sentence.text, sentence]));
    const nationalSentence = byText.get("完全失業率は2.4%でした。");
    const regionalSentence = byText.get("完全失業率は1.2%でした。");
    expect(nationalSentence).toBeDefined();
    expect(regionalSentence).toBeDefined();
    expect(nationalSentence!.score).toBeGreaterThan(regionalSentence!.score);
  });

  it("keeps the regional official's bonus when no national official source is in the pool", () => {
    const news = source({
      title: "雇用情勢を伝える報道",
      url: "https://example.com/news/employment",
      domain: "example.com",
      authorityTier: "major-news",
      excerpt: "完全失業率は2.4%でした。就業者数は6,700万人でした。",
    });
    const packet = buildGroundedResearchEvidencePacket([regional, news], question);
    const byText = new Map(packet.sentences.map((sentence) => [sentence.text, sentence]));
    // Same base signals as the news sentence; only the official
    // bonus separates them, and it must still be there.
    expect(byText.get("完全失業率は1.2%でした。")!.score).toBeGreaterThan(
      byText.get("完全失業率は2.4%でした。")!.score,
    );
  });
});

describe("file-description demotion (round-5 measure 5-3b)", () => {
  it("recognizes file-guide sentences and only those", () => {
    expect(packetSentenceIsFileDescription("印刷用PDF：148KBで提供しています。")).toBe(true);
    expect(packetSentenceIsFileDescription("統計表（Excel：15KB）をダウンロードできます。")).toBe(true);
    // A decimal file size is still a file size, not a statistic.
    expect(packetSentenceIsFileDescription("結果の概要（PDF：2.3MB）を掲載しています。")).toBe(true);
    // A sentence that reports a figure AND mentions a file is a
    // value sentence, not a guide.
    expect(packetSentenceIsFileDescription("完全失業率は2.4%でした。詳細は印刷用PDF：148KBをご覧ください。")).toBe(false);
    expect(packetSentenceIsFileDescription("完全失業率は2.4%でした。")).toBe(false);
    expect(packetSentenceIsFileDescription("労働力調査 基本集計 令和8年9月分 結果の概要")).toBe(false);
    expect(packetSentenceIsFileDescription("ファイルサイズは148KBです。")).toBe(false);
  });

  it("a guide sentence on an official page no longer crowds value sentences out of the top 8", () => {
    // The measured B3 pool shape: an official file page whose guide
    // sentence carries the official + latest-edition bonuses and
    // outscores plain value sentences. Nine candidates compete for
    // eight slots; before the demotion the guide took one.
    const guide = source({
      title: "労働力調査（基本集計）令和8年9月分 結果の概要",
      url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
      domain: "stat.go.jp",
      authorityTier: "official",
      excerpt: "完全失業率の統計表（印刷用PDF：148KB）を掲載しています。",
    });
    const values = source({
      title: "失業率の解説",
      url: "https://blog.example.com/unemployment",
      domain: "blog.example.com",
      excerpt: Array.from(
        { length: 8 },
        (_, index) => `完全失業率は2.${index}%でした。`,
      ).join(""),
    });
    const packet = buildGroundedResearchEvidencePacket(
      [guide, values],
      "最新の完全失業率を教えてください。いつの分ですか？",
    );
    const texts = packet.sentences.map((sentence) => sentence.text);
    expect(texts).toHaveLength(8);
    expect(texts).not.toContain("完全失業率の統計表（印刷用PDF：148KB）を掲載しています。");
    for (let index = 0; index < 8; index += 1) {
      expect(texts).toContain(`完全失業率は2.${index}%でした。`);
    }
  });

  it("demotion is not exclusion: a pool whose only candidate is a guide sentence keeps it", () => {
    const guideOnly = source({
      title: "労働力調査（基本集計）令和8年9月分 結果の概要",
      url: "https://www.stat.go.jp/data/roudou/sokuhou/gaiyou.html",
      domain: "stat.go.jp",
      authorityTier: "official",
      excerpt: "完全失業率の統計表（印刷用PDF：148KB）を掲載しています。",
    });
    const packet = buildGroundedResearchEvidencePacket(
      [guideOnly],
      "最新の完全失業率を教えてください。いつの分ですか？",
    );
    const texts = packet.sentences.map((sentence) => sentence.text);
    expect(texts).toContain("完全失業率の統計表（印刷用PDF：148KB）を掲載しています。");
  });
});
