import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  buildGroundedResearchRecordsPacket,
  evaluateGroundedResearchRecords,
  parseGroundedResearchRecords,
  RECORDS_MAX_RECORDS,
} from "./groundedResearchRecordsV13";

// Fixtures modeled on the two production failure shapes named in the
// design (§14.1 R-PR-2): the current-prime-minister question and the
// Google Pixel price question. All names/prices are fixture data.

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

const PM_UNIT_1 = "高市早苗は、第105代内閣総理大臣に指名された。";
const PM_UNIT_2 = "内閣総理大臣は、国会の議決により指名される。";
const PM2_UNIT_1 = "2026年11月現在、内閣総理大臣は高市早苗氏である。";

function pmPacket() {
  return buildGroundedResearchRecordsPacket([
    makeSource({
      title: "内閣総理大臣の指名について",
      url: "https://www.kantei.example.go.jp/souri/",
      domain: "kantei.example.go.jp",
      excerpt: `${PM_UNIT_1}${PM_UNIT_2}`,
    }),
    makeSource({
      title: "首相ニュース",
      url: "https://news.example.co.jp/pm",
      domain: "news.example.co.jp",
      excerpt: `${PM2_UNIT_1}高市氏は自由民主党の総裁を務めている。`,
    }),
  ]);
}

const PIXEL_UNIT_1 = "Google Pixel 10の価格は124,800円（税込）です。";
const PIXEL2_UNIT_1 = "Pixel 10の実売価格は124,800円前後で推移している。";

function pixelPacket() {
  return buildGroundedResearchRecordsPacket([
    makeSource({
      title: "Google Pixel 10 公式ストア",
      url: "https://store.example.com/pixel10",
      domain: "store.example.com",
      excerpt: `${PIXEL_UNIT_1}ストレージ容量は256GBモデルも用意されています。`,
    }),
    makeSource({
      title: "Pixel 10 レビュー",
      url: "https://review.example.jp/pixel10",
      domain: "review.example.jp",
      excerpt: `${PIXEL2_UNIT_1}本体カラーは全4色の展開である。`,
    }),
  ]);
}

function jsonOutput(records: unknown[]): string {
  return JSON.stringify({ records });
}

