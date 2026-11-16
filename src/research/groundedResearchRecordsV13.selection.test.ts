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
  buildGroundedResearchSelectionPrompt,
  evaluateGroundedResearchSelection,
  executeGroundedResearchRecordsSynthesis,
  parseGroundedResearchSelection,
  renderGroundedResearchSelectionAnswer,
  RECORDS_SELECTION_MAX_UNITS,
  type GroundedResearchRecordsPacket,
} from "./groundedResearchRecordsV13";

// R-PR-4 (design §4.4, §8, §11, §12): the select-only extraction
// layer. The model returns E-IDs only; the app renders the selected
// unit texts verbatim. Fixtures reuse the prime-minister shape of the
// R-PR-2/3 tests; all names are fixture data.

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

describe("buildGroundedResearchSelectionInstruction (design §8)", () => {
  it("asks for E-IDs only: in answer order, at most 5, no sentences", () => {
    const instruction = buildGroundedResearchSelectionInstruction("ja");
    expect(instruction).toContain("答える順に最大5件");
    expect(instruction).toContain("文章・見出し・解説は書かないでください");
    expect(instruction).toContain("{\"select\":[\"E1_1\",\"E2_1\"]}");
    expect(instruction).toContain("{\"select\":[]}");
    // The records schema is not part of this layer's contract.
    expect(instruction).not.toContain("\"records\"");
  });

  it("provides the en form with the same contract markers", () => {
    const instruction = buildGroundedResearchSelectionInstruction("en");
    expect(instruction).toContain("at most 5");
    expect(instruction).toContain("Do not write any sentence");
    expect(instruction).toContain("{\"select\":[\"E1_1\",\"E2_1\"]}");
  });
});

describe("buildGroundedResearchSelectionPrompt (design §8)", () => {
  it("carries the same E-ID packet as the records stage, but no packet URL", () => {
    const prompt = buildGroundedResearchSelectionPrompt("現在の内閣総理大臣は誰ですか？", pmPacket(), [], "ja");
    expect(prompt).toContain("現在の内閣総理大臣は誰ですか？");
    expect(prompt).toContain("[E1_1] 高市早苗は、第105代内閣総理大臣に指名された。");
    expect(prompt).toContain("出力契約");
    expect(prompt).toContain("最大5件");
    expect(prompt).not.toContain("https://www.kantei.example.go.jp/souri/");
    expect(prompt).not.toContain("citation_token");
  });
});

describe("parseGroundedResearchSelection (design §4.4)", () => {
  it("parses the JSON form first and keeps the model order", () => {
    const parsed = parseGroundedResearchSelection("{\"select\":[\"E2_1\",\"E1_1\"]}");
    expect(parsed.format).toBe("json");
    expect(parsed.ids).toEqual(["E2_1", "E1_1"]);
  });

  it("drops non-string JSON entries deterministically", () => {
    const parsed = parseGroundedResearchSelection("{\"select\":[\"E1_1\",42,null,\"E2_1\"]}");
    expect(parsed.format).toBe("json");
    expect(parsed.ids).toEqual(["E1_1", "E2_1"]);
  });

  it("parses the text form: one E-ID per line, other lines ignored", () => {
    const parsed = parseGroundedResearchSelection(["E1_1", "説明の文です。", " E2_1 ", "", "E1_2"].join("\n"));
    expect(parsed.format).toBe("text");
    expect(parsed.ids).toEqual(["E1_1", "E2_1", "E1_2"]);
  });

  it("treats a records-shaped JSON output as no selection (format null)", () => {
    const parsed = parseGroundedResearchSelection("{\"records\":[{\"evidence\":[\"E1_1\"]}]}");
    expect(parsed.format).toBeNull();
    expect(parsed.ids).toEqual([]);
  });

  it("yields format null for prose output", () => {
    const parsed = parseGroundedResearchSelection("よく分かりませんでした。");
    expect(parsed.format).toBeNull();
    expect(parsed.ids).toEqual([]);
  });
});

