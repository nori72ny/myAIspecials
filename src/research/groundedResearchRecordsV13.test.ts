import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  buildGroundedResearchRecordsPacket,
  formatGroundedResearchRecordsPacket,
  segmentEvidenceText,
  RECORDS_MAX_UNITS_PER_SOURCE,
  RECORDS_NUMERIC_LIST_MAX_PER_SOURCE,
  RECORDS_PACKET_EXCERPT_CHARS,
  RECORDS_PACKET_MAX_SOURCES,
} from "./groundedResearchRecordsV13";

function texts(excerpt: string, sourceNumber = 1): string[] {
  return segmentEvidenceText(excerpt, sourceNumber).map((unit) => unit.text);
}

describe("segmentEvidenceText", () => {
  it("splits basic Japanese sentences and assigns sequential E-IDs", () => {
    const units = segmentEvidenceText("料金は100円です。次に説明します。以上が概要です。", 1);
    expect(units.map((unit) => unit.text)).toEqual([
      "料金は100円です。",
      "次に説明します。",
      "以上が概要です。",
    ]);
    expect(units.map((unit) => unit.id)).toEqual(["E1_1", "E1_2", "E1_3"]);
    expect(units.every((unit) => unit.sourceId === "S1")).toBe(true);
    expect(units.map((unit) => unit.index)).toEqual([1, 2, 3]);
  });

  it("uses the given source number in E-IDs", () => {
    const units = segmentEvidenceText("これは十分な長さの最初の文です。次も十分な長さの文です。", 3);
    expect(units.map((unit) => unit.id)).toEqual(["E3_1", "E3_2"]);
    expect(units.every((unit) => unit.sourceId === "S3")).toBe(true);
  });

  it("does not split at a terminator inside brackets", () => {
    expect(texts("彼は「今日は行く。」と静かに言った。そして家を出た。")).toEqual([
      "彼は「今日は行く。」と静かに言った。",
      "そして家を出た。",
    ]);
    expect(texts("（注記）価格は据え置きである。次の議題へ進む。")).toEqual([
      "（注記）価格は据え置きである。",
      "次の議題へ進む。",
    ]);
  });

  it("does not split at a decimal point", () => {
    const result = texts("金利は3.5%に引き上げられた。今後も注視が必要である。");
    expect(result).toEqual(["金利は3.5%に引き上げられた。", "今後も注視が必要である。"]);
    expect(result[0]).toContain("3.5%");
  });

  it("does not split inside domains or version strings", () => {
    expect(texts("詳細はexample.comを確認すること。追加の説明文である。")).toEqual([
      "詳細はexample.comを確認すること。",
      "追加の説明文である。",
    ]);
    expect(texts("バージョン1.2.3が公開された。変更点は多岐にわたる。")).toEqual([
      "バージョン1.2.3が公開された。",
      "変更点は多岐にわたる。",
    ]);
  });

  it("treats an ASCII period as a terminator before whitespace + uppercase or a Japanese character", () => {
    expect(texts("The price is 100 dollars. It rose sharply today.")).toEqual([
      "The price is 100 dollars.",
      "It rose sharply today.",
    ]);
    expect(texts("処理が完了した. 次の工程へ進むこと。")).toEqual([
      "処理が完了した.",
      "次の工程へ進むこと。",
    ]);
    expect(texts("結果はOK.次に進むことにした。")).toEqual([
      "結果はOK.",
      "次に進むことにした。",
    ]);
  });

  it("absorbs closing quotes and terminator runs into the sentence that just ended", () => {
    const quoted = texts("結果は\"想定以上であった。\"と報告されたのである。次の議題に移る。");
    expect(quoted).toEqual([
      "結果は\"想定以上であった。\"",
      "と報告されたのである。",
      "次の議題に移る。",
    ]);
    expect(texts("それは本当なのか？！驚きの結果である。")).toEqual([
      "それは本当なのか？！",
      "驚きの結果である。",
    ]);
  });

  it("merges a unit shorter than 8 characters into the previous unit", () => {
    expect(texts("これは十分な長さの最初の文です。短い。次も十分な長さの文です。")).toEqual([
      "これは十分な長さの最初の文です。短い。",
      "次も十分な長さの文です。",
    ]);
  });

  it("keeps a short first unit as its own unit (it has no predecessor)", () => {
    expect(texts("短い。十分な長さの二番目の文です。")).toEqual([
      "短い。",
      "十分な長さの二番目の文です。",
    ]);
  });

  it("keeps a trailing fragment without a terminator as its own unit", () => {
    expect(texts("これは十分な長さの最初の文です。末尾の断片テキスト")).toEqual([
      "これは十分な長さの最初の文です。",
      "末尾の断片テキスト",
    ]);
  });

  it("does not split enumerations on ・", () => {
    expect(texts("対象は東京・大阪・名古屋の三都市である。")).toEqual([
      "対象は東京・大阪・名古屋の三都市である。",
    ]);
  });

  it("caps units per source by merging the overflow into the last unit", () => {
    const excerpt = Array.from({ length: 15 }, (_, i) => `これは${i + 1}番目の十分な長さの文です。`).join("");
    const units = segmentEvidenceText(excerpt, 1);
    expect(units).toHaveLength(RECORDS_MAX_UNITS_PER_SOURCE);
    expect(units[0].text).toBe("これは1番目の十分な長さの文です。");
    expect(units[RECORDS_MAX_UNITS_PER_SOURCE - 1].text).toContain("12番目");
    expect(units[RECORDS_MAX_UNITS_PER_SOURCE - 1].text).toContain("15番目");
    expect(units[RECORDS_MAX_UNITS_PER_SOURCE - 1].id).toBe(`E1_${RECORDS_MAX_UNITS_PER_SOURCE}`);
  });

  it("returns no units for empty or whitespace-only input", () => {
    expect(segmentEvidenceText("", 1)).toEqual([]);
    expect(segmentEvidenceText("   ", 2)).toEqual([]);
  });

  it("is deterministic", () => {
    const excerpt = "彼は「今日は行く。」と静かに言った。金利は3.5%に引き上げられた。短い。そして家を出た。";
    expect(segmentEvidenceText(excerpt, 2)).toEqual(segmentEvidenceText(excerpt, 2));
  });
});

