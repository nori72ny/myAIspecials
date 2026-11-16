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
  executeGroundedResearchRecordsSynthesis,
  groundedResearchRecordsSalvageNote,
  renderGroundedResearchRecomposedAnswer,
  type GroundedResearchAcceptedRecord,
  type GroundedResearchRecordsPacket,
} from "./groundedResearchRecordsV13";

// R-PR-9d (RPR9_DESIGN_2026-11-15 §2 R9-D): the recomposition stage
// at the selection layer's position. The records stage's accepted
// records are retained instead of discarded, pooled with the
// selection layer's surviving units (material supply), and — when
// the pool satisfies the same coverage bar — recomposed
// deterministically (heading, packet-order sentences, evidence
// block) under the same post-render check. Fixtures reuse the
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

const S1_RECORD: GroundedResearchAcceptedRecord = {
  sourceId: "S1",
  sourceIndex: 0,
  evidenceIds: ["E1_1"],
  quote: PM_UNIT_1,
  text: "現在の内閣総理大臣は高市早苗です。",
  quoteStart: 0,
};

const S2_UNIT_RECORD: GroundedResearchAcceptedRecord = {
  sourceId: "S2",
  sourceIndex: 1,
  evidenceIds: ["E2_1"],
  quote: PM2_UNIT_1,
  text: PM2_UNIT_1,
  quoteStart: 0,
};

describe("renderGroundedResearchRecomposedAnswer (R-PR-9d)", () => {
  it("renders heading, body bullets, the evidence block, and the source list (ja)", () => {
    const rendered = renderGroundedResearchRecomposedAnswer([S1_RECORD, S2_UNIT_RECORD], pmPacket(), "ja");
    expect(rendered).toBe([
      "## 確認できた内容",
      "",
      `- 現在の内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)`,
      `- ${PM2_UNIT_1} [S2](https://news.example.co.jp/pm)`,
      "",
      // The record's quote backs its sentence; the unit's quote is
      // its own sentence, so no duplicate evidence line for it.
      `根拠の引用文：「${PM_UNIT_1}」 [S1](https://www.kantei.example.go.jp/souri/)`,
      "",
      ...PM_SOURCE_LIST,
    ].join("\n"));
  });

  it("renders the en form with the same structure", () => {
    const rendered = renderGroundedResearchRecomposedAnswer([S1_RECORD, S2_UNIT_RECORD], pmPacket(), "en");
    expect(rendered).toContain("## What could be confirmed");
    expect(rendered).toContain(`Supporting quote: "${PM_UNIT_1}" [S1](https://www.kantei.example.go.jp/souri/)`);
    expect(rendered).toContain("## Sources");
  });

  it("omits the evidence block when every quote is its own sentence", () => {
    const rendered = renderGroundedResearchRecomposedAnswer([S2_UNIT_RECORD], pmPacket(), "ja");
    expect(rendered).not.toContain("根拠の引用文");
    expect(rendered).toContain(`- ${PM2_UNIT_1} [S2](https://news.example.co.jp/pm)`);
  });
});

// --- Shared execution helper: recomposition wiring --------------------------

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

// The fixture query is deliberately NOT a single-fact-slot question
// (the slot branch is pinned in groundedResearchRecordsV13.slot.test.ts).
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
function sequencedExecute(recordsText: string, selectionText: string) {
  return vi.fn(async (request: OriginProviderExecutionRequest) => {
    if (request.systemInstruction === buildGroundedResearchRecordsInstruction("ja")) {
      return executionResult(recordsText, 1234);
    }
    if (request.systemInstruction === buildGroundedResearchSelectionInstruction("ja")) {
      return executionResult(selectionText, 555);
    }
    throw new Error("unexpected instruction");
  });
}