const PM_RECORD_1 = { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" };
const PM_RECORD_2 = { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "2026年11月時点でも内閣総理大臣は高市早苗氏です。" };

describe("parseGroundedResearchRecords", () => {
  it("parses the JSON form", () => {
    const result = parseGroundedResearchRecords(jsonOutput([PM_RECORD_1, PM_RECORD_2]));
    expect(result.format).toBe("json");
    expect(result.records).toHaveLength(2);
    expect(result.totalRecords).toBe(2);
    expect(result.truncatedRecords).toBe(0);
    expect(result.malformedRecords).toBe(0);
    expect(result.records[0]).toMatchObject({ evidence: ["E1_1"], quote: PM_UNIT_1 });
  });

  it("truncates records beyond the cap at parse time (design §4.1)", () => {
    const entries = Array.from({ length: RECORDS_MAX_RECORDS + 1 }, () => PM_RECORD_1);
    const result = parseGroundedResearchRecords(jsonOutput(entries));
    expect(result.records).toHaveLength(RECORDS_MAX_RECORDS);
    expect(result.totalRecords).toBe(RECORDS_MAX_RECORDS + 1);
    expect(result.truncatedRecords).toBe(1);
  });

  it("treats an empty records array as a valid JSON form with zero records", () => {
    const result = parseGroundedResearchRecords(jsonOutput([]));
    expect(result.format).toBe("json");
    expect(result.records).toEqual([]);
    expect(result.totalRecords).toBe(0);
  });

  it("fails deterministically on code-fenced JSON (no fuzzy recovery)", () => {
    const fenced = "```json\n" + jsonOutput([PM_RECORD_1]) + "\n```";
    const result = parseGroundedResearchRecords(fenced);
    expect(result.format).toBeNull();
    expect(result.records).toEqual([]);
  });

  it("does not interpret the slot form (slots are a later PR, design §9)", () => {
    const slot = JSON.stringify({ answer: "高市早苗", src: "S2", quote: PM_UNIT_1 });
    const result = parseGroundedResearchRecords(slot);
    expect(result.format).toBeNull();
    expect(result.records).toEqual([]);
  });

  it("returns format null for output in neither form", () => {
    expect(parseGroundedResearchRecords("").format).toBeNull();
    expect(parseGroundedResearchRecords("自由文の回答です。出典はありません。").format).toBeNull();
  });

  it("parses the text form with multiple blocks", () => {
    const output = [
      "REC",
      "E: E1_1",
      `Q: ${PM_UNIT_1}`,
      "T: 現在の内閣総理大臣は高市早苗です。",
      "END",
      "REC",
      "E: E2_1",
      `Q: ${PM2_UNIT_1}`,
      "T: 2026年11月時点でも内閣総理大臣は高市早苗氏です。",
      "END",
    ].join("\n");
    const result = parseGroundedResearchRecords(output);
    expect(result.format).toBe("text");
    expect(result.records).toHaveLength(2);
    expect(result.malformedRecords).toBe(0);
    expect(result.records[1]).toMatchObject({ evidence: ["E2_1"], quote: PM2_UNIT_1 });
  });

  it("splits a text-form E line into multiple evidence IDs", () => {
    const output = ["REC", "E: E1_1 E1_2", `Q: ${PM_UNIT_1}${PM_UNIT_2}`, "T: 内閣総理大臣は高市早苗です。", "END"].join("\n");
    const result = parseGroundedResearchRecords(output);
    expect(result.records[0].evidence).toEqual(["E1_1", "E1_2"]);
  });

  it("drops only the block that contains a stray line", () => {
    const output = [
      "REC",
      "E: E1_1",
      "これは余分な行です",
      `Q: ${PM_UNIT_1}`,
      "T: 現在の内閣総理大臣は高市早苗です。",
      "END",
      "REC",
      "E: E2_1",
      `Q: ${PM2_UNIT_1}`,
      "T: 2026年11月時点でも内閣総理大臣は高市早苗氏です。",
      "END",
    ].join("\n");
    const result = parseGroundedResearchRecords(output);
    expect(result.format).toBe("text");
    expect(result.records).toHaveLength(1);
    expect(result.records[0].evidence).toEqual(["E2_1"]);
    expect(result.malformedRecords).toBe(1);
    expect(result.totalRecords).toBe(2);
  });

  it("counts an unterminated block as malformed", () => {
    const output = ["REC", "E: E1_1", `Q: ${PM_UNIT_1}`, "T: 現在の内閣総理大臣は高市早苗です。"].join("\n");
    const result = parseGroundedResearchRecords(output);
    expect(result.format).toBe("text");
    expect(result.records).toEqual([]);
    expect(result.malformedRecords).toBe(1);
  });

  it("drops a block with a repeated field (multi-line field spill)", () => {
    const output = [
      "REC",
      "E: E1_1",
      `Q: ${PM_UNIT_1}`,
      "Q: 続きの引用です",
      "T: 現在の内閣総理大臣は高市早苗です。",
      "END",
    ].join("\n");
    const result = parseGroundedResearchRecords(output);
    expect(result.records).toEqual([]);
    expect(result.malformedRecords).toBe(1);
  });
});

describe("validateGroundedResearchRecords (prime-minister fixture)", () => {
  it("accepts well-formed records from two sources and satisfies coverage", () => {
    const result = evaluateGroundedResearchRecords(jsonOutput([PM_RECORD_1, PM_RECORD_2]), pmPacket());
    expect(result.rejections).toEqual([]);
    expect(result.accepted).toHaveLength(2);
    expect(result.accepted[0]).toMatchObject({
      sourceId: "S1",
      sourceIndex: 0,
      evidenceIds: ["E1_1"],
      quote: PM_UNIT_1,
      text: PM_RECORD_1.text,
      quoteStart: 0,
    });
    expect(result.accepted[1].sourceId).toBe("S2");
    expect(result.coverage).toEqual({
      requiredSourceCount: 2,
      citedSourceCount: 2,
      satisfied: true,
      code: null,
    });
  });

  it("accepts the text form through the same validator", () => {
    const output = [
      "REC",
      "E: E1_1",
      `Q: ${PM_UNIT_1}`,
      "T: 現在の内閣総理大臣は高市早苗です。",
      "END",
      "REC",
      "E: E2_1",
      `Q: ${PM2_UNIT_1}`,
      "T: 2026年11月時点でも内閣総理大臣は高市早苗氏です。",
      "END",
    ].join("\n");
    const result = evaluateGroundedResearchRecords(output, pmPacket());
    expect(result.parse.format).toBe("text");
    expect(result.accepted).toHaveLength(2);
    expect(result.coverage.satisfied).toBe(true);
  });

  it("accepts a record citing two units of one source with a combined quote", () => {
    const record = { evidence: ["E1_1", "E1_2"], quote: `${PM_UNIT_1}${PM_UNIT_2}`, text: "内閣総理大臣は高市早苗です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record, PM_RECORD_2]), pmPacket());
    expect(result.rejections).toEqual([]);
    expect(result.accepted[0].evidenceIds).toEqual(["E1_1", "E1_2"]);
  });

  it("accepts a record whose optional src agrees with the derived source", () => {
    const record = { ...PM_RECORD_1, src: "S1" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record, PM_RECORD_2]), pmPacket());
    expect(result.rejections).toEqual([]);
    expect(result.accepted).toHaveLength(2);
  });

  it("rejects malformed records at the format step", () => {
    const packet = pmPacket();
    const cases: unknown[] = [
      { evidence: ["E1_1", "E1_2", "E2_1", "E2_2"], quote: PM_UNIT_1, text: "内閣総理大臣は高市早苗です。" },
      { evidence: [], quote: PM_UNIT_1, text: "内閣総理大臣は高市早苗です。" },
      { evidence: "E1_1", quote: PM_UNIT_1, text: "内閣総理大臣は高市早苗です。" },
      { evidence: ["E1_1"], quote: PM_UNIT_1, text: "" },
      { evidence: ["E1_1"], quote: PM_UNIT_1, text: `${"あ".repeat(200)}。` },
      { evidence: ["E1_1"], quote: "あ".repeat(801), text: "内閣総理大臣は高市早苗です。" },
      "not-an-object",
    ];
    for (const entry of cases) {
      const result = evaluateGroundedResearchRecords(jsonOutput([entry]), packet);
      expect(result.accepted).toEqual([]);
      expect(result.rejections).toEqual([{ recordIndex: 0, code: "INVALID_RECORD_FORMAT" }]);
    }
  });

  it("accepts a text of exactly 200 characters (the format cap is inclusive)", () => {
    const record = { evidence: ["E1_1"], quote: PM_UNIT_1, text: `${"あ".repeat(199)}。` };
    const result = evaluateGroundedResearchRecords(jsonOutput([record, PM_RECORD_2]), pmPacket());
    expect(result.rejections).toEqual([]);
    expect(result.accepted[0].text).toHaveLength(200);
  });

  it("rejects unknown evidence IDs", () => {
    const record = { evidence: ["E9_9"], quote: PM_UNIT_1, text: "内閣総理大臣は高市早苗です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "UNKNOWN_EVIDENCE_ID" }]);
    expect(result.rejectionCounts.UNKNOWN_EVIDENCE_ID).toBe(1);
  });

  it("rejects evidence spanning two sources as a source mismatch", () => {
    const record = { evidence: ["E1_1", "E2_1"], quote: PM_UNIT_1, text: "内閣総理大臣は高市早苗です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "SRC_EVIDENCE_MISMATCH" }]);
  });

  it("rejects a src field that disagrees with the derived source", () => {
    const record = { ...PM_RECORD_1, src: "S2" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "SRC_EVIDENCE_MISMATCH" }]);
  });

  it("rejects a quote that is not a verbatim substring of the excerpt", () => {
    const record = { evidence: ["E1_1"], quote: "高市早苗は、第106代内閣総理大臣に指名された。", text: "内閣総理大臣は高市早苗です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "QUOTE_NOT_SUBSTRING" }]);
  });

  it("rejects a quote that covers a different unit than the cited one", () => {
    const record = { evidence: ["E1_1"], quote: PM_UNIT_2, text: "内閣総理大臣は高市早苗です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "QUOTE_DOES_NOT_COVER_EVIDENCE" }]);
  });

  it("rejects a fragment-only quote that contains no complete unit", () => {
    const record = { evidence: ["E1_1"], quote: "高市早苗は、第105代内閣総理大臣に", text: "内閣総理大臣は高市早苗です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "QUOTE_DOES_NOT_COVER_EVIDENCE" }]);
  });

  it("rejects a multi-sentence text", () => {
    const record = { evidence: ["E1_1"], quote: PM_UNIT_1, text: "内閣総理大臣は高市早苗です。国会の議決で指名されました。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "TEXT_MULTI_SENTENCE" }]);
  });

  it("rejects a text with a back-reference", () => {
    const record = { evidence: ["E1_1"], quote: PM_UNIT_1, text: "上記のとおり、内閣総理大臣は高市早苗です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "TEXT_HAS_BACK_REFERENCE" }]);
  });

  it("keeps the first of two records sharing source and quote start", () => {
    const second = { evidence: ["E1_1"], quote: PM_UNIT_1, text: "内閣総理大臣は高市早苗です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([PM_RECORD_1, second, PM_RECORD_2]), pmPacket());
    expect(result.accepted).toHaveLength(2);
    expect(result.accepted[0].text).toBe(PM_RECORD_1.text);
    expect(result.rejections).toEqual([{ recordIndex: 1, code: "DUPLICATE_RECORD" }]);
  });

  it("reports insufficient coverage when only one of two sources survives", () => {
    const result = evaluateGroundedResearchRecords(jsonOutput([PM_RECORD_1]), pmPacket());
    expect(result.accepted).toHaveLength(1);
    expect(result.coverage).toEqual({
      requiredSourceCount: 2,
      citedSourceCount: 1,
      satisfied: false,
      code: "INSUFFICIENT_SOURCE_COVERAGE",
    });
  });

  it("satisfies coverage with a single record when the packet has one source", () => {
    const single = buildGroundedResearchRecordsPacket([
      makeSource({
        url: "https://www.kantei.example.go.jp/souri/",
        domain: "kantei.example.go.jp",
        excerpt: `${PM_UNIT_1}${PM_UNIT_2}`,
      }),
    ]);
    const result = evaluateGroundedResearchRecords(jsonOutput([PM_RECORD_1]), single);
    expect(result.accepted).toHaveLength(1);
    expect(result.coverage).toEqual({
      requiredSourceCount: 1,
      citedSourceCount: 1,
      satisfied: true,
      code: null,
    });
  });

  it("gates a bracketed name that is absent from the quote", () => {
    const record = { evidence: ["E1_1"], quote: PM_UNIT_1, text: "「岸田文雄」氏が内閣総理大臣です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "NAME_NOT_IN_QUOTE" }]);
  });

  it("is deterministic", () => {
    const output = jsonOutput([PM_RECORD_1, PM_RECORD_2]);
    expect(evaluateGroundedResearchRecords(output, pmPacket())).toEqual(
      evaluateGroundedResearchRecords(output, pmPacket()),
    );
  });
});

describe("validateGroundedResearchRecords (Pixel price fixture)", () => {
  const PIXEL_RECORD_1 = { evidence: ["E1_1"], quote: PIXEL_UNIT_1, text: "Google Pixel 10の価格は124,800円です。" };
  const PIXEL_RECORD_2 = { evidence: ["E2_1"], quote: PIXEL2_UNIT_1, text: "Pixel 10の実売価格は124,800円前後で推移しています。" };

  it("accepts verbatim price records from two sources", () => {
    const result = evaluateGroundedResearchRecords(jsonOutput([PIXEL_RECORD_1, PIXEL_RECORD_2]), pixelPacket());
    expect(result.rejections).toEqual([]);
    expect(result.accepted).toHaveLength(2);
    expect(result.coverage.satisfied).toBe(true);
  });

  it("rejects a text that converts the price (約12万円) instead of copying it", () => {
    const record = { evidence: ["E1_1"], quote: PIXEL_UNIT_1, text: "Google Pixel 10の価格は約12万円です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pixelPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "NUMERIC_NOT_IN_QUOTE" }]);
  });

  it("rejects a text naming a Latin proper noun absent from its quote", () => {
    const record = { evidence: ["E2_1"], quote: PIXEL2_UNIT_1, text: "Google Pixel 10の実売価格は124,800円前後です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pixelPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "NAME_NOT_IN_QUOTE" }]);
  });

  it("accepts form-only differences in the quote (full-width digits, §6.2)", () => {
    const record = {
      evidence: ["E1_1"],
      quote: "Google Pixel 10の価格は１２４，８００円（税込）です。",
      text: "Google Pixel 10の価格は124,800円です。",
    };
    const result = evaluateGroundedResearchRecords(jsonOutput([record, PIXEL_RECORD_2]), pixelPacket());
    expect(result.rejections).toEqual([]);
    expect(result.accepted).toHaveLength(2);
  });

  it("rejects a katakana name absent from the quote", () => {
    const record = { evidence: ["E2_1"], quote: PIXEL2_UNIT_1, text: "Pixel 10はオンラインストアで124,800円前後です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([record]), pixelPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "NAME_NOT_IN_QUOTE" }]);
  });

  it("counts rejections per code and never lets a rejected record block a later duplicate check", () => {
    const unknown = { evidence: ["E7_7"], quote: PIXEL_UNIT_1, text: "Google Pixel 10の価格は124,800円です。" };
    const converted = { evidence: ["E1_1"], quote: PIXEL_UNIT_1, text: "Google Pixel 10の価格は約12万円です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([unknown, converted, PIXEL_RECORD_1]), pixelPacket());
    expect(result.rejections).toEqual([
      { recordIndex: 0, code: "UNKNOWN_EVIDENCE_ID" },
      { recordIndex: 1, code: "NUMERIC_NOT_IN_QUOTE" },
    ]);
    expect(result.rejectionCounts.UNKNOWN_EVIDENCE_ID).toBe(1);
    expect(result.rejectionCounts.NUMERIC_NOT_IN_QUOTE).toBe(1);
    expect(result.rejectionCounts.DUPLICATE_RECORD).toBe(0);
    // The converted record was rejected before the duplicate step, so the
    // later valid record with the same quote is still accepted.
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].text).toBe(PIXEL_RECORD_1.text);
  });
});