describe("evaluateGroundedResearchSelection (design §8)", () => {
  it("adopts a cross-source selection and preserves the model order verbatim", () => {
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E2_1\",\"E1_1\"]}", pmPacket());
    expect(evaluation.adopted).toBe(true);
    expect(evaluation.code).toBeNull();
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E2_1", "E1_1"]);
    expect(evaluation.selectedUnits.map((unit) => unit.text)).toEqual([PM2_UNIT_1, PM_UNIT_1]);
    expect(evaluation.citedSourceCount).toBe(2);
    expect(evaluation.requiredSourceCount).toBe(2);
  });

  it("drops unknown E-IDs at the existence step", () => {
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E9_9\",\"E1_1\",\"E2_1\"]}", pmPacket());
    expect(evaluation.adopted).toBe(true);
    expect(evaluation.unknownIdCount).toBe(1);
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E1_1", "E2_1"]);
  });

  it("dedupes after existence and before the cap, first occurrence wins", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        url: "https://a.example.com/1",
        domain: "a.example.com",
        excerpt: "第一の十分な長さの文です。第二の十分な長さの文です。第三の十分な長さの文です。第四の十分な長さの文です。",
      }),
      makeSource({
        url: "https://b.example.com/2",
        domain: "b.example.com",
        excerpt: "第五の十分な長さの文です。第六の十分な長さの文です。第七の十分な長さの文です。第八の十分な長さの文です。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchSelection(
      "{\"select\":[\"E1_1\",\"E1_2\",\"E1_3\",\"E1_4\",\"E2_1\",\"E2_2\",\"E1_1\"]}",
      packet,
    );
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E1_1", "E1_2", "E1_3", "E1_4", "E2_1"]);
    expect(evaluation.selectedUnits).toHaveLength(RECORDS_SELECTION_MAX_UNITS);
    // The 6th distinct unit hits the cap; the trailing repeat of E1_1
    // is counted as a duplicate, not as over-cap (cleanup order).
    expect(evaluation.overCapIdCount).toBe(1);
    expect(evaluation.duplicateIdCount).toBe(1);
    expect(evaluation.adopted).toBe(true);
  });

  it("fails with SELECTION_NO_UNITS when nothing usable is selected", () => {
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E9_9\"]}", pmPacket());
    expect(evaluation.adopted).toBe(false);
    expect(evaluation.code).toBe("SELECTION_NO_UNITS");
    expect(evaluation.selectedUnits).toEqual([]);
  });

  it("applies the records coverage bar: a single-source selection is not adopted", () => {
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E1_1\",\"E1_2\"]}", pmPacket());
    expect(evaluation.adopted).toBe(false);
    expect(evaluation.code).toBe("SELECTION_INSUFFICIENT_COVERAGE");
    expect(evaluation.citedSourceCount).toBe(1);
    expect(evaluation.coverageSatisfied).toBe(false);
  });

  it("adopts a one-unit selection when the packet itself has a single source", () => {
    const packet = buildGroundedResearchRecordsPacket([pmSources()[0]]);
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E1_1\"]}", packet);
    expect(evaluation.requiredSourceCount).toBe(1);
    expect(evaluation.adopted).toBe(true);
  });
});

describe("renderGroundedResearchSelectionAnswer (design §8)", () => {
  it("renders the selected unit texts verbatim, in model order, with the full source list", () => {
    const packet = pmPacket();
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E2_1\",\"E1_1\"]}", packet);
    const rendered = renderGroundedResearchSelectionAnswer(evaluation.selectedUnits, packet, "ja");
    expect(rendered).toBe([
      `- ${PM2_UNIT_1} [S2](https://news.example.co.jp/pm)`,
      `- ${PM_UNIT_1} [S1](https://www.kantei.example.go.jp/souri/)`,
      "",
      ...PM_SOURCE_LIST,
    ].join("\n"));
  });
});

// --- Shared execution helper: layer wiring ----------------------------------

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
// (R-PR-6, design §9): a slot-shaped question (e.g. the prime-minister
// question the fixtures are modeled on) spends its first execution on
// the slot layer. This file pins the selection contract and its
// execution counts for requests that reach the records stage
// directly; the slot branch is pinned in
// groundedResearchRecordsV13.slot.test.ts.
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

