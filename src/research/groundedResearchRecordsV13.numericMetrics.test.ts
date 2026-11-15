import { describe, expect, it, vi } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import { GROUNDED_RESEARCH_FACT_SLOT_ENTRIES } from "./groundedResearchFactSlotsV13";
import {
  buildGroundedResearchFactSlotInstruction,
  buildGroundedResearchRecordsInstruction,
  buildGroundedResearchSelectionInstruction,
  executeGroundedResearchRecordsSynthesis,
} from "./groundedResearchRecordsV13";

// R-PR-8e (RPR8_DESIGN_2026-11-15 §8e): verbatim-rate observation.
// The stage metrics carry, for the record set that formed the
// adopted answer, the total numeric tokens of the records' texts
// (adoptedNumericTokenCount) and how many of them appear verbatim
// in their own record's quote (adoptedNumericVerbatimCount) — the
// §6.1 step 5 judgment, aggregated — so the verbatim-match rate is
// computable from production logs (R-PR-7 could not compute it from
// the harness result files). Observation only: validation, coverage,
// and adoption are unchanged, and the counts stand at 0 whenever
// nothing was adopted. All figures and names are fixture data.

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

const RECORDS_INSTRUCTION_JA = buildGroundedResearchRecordsInstruction("ja");
const SELECTION_INSTRUCTION_JA = buildGroundedResearchSelectionInstruction("ja");

// --- Numeric product fixtures (no slot entry matches the query) ---

const PRICE_UNIT = "新型モデルの価格は128,000円です。";
const BATTERY_UNIT = "駆動時間は20時間です。";
const WEIGHT_UNIT = "新型モデルの重さは180グラムです。";
const SCREEN_UNIT = "画面サイズは6.1インチです。";

function numericSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "新型モデルの仕様",
      url: "https://spec.example.jp/model",
      domain: "spec.example.jp",
      excerpt: `${PRICE_UNIT}${BATTERY_UNIT}`,
    }),
    makeSource({
      title: "新型モデルのレビュー",
      url: "https://review.example.jp/model",
      domain: "review.example.jp",
      rank: 2,
      excerpt: `${WEIGHT_UNIT}${SCREEN_UNIT}`,
    }),
  ];
}

// One numeric token per record text: 128000円 / 20 / 180 / 6.1.
const NUMERIC_RECORDS_JSON = JSON.stringify({
  records: [
    { evidence: ["E1_1"], quote: PRICE_UNIT, text: PRICE_UNIT },
    { evidence: ["E1_2"], quote: BATTERY_UNIT, text: BATTERY_UNIT },
    { evidence: ["E2_1"], quote: WEIGHT_UNIT, text: WEIGHT_UNIT },
    { evidence: ["E2_2"], quote: SCREEN_UNIT, text: SCREEN_UNIT },
  ],
});

const FABRICATED_RECORDS_JSON = JSON.stringify({
  records: [{ evidence: ["E1_1"], quote: "パケットに存在しない引用文です。", text: "新型モデルの価格は999円です。" }],
});

function layeredExecute(outputs: { records?: string; selection?: string }) {
  return vi.fn(async (request: OriginProviderExecutionRequest) => {
    if (request.systemInstruction === RECORDS_INSTRUCTION_JA) {
      if (outputs.records === undefined) throw new Error("records execution failed");
      return executionResult(outputs.records, 200);
    }
    if (request.systemInstruction === SELECTION_INSTRUCTION_JA) {
      if (outputs.selection === undefined) throw new Error("selection execution failed");
      return executionResult(outputs.selection, 300);
    }
    throw new Error("unexpected instruction");
  });
}

function helperOptions(overrides: Partial<Parameters<typeof executeGroundedResearchRecordsSynthesis>[1]> = {}) {
  return {
    plan: fakePlan,
    query: "新型モデルについて教えてください",
    sources: numericSources(),
    language: "ja" as const,
    enabled: true,
    assertZeroCost: () => {},
    ...overrides,
  };
}

