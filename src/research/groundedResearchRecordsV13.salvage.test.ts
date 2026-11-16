import { describe, expect, it, vi } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import {
  buildGroundedResearchRecordsInstruction,
  buildGroundedResearchRecordsPacket,
  buildGroundedResearchSelectionInstruction,
  checkGroundedResearchRenderedAnswer,
  executeGroundedResearchRecordsSynthesis,
  groundedResearchRecordsSalvageNote,
  renderGroundedResearchRecordsAnswer,
  salvageGroundedResearchRecordsMaterial,
  type GroundedResearchAcceptedRecord,
  type GroundedResearchRecordsPacket,
} from "./groundedResearchRecordsV13";

// Records improvement #2 (RPR9_MEASUREMENT_ADJUDICATION_2026-11-16,
// improvement candidate 2): the partial-answer salvage stage. When
// every full-adoption layer has failed but the recomposition pool
// still holds verified material, the pool is rendered, re-checked,
// and adopted as a partial answer — marked partial, leading with
// the plain-language note — instead of being discarded into the
// caller's source-list-only fallback. Fixtures reuse the
// prime-minister shape of the R-PR-2/3 tests; all names are fixture
// data.

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
const PM2_UNIT_2 = "高市氏は自由民主党の総裁を務めている。";

function pmSources(): OriginResearchSource[] {
  return [
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
      excerpt: `${PM2_UNIT_1}${PM2_UNIT_2}`,
    }),
  ];
}

function pmPacket(): GroundedResearchRecordsPacket {
  return buildGroundedResearchRecordsPacket(pmSources());
}

const PM_SOURCE_LIST = [
  "## 出典",
  "- S1: 内閣総理大臣の指名について（kantei.example.go.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S1](https://www.kantei.example.go.jp/souri/)",
  "- S2: 首相ニュース（news.example.co.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S2](https://news.example.co.jp/pm)",
];

const fakePlan = { providerId: "openrouter", modelId: "google/gemma-4-31b-it:free" } as unknown as OriginProviderExecutionRequest["plan"];

function executionResult(text: string, durationMs: number): OriginProviderExecutionResult {
  return {
    text,
    transportRequestCount: 1,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
    attempts: [{ providerId: "openrouter", modelId: "google/gemma-4-31b-it:free", outcome: "succeeded", durationMs }],
  } as OriginProviderExecutionResult;
}

function helperOptions(overrides: Partial<Parameters<typeof executeGroundedResearchRecordsSynthesis>[1]> = {}) {
  return {
    plan: fakePlan,
    query: "公開情報の要点を調査してください",
    sources: pmSources(),
    language: "ja" as const,
    enabled: true,
    assertZeroCost: () => {},
    ...overrides,
  };
}

/** Routes each execution by its instruction: records vs selection. */
function sequencedExecute(recordsText: string, selectionText: string, language: "ja" | "en" = "ja") {
  return vi.fn(async (request: OriginProviderExecutionRequest) => {
    if (request.systemInstruction === buildGroundedResearchRecordsInstruction(language)) {
      return executionResult(recordsText, 1234);
    }
    if (request.systemInstruction === buildGroundedResearchSelectionInstruction(language)) {
      return executionResult(selectionText, 555);
    }
    throw new Error("unexpected instruction");
  });
}