const PM_RECORDS_JSON = JSON.stringify({
  records: [
    { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" },
    { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "2026年11月時点でも内閣総理大臣は高市早苗氏です。" },
  ],
});

const FABRICATED_RECORDS_JSON = JSON.stringify({
  records: [{ evidence: ["E1_1"], quote: "パケットに存在しない引用文です。", text: "現在の内閣総理大臣は高市早苗です。" }],
});

const SELECTION_JSON = "{\"select\":[\"E1_1\",\"E2_1\"]}";

const EXPECTED_SELECTION_RENDER = [
  `- ${PM_UNIT_1} [S1](https://www.kantei.example.go.jp/souri/)`,
  `- ${PM2_UNIT_1} [S2](https://news.example.co.jp/pm)`,
  "",
  ...PM_SOURCE_LIST,
].join("\n");

describe("executeGroundedResearchRecordsSynthesis selection layer (design §8/§11/§12)", () => {
  it("never fires the selection layer when the records stage adopts", async () => {
    const execute = sequencedExecute(PM_RECORDS_JSON, SELECTION_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics?.finalForm).toBe("records");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(outcome.metrics).toMatchObject({
      executionCount: 1,
      selectionAttempted: false,
      selectionSelectedUnitCount: 0,
      selectionCitedSourceCount: 0,
      selectionCode: null,
    });
  });

  it("adopts the selection when every record is rejected, and consumes the selection result", async () => {
    const execute = sequencedExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(EXPECTED_SELECTION_RENDER);
    expect(outcome.usedSourceIds).toEqual(["S1", "S2"]);
    // The consumed result is the selection execution's (V12 retry
    // helper precedent), and the request was the selection request.
    expect(outcome.result?.text).toBe(SELECTION_JSON);
    expect(execute).toHaveBeenCalledTimes(2);
    const selectionRequest = execute.mock.calls[1]?.[0];
    expect(selectionRequest?.systemInstruction).toBe(buildGroundedResearchSelectionInstruction("ja"));
    expect(selectionRequest?.messages[0]?.content).toContain("[E1_1]");
    expect(selectionRequest?.messages[0]?.content).not.toContain("https://www.kantei.example.go.jp/souri/");
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      synthesisDurationMs: 1234 + 555,
      zeroCostAsserted: true,
      acceptedRecordCount: 0,
      selectionAttempted: true,
      selectionSelectedUnitCount: 2,
      selectionCitedSourceCount: 2,
      selectionCode: "SELECTION_ADOPTED",
      renderedRecordCount: 2,
      renderCheckFailed: false,
      finalForm: "selection",
    });
    expect(outcome.failureCode).toBeUndefined();
  });

  it("adopts the text-form selection as well", async () => {
    const execute = sequencedExecute(FABRICATED_RECORDS_JSON, "E1_1\nE2_1");
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(EXPECTED_SELECTION_RENDER);
    expect(outcome.metrics?.selectionCode).toBe("SELECTION_ADOPTED");
  });

  it("fires after INSUFFICIENT_SOURCE_COVERAGE too, and can still adopt", async () => {
    const singleSourceRecords = JSON.stringify({
      records: [{ evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" }],
    });
    const execute = sequencedExecute(singleSourceRecords, SELECTION_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics?.finalForm).toBe("selection");
    expect(outcome.metrics?.coverageSatisfied).toBe(false);
  });

  it("keeps the records failure code when the selection also fails (partial answer)", async () => {
    const execute = sequencedExecute(FABRICATED_RECORDS_JSON, "{\"select\":[]}");
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("NO_ACCEPTED_RECORDS");
    // The records execution result stands as the consumed result.
    expect(outcome.result?.text).toBe(FABRICATED_RECORDS_JSON);
    expect(outcome.text).toBeUndefined();
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      selectionAttempted: true,
      selectionSelectedUnitCount: 0,
      selectionCitedSourceCount: 0,
      selectionCode: "SELECTION_NO_UNITS",
      finalForm: "partial",
    });
  });

  it("records a coverage failure of the selection layer in metrics, then salvages the selected units (improvement #2)", async () => {
    const execute = sequencedExecute(FABRICATED_RECORDS_JSON, "{\"select\":[\"E1_1\",\"E1_2\"]}");
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    // The selection layer's own verdict is unchanged (coverage
    // failure, recorded in metrics); before improvement #2 the
    // request then failed with NO_ACCEPTED_RECORDS and the two
    // verified units were discarded. The salvage stage now
    // delivers them as a partial answer.
    expect(outcome.adopted).toBe(true);
    expect(outcome.partial).toBe(true);
    expect(outcome.failureCode).toBeUndefined();
    expect(outcome.text).toContain(PM_UNIT_1);
    expect(outcome.text).toContain(PM_UNIT_2);
    expect(outcome.metrics).toMatchObject({
      selectionAttempted: true,
      selectionSelectedUnitCount: 2,
      selectionCitedSourceCount: 1,
      selectionCode: "SELECTION_INSUFFICIENT_COVERAGE",
      salvageCode: "SALVAGE_ADOPTED",
      salvageDeliveredCount: 2,
      finalForm: "salvage",
    });
  });

  it("contains a selection execution error inside the layer (no throw)", async () => {
    const execute = vi.fn(async (request: OriginProviderExecutionRequest) => {
      if (request.systemInstruction === buildGroundedResearchSelectionInstruction("ja")) {
        throw new Error("provider down at selection");
      }
      return executionResult(FABRICATED_RECORDS_JSON, 1234);
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("NO_ACCEPTED_RECORDS");
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      selectionAttempted: true,
      selectionCode: "SELECTION_EXECUTION_FAILED",
      finalForm: "partial",
    });
  });

  it("contains a $0 assertion failure on the selection result inside the layer", async () => {
    const execute = sequencedExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    let assertions = 0;
    const options = helperOptions({
      assertZeroCost: () => {
        assertions += 1;
        if (assertions === 2) throw new Error("cost violation at selection");
      },
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, options);
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("NO_ACCEPTED_RECORDS");
    expect(outcome.metrics?.selectionCode).toBe("SELECTION_EXECUTION_FAILED");
  });
});