describe("verbatim-rate observation (R-PR-8e)", () => {
  it("counts the numeric tokens of the adopted records and their verbatim matches (records form)", async () => {
    const execute = layeredExecute({ records: NUMERIC_RECORDS_JSON });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      finalForm: "records",
      renderedRecordCount: 4,
      adoptedNumericTokenCount: 4,
      adoptedNumericVerbatimCount: 4,
    });
  });

  it("counts the merged set's tokens when the fresh retry adopts (records-after-retry form)", async () => {
    const execute = layeredExecute({ records: FABRICATED_RECORDS_JSON });
    const executeRetry = vi.fn(async () => executionResult(NUMERIC_RECORDS_JSON, 400));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({
      executeRetry,
      startedAtMs: 1_000,
      now: () => 2_000,
    }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      finalForm: "records-after-retry",
      // The main-stage fields keep the initial (failed) evaluation;
      // the adopted counts describe the merged set that was rendered.
      acceptedRecordCount: 0,
      mergedAcceptedRecordCount: 4,
      adoptedNumericTokenCount: 4,
      adoptedNumericVerbatimCount: 4,
    });
  });

  it("counts the selected units' tokens when the selection layer adopts (selection form)", async () => {
    const execute = layeredExecute({
      records: FABRICATED_RECORDS_JSON,
      selection: "{\"select\":[\"E1_1\",\"E2_1\"]}",
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      finalForm: "selection",
      selectionCode: "SELECTION_ADOPTED",
      // The two selected units carry one numeric token each
      // (128000円 and 180); a pseudo-record's quote is the unit
      // itself, so every token is verbatim by construction.
      adoptedNumericTokenCount: 2,
      adoptedNumericVerbatimCount: 2,
    });
  });

  it("stays at zero for adopted records whose texts carry no numeric tokens", async () => {
    const sources = [
      makeSource({
        title: "製品紹介",
        url: "https://intro.example.jp/product",
        domain: "intro.example.jp",
        excerpt: "この製品は軽量で持ち運びに便利です。日常の作業に向いています。",
      }),
      makeSource({
        title: "利用者の声",
        url: "https://voice.example.jp/product",
        domain: "voice.example.jp",
        rank: 2,
        excerpt: "利用者からは静かな動作が好評です。",
      }),
    ];
    const recordsJson = JSON.stringify({
      records: [
        { evidence: ["E1_1"], quote: "この製品は軽量で持ち運びに便利です。", text: "この製品は軽量で持ち運びに便利です。" },
        { evidence: ["E2_1"], quote: "利用者からは静かな動作が好評です。", text: "利用者からは静かな動作が好評です。" },
      ],
    });
    const execute = layeredExecute({ records: recordsJson });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ sources }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      finalForm: "records",
      renderedRecordCount: 2,
      adoptedNumericTokenCount: 0,
      adoptedNumericVerbatimCount: 0,
    });
  });

  it("stays at zero when nothing is adopted", async () => {
    const execute = layeredExecute({
      records: FABRICATED_RECORDS_JSON,
      selection: "{\"select\":[]}",
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(false);
    expect(outcome.metrics).toMatchObject({
      finalForm: "partial",
      adoptedNumericTokenCount: 0,
      adoptedNumericVerbatimCount: 0,
    });
  });
});

// --- Slot form: the slot pseudo-record joins the count ---------------

const PM_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((entry) => entry.id === "incumbent-prime-minister-jp")!;
const SLOT_INSTRUCTION_JA = buildGroundedResearchFactSlotInstruction(PM_ENTRY, "ja");
const PM_UNIT_1 = "高市早苗は、第105代内閣総理大臣に指名された。";
const PM_UNIT_2 = "内閣総理大臣は、国会の議決により指名される。";
const PM2_UNIT_1 = "2026年11月現在、内閣総理大臣は高市早苗氏である。";
const PM_QUERY = "現在の内閣総理大臣は誰ですか？";

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
      rank: 2,
      excerpt: `${PM2_UNIT_1}高市氏は自由民主党の総裁を務めている。`,
    }),
  ];
}

describe("verbatim-rate observation: slot form (R-PR-8e)", () => {
  it("counts the supporting records plus the slot pseudo-record", async () => {
    const slotJson = JSON.stringify({ fields: { holder: { value: "高市早苗", src: "S1", quote: PM_UNIT_1 } } });
    const recordsJson = JSON.stringify({
      records: [
        { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" },
        { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "2026年11月時点でも内閣総理大臣は高市早苗氏です。" },
      ],
    });
    const execute = vi.fn(async (request: OriginProviderExecutionRequest) => {
      if (request.systemInstruction === SLOT_INSTRUCTION_JA) return executionResult(slotJson, 100);
      if (request.systemInstruction === RECORDS_INSTRUCTION_JA) return executionResult(recordsJson, 200);
      throw new Error("unexpected instruction");
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({
      query: PM_QUERY,
      sources: pmSources(),
    }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      finalForm: "slot",
      slotCode: "SLOT_ADOPTED",
      // Supporting records: 0 tokens (name only) + 2 tokens
      // (2026年・11月). Slot pseudo-record: the template sentence
      // carries the base date's 3 tokens (2026年・11月・14日),
      // covered by the date forms appended to its quote.
      adoptedNumericTokenCount: 5,
      adoptedNumericVerbatimCount: 5,
    });
  });
});