const SINGLE_S1_RECORD_JSON = JSON.stringify({
  records: [{ evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" }],
});

const SINGLE_S2_RECORD_JSON = JSON.stringify({
  records: [{ evidence: ["E2_1"], quote: PM2_UNIT_1, text: "首相は高市早苗氏です。" }],
});

const FABRICATED_RECORDS_JSON = JSON.stringify({
  records: [{ evidence: ["E1_1"], quote: "パケットに存在しない引用文です。", text: "現在の内閣総理大臣は高市早苗です。" }],
});

const SELECTION_EMPTY_JSON = "{\"select\":[]}";

describe("executeGroundedResearchRecordsSynthesis recomposition stage (R-PR-9d)", () => {
  it("adopts the recomposition when records and selection units complete coverage together", async () => {
    // Records: one S1 record (coverage fails). Selection: one S2
    // unit (coverage fails on its own too). Pooled, coverage is
    // satisfied — before R-PR-9d this request lost both materials.
    const execute = sequencedExecute(SINGLE_S1_RECORD_JSON, "{\"select\":[\"E2_1\"]}");
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.failureCode).toBeUndefined();
    expect(outcome.usedSourceIds).toEqual(["S1", "S2"]);
    // The consumed result is the selection execution's (the last
    // execution whose material the recomposition consumed).
    expect(outcome.result?.text).toBe("{\"select\":[\"E2_1\"]}");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(outcome.text).toBe([
      "## 確認できた内容",
      "",
      `- 現在の内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)`,
      `- ${PM2_UNIT_1} [S2](https://news.example.co.jp/pm)`,
      "",
      `根拠の引用文：「${PM_UNIT_1}」 [S1](https://www.kantei.example.go.jp/souri/)`,
      "",
      ...PM_SOURCE_LIST,
    ].join("\n"));
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      selectionAttempted: true,
      selectionCode: "SELECTION_INSUFFICIENT_COVERAGE",
      recompositionAttempted: true,
      recompositionMaterialCount: 2,
      recompositionCode: "RECOMPOSITION_ADOPTED",
      renderedRecordCount: 2,
      finalForm: "recomposition",
    });
    // Adopted outcomes carry their material in the text, not in the
    // retention field.
    expect(outcome.acceptedRecords).toBeUndefined();
  });

  it("orders the recomposed body deterministically (packet order), not by material arrival order", async () => {
    // The S2 record arrives first (records stage), the S1 unit
    // second (selection); the body must still open with S1.
    const execute = sequencedExecute(SINGLE_S2_RECORD_JSON, "{\"select\":[\"E1_1\"]}");
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics?.finalForm).toBe("recomposition");
    const text = outcome.text ?? "";
    const s1Bullet = text.indexOf(`- ${PM_UNIT_1}`);
    const s2Bullet = text.indexOf("- 首相は高市早苗氏です。");
    expect(s1Bullet).toBeGreaterThanOrEqual(0);
    expect(s2Bullet).toBeGreaterThan(s1Bullet);
  });

  it("delivers the retained record as a partial answer when the pool cannot satisfy coverage (improvement #2)", async () => {
    const execute = sequencedExecute(SINGLE_S1_RECORD_JSON, SELECTION_EMPTY_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    // Before records improvement #2 this request failed with
    // INSUFFICIENT_SOURCE_COVERAGE and the verified record only rode
    // the outcome as retention data while the caller fell back to
    // the source-list-only answer. The salvage stage now delivers
    // the record as a partial answer, marked partial, leading with
    // the plain-language note.
    expect(outcome.adopted).toBe(true);
    expect(outcome.partial).toBe(true);
    expect(outcome.failureCode).toBeUndefined();
    expect(outcome.text).toBe([
      groundedResearchRecordsSalvageNote("ja"),
      "",
      `- 現在の内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)`,
      "",
      ...PM_SOURCE_LIST,
    ].join("\n"));
    // Adopted outcomes carry their material in the text, not in the
    // retention field.
    expect(outcome.acceptedRecords).toBeUndefined();
    expect(outcome.metrics).toMatchObject({
      recompositionAttempted: true,
      recompositionMaterialCount: 1,
      recompositionCode: "RECOMPOSITION_INSUFFICIENT_COVERAGE",
      salvageAttempted: true,
      salvageMaterialCount: 1,
      salvageDeliveredCount: 1,
      salvageCode: "SALVAGE_ADOPTED",
      finalForm: "salvage",
    });
  });

  it("retains an empty set and reports NO_MATERIAL when nothing verified survived", async () => {
    const execute = sequencedExecute(FABRICATED_RECORDS_JSON, SELECTION_EMPTY_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("NO_ACCEPTED_RECORDS");
    expect(outcome.acceptedRecords).toEqual([]);
    expect(outcome.metrics).toMatchObject({
      recompositionAttempted: true,
      recompositionMaterialCount: 0,
      recompositionCode: "RECOMPOSITION_NO_MATERIAL",
      salvageAttempted: true,
      salvageMaterialCount: 0,
      salvageDeliveredCount: 0,
      salvageCode: "SALVAGE_NO_MATERIAL",
      finalForm: "partial",
    });
  });

  it("delivers the retry-merged records as a partial answer when the merged set still cannot adopt in full (improvement #2)", async () => {
    const execute = sequencedExecute(FABRICATED_RECORDS_JSON, SELECTION_EMPTY_JSON);
    const executeRetry = vi.fn(async () => executionResult(SINGLE_S1_RECORD_JSON, 777));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    // The standing code is re-judged over the merged set (one
    // survivor: the coverage verdict), and the merged survivor is
    // then delivered by the salvage stage as a partial answer
    // instead of only riding the outcome as retention data.
    expect(outcome.adopted).toBe(true);
    expect(outcome.partial).toBe(true);
    expect(outcome.failureCode).toBeUndefined();
    expect(outcome.usedSourceIds).toEqual(["S1"]);
    expect(outcome.text).toContain("現在の内閣総理大臣は高市早苗です。");
    expect(outcome.acceptedRecords).toBeUndefined();
    expect(outcome.metrics).toMatchObject({
      executionCount: 3,
      mergedAcceptedRecordCount: 1,
      recompositionMaterialCount: 1,
      recompositionCode: "RECOMPOSITION_INSUFFICIENT_COVERAGE",
      salvageCode: "SALVAGE_ADOPTED",
      finalForm: "salvage",
    });
  });

  it("completes the pool with selection units after a retry, inside the three-execution cap", async () => {
    const execute = sequencedExecute(SINGLE_S1_RECORD_JSON, "{\"select\":[\"E2_1\"]}");
    const executeRetry = vi.fn(async () => executionResult(FABRICATED_RECORDS_JSON, 777));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      executionCount: 3,
      recompositionMaterialCount: 2,
      recompositionCode: "RECOMPOSITION_ADOPTED",
      finalForm: "recomposition",
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(executeRetry).toHaveBeenCalledTimes(1);
  });

  it("never runs when the kill switch is off: no retention field, no execution", async () => {
    const execute = sequencedExecute(SINGLE_S1_RECORD_JSON, SELECTION_EMPTY_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ enabled: false }));
    expect(outcome.attempted).toBe(false);
    expect(outcome.adopted).toBe(false);
    expect(outcome.acceptedRecords).toBeUndefined();
    expect(outcome.metrics).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });
});