const SINGLE_S1_RECORD_JSON = JSON.stringify({
  records: [{ evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" }],
});

const BOTH_SOURCES_RECORDS_JSON = JSON.stringify({
  records: [
    { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" },
    { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "首相は高市早苗氏です。" },
  ],
});

const FABRICATED_RECORDS_JSON = JSON.stringify({
  records: [{ evidence: ["E1_1"], quote: "パケットに存在しない引用文です。", text: "現在の内閣総理大臣は高市早苗です。" }],
});

const SELECTION_EMPTY_JSON = "{\"select\":[]}";

const EXPECTED_SALVAGED_TEXT = [
  groundedResearchRecordsSalvageNote("ja"),
  "",
  "- 現在の内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)",
  "",
  ...PM_SOURCE_LIST,
].join("\n");

describe("executeGroundedResearchRecordsSynthesis partial-answer salvage (improvement #2)", () => {
  it("adopts verified single-source material as a partial answer instead of discarding it", async () => {
    // Records: one S1 record (coverage fails). Selection: nothing.
    // Before this stage the request fell to the source-list-only
    // fallback even though the S1 record is fully verified.
    const execute = sequencedExecute(SINGLE_S1_RECORD_JSON, SELECTION_EMPTY_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.partial).toBe(true);
    expect(outcome.failureCode).toBeUndefined();
    expect(outcome.usedSourceIds).toEqual(["S1"]);
    expect(outcome.text).toBe(EXPECTED_SALVAGED_TEXT);
    // The consumed result is the selection execution's (the last
    // execution whose material the delivered answer consumed).
    expect(outcome.result?.text).toBe(SELECTION_EMPTY_JSON);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(outcome.metrics).toMatchObject({
      recompositionAttempted: true,
      recompositionMaterialCount: 1,
      recompositionCode: "RECOMPOSITION_INSUFFICIENT_COVERAGE",
      salvageAttempted: true,
      salvageMaterialCount: 1,
      salvageDeliveredCount: 1,
      salvageCode: "SALVAGE_ADOPTED",
      renderedRecordCount: 1,
      finalForm: "salvage",
    });
    // Adopted outcomes carry their material in the text, not in the
    // retention field.
    expect(outcome.acceptedRecords).toBeUndefined();
  });

  it("delivers selection survivors as a partial answer when no record was accepted", async () => {
    // Records: fabricated (zero accepted). Selection: one S1 unit —
    // coverage fails on its own, so the recomposition pool holds
    // exactly that verbatim unit. The salvage delivers it.
    const execute = sequencedExecute(FABRICATED_RECORDS_JSON, "{\"select\":[\"E1_1\"]}");
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.partial).toBe(true);
    expect(outcome.text).toContain(`- ${PM_UNIT_1} [S1](https://www.kantei.example.go.jp/souri/)`);
    expect(outcome.text?.startsWith(groundedResearchRecordsSalvageNote("ja"))).toBe(true);
    expect(outcome.metrics).toMatchObject({
      acceptedRecordCount: 0,
      selectionCode: "SELECTION_INSUFFICIENT_COVERAGE",
      salvageCode: "SALVAGE_ADOPTED",
      salvageDeliveredCount: 1,
      finalForm: "salvage",
    });
  });

  it("does not fire when nothing verified survived (total failure stands)", async () => {
    const execute = sequencedExecute(FABRICATED_RECORDS_JSON, SELECTION_EMPTY_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(false);
    expect(outcome.partial).toBeUndefined();
    expect(outcome.failureCode).toBe("NO_ACCEPTED_RECORDS");
    expect(outcome.text).toBeUndefined();
    expect(outcome.acceptedRecords).toEqual([]);
    expect(outcome.metrics).toMatchObject({
      salvageAttempted: true,
      salvageMaterialCount: 0,
      salvageDeliveredCount: 0,
      salvageCode: "SALVAGE_NO_MATERIAL",
      finalForm: "partial",
    });
  });

  it("does not fire when the records stage adopts in full", async () => {
    const execute = sequencedExecute(BOTH_SOURCES_RECORDS_JSON, SELECTION_EMPTY_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.partial).toBeUndefined();
    expect(outcome.text).not.toContain(groundedResearchRecordsSalvageNote("ja"));
    expect(outcome.metrics).toMatchObject({
      salvageAttempted: false,
      salvageCode: null,
      finalForm: "records",
    });
    // Full adoption settles at the records stage: the selection
    // execution never runs.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the recomposition adopts in full", async () => {
    const execute = sequencedExecute(SINGLE_S1_RECORD_JSON, "{\"select\":[\"E2_1\"]}");
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.partial).toBeUndefined();
    expect(outcome.metrics).toMatchObject({
      recompositionCode: "RECOMPOSITION_ADOPTED",
      salvageAttempted: false,
      salvageCode: null,
      finalForm: "recomposition",
    });
  });

  it("leads with the English note for English requests", async () => {
    const execute = sequencedExecute(SINGLE_S1_RECORD_JSON, SELECTION_EMPTY_JSON, "en");
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ language: "en" }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.partial).toBe(true);
    expect(outcome.text?.startsWith(groundedResearchRecordsSalvageNote("en"))).toBe(true);
    expect(outcome.text).toContain("## Sources");
  });

  it("keeps the note free of internal vocabulary", () => {
    for (const language of ["ja", "en"] as const) {
      const note = groundedResearchRecordsSalvageNote(language);
      expect(note).not.toContain("レコード");
      expect(note).not.toContain("ゲート");
      expect(note).not.toContain("records");
      expect(note).not.toContain("validation");
      expect(note).not.toMatch(/https?:\/\//);
      expect(note).not.toMatch(/[0-9０-９]/);
    }
  });
});

describe("salvageGroundedResearchRecordsMaterial (per-line judgement)", () => {
  const goodRecord: GroundedResearchAcceptedRecord = {
    sourceId: "S1",
    sourceIndex: 0,
    evidenceIds: ["E1_1"],
    quote: PM_UNIT_1,
    text: "現在の内閣総理大臣は高市早苗です。",
    quoteStart: 0,
  };
  // A record whose text states a numeric value its quote does not
  // contain: validation would never accept it, but if a renderer
  // regression ever pooled one, its body line fails the post-render
  // check's numeric arm and the salvage must drop exactly it.
  const numericBadRecord: GroundedResearchAcceptedRecord = {
    sourceId: "S1",
    sourceIndex: 0,
    evidenceIds: ["E1_2"],
    quote: PM_UNIT_2,
    text: "内閣総理大臣の年収は4,030万円です。",
    quoteStart: 30,
  };

  it("returns the note plus the checked rendering when the material passes as-is", () => {
    const packet = pmPacket();
    const salvaged = salvageGroundedResearchRecordsMaterial([goodRecord], packet, "ja");
    expect(salvaged).not.toBeNull();
    expect(salvaged?.records).toEqual([goodRecord]);
    expect(salvaged?.text).toBe(EXPECTED_SALVAGED_TEXT);
    // The delivered material part passes the unchanged check.
    const rendered = renderGroundedResearchRecordsAnswer([goodRecord], packet, "ja");
    expect(checkGroundedResearchRenderedAnswer(rendered, packet, [goodRecord]).ok).toBe(true);
  });

  it("drops only the record behind the failing body line and delivers the rest", () => {
    const packet = pmPacket();
    const salvaged = salvageGroundedResearchRecordsMaterial([goodRecord, numericBadRecord], packet, "ja");
    expect(salvaged).not.toBeNull();
    expect(salvaged?.records).toEqual([goodRecord]);
    expect(salvaged?.text).toContain("現在の内閣総理大臣は高市早苗です。");
    expect(salvaged?.text).not.toContain("年収");
    expect(salvaged?.text).not.toContain("4,030");
  });

  it("returns null when every record fails the check", () => {
    const packet = pmPacket();
    expect(salvageGroundedResearchRecordsMaterial([numericBadRecord], packet, "ja")).toBeNull();
  });

  it("returns null for empty material", () => {
    expect(salvageGroundedResearchRecordsMaterial([], pmPacket(), "ja")).toBeNull();
  });
});