function makeSource(overrides: Partial<OriginResearchSource> = {}): OriginResearchSource {
  return {
    title: "Source title",
    url: "https://example.com/article",
    excerpt: "これは十分な長さの最初の文です。次も十分な長さの文です。",
    sourceType: "web-search",
    domain: "example.com",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T10:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "unclassified",
    ...overrides,
  };
}

describe("buildGroundedResearchRecordsPacket", () => {
  it("keeps at most the top sources in selection order, renumbered S1..", () => {
    const sources = Array.from({ length: 6 }, (_, i) => makeSource({
      title: `Title ${i + 1}`,
      url: `https://example${i + 1}.com/a`,
      domain: `example${i + 1}.com`,
    }));
    const packet = buildGroundedResearchRecordsPacket(sources);
    expect(packet.sources).toHaveLength(RECORDS_PACKET_MAX_SOURCES);
    expect(packet.sources.map((source) => source.id)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(packet.sources.map((source) => source.title)).toEqual(["Title 1", "Title 2", "Title 3", "Title 4"]);
  });

  it("excludes sources whose excerpt is empty after compaction and renumbers", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({ title: "Empty", excerpt: "   " }),
      makeSource({ title: "B", url: "https://b.example.com/", domain: "b.example.com" }),
      makeSource({ title: "C", url: "https://c.example.com/", domain: "c.example.com" }),
    ]);
    expect(packet.sources.map((source) => source.title)).toEqual(["B", "C"]);
    expect(packet.sources.map((source) => source.id)).toEqual(["S1", "S2"]);
    expect(packet.sources[0].units[0].id).toBe("E1_1");
    expect(packet.sources[1].units[0].id).toBe("E2_1");
  });

  it("excludes sources without a safe https URL", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({ title: "Http", url: "http://example.com/a" }),
      makeSource({ title: "Creds", url: "https://user:pass@example.com/a" }),
      makeSource({ title: "Ok", url: "https://ok.example.com/a", domain: "ok.example.com" }),
    ]);
    expect(packet.sources.map((source) => source.title)).toEqual(["Ok"]);
  });

  it("compacts whitespace and caps the excerpt at the records limit", () => {
    const long = buildGroundedResearchRecordsPacket([
      makeSource({ excerpt: `${"あ".repeat(500)}。${"い".repeat(600)}。` }),
    ]);
    expect(long.sources[0].excerpt).toHaveLength(RECORDS_PACKET_EXCERPT_CHARS);
    // Units are segmented from the exact packet excerpt string.
    expect(long.sources[0].units).toEqual(segmentEvidenceText(long.sources[0].excerpt, 1));

    const messy = buildGroundedResearchRecordsPacket([
      makeSource({ excerpt: "  文の一つ目ですこれはテスト。\n\n  文の二つ目ですこれはテスト。  " }),
    ]);
    expect(messy.sources[0].excerpt).not.toContain("\n");
    expect(messy.sources[0].units.map((unit) => unit.text)).toEqual([
      "文の一つ目ですこれはテスト。",
      "文の二つ目ですこれはテスト。",
    ]);
  });

  it("produces unique E-IDs across the packet and is deterministic", () => {
    const sources = [
      makeSource({ url: "https://a.example.com/", domain: "a.example.com" }),
      makeSource({ url: "https://b.example.com/", domain: "b.example.com" }),
      makeSource({ url: "https://c.example.com/", domain: "c.example.com" }),
    ];
    const first = buildGroundedResearchRecordsPacket(sources);
    const second = buildGroundedResearchRecordsPacket(sources);
    expect(second).toEqual(first);
    const ids = first.sources.flatMap((source) => source.units.map((unit) => unit.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(first.totalUnits).toBe(ids.length);
  });

  it("builds the verbatim numeric list without time-of-day or URL-only tokens", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "価格情報（更新は9:05）",
        excerpt: "価格は124,800円です。利用者は32万人を超えました。詳細はhttps://example.com/items/98765 を参照してください。",
        revisionTimestamp: "2026-11-14T09:30:00.000Z",
        retrievedAt: "2026-11-14T10:00:00.000Z",
      }),
    ]);
    const tokens = packet.sources[0].numericTokens;
    expect(tokens).toContain("124800円");
    expect(tokens).toContain("32万");
    expect(tokens).toContain("2026年");
    expect(tokens).not.toContain("05");
    expect(tokens).not.toContain("98765");
  });

  it("caps the numeric list per source in appearance order", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({ excerpt: "数値は11件、22件、33件、44件、55件、66件、77件、88件、99件、100件、111件、122件です。" }),
    ]);
    const tokens = packet.sources[0].numericTokens;
    expect(tokens).toHaveLength(RECORDS_NUMERIC_LIST_MAX_PER_SOURCE);
    expect(tokens[0]).toBe("11");
    expect(tokens[RECORDS_NUMERIC_LIST_MAX_PER_SOURCE - 1]).toBe("100");
  });
});

describe("formatGroundedResearchRecordsPacket", () => {
  it("renders headings, metadata, the numeric list and E-ID units without any URL", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "価格の記事",
        url: "https://hidden-host.example/secret-path-123",
        domain: "example.com",
        excerpt: "価格は124,800円です。次も十分な長さの文です。",
      }),
      makeSource({
        title: "Second",
        url: "https://other.example.org/x",
        domain: "other.example.org",
      }),
    ]);
    const rendered = formatGroundedResearchRecordsPacket(packet);
    expect(rendered).toContain("S1（example.com）");
    expect(rendered).toContain("S2（other.example.org）");
    expect(rendered).toContain("[E1_1] 価格は124,800円です。");
    expect(rendered).toContain("原文の数値表記: ");
    expect(rendered).not.toContain("hidden-host");
    expect(rendered).not.toContain("secret-path-123");
    expect(rendered).not.toContain("https://");
    expect(rendered).not.toContain("citation_token");
    expect(formatGroundedResearchRecordsPacket(packet)).toBe(rendered);
  });
});
